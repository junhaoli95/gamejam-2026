import * as THREE from 'three';

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
let eyeTexture: THREE.DataTexture | null = null;
let eyeMaterial: THREE.MeshBasicMaterial | null = null;

function materialFor(color: number): THREE.MeshStandardMaterial {
  let material = materialCache.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, flatShading: true });
    materialCache.set(color, material);
  }
  return material;
}

/** 程序化猫眼贴图:透明底 + 琥珀虹膜 + 黑色竖瞳 + 高光。DataTexture 纯像素生成,零 DOM 依赖,全局单例。 */
function createEyeTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const i = (y * size + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      if (dx * dx + dy * dy < 24 * 24) {
        r = 183; g = 131; b = 50; a = 255;                       // 琥珀虹膜
        if ((dx / 12) ** 2 + (dy / 22) ** 2 < 1) {
          r = 42; g = 33; b = 29;                                 // 黑色竖瞳
        }
        if ((dx - 14) ** 2 + (dy - 14) ** 2 < 36) {
          r = 255; g = 255; b = 255;                              // 高光
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
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createCatParts(palette: CatPalette, seated: boolean): { cat: THREE.Group; rig: CatRig } {
  const cat = new THREE.Group();
  cat.name = seated ? 'proceduralSeatedCat' : 'proceduralStandingCat';
  cat.userData.proceduralCat = true;

  const fur = materialFor(palette.fur);
  const furLight = materialFor(palette.furLight);
  const chest = materialFor(palette.chest);
  const stripe = materialFor(palette.stripe);

  // ── Q版身体:Minecraft 风方块身 ──
  const bodyY = seated ? 0.42 : 0.52;
  const body = addMesh(
    cat,
    'body',
    new THREE.Mesh(
      new THREE.BoxGeometry(seated ? 0.58 : 0.62, seated ? 0.5 : 0.62, seated ? 0.5 : 0.48),
      fur,
    ),
    [0, bodyY, seated ? 0.04 : 0],
  );

  if (!seated) {
    addMesh(
      body,
      'bodyStripe0',
      new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.035), stripe),
      [0, 0.28, 0.22],
    );
  }

  const headY = seated ? 0.9 : 1.05;
  const headZ = seated ? -0.08 : -0.12;
  const head = addMesh(cat, 'head', new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), furLight), [0, headY, headZ]);
  head.scale.set(1.02, 1.04, 1.02);

  addMesh(
    head,
    'muzzle',
    new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), chest),
    [0, -0.06, -0.32],
  ).scale.set(1.2, 0.75, 0.7);

  let leftEar: THREE.Object3D | undefined;
  let rightEar: THREE.Object3D | undefined;
  for (const side of [-1, 1] as const) {
    const ear = addMesh(
      head,
      side === -1 ? 'leftEar' : 'rightEar',
      new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), fur),
      [side * 0.2, 0.32, 0.02],
    );
    ear.rotation.z = -side * 0.1;
    if (side === -1) leftEar = ear;
    else rightEar = ear;

    // 眼睛:贴图平面(CanvasTexture 画猫眼),贴头部表面朝外
    const eye = addMesh(
      head,
      side === -1 ? 'leftEye' : 'rightEye',
      new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), getEyeMaterial()),
      [side * 0.13, 0.04, -0.3],
    );
    eye.rotation.y = -side * 0.35;
  }

  // ── 双腿(方块;站立)或坐姿双腿前伸 ──
  const legZ = seated ? 0.02 : 0;
  const legY = seated ? 0.16 : 0.22;
  const leftLeg = addMesh(
    cat,
    'leftLeg',
    new THREE.Mesh(new THREE.BoxGeometry(0.22, seated ? 0.2 : 0.44, 0.22), fur),
    [-0.13, legY, legZ],
  );
  const rightLeg = addMesh(
    cat,
    'rightLeg',
    new THREE.Mesh(new THREE.BoxGeometry(0.22, seated ? 0.2 : 0.44, 0.22), fur),
    [0.13, legY, legZ],
  );

  // 脚掌(奶油色;坐姿时被身体挡住,省略省 mesh)
  if (!seated) {
    addMesh(cat, 'leftFoot', new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 4), chest), [-0.13, 0.06, 0.06]).scale.set(1, 0.5, 1.4);
    addMesh(cat, 'rightFoot', new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 4), chest), [0.13, 0.06, 0.06]).scale.set(1, 0.5, 1.4);
  }

  // ── 两只短手臂(方块;站立时自然下垂,坐姿时放腿前) ──
  const armY = seated ? 0.34 : 0.42;
  const armZ = seated ? 0.05 : 0;
  const leftArm = addMesh(cat, 'leftArm', new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 0.16), furLight), [-0.27, armY, armZ]);
  const rightArm = addMesh(cat, 'rightArm', new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 0.16), furLight), [0.27, armY, armZ]);

  addMesh(
    body,
    'chestPatch',
    new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 5), chest),
    [0, 0.06, seated ? -0.18 : -0.22],
  ).scale.set(0.7, 1.1, 0.45);

  const tail = new THREE.Group();
  tail.name = 'tail';
  tail.position.set(0, seated ? 0.44 : 0.56, seated ? 0.28 : 0.32);
  cat.add(tail);
  const tailSegment = addMesh(tail, 'tailSegment', new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.42, 2, 6), fur), [0, 0.14, 0]);
  tailSegment.rotation.x = seated ? -0.5 : -0.7;

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

export function createStandingCat(palette: CatPalette): THREE.Group {
  return createCatParts(palette, false).cat;
}

export function createSeatedCat(palette: CatPalette, rotationY: number): THREE.Group {
  const cat = createCatParts(palette, true).cat;
  cat.rotation.y = rotationY;
  return cat;
}

export function updateCatAnimation(cat: THREE.Group, motion: CatMotion): void {
  const rig = rigs.get(cat);
  if (!rig) return;

  const dt = Math.min(Math.max(motion.dt, 0), 0.1);
  const moving = motion.speed > 0.05;
  rig.phase += dt * (moving ? motion.speed * 5 : 1.4);

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
    if (object instanceof THREE.Mesh) object.geometry.dispose();
  });
}
