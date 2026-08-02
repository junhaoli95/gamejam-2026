import * as THREE from 'three';

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
}

interface ControllerOptions {
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement;
  player: THREE.Group;
  colliders: THREE.Box3[];
  bounds: { w: number; d: number };
  /** 指针未锁定时显示的提示遮罩。 */
  overlay: HTMLElement;
}

const WALK_SPEED = 3.0;
const SPRINT_SPEED = 5.6;
const PLAYER_RADIUS = 0.32;
const TURN_LERP = 14;

const CAM_DIST = 2.7;
const CAM_SIDE = 0.35;
const CAM_UP = 1.35;
const PITCH_MIN = -0.12; // 微抬头上限
const PITCH_MAX = 0.4;   // 低头下限(相机最高 ~2.4m,看不穿 3.4m 柱与 2.4m 书架)
const MOUSE_SENS = 0.0023;
const CAM_COLLIDE_PAD = 0.25;
const CAM_COLLIDE_STEPS = 8;

export function createThirdPersonController(opts: ControllerOptions): ThirdPersonController {
  const { camera, dom, player, colliders, bounds, overlay } = opts;

  let yaw = 0;           // 0 = 相机在角色 +z 后方,看向 -z(书库深处)
  let pitch = 0.16;      // 默认微低头("镜头要向下一点")
  const keys = new Set<string>();

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
    yaw -= e.movementX * MOUSE_SENS;
    pitch += e.movementY * MOUSE_SENS;
    pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));
  });
  window.addEventListener('keydown', (e: KeyboardEvent) => keys.add(e.code));
  window.addEventListener('keyup', (e: KeyboardEvent) => keys.delete(e.code));

  // 分轴碰撞:移动后若玩家圆陷入某 AABB(半径外扩),沿该轴推出到贴面
  function resolveAxis(axis: 'x' | 'z'): void {
    const p = player.position;
    for (const b of colliders) {
      if (
        p.x > b.min.x - PLAYER_RADIUS && p.x < b.max.x + PLAYER_RADIUS &&
        p.z > b.min.z - PLAYER_RADIUS && p.z < b.max.z + PLAYER_RADIUS
      ) {
        if (axis === 'x') {
          p.x = p.x < (b.min.x + b.max.x) / 2 ? b.min.x - PLAYER_RADIUS : b.max.x + PLAYER_RADIUS;
        } else {
          p.z = p.z < (b.min.z + b.max.z) / 2 ? b.min.z - PLAYER_RADIUS : b.max.z + PLAYER_RADIUS;
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

  function cameraClipTest(point: THREE.Vector3): boolean {
    for (const b of colliders) {
      if (
        point.x > b.min.x - CAM_COLLIDE_PAD && point.x < b.max.x + CAM_COLLIDE_PAD &&
        point.y > b.min.y - CAM_COLLIDE_PAD && point.y < b.max.y + CAM_COLLIDE_PAD &&
        point.z > b.min.z - CAM_COLLIDE_PAD && point.z < b.max.z + CAM_COLLIDE_PAD
      ) {
        return true;
      }
    }
    return false;
  }

  return {
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

        const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;
        player.position.x += mx * speed * dt;
        resolveAxis('x');
        player.position.z += mz * speed * dt;
        resolveAxis('z');

        // 面朝移动方向(最短角插值)
        const targetRot = Math.atan2(-mx, -mz);
        let delta = targetRot - player.rotation.y;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        player.rotation.y += delta * Math.min(1, TURN_LERP * dt);
      }

      // 场地边界
      const hw = bounds.w / 2 - 0.4;
      const hd = bounds.d / 2 - 0.4;
      player.position.x = Math.min(hw, Math.max(-hw, player.position.x));
      player.position.z = Math.min(hd, Math.max(-hd, player.position.z));

      // ── 越肩相机 ──
      euler.set(pitch, yaw, 0);
      camOffset.set(CAM_SIDE, CAM_UP, CAM_DIST).applyEuler(euler);
      headPos.copy(player.position);
      headPos.y += 1.4;
      desiredCam.copy(player.position).add(camOffset);

      // 相机防穿:从头部向机位步进,撞墙前停
      let t = 1;
      for (let i = 1; i <= CAM_COLLIDE_STEPS; i++) {
        const s = i / CAM_COLLIDE_STEPS;
        tmp.lerpVectors(headPos, desiredCam, s);
        if (cameraClipTest(tmp)) {
          t = Math.max(0.1, (i - 1) / CAM_COLLIDE_STEPS);
          break;
        }
      }
      camera.position.lerpVectors(headPos, desiredCam, t);
      // 无墙体 mesh 阶段:相机不越出地板边界
      camera.position.x = Math.min(hw, Math.max(-hw, camera.position.x));
      camera.position.z = Math.min(hd, Math.max(-hd, camera.position.z));

      lookTarget.set(0, 1.15, -2).applyEuler(euler).add(player.position);
      camera.lookAt(lookTarget);
    },
  };
}
