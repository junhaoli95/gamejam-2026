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
  rearLeft: number;
  rearRight: number;
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

export function computeCatWalkPose(phase: number, isDashing: boolean): CatPose {
  const stride = isDashing ? 0.65 : 0.42;
  const wave = Math.sin(phase + Math.PI / 4) * stride;

  return {
    frontLeft: wave,
    frontRight: -wave,
    rearLeft: -wave,
    rearRight: wave,
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
  frontLeft: THREE.Object3D;
  frontRight: THREE.Object3D;
  rearLeft: THREE.Object3D;
  rearRight: THREE.Object3D;
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

function materialFor(color: number): THREE.MeshStandardMaterial {
  let material = materialCache.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, flatShading: true });
    materialCache.set(color, material);
  }
  return material;
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
  const eye = materialFor(palette.eye);

  const body = addMesh(
    cat,
    'body',
    new THREE.Mesh(new THREE.CapsuleGeometry(seated ? 0.25 : 0.28, seated ? 0.25 : 0.45, 3, 8), fur),
    [0, seated ? 0.38 : 0.56, seated ? 0.04 : 0.02],
  );
  body.scale.set(seated ? 1.05 : 0.98, seated ? 0.9 : 1.05, seated ? 0.95 : 1.28);

  const bodyStripeYs = seated ? [] : [0.8];
  for (const [index, y] of bodyStripeYs.entries()) {
    addMesh(
      body,
      `bodyStripe${index}`,
      new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.035), stripe),
      [0, y - (seated ? 0.38 : 0.56), seated ? 0.23 : 0.28],
    );
  }

  const headY = seated ? 0.72 : 0.94;
  const headZ = seated ? -0.13 : -0.22;
  const head = addMesh(cat, 'head', new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), furLight), [0, headY, headZ]);
  head.scale.set(1.02, 1.02, 1.05);

  addMesh(
    head,
    'muzzle',
    new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 4), chest),
    [0, -0.05, -0.25],
  ).scale.set(1.25, 0.8, 0.75);

  let leftEar: THREE.Object3D | undefined;
  let rightEar: THREE.Object3D | undefined;
  for (const side of [-1, 1] as const) {
    const ear = addMesh(
      head,
      side === -1 ? 'leftEar' : 'rightEar',
      new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 4), fur),
      [side * 0.14, seated ? 0.22 : 0.21, 0.01],
    );
    ear.rotation.z = -side * 0.12;
    if (side === -1) leftEar = ear;
    else rightEar = ear;

    addMesh(
      head,
      side === -1 ? 'leftEye' : 'rightEye',
      new THREE.Mesh(new THREE.SphereGeometry(0.038, 6, 4), eye),
      [side * 0.095, 0.02, -0.255],
    );
  }

  const legPositions: Array<[string, number, number]> = seated
    ? [
        ['frontLeftLeg', -0.17, -0.16],
        ['frontRightLeg', 0.17, -0.16],
      ]
    : [
        ['frontLeftLeg', -0.17, -0.16],
        ['frontRightLeg', 0.17, -0.16],
        ['rearLeftLeg', -0.17, 0.2],
        ['rearRightLeg', 0.17, 0.2],
      ];
  const legs: THREE.Object3D[] = [];
  for (const [name, x, z] of legPositions) {
    const leg = addMesh(
      cat,
      name,
      new THREE.Mesh(new THREE.CapsuleGeometry(0.085, seated ? 0.18 : 0.28, 2, 6), seated && z > 0 ? furLight : fur),
      [x, seated ? 0.2 : 0.225, z],
    );
    legs.push(leg);
  }

  const chestPatch = addMesh(
    body,
    'chestPatch',
    new THREE.Mesh(new THREE.SphereGeometry(0.17, 7, 5), chest),
    [0, seated ? 0.02 : 0.08, -0.2],
  );
  chestPatch.scale.set(0.75, seated ? 1.15 : 1.35, 0.45);

  const tail = new THREE.Group();
  tail.name = 'tail';
  tail.position.set(0, seated ? 0.42 : 0.48, seated ? 0.28 : 0.34);
  cat.add(tail);
  const tailSegment = addMesh(tail, 'tailSegment', new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.38, 2, 6), fur), [0, 0.13, 0]);
  tailSegment.rotation.x = seated ? -0.5 : -0.8;

  const rig: CatRig = {
    phase: 0,
    body,
    head,
    frontLeft: legs[0],
    frontRight: legs[1],
    rearLeft: legs[2] ?? legs[0],
    rearRight: legs[3] ?? legs[1],
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
  rig.frontLeft.rotation.x = pose.frontLeft * legScale;
  rig.frontRight.rotation.x = pose.frontRight * legScale;
  rig.rearLeft.rotation.x = pose.rearLeft * legScale;
  rig.rearRight.rotation.x = pose.rearRight * legScale;
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
