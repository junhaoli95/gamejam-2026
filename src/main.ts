import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createLibraryScene } from './scene/loadLibraryScene';
import './style.css';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// --- Camera (top-down 45°, Animal Crossing-style) ---
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  200,
);
camera.position.set(0, 18, 22);
camera.lookAt(0, 0, -3);

// --- Scene ---
const { scene, update } = createLibraryScene();

// --- OrbitControls (dev inspection; removable before ship) ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 4;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.target.set(0, 0, -3);
controls.update();

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
  update(dt);
  controls.update();
  renderer.render(scene, camera);
}
animate();