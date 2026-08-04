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

// --- Controller ---
const controller = createThirdPersonController({
  camera,
  dom: renderer.domElement,
  player,
  colliders,
  bounds: { w: CONFIG.world.w, d: CONFIG.world.d },
  overlay,
});

// --- SharedState facade (Layer 1 stub; PR #8 fills battery/pips) ---
const { getSharedState } = createSharedStateFacade(player, controller, outlets);

// --- Mount stubs (PR #7/#8 replace implementations) ---
mountPhoneHud({
  getSharedState,
  onAppAction: (action) => console.log('[stub] app action:', action),
});
mountPlayerStats({ getSharedState });

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
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  controller.update(dt);
  update(dt);
  renderer.render(scene, camera);
  minimap.update(colliders, getSharedState());
}
animate();
