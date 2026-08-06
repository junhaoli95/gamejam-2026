import * as THREE from 'three';
import { CONFIG } from '../game/config';

// ─────────────────────────────────────────────────────────────────────────────
// Third-person controller (placeholder scaffold)
//
// "第一人称视野 + 第三人称显示角色":指针锁鼠标视角,相机紧跟角色肩后
// (略偏右,角色露在画面左下),WASD 相对相机朝向移动,Shift 加速占位
// (dash pip 经济系统后进 game/)。
//
// 碰撞:玩家=半径 RADIUS 的圆柱,对场景静态 AABB 做分轴 move-and-clamp;
// 相机从头部向期望机位步进采样,撞到 AABB 前停下(防穿书架)。
// ─────────────────────────────────────────────────────────────────────────────

export interface ThirdPersonController {
  update: (dt: number) => void;
  getYaw: () => number;
  /** 读取这一帧的方向/Shift 状态(ShiftEdge 为边沿触发,本帧内只可读一次,会消费 prev shift 标记)。
   *  供主循环把 shiftEdge 喂给 playerStats.requestDash 把方向喂给 playerStats.step。 */
  getInput: () => { fwd: number; strafe: number; shiftEdge: boolean };
}

interface ControllerOptions {
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement;
  player: THREE.Group;
  colliders: THREE.Box3[];
  bounds: { w: number; d: number };
  /** 指针未锁定时显示的提示遮罩。 */
  overlay: HTMLElement;
  /** PR #10:dash 倍速回调。idle/cooldown=1, dashing=CONFIG.dash.dashMult。controller 不持有 game 状态,只读外部 mult。 */
  getDashMult: () => number;
}

export function createThirdPersonController(opts: ControllerOptions): ThirdPersonController {
  const { camera, dom, player, colliders, bounds, overlay, getDashMult } = opts;

  let yaw = 0;           // 0 = 相机在角色 +z 后方,看向 -z(书库深处)
  let pitch = 0.16;      // 默认微低头("镜头要向下一点")
  const keys = new Set<string>();
  let prevShift = false; // Shift 边沿触发 dash(requestDash 仅按 shift-down 第一帧触发)

  // 监听 window:遮罩层覆盖 canvas 时点击事件不会落到 dom 上
  window.addEventListener('click', () => {
    if (document.pointerLockElement === dom) return;
    // 非可信手势(自动化脚本点击)下 requestPointerLock 的 promise 会 reject,吞掉防噪音
    const result = dom.requestPointerLock() as unknown;
    if (result instanceof Promise) result.catch(() => {});
  });
  document.addEventListener('pointerlockchange', () => {
    overlay.style.display = document.pointerLockElement === dom ? 'none' : '';
  });
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (document.pointerLockElement !== dom) return;
    yaw -= e.movementX * CONFIG.camera.mouseSens;
    pitch += e.movementY * CONFIG.camera.mouseSens;
    pitch = Math.min(CONFIG.camera.pitchMax, Math.max(CONFIG.camera.pitchMin, pitch));
  });
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

  return {
    getYaw: () => yaw,
    getInput: () => {
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const shiftNow = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const shiftEdge = shiftNow && !prevShift;
      prevShift = shiftNow;
      return { fwd, strafe, shiftEdge };
    },
    update: (dt: number) => {
      // ── 移动(相对相机朝向)──
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const moving = fwd !== 0 || strafe !== 0;

      if (moving) {
        const sinY = Math.sin(yaw);
        const cosY = Math.cos(yaw);
        // forward=(-sinY,0,-cosY), right=(cosY,0,-sinY)
        let mx = -sinY * fwd + cosY * strafe;
        let mz = -cosY * fwd - sinY * strafe;
        const len = Math.hypot(mx, mz);
        mx /= len;
        mz /= len;

        // PR #10:速度由 dash 倍速决定(idle/cooldown=walkSpeed, dashing=walkSpeed × dashMult),
        // Shift 不再做持续 sprint(requestDash 由主循环边沿触发,这里只读 mult)
        const speed = CONFIG.player.walkSpeed * getDashMult();
        player.position.x += mx * speed * dt;
        resolveAxis('x');
        player.position.z += mz * speed * dt;
        resolveAxis('z');

        // 面朝移动方向(最短角插值)
        const targetRot = Math.atan2(-mx, -mz);
        let delta = targetRot - player.rotation.y;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        player.rotation.y += delta * Math.min(1, CONFIG.player.turnLerp * dt);
      }

      // 场地边界
      const hw = bounds.w / 2 - 0.4;
      const hd = bounds.d / 2 - 0.4;
      player.position.x = Math.min(hw, Math.max(-hw, player.position.x));
      player.position.z = Math.min(hd, Math.max(-hd, player.position.z));

      // ── 越肩相机 ──
      euler.set(pitch, yaw, 0);
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
      const dampFactor = 1 - Math.exp(-CONFIG.camera.dampLambda * dt);
      camera.position.lerp(targetCamPos, dampFactor);

      // backlog #001:damp 后再 clamp 相机距 head 下限,贴墙不近脸(业界 90% 三人称标准)
      const dir = tmp.subVectors(camera.position, headPos);
      const dist = dir.length();
      if (dist < CONFIG.camera.minDist) {
        dir.multiplyScalar(CONFIG.camera.minDist / dist);
        camera.position.copy(headPos).add(dir);
      }

      lookTarget.set(0, 1.15, -2).applyEuler(euler).add(player.position);
      camera.lookAt(lookTarget);
    },
  };
}
