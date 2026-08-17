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
    expect(meshCount).toBeLessThanOrEqual(16);
  });

  it('keeps seated cats as a separate pose', () => {
    const cat = createSeatedCat(BROWN_TABBY_PALETTE, 0);
    let meshCount = 0;
    cat.traverse(object => { if (object instanceof THREE.Mesh) meshCount++; });

    expect(cat.name).toBe('proceduralSeatedCat');
    expect(cat.getObjectByName('body')).toBeInstanceOf(THREE.Mesh);
    expect(meshCount).toBeLessThanOrEqual(14);
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
