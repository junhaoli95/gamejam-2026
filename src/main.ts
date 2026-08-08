import * as THREE from 'three';
import { createLibraryScene, DEFAULT_DEBUG_PARAMS } from './scene/loadLibraryScene';
import { createThirdPersonController } from './player/thirdPersonController';
import { createSharedStateFacade } from './platform/sharedState';
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
  pips: CONFIG.dash.startEnergy,
  appOpen: { RADAR: false, MAP: false, QUERY: false },
};
const playerStats = mountPlayerStats({ runtime });

// --- Controller(PR #12:Shift 持续按住由 playerStats.step 经 input.shift 消耗 energy;
// controller 仍走 getDashMult 回调读速度倍率)
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

  // PR #12:step 改签 (dt, input);Shift 持续消耗 energy(不再边沿触发)。
  const input = controller.getInput();
  playerStats.step(dt, input);
  controller.update(dt);
  update(dt);
  renderer.render(scene, camera);
}
animate();
