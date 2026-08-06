import * as THREE from 'three';
import { createLibraryScene, DEFAULT_DEBUG_PARAMS } from './scene/loadLibraryScene';
import { createThirdPersonController } from './player/thirdPersonController';
import { createSharedStateFacade } from './platform/sharedState';
import { createMinimap } from './ui/minimap';
import { mountPhoneHud } from './ui/phoneHud';
import { mountPlayerStats } from './game/playerStats';
import { CONFIG } from './game/config';
import './style.css';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// --- Camera (第三人称越肩:第一人称视野 + 角色可见) ---
const camera = new THREE.PerspectiveCamera(
  CONFIG.camera.fov,
  window.innerWidth / window.innerHeight,
  CONFIG.camera.near,
  CONFIG.camera.far,
);

// --- Scene ---
const { scene, player, colliders, outlets, update, rebuildTableZone, setColliderHelpersVisible } =
  createLibraryScene(DEFAULT_DEBUG_PARAMS);

// --- 点击进入指针锁的提示遮罩 ---
const overlay = document.createElement('div');
overlay.textContent = '点击画面进入 · WASD 移动 · Shift 加速 · 鼠标转视角 · Esc 退出';
Object.assign(overlay.style, {
  position: 'fixed',
  inset: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(20, 16, 10, 0.55)',
  color: '#ffe9c4',
  font: '16px/1.6 system-ui, sans-serif',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  zIndex: '10',
});
document.body.appendChild(overlay);

// --- Runtime + PlayerStats(PR #10 — 必须先于 controller 实例化,因 controller 需读 dash mult)
const runtime = {
  battery: CONFIG.battery.startPercent,
  pips: CONFIG.dash.startPips,
  appOpen: { RADAR: false, MAP: false, QUERY: false },
};
const playerStats = mountPlayerStats({ runtime });

// --- Controller(PR #10:注入 dash 倍速回调,Shift 边沿由主循环读 getInput 喂 requestDash)
const controller = createThirdPersonController({
  camera,
  dom: renderer.domElement,
  player,
  colliders,
  bounds: { w: CONFIG.world.w, d: CONFIG.world.d },
  overlay,
  getDashMult: playerStats.getDashSpeedMult,
});

// --- SharedState facade:Layer 1 stub 返回固定 battery=1.0 / pips=3;
// PR #10 在 main 包一层 wrap,用 runtime 真值覆盖 battery/pips 字段(sharedState.ts 文件 0 改,§0.3)。
const { getSharedState: getRawSharedState } = createSharedStateFacade(player, controller, outlets);

/** wrap:取 raw SharedState,覆写 battery/pips 为 runtime 真值(给 phone HUD / minimap / __debug 读)。 */
function getSharedState() {
  const s = getRawSharedState();
  return { ...s, battery: runtime.battery, pips: runtime.pips };
}

// --- Mount phone HUD stub(Sam 在 PR #9 替换 mountPhoneHud 实现,调用点不动)---
mountPhoneHud({
  getSharedState,
  onAppAction: (action) => console.log('[stub] app action:', action),
});

// --- Minimap ---
const minimap = createMinimap();

// --- Debug: expose getSharedState to window for console eval ---
if (import.meta.env.DEV) {
  Object.assign(window, { __debug: { getSharedState } });
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Debug overlay (dev only; dynamic import keeps lil-gui out of prod bundle) ---
if (import.meta.env.DEV) {
  import('./debug/overlay').then(({ attachDebugGui }) => {
    attachDebugGui({
      rebuildTableZone,
      setColliderHelpersVisible,
      defaultParams: DEFAULT_DEBUG_PARAMS,
    });
  });
}

// --- Game loop ---
// dt clamped so tab-switch won't cause physics/anim jumps.
// backlog #002:THREE.Clock 已 deprecated,改用 THREE.Timer(Timer.update()+getDelta(),v0.185 API 已实测)
const timer = new THREE.Timer();
function animate() {
  requestAnimationFrame(animate);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);

  // PR #10:每帧先读 input(Shift 边沿 + WASD 方向),Shift down 边沿则触发 requestDash
  // (requestDash 三道门:phase==idle / pip≥1 / 方向非零; 否则不耗 pip)
  const input = controller.getInput();
  if (input.shiftEdge) {
    playerStats.requestDash({ fwd: input.fwd, strafe: input.strafe });
  }
  // 推进资源状态机(先 step 设 dash phase,再 controller.update 让 speed 读 dash 多倍)
  playerStats.step(dt);
  controller.update(dt);
  update(dt);
  renderer.render(scene, camera);
  minimap.update(colliders, getSharedState());
}
animate();
