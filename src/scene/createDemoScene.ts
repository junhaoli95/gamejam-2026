import * as THREE from 'three';

export interface DemoScene {
  scene: THREE.Scene;
  update: (dt: number) => void;
}

/**
 * Minimal verification scene: spinning, breathing cube on a ground disc.
 * The cube is the stand-in for a future Meshy GLB model.
 * NOTE: Three.js has NO default lighting — without lights everything is black.
 */
export function createDemoScene(): DemoScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshStandardMaterial({ color: 0x2d5016 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Cube
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xff8c42 }),
  );
  cube.position.y = 0.5;
  scene.add(cube);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.2);
  sun.position.set(4, 6, 3);
  scene.add(sun);

  let elapsed = 0;
  function update(dt: number) {
    elapsed += dt;
    cube.rotation.y += dt * 0.8;
    cube.rotation.x += dt * 0.3;
    // Procedural "breathing" — first taste of code-driven juice.
    cube.position.y = 0.5 + Math.sin(elapsed * 2.5) * 0.08;
  }

  return { scene, update };
}
