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
// 相机从头部向期望机位步进采样,撞到 AABB 前停下(防穿书架)。
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
  const desiredCam = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const targetCamPos = new THREE.Vector3();
  const camCurOff = new THREE.Vector3();      // camera tune:当前相机→head 偏移
  const camTargetOff = new THREE.Vector3();   // camera tune:目标机位→head 偏移

  function cameraClipTest(point: THREE.Vector3): boolean {
    for (const b of colliders) {
      if (
        point.x > b.min.x - CONFIG.camera.collidePad && point.x < b.max.x + CONFIG.camera.collidePad &&
        point.y > b.min.y - CONFIG.camera.collidePad && point.y < b.max.y + CONFIG.camera.collidePad &&
        point.z > b.min.z - CONFIG.camera.collidePad && point.z < b.max.z + CONFIG.camera.collidePad
      ) {
        return true;
      }
    }
    return false;
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

      // 场地边界
      const hw = bounds.w / 2 - 0.4;
      const hd = bounds.d / 2 - 0.4;
      player.position.x = Math.min(hw, Math.max(-hw, player.position.x));
      player.position.z = Math.min(hd, Math.max(-hd, player.position.z));

      // ── 越肩相机 ──
      euler.set(FIXED_PITCH, yaw, 0);
      camOffset.set(CONFIG.camera.side, CONFIG.camera.up, CONFIG.camera.dist).applyEuler(euler);
      headPos.copy(player.position);
      headPos.y += 1.4;
      desiredCam.copy(player.position).add(camOffset);

      // 相机防穿:从头部向机位步进,撞墙前停
      let t = 1;
      for (let i = 1; i <= CONFIG.camera.collideSteps; i++) {
        const s = i / CONFIG.camera.collideSteps;
        tmp.lerpVectors(headPos, desiredCam, s);
        if (cameraClipTest(tmp)) {
          t = Math.max(0.1, (i - 1) / CONFIG.camera.collideSteps);
          break;
        }
      }
      // 算出目标机位(含防穿 clamp)到 targetCamPos,spring-damp 平滑过去
      targetCamPos.lerpVectors(headPos, desiredCam, t);
      targetCamPos.x = Math.min(hw, Math.max(-hw, targetCamPos.x));
      targetCamPos.z = Math.min(hd, Math.max(-hd, targetCamPos.z));
      // ── spring-damp 拆分:方向快跟、距离慢跟(camera tune) ──
      // 旧版整 vector lerp 把方向(yaw 转向)与距离(近墙 clip 恢复)绑在同一
      // dampLambda 12 下:停转向瞬间全收敛 → "啪"地停;出墙瞬间距离 2.7m 突变 → 拉远感。
      // 拆开:方向保持 dampLambda(12)快跟转向,距离用 dampDistLambda(5)慢慢拉近/拉远。
      // minDist 从旧的"相机位置硬 snap"(无 lerp,与 clip 每帧打架 → 距离阶梯跳)改为
      // 压在目标距离上(floor)→ 距离 lerp 自然平滑,贴墙不再抖动。
      const curOff = camCurOff.subVectors(camera.position, headPos);
      const curDist = curOff.length();
      camTargetOff.subVectors(targetCamPos, headPos);
      const targetDist = Math.max(camTargetOff.length(), CONFIG.camera.minDist);
      camTargetOff.normalize();
      if (curDist < 1e-6) {
        // PR #12 §2.9 NaN 防护:dist=0(相机正好叠在 headPos 上)时直接到位,跳过 lerp
        camera.position.copy(headPos).addScaledVector(camTargetOff, targetDist);
      } else {
        const dampDir = 1 - Math.exp(-CONFIG.camera.dampLambda * dt);
        const dampDist = 1 - Math.exp(-CONFIG.camera.dampDistLambda * dt);
        curOff.multiplyScalar(1 / curDist);
        curOff.lerp(camTargetOff, dampDir).normalize();
        const newDist = curDist + (targetDist - curDist) * dampDist;
        camera.position.copy(headPos).addScaledVector(curOff, newDist);
      }

      lookTarget.set(0, 1.15, -2).applyEuler(euler).add(player.position);
      camera.lookAt(lookTarget);
    },
  };
}