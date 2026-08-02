import * as THREE from 'three';
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
camera.position.set(0, 12, 14);
camera.lookAt(0, 0, 0);

// --- Scene (D2 will populate: LibraryView / PlayerView / NpcView / SpotView) ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfdf6e3);
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
scene.add(new THREE.HemisphereLight(0xffffff, 0xa08060, 0.4));

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Game loop ---
// dt is clamped so a tab-switch doesn't cause a huge physics/anim jump.
// D2 wiring: worldState = game.step(inputState, dt) -> sceneView.render(worldState)
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  void dt;
  renderer.render(scene, camera);
}
animate();