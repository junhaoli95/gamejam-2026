import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export interface CatPalette {
  fur: number;
  furLight: number;
  chest: number;
  stripe: number;
  eye: number;
}

export interface CatMotion {
  speed: number;
  directionX: number;
  directionZ: number;
  isDashing: boolean;
  dt: number;
}

export interface CatPose {
  frontLeft: number;
  frontRight: number;
  armLeft: number;
  armRight: number;
  bodyBob: number;
  headBob: number;
  tailSway: number;
  lean: number;
}

export const BROWN_TABBY_PALETTE: CatPalette = {
  fur: 0x6b4a2f,
  furLight: 0x8b6445,
  chest: 0xf0e6d2,
  stripe: 0x2a211d,
  eye: 0xb78332,
};

/** 双足步态:左右腿反相,手臂与同侧腿反相(Minecraft 式摆臂)。 */
export function computeCatWalkPose(phase: number, isDashing: boolean): CatPose {
  const stride = isDashing ? 0.65 : 0.42;
  const wave = Math.sin(phase + Math.PI / 4) * stride;

  return {
    frontLeft: wave,
    frontRight: -wave,
    armLeft: -wave,
    armRight: wave,
    bodyBob: Math.abs(Math.sin(phase * 2)) * (isDashing ? 0.045 : 0.025),
    headBob: Math.sin(phase * 2 + Math.PI) * (isDashing ? 0.02 : 0.012),
    tailSway: Math.sin(phase * 0.7) * (isDashing ? 0.16 : 0.1),
    lean: isDashing ? 0.12 : 0.02,
  };
}

export function catYawForDirection(directionX: number, directionZ: number): number {
  if (Math.hypot(directionX, directionZ) < 1e-6) return 0;
  return Math.atan2(-directionX, -directionZ);
}

interface CatRig {
  phase: number;
  body: THREE.Object3D;
  head: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  tail: THREE.Object3D;
  leftEar: THREE.Object3D;
  rightEar: THREE.Object3D;
  baseBodyY: number;
  baseHeadY: number;
  baseLeftEarZ: number;
  baseRightEarZ: number;
}

const rigs = new WeakMap<THREE.Group, CatRig>();
const materialCache = new Map<number, THREE.MeshStandardMaterial>();
const sharedGeometryCache = new Map<string, THREE.BufferGeometry>();
const standingBodyGeometryCache = new Map<string, THREE.BufferGeometry>();
const standingHeadGeometryCache = new Map<string, THREE.BufferGeometry>();
const standingLegGeometryCache = new Map<string, THREE.BufferGeometry>();
const seatedGeometryCache = new Map<string, THREE.BufferGeometry>();
let eyeTexture: THREE.DataTexture | null = null;
let eyeMaterial: THREE.MeshBasicMaterial | null = null;
let vertexColorMaterial: THREE.MeshStandardMaterial | null = null;

function materialFor(color: number): THREE.MeshStandardMaterial {
  let material = materialCache.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, flatShading: true });
    materialCache.set(color, material);
  }
  return material;
}

function sharedGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = sharedGeometryCache.get(key);
  if (cached) return cached;
  const geometry = factory();
  geometry.userData.sharedResource = true;
  sharedGeometryCache.set(key, geometry);
  return geometry;
}

/** 程序化猫眼贴图:透明底 + 方形琥珀虹膜 + 黑色竖瞳。DataTexture 纯像素生成,零 DOM 依赖,全局单例。 */
function createEyeTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const i = (y * size + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      if (Math.abs(dx) <= 24 && Math.abs(dy) <= 24) {
        r = 183; g = 131; b = 50; a = 255;                       // 琥珀虹膜
        if (Math.abs(dx) <= 6 && Math.abs(dy) <= 20) {
          r = 42; g = 33; b = 29;                                 // 黑色竖瞳
        }
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function getEyeMaterial(): THREE.MeshBasicMaterial {
  if (eyeMaterial) return eyeMaterial;
  if (!eyeTexture) eyeTexture = createEyeTexture();
  eyeMaterial = new THREE.MeshBasicMaterial({ map: eyeTexture, transparent: true, depthWrite: false });
  return eyeMaterial;
}

function addMesh<T extends THREE.Object3D>(
  parent: THREE.Object3D,
  name: string,
  mesh: T,
  position: THREE.Vector3Tuple,
  material?: THREE.Material,
): T {
  mesh.name = name;
  if (material && mesh instanceof THREE.Mesh) mesh.material = material;
  mesh.position.set(...position);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function createStandingParts(palette: CatPalette): { cat: THREE.Group; rig: CatRig } {
  const cat = new THREE.Group();
  cat.name = 'proceduralStandingCat';
  cat.userData.proceduralCat = true;

  const fur = materialFor(palette.fur);
  const furLight = materialFor(palette.furLight);
  const vertexMaterial = getVertexColorMaterial();

  // ── 站立猫:统一方块比例 ──
  const body = addMesh(
    cat,
    'body',
    new THREE.Mesh(getStandingBodyGeometry(palette), vertexMaterial),
    [0, 0.64, 0],
  );

  const head = addMesh(
    cat,
    'head',
    new THREE.Mesh(getStandingHeadGeometry(palette), vertexMaterial),
    [0, 1.12, -0.1],
  );

  let leftEar: THREE.Object3D | undefined;
  let rightEar: THREE.Object3D | undefined;
  for (const side of [-1, 1] as const) {
    const ear = addMesh(
      head,
      side === -1 ? 'leftEar' : 'rightEar',
      new THREE.Mesh(sharedGeometry('standing-ear', () => new THREE.ConeGeometry(0.16, 0.3, 4)), fur),
      [side * 0.2, 0.3, 0.02],
    );
    ear.rotation.z = -side * 0.1;
    if (side === -1) leftEar = ear;
    else rightEar = ear;

    // 眼睛:PlaneGeometry 默认正面朝 +Z,猫脸朝 -Z,所以绕 Y 旋转 180°。
    const eye = addMesh(
      head,
      side === -1 ? 'leftEye' : 'rightEye',
      new THREE.Mesh(sharedGeometry('standing-eye', () => new THREE.PlaneGeometry(0.15, 0.15)), getEyeMaterial()),
      [side * 0.15, 0.04, -0.27],
    );
    eye.rotation.y = Math.PI;
    eye.renderOrder = 1;
  }

  // ── 双腿和脚掌:腿顶端只与身体底部轻微连接 ──
  const leftLeg = addMesh(
    cat,
    'leftLeg',
    new THREE.Mesh(getStandingLegGeometry(palette), vertexMaterial),
    [-0.16, 0.17, 0],
  );
  const rightLeg = addMesh(
    cat,
    'rightLeg',
    new THREE.Mesh(getStandingLegGeometry(palette), vertexMaterial),
    [0.16, 0.17, 0],
  );

  // ── 两只短手臂:放在身体外侧 ──
  const leftArm = addMesh(
    cat,
    'leftArm',
    new THREE.Mesh(sharedGeometry('standing-arm', () => new THREE.BoxGeometry(0.16, 0.32, 0.16)), furLight),
    [-0.38, 0.57, 0],
  );
  const rightArm = addMesh(
    cat,
    'rightArm',
    new THREE.Mesh(sharedGeometry('standing-arm', () => new THREE.BoxGeometry(0.16, 0.32, 0.16)), furLight),
    [0.38, 0.57, 0],
  );

  const tail = new THREE.Group();
  tail.name = 'tail';
  tail.position.set(0, 0.6, 0.3);
  cat.add(tail);
  const tailSegment = addMesh(
    tail,
    'tailSegment',
    new THREE.Mesh(sharedGeometry('standing-tail', () => new THREE.CapsuleGeometry(0.06, 0.42, 2, 6)), fur),
    [0, 0.14, 0],
  );
  tailSegment.rotation.x = -0.7;

  const rig: CatRig = {
    phase: 0,
    body,
    head,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    tail,
    leftEar: leftEar!,
    rightEar: rightEar!,
    baseBodyY: body.position.y,
    baseHeadY: head.position.y,
    baseLeftEarZ: leftEar!.rotation.z,
    baseRightEarZ: rightEar!.rotation.z,
  };
  rigs.set(cat, rig);
  return { cat, rig };
}

function appendColoredGeometry(
  geometries: THREE.BufferGeometry[],
  geometry: THREE.BufferGeometry,
  color: number,
  position: THREE.Vector3Tuple,
  rotation: THREE.Vector3Tuple = [0, 0, 0],
): void {
  geometry.rotateX(rotation[0]);
  geometry.rotateY(rotation[1]);
  geometry.rotateZ(rotation[2]);
  geometry.translate(...position);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const vertexColor = new THREE.Color(color);
  for (let index = 0; index < geometry.attributes.position.count; index++) {
    vertexColor.toArray(colors, index * 3);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometries.push(geometry);
}

function paletteKey(palette: CatPalette): string {
  return [palette.fur, palette.furLight, palette.chest, palette.stripe, palette.eye]
    .map(color => color.toString(16))
    .join(':');
}

function mergeCachedGeometry(
  cache: Map<string, THREE.BufferGeometry>,
  key: string,
  geometries: THREE.BufferGeometry[],
  errorMessage: string,
): THREE.BufferGeometry {
  let merged: THREE.BufferGeometry | null = null;
  try {
    merged = BufferGeometryUtils.mergeGeometries(geometries, false);
  } finally {
    geometries.forEach(geometry => geometry.dispose());
  }
  if (!merged) throw new Error(errorMessage);
  merged.userData.sharedResource = true;
  cache.set(key, merged);
  return merged;
}

function getVertexColorMaterial(): THREE.MeshStandardMaterial {
  if (!vertexColorMaterial) {
    vertexColorMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      flatShading: true,
    });
  }
  return vertexColorMaterial;
}

function getStandingBodyGeometry(palette: CatPalette): THREE.BufferGeometry {
  const key = paletteKey(palette);
  const cached = standingBodyGeometryCache.get(key);
  if (cached) return cached;
  const geometries: THREE.BufferGeometry[] = [];
  appendColoredGeometry(geometries, new THREE.BoxGeometry(0.62, 0.58, 0.48), palette.fur, [0, 0, 0]);
  appendColoredGeometry(geometries, new THREE.BoxGeometry(0.22, 0.035, 0.035), palette.stripe, [0, 0.24, -0.25]);
  appendColoredGeometry(geometries, new THREE.BoxGeometry(0.3, 0.34, 0.035), palette.chest, [0, 0.02, -0.255]);
  return mergeCachedGeometry(standingBodyGeometryCache, key, geometries, 'Failed to merge standing cat body geometry');
}

function getStandingHeadGeometry(palette: CatPalette): THREE.BufferGeometry {
  const key = paletteKey(palette);
  const cached = standingHeadGeometryCache.get(key);
  if (cached) return cached;
  const geometries: THREE.BufferGeometry[] = [];
  appendColoredGeometry(geometries, new THREE.BoxGeometry(0.62, 0.52, 0.5), palette.furLight, [0, 0, 0]);
  appendColoredGeometry(geometries, new THREE.BoxGeometry(0.26, 0.14, 0.1), palette.chest, [0, -0.1, -0.28]);
  return mergeCachedGeometry(standingHeadGeometryCache, key, geometries, 'Failed to merge standing cat head geometry');
}

function getStandingLegGeometry(palette: CatPalette): THREE.BufferGeometry {
  const key = paletteKey(palette);
  const cached = standingLegGeometryCache.get(key);
  if (cached) return cached;
  const geometries: THREE.BufferGeometry[] = [];
  appendColoredGeometry(geometries, new THREE.BoxGeometry(0.2, 0.34, 0.2), palette.fur, [0, 0, 0]);
  appendColoredGeometry(geometries, new THREE.BoxGeometry(0.22, 0.08, 0.28), palette.chest, [0, -0.13, -0.08]);
  return mergeCachedGeometry(standingLegGeometryCache, key, geometries, 'Failed to merge standing cat leg geometry');
}

function appendSeatedBox(
  geometries: THREE.BufferGeometry[],
  size: THREE.Vector3Tuple,
  position: THREE.Vector3Tuple,
  color: number,
): void {
  appendColoredGeometry(geometries, new THREE.BoxGeometry(...size), color, position);
}

function getSeatedGeometry(palette: CatPalette): THREE.BufferGeometry {
  const key = paletteKey(palette);
  const cached = seatedGeometryCache.get(key);
  if (cached) return cached;

  const geometries: THREE.BufferGeometry[] = [];

  appendSeatedBox(geometries, [0.58, 0.42, 0.46], [0, 0.42, 0.04], palette.fur);
  appendSeatedBox(geometries, [0.56, 0.46, 0.45], [0, 0.84, -0.08], palette.furLight);
  appendSeatedBox(geometries, [0.18, 0.18, 0.2], [-0.14, 0.15, -0.02], palette.fur);
  appendSeatedBox(geometries, [0.18, 0.18, 0.2], [0.14, 0.15, -0.02], palette.fur);
  appendSeatedBox(geometries, [0.22, 0.08, 0.25], [-0.14, 0.07, -0.12], palette.chest);
  appendSeatedBox(geometries, [0.22, 0.08, 0.25], [0.14, 0.07, -0.12], palette.chest);
  appendSeatedBox(geometries, [0.14, 0.26, 0.14], [-0.34, 0.43, 0], palette.furLight);
  appendSeatedBox(geometries, [0.14, 0.26, 0.14], [0.34, 0.43, 0], palette.furLight);
  appendSeatedBox(geometries, [0.28, 0.25, 0.035], [0, 0.41, -0.2], palette.chest);
  appendSeatedBox(geometries, [0.22, 0.12, 0.08], [0, 0.73, -0.32], palette.chest);
  appendSeatedBox(geometries, [0.2, 0.035, 0.035], [0, 0.57, -0.2], palette.stripe);

  for (const side of [-1, 1] as const) {
    const ear = new THREE.ConeGeometry(0.14, 0.26, 4);
    appendColoredGeometry(geometries, ear, palette.fur, [side * 0.18, 1.12, 0.02], [0, 0, -side * 0.1]);

    appendSeatedBox(geometries, [0.13, 0.13, 0.025], [side * 0.13, 0.88, -0.315], palette.eye);
    appendSeatedBox(geometries, [0.035, 0.1, 0.03], [side * 0.13, 0.88, -0.34], palette.stripe);
  }

  const tail = new THREE.CapsuleGeometry(0.055, 0.38, 2, 6);
  appendColoredGeometry(geometries, tail, palette.fur, [0, 0.56, 0.28], [-0.55, 0, 0]);

  return mergeCachedGeometry(seatedGeometryCache, key, geometries, 'Failed to merge procedural seated cat geometry');
}

function getSeatedMaterial(): THREE.MeshStandardMaterial {
  return getVertexColorMaterial();
}

export function createStandingCat(palette: CatPalette): THREE.Group {
  return createStandingParts(palette).cat;
}

export function createSeatedCat(palette: CatPalette, rotationY: number): THREE.Group {
  const cat = new THREE.Group();
  cat.name = 'proceduralSeatedCat';
  cat.userData.proceduralCat = true;
  cat.userData.staticProceduralCat = true;
  cat.rotation.y = rotationY;
  const mesh = new THREE.Mesh(getSeatedGeometry(palette), getSeatedMaterial());
  mesh.name = 'seatedCatMesh';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  cat.add(mesh);
  return cat;
}

export function updateCatAnimation(cat: THREE.Group, motion: CatMotion): void {
  const rig = rigs.get(cat);
  if (!rig) return;

  const dt = Math.min(Math.max(motion.dt, 0), 0.1);
  const moving = motion.speed > 0.05;
  rig.phase += dt * (moving ? motion.speed * 2.5 : 1.4);

  const pose = computeCatWalkPose(rig.phase, motion.isDashing);
  const legScale = moving ? 1 : 0;

  rig.leftLeg.rotation.x = pose.frontLeft * legScale;
  rig.rightLeg.rotation.x = pose.frontRight * legScale;
  rig.leftArm.rotation.x = pose.armLeft * legScale;
  rig.rightArm.rotation.x = pose.armRight * legScale;

  rig.body.position.y = rig.baseBodyY + pose.bodyBob * (moving ? 1 : 0.65);
  rig.head.position.y = rig.baseHeadY + pose.headBob * (moving ? 1 : 0.65);
  rig.body.rotation.x = moving ? -pose.lean : 0;
  rig.head.rotation.x = moving ? pose.lean * 0.5 : 0;
  rig.tail.rotation.z = pose.tailSway;
  rig.tail.rotation.x = motion.isDashing ? 0.25 : 0;

  const twitch = Math.sin(rig.phase * 0.37) > 0.96 ? 0.08 : 0;
  rig.leftEar.rotation.z = rig.baseLeftEarZ + twitch;
  rig.rightEar.rotation.z = rig.baseRightEarZ - twitch;
}

export function disposeProceduralCat(cat: THREE.Group): void {
  cat.traverse(object => {
    if (object instanceof THREE.Mesh && object.geometry.userData.sharedResource !== true) object.geometry.dispose();
  });
}
