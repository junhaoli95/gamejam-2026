import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BROWN_TABBY_PALETTE,
  createSeatedCat,
  createStandingCat,
  catYawForDirection,
  computeCatWalkPose,
  updateCatAnimation,
} from './proceduralCat';

describe('computeCatWalkPose', () => {
  it('swings bipedal legs opposite to each other', () => {
    const pose = computeCatWalkPose(0, false);

    expect(pose.frontLeft).toBeCloseTo(-pose.frontRight);
    expect(pose.frontLeft).not.toBeCloseTo(0);
  });

  it('swings each arm opposite to its same-side leg', () => {
    const pose = computeCatWalkPose(0, false);

    expect(pose.armLeft).toBeCloseTo(-pose.frontLeft);
    expect(pose.armRight).toBeCloseTo(-pose.frontRight);
  });

  it('increases stride and body lean during dash', () => {
    const walk = computeCatWalkPose(Math.PI / 2, false);
    const dash = computeCatWalkPose(Math.PI / 2, true);

    expect(Math.abs(dash.frontLeft)).toBeGreaterThan(Math.abs(walk.frontLeft));
    expect(dash.lean).toBeGreaterThan(walk.lean);
  });

  it('maps world movement to the cat root yaw with -z as forward', () => {
    expect(catYawForDirection(0, -1)).toBeCloseTo(0);
    expect(Math.abs(catYawForDirection(0, 1))).toBeCloseTo(Math.PI);
    expect(catYawForDirection(1, 0)).toBeCloseTo(-Math.PI / 2);
  });

  it('uses the slower half-speed walk phase', () => {
    const cat = createStandingCat(BROWN_TABBY_PALETTE);
    const leg = cat.getObjectByName('leftLeg')!;

    updateCatAnimation(cat, { speed: 3, directionX: 0, directionZ: -1, isDashing: false, dt: 0.1 });

    const expected = computeCatWalkPose(3 * 0.1 * 2.5, false).frontLeft;
    expect(leg.rotation.x).toBeCloseTo(expected);
  });
});

describe('procedural cat geometry', () => {
  it('creates a grounded chibi bipedal standing cat', () => {
    const cat = createStandingCat(BROWN_TABBY_PALETTE);
    let meshCount = 0;
    cat.traverse(object => { if (object instanceof THREE.Mesh) meshCount++; });

    expect(cat.name).toBe('proceduralStandingCat');
    expect(cat.getObjectByName('body')).toBeInstanceOf(THREE.Mesh);
    expect(cat.getObjectByName('leftLeg')).toBeInstanceOf(THREE.Object3D);
    expect(cat.getObjectByName('leftArm')).toBeInstanceOf(THREE.Object3D);
    expect(cat.getObjectByName('rightLeg')).toBeInstanceOf(THREE.Object3D);
    expect(cat.getObjectByName('tail')).toBeInstanceOf(THREE.Object3D);
    expect(meshCount).toBeLessThanOrEqual(12);
  });

  it('uses shared low-poly geometry for the body and limbs', () => {
    const cat = createStandingCat(BROWN_TABBY_PALETTE);
    const body = cat.getObjectByName('body') as THREE.Mesh;
    const leftLeg = cat.getObjectByName('leftLeg') as THREE.Mesh;
    const leftArm = cat.getObjectByName('leftArm') as THREE.Mesh;

    expect(body.geometry.type).toBe('BufferGeometry');
    expect(leftLeg.geometry.type).toBe('BufferGeometry');
    expect(leftArm.geometry.type).toBe('BoxGeometry');
    expect(body.geometry.userData.sharedResource).toBe(true);
    expect(leftLeg.geometry.userData.sharedResource).toBe(true);
  });

  it('uses a coherent block silhouette for the standing cat', () => {
    const cat = createStandingCat(BROWN_TABBY_PALETTE);
    const body = cat.getObjectByName('body') as THREE.Mesh;
    const head = cat.getObjectByName('head') as THREE.Mesh;
    const leftLeg = cat.getObjectByName('leftLeg') as THREE.Mesh;
    const leftArm = cat.getObjectByName('leftArm') as THREE.Mesh;

    expect(body.geometry.type).toBe('BufferGeometry');
    expect(head.geometry.type).toBe('BufferGeometry');
    expect(leftLeg.geometry.type).toBe('BufferGeometry');
    expect(leftArm.geometry.type).toBe('BoxGeometry');
    expect(Math.abs(leftArm.position.x)).toBeGreaterThan(0.31);
  });

  it('faces eyes forward and keeps limbs outside the body', () => {
    const cat = createStandingCat(BROWN_TABBY_PALETTE);
    const eye = cat.getObjectByName('leftEye') as THREE.Mesh;
    const body = cat.getObjectByName('body') as THREE.Mesh;
    const leg = cat.getObjectByName('leftLeg') as THREE.Mesh;
    const eyeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(eye.quaternion);
    body.geometry.computeBoundingBox();
    leg.geometry.computeBoundingBox();
    const bodyBottom = body.position.y + body.geometry.boundingBox!.min.y;
    const legTop = leg.position.y + leg.geometry.boundingBox!.max.y;

    expect(eye.geometry.type).toBe('PlaneGeometry');
    expect(eyeNormal.z).toBeLessThan(-0.9);
    expect(legTop - bodyBottom).toBeLessThanOrEqual(0.03);
  });

  it('renders eyes with a texture material instead of sphere meshes', () => {
    const cat = createStandingCat(BROWN_TABBY_PALETTE);
    const leftEye = cat.getObjectByName('leftEye') as THREE.Mesh;
    const material = leftEye.material as THREE.MeshBasicMaterial;

    expect(leftEye.geometry.type).toBe('PlaneGeometry');
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(material.map).toBeInstanceOf(THREE.Texture);
  });

  it('uses a square amber eye pattern matching static cats', () => {
    const cat = createStandingCat(BROWN_TABBY_PALETTE);
    const material = (cat.getObjectByName('leftEye') as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const texture = material.map as THREE.DataTexture;
    const pixels = texture.image.data as Uint8Array;
    const pixelAt = (x: number, y: number): number[] => {
      const index = (y * texture.image.width + x) * 4;
      return Array.from(pixels.slice(index, index + 4));
    };

    expect(pixelAt(8, 32)).toEqual([183, 131, 50, 255]);
    expect(pixelAt(32, 32)).toEqual([42, 33, 29, 255]);
    expect(pixelAt(0, 0)[3]).toBe(0);
  });

  it('does not add a white eye highlight', () => {
    const standingCat = createStandingCat(BROWN_TABBY_PALETTE);
    const eyeMaterial = (standingCat.getObjectByName('leftEye') as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const texture = eyeMaterial.map as THREE.DataTexture;
    const pixels = texture.image.data as Uint8Array;

    for (let index = 0; index < pixels.length; index += 4) {
      expect([pixels[index], pixels[index + 1], pixels[index + 2]]).not.toEqual([255, 255, 255]);
    }

    const seatedCat = createSeatedCat(BROWN_TABBY_PALETTE, 0);
    const seatedGeometry = (seatedCat.getObjectByName('seatedCatMesh') as THREE.Mesh).geometry;
    const positions = seatedGeometry.getAttribute('position');
    const colors = seatedGeometry.getAttribute('color');
    const chest = new THREE.Color(BROWN_TABBY_PALETTE.chest);
    let eyeHighlightVertices = 0;
    for (let index = 0; index < positions.count; index++) {
      const nearEyeCenter = Math.abs(Math.abs(positions.getX(index)) - 0.1) < 0.03
        && positions.getY(index) > 0.9
        && positions.getY(index) < 0.94
        && positions.getZ(index) < -0.34;
      const isChestColor = Math.abs(colors.getX(index) - chest.r) < 0.001
        && Math.abs(colors.getY(index) - chest.g) < 0.001
        && Math.abs(colors.getZ(index) - chest.b) < 0.001;
      if (nearEyeCenter && isChestColor) eyeHighlightVertices++;
    }
    expect(eyeHighlightVertices).toBe(0);
  });

  it('keeps seated cats as a separate pose', () => {
    const cat = createSeatedCat(BROWN_TABBY_PALETTE, 0);
    let meshCount = 0;
    cat.traverse(object => { if (object instanceof THREE.Mesh) meshCount++; });

    expect(cat.name).toBe('proceduralSeatedCat');
    expect(cat.getObjectByName('seatedCatMesh')).toBeInstanceOf(THREE.Mesh);
    expect(meshCount).toBe(1);
  });

  it('bakes seated cats into one static renderable mesh', () => {
    const cat = createSeatedCat(BROWN_TABBY_PALETTE, 0);
    let meshCount = 0;
    cat.traverse(object => { if (object instanceof THREE.Mesh) meshCount++; });

    expect(cat.userData.staticProceduralCat).toBe(true);
    expect(meshCount).toBe(1);
  });

  it('animates child limbs without moving the gameplay root', () => {
    const cat = createStandingCat(BROWN_TABBY_PALETTE);
    const leg = cat.getObjectByName('leftLeg')!;
    const rootBefore = cat.position.clone();
    const before = leg.rotation.x;

    updateCatAnimation(cat, { speed: 3, directionX: 1, directionZ: 0, isDashing: false, dt: 0.1 });
    updateCatAnimation(cat, { speed: 3, directionX: 1, directionZ: 0, isDashing: false, dt: 0.1 });

    expect(leg.rotation.x).not.toBe(before);
    expect(cat.position).toEqual(rootBefore);
  });
});
