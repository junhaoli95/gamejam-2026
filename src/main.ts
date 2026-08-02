import * as THREE from 'three';
import { createLibraryScene } from './scene/loadLibraryScene';
import { createThirdPersonController } from './player/thirdPersonController';
import './style.css';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// --- Camera (第三人称越肩:第一人称视野 + 角色可见) ---
const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.05,
  80,
);

// --- Scene ---
const { scene, player, colliders, update } = createLibraryScene();

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
  bounds: { w: 32, d: 24 },
  overlay,
});

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Game loop ---
// dt clamped so tab-switch won't cause physics/anim jumps.
// D2 wiring: worldState = game.step(inputState, dt) -> sceneView.render(worldState)
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  controller.update(dt);
  update(dt);
  renderer.render(scene, camera);
}
animate();
