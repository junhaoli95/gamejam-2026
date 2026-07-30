import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * GLB/GLTF loading with progress + clean error surface.
 * Works with Meshy exports (GLB with embedded textures).
 * NOTE: GLTFLoader + GLB is one of the loaders verified to work
 * on the WeChat platformize adapter — stay within it.
 *
 * Usage:
 *   const model = await loadGlb('/assets/cat.glb', (p) => console.log(p));
 *   scene.add(model);
 */
export async function loadGlb(
  url: string,
  onProgress?: (fraction: number) => void,
): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url, (event) => {
    if (onProgress && event.total > 0) {
      onProgress(event.loaded / event.total);
    }
  });
  return gltf.scene;
}

/**
 * Convenience: load + normalize scale so the model fits a target height,
 * and center it on the ground plane (y=0 at feet).
 * AI-generated models come in wildly inconsistent scales — always normalize.
 */
export async function loadGlbNormalized(
  url: string,
  targetHeight = 1,
  onProgress?: (fraction: number) => void,
): Promise<THREE.Group> {
  const model = await loadGlb(url, onProgress);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetHeight / size.y;
  model.scale.setScalar(scale);

  // Re-measure after scaling, then sit the model on y=0.
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.y -= box2.min.y;

  return model;
}
