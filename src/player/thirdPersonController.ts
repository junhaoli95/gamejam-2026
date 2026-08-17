import * as THREE from 'three';
import { CONFIG } from '../game/config';

// ─────────────────────────────────────────────────────────────────────────────
// Third-person controller — 视角方案 D(PR #12 spec §2.8)
//
// 坦克式控制:W/S 沿角色朝向前后移动;A/D 直接控制 yaw 转向(无平移);
// 无指针锁 / 无鼠标:移动端友好,6 键操作 → 5 键(A/D 还兼任转向)。
// 相机:沿用 PR #8 的越肩 spring-damp + AABB 防穿 + minDist clamp(PR #11
// 视角 yaw 改由按键驱动而非鼠标)。
// 碰撞:玩家=半径 RADIUS 的圆柱,对场景静态 AABB 做分轴 move-and-clamp;
// 相机用连续 segment-vs-AABB(slab)求清距,被挡时绕 head 侧滑摆角找远机位(防穿书架+防拉近)。
// ─────────────────────────────────────────────────────────────────────────────

export interface ThirdPersonController {
  update: (dt: number) => void;
  getYaw: () => number;
  /** 读取这一帧的方向/Shift 状态(Shift 为持续按住,供 playerStats.step 调 updateDash)。
   *  供主循环 const input = controller.getInput(); playerStats.step(dt, input); */
  getInput: () => { fwd: number; strafe: number; shift: boolean };
}

interface ControllerOptions {
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement;
  player: THREE.Group;
  colliders: THREE.Box3[];
  bounds: { w: number; d: number };
  overlay: HTMLElement;
  /** dash 倍速回调。idle=1,冲刺=CONFIG.dash.dashMult。controller 不持有 game 状态,只读外部 mult。 */
  getDashMult: () => number;
}

// 视角 D 删鼠标后,pitch 固定为 PR #8 时的 0.16 默认值(略低头);
// 改为动态可调由 playtest 需求驱动,目前 inline 常量最简洁。
const FIXED_PITCH = 0.16;

export function createThirdPersonController(opts: ControllerOptions): ThirdPersonController {
  const { camera, dom: _dom, player, colliders, bounds, overlay: _overlay, getDashMult } = opts;
  void _dom;  // dom 仅用于历史 pointer lock;视角 D 不再使用,保留接口不破外部调用点
  void _overlay; // commit 5 把 overlay click → 隐藏 + gameStarted flag 移到 main.ts(整合 commit)

  let yaw = 0;           // 0 = 相机在角色 +z 后方,看向 -z(书库深处)
  const keys = new Set<string>();

  window.addEventListener('keydown', (e: KeyboardEvent) => keys.add(e.code));
  window.addEventListener('keyup', (e: KeyboardEvent) => keys.delete(e.code));

  // 分轴碰撞:移动后若玩家圆陷入某 AABB(半径外扩),沿该轴推出到贴面
  function resolveAxis(axis: 'x' | 'z'): void {
    const p = player.position;
    for (const b of colliders) {
      if (
        p.x > b.min.x - CONFIG.player.radius && p.x < b.max.x + CONFIG.player.radius &&
        p.z > b.min.z - CONFIG.player.radius && p.z < b.max.z + CONFIG.player.radius
      ) {
        if (axis === 'x') {
          p.x = p.x < (b.min.x + b.max.x) / 2 ? b.min.x - CONFIG.player.radius : b.max.x + CONFIG.player.radius;
        } else {
          p.z = p.z < (b.min.z + b.max.z) / 2 ? b.min.z - CONFIG.player.radius : b.max.z + CONFIG.player.radius;
        }
      }
    }
  }

  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const camOffset = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();           // camera tune 2:摆角射线终点
  const targetCamPos = new THREE.Vector3();
  const camCurOff = new THREE.Vector3();      // camera tune:当前相机→head 偏移
  const camTargetOff = new THREE.Vector3();   // camera tune:目标机位→head 偏移
  const Y_AXIS = new THREE.Vector3(0, 1, 0);  // camera tune 2:绕 head 侧滑摆角轴
  let prevSwing = 0;                          // camera tune 2:上帧摆角(滞回)

  // 连续 slab segment-vs-AABB(camera tune 第二轮):from→to 线段上最近碰撞前的
  // t ∈ [0,1](1 = 全通)。取代 collideSteps 8 步量化采样 → 无 0.125 阶梯跳;
  // 且返回连续清距,供侧滑摆角选择用。零分配(手工展开三轴)。
  const segDir = new THREE.Vector3();
  function segmentClearFraction(from: THREE.Vector3, to: THREE.Vector3): number {
    segDir.subVectors(to, from);
    const pad = CONFIG.camera.collidePad;
    let tClear = 1;
    for (const b of colliders) {
      let t0 = 0;
      let t1 = 1;
      let hit = true;
      const dx = segDir.x;
      if (Math.abs(dx) < 1e-9) {
        if (from.x < b.min.x - pad || from.x > b.max.x + pad) hit = false;
      } else {
        let ta = (b.min.x - pad - from.x) / dx;
        let tb = (b.max.x + pad - from.x) / dx;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) hit = false;
      }
      if (hit) {
        const dy = segDir.y;
        if (Math.abs(dy) < 1e-9) {
          if (from.y < b.min.y - pad || from.y > b.max.y + pad) hit = false;
        } else {
          let ta = (b.min.y - pad - from.y) / dy;
          let tb = (b.max.y + pad - from.y) / dy;
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) hit = false;
        }
      }
      if (hit) {
        const dz = segDir.z;
        if (Math.abs(dz) < 1e-9) {
          if (from.z < b.min.z - pad || from.z > b.max.z + pad) hit = false;
        } else {
          let ta = (b.min.z - pad - from.z) / dz;
          let tb = (b.max.z + pad - from.z) / dz;
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) hit = false;
        }
      }
      if (hit) tClear = Math.min(tClear, Math.max(0, t0));
    }
    return tClear;
  }

  // DEV-only:供 MCP / console 读相机状态(camera tune playtest 验证,prod 不含)
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __camDebug: {
        getDist: () => camera.position.distanceTo(headPos),
        getPos: () => camera.position.toArray(),
      },
    });
  }

  return {
    getYaw: () => yaw,
    getInput: () => {
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
      return { fwd, strafe, shift };
    },
    update: (dt: number) => {
      // ── 视角 D:A/D 转向(W/S 不参与) ──
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);

      if (strafe !== 0) {
        // strafe=+1 (D) → yaw -= (向右转,符合"右转看右手"直觉)
        yaw -= strafe * CONFIG.player.turnRate * dt;
      }

      // ── 移动:W/S 沿角色朝向前后(无 strafe 平移) ──
      if (fwd !== 0) {
        // 视角 D 删 sprintSpeed;速度纯由 walkSpeed * dashMult 决定
        const speed = CONFIG.player.walkSpeed * getDashMult();
        const moveX = -Math.sin(yaw) * fwd * speed * dt;
        const moveZ = -Math.cos(yaw) * fwd * speed * dt;
        player.position.x += moveX;
        resolveAxis('x');
        player.position.z += moveZ;
        resolveAxis('z');
      }

      // 角色朝向 = yaw 即时(tank-style,无需 lerp)
      player.rotation.y = yaw;

      // 场地边界:margin 覆盖程序化猫手臂外延(±0.46)+ 余量,避免贴墙时半边手臂穿墙
      const hw = bounds.w / 2 - 0.5;
      const hd = bounds.d / 2 - 0.5;
      player.position.x = Math.min(hw, Math.max(-hw, player.position.x));
      player.position.z = Math.min(hd, Math.max(-hd, player.position.z));

      // ── 越肩相机 ──
      euler.set(FIXED_PITCH, yaw, 0);
      camOffset.set(CONFIG.camera.side, CONFIG.camera.up, CONFIG.camera.dist).applyEuler(euler);
      headPos.copy(player.position);
      headPos.y += 1.4;

      // ── 机位选择:连续 clip + 侧滑摆角(camera tune 第二轮) ──
      // 根因(第一轮遗留):旧 minDist 1.4 在碰撞 clip 后沿原方向硬推 → 相机穿进书架
      // (贴书架 0.3m 时相机落在书架背面 0.23m 外),书架背面贴脸 + 距离 2.7→1.4
      // = "靠墙拉近" + 晕。侧滑:正位被挡 → 绕 head 摆角(±10°..±90°)找第一个
      // 清距 ≥ minDist 的机位 → 保距离、不穿墙;全堵(角落)→ 取清距最大角度,贴墙不穿墙。
      const camLen = camOffset.length();
      const swingClear = (deg: number): number => {
        tmp.copy(camOffset).applyAxisAngle(Y_AXIS, (deg * Math.PI) / 180);
        tmp2.copy(headPos).add(tmp);
        return segmentClearFraction(headPos, tmp2) * camLen;
      };
      let swing = 0;
      if (swingClear(0) < CONFIG.camera.minDist) {
        // 滞回:上一帧摆角仍够远 → 沿用,防临界清距抖动时左右甩
        if (prevSwing !== 0 && swingClear(prevSwing) >= CONFIG.camera.minDist - CONFIG.camera.swingHyst) {
          swing = prevSwing;
        } else {
          let bestClear = 0;
          for (let deg = CONFIG.camera.swingStepDeg; deg <= CONFIG.camera.swingMaxDeg; deg += CONFIG.camera.swingStepDeg) {
            for (const s of [deg, -deg]) {
              const clear = swingClear(s);
              if (clear > bestClear) { bestClear = clear; swing = s; }
              if (clear >= CONFIG.camera.minDist) break;
            }
            if (bestClear >= CONFIG.camera.minDist) break;
          }
        }
      }
      prevSwing = swing;

      // 目标机位 = head + 摆角后方向 × 机位距离;清距 ≥ minDist → min(清距, dist),
      // 清距 < minDist(全堵角落)→ 站清距,绝不穿墙
      tmp.copy(camOffset).applyAxisAngle(Y_AXIS, (swing * Math.PI) / 180);
      tmp2.copy(headPos).add(tmp);
      const clearDist = segmentClearFraction(headPos, tmp2) * camLen;
      const targetDist = clearDist >= CONFIG.camera.minDist ? Math.min(clearDist, CONFIG.camera.dist) : clearDist;
      targetCamPos.copy(headPos).addScaledVector(tmp.normalize(), targetDist);
      targetCamPos.x = Math.min(hw, Math.max(-hw, targetCamPos.x));
      targetCamPos.z = Math.min(hd, Math.max(-hd, targetCamPos.z));

      // ── spring-damp 拆分:方向快跟、距离慢跟(camera tune 第一轮保留) ──
      // 方向保持 dampLambda(12)快跟转向,距离用 dampDistLambda(5)慢慢拉近/拉远,
      // 避免整 vector lerp 时"停转向啪停 + 出墙瞬间距离突变"的冲感。
      const curOff = camCurOff.subVectors(camera.position, headPos);
      const curDist = curOff.length();
      camTargetOff.subVectors(targetCamPos, headPos);
      const dampTargetDist = camTargetOff.length();
      camTargetOff.normalize();
      if (curDist < 1e-6) {
        // PR #12 §2.9 NaN 防护:dist=0(相机正好叠在 headPos 上)时直接到位,跳过 lerp
        camera.position.copy(headPos).addScaledVector(camTargetOff, dampTargetDist);
      } else {
        const dampDir = 1 - Math.exp(-CONFIG.camera.dampLambda * dt);
        const dampDist = 1 - Math.exp(-CONFIG.camera.dampDistLambda * dt);
        curOff.multiplyScalar(1 / curDist);
        curOff.lerp(camTargetOff, dampDir).normalize();
        const newDist = curDist + (dampTargetDist - curDist) * dampDist;
        camera.position.copy(headPos).addScaledVector(curOff, newDist);
      }

      lookTarget.set(0, 1.15, -2).applyEuler(euler).add(player.position);
      camera.lookAt(lookTarget);
    },
  };
}