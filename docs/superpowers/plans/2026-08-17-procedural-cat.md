# Procedural Cat and Walk Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace placeholder cats with a low-poly brown tabby procedural cat and add simple code-driven idle, walk, and dash animation for the player and moving NPCs.

**Architecture:** Keep all cat geometry, pure pose math, and animation in `src/scene/proceduralCat.ts`. The module exposes normal `THREE.Group` values and stores rig references in a `WeakMap`; it does not read game state or DOM. `loadLibraryScene.ts` owns player and seated-cat creation, while `npcMesh.ts` derives NPC motion from entity position deltas and drives standing-cat animation. `game/` state, movement, collision, and NPC pathfinding remain unchanged.

**Tech Stack:** TypeScript, Three.js, Vitest.

## Global Constraints

- Work only in `opencode/ben-procedural-cat`; do not modify or push to the OPEN PR #31 branch.
- Do not import Three.js into `src/game/`.
- Keep player radius, movement speed, NPC pathfinding, colliders, and state-machine semantics unchanged.
- Use low-poly geometry, `flatShading`, shared cached materials, and no GLB/PBR/fur texture.
- Main cat palette is brown tabby: `#6B4A2F`, `#8B6445`, `#F0E6D2`, `#2A211D`, amber eyes.
- Clamp animation `dt` through the existing main-loop clamp; animation must not move gameplay roots.

---

### Task 1: Build and Test the Procedural Cat Module

**Files:**
- Create: `src/scene/proceduralCat.ts`
- Create: `src/scene/proceduralCat.test.ts`

**Interfaces:**
- Produces `CatPalette`, `CatMotion`, `CatPose` types.
- Produces `createStandingCat(palette) -> THREE.Group`.
- Produces `createSeatedCat(palette, rotationY) -> THREE.Group`.
- Produces `computeCatWalkPose(phase, isDashing) -> CatPose`.

- [x] **Step 1: Write failing pure pose tests**

```ts
import { describe, expect, it } from 'vitest';
import { computeCatWalkPose } from './proceduralCat';

describe('computeCatWalkPose', () => {
  it('uses opposite phases for diagonal leg pairs', () => {
    const pose = computeCatWalkPose(0, false);
    expect(pose.frontLeft).toBeCloseTo(pose.rearRight);
    expect(pose.frontRight).toBeCloseTo(pose.rearLeft);
    expect(pose.frontLeft).not.toBeCloseTo(pose.frontRight);
  });

  it('increases stride and body lean during dash', () => {
    const walk = computeCatWalkPose(Math.PI / 2, false);
    const dash = computeCatWalkPose(Math.PI / 2, true);
    expect(Math.abs(dash.frontLeft)).toBeGreaterThan(Math.abs(walk.frontLeft));
    expect(dash.lean).toBeGreaterThan(walk.lean);
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/scene/proceduralCat.test.ts
```

Expected: FAIL because `src/scene/proceduralCat.ts` does not exist.

- [x] **Step 3: Implement pure pose calculation**

Define `CatPose` with `frontLeft`, `frontRight`, `rearLeft`, `rearRight`, `bodyBob`, `headBob`, `tailSway`, and `lean`. Use sine/cosine only; `isDashing` increases stride and lean without changing any world position.

- [x] **Step 4: Add failing group and palette tests**

```ts
import * as THREE from 'three';
import { createStandingCat, createSeatedCat, BROWN_TABBY_PALETTE } from './proceduralCat';

it('creates a grounded standing cat with animated parts', () => {
  const cat = createStandingCat(BROWN_TABBY_PALETTE);
  expect(cat.name).toBe('proceduralStandingCat');
  expect(cat.getObjectByName('body')).toBeInstanceOf(THREE.Mesh);
  expect(cat.getObjectByName('frontLeftLeg')).toBeInstanceOf(THREE.Object3D);
  expect(cat.getObjectByName('tail')).toBeInstanceOf(THREE.Object3D);
});

it('keeps seated cats as a separate pose', () => {
  const cat = createSeatedCat(BROWN_TABBY_PALETTE, 0);
  expect(cat.name).toBe('proceduralSeatedCat');
  expect(cat.getObjectByName('body')).toBeInstanceOf(THREE.Mesh);
});
```

- [x] **Step 5: Run the focused test and verify RED**

Run:

```bash
npm test -- src/scene/proceduralCat.test.ts
```

Expected: the new group tests fail until the geometry builder exists.

- [x] **Step 6: Implement low-poly cat geometry**

Implement `proceduralCat.ts` with:

- `BROWN_TABBY_PALETTE` using the locked colors from the spec.
- Cached `MeshStandardMaterial` instances per palette/color.
- Standing body, head, muzzle, ears, four legs, four paws, and a segmented tail.
- Chest/muzzle/paw color blocks and 2-3 dark tabby stripe meshes or bands; no fur texture.
- Seated body/legs/tail pose for table cats.
- `castShadow = true` on visible parts and `receiveShadow = true` on body/legs.

Use a standing height near `1.2m`, a body width near `0.55m`, and a root bottom at `y=0`.

- [x] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
npm test -- src/scene/proceduralCat.test.ts
```

Expected: all cat-module tests pass.

---

### Task 2: Integrate Player, NPC, and Seated Cat Animation

**Files:**
- Modify: `src/scene/loadLibraryScene.ts:284-342, 576-614, 940-965, 990-1008`
- Modify: `src/scene/npcMesh.ts:8-75`
- Modify: `src/main.ts:172-178, 268-290`
- Modify: `src/scene/proceduralCat.test.ts`

**Interfaces:**
- Consumes the cat module from Task 1.
- Produces `updateCatAnimation(cat, motion) -> void`.
- `createNpcMeshManager().update` changes from `(entities)` to `(entities, dt)`.
- Produces standing player/NPC visuals while preserving `LibraryScene.player`, `npcMeshes`, and all game interfaces.

- [x] **Step 1: Write the failing animation test**

Extend the module-level tests to call `updateCatAnimation` twice with movement and assert that a named leg transform changes while the root position remains unchanged:

```ts
it('animates child limbs without moving the gameplay root', () => {
  const cat = createStandingCat(BROWN_TABBY_PALETTE);
  const leg = cat.getObjectByName('frontLeftLeg')!;
  const rootBefore = cat.position.clone();
  const before = leg.rotation.x;

  updateCatAnimation(cat, { speed: 3, directionX: 1, directionZ: 0, isDashing: false, dt: 0.1 });
  updateCatAnimation(cat, { speed: 3, directionX: 1, directionZ: 0, isDashing: false, dt: 0.1 });

  expect(leg.rotation.x).not.toBe(before);
  expect(cat.position).toEqual(rootBefore);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/scene/proceduralCat.test.ts
```

Expected: the integration assertion fails because `updateCatAnimation` is not implemented yet.

- [x] **Step 3: Implement animation state and child transforms**

Add the `WeakMap<THREE.Group, CatRig>` to `proceduralCat.ts` and implement `updateCatAnimation()` so it advances phase from `speed * dt`, applies the pure pose to named limbs/body/head/tail, handles idle and dash, and never changes the root position.

- [x] **Step 4: Replace scene-local player and cat construction**

In `loadLibraryScene.ts`:

- Remove the local procedural body of `createSeatedCat` and `createPlaceholderCat`.
- Import `BROWN_TABBY_PALETTE`, `createStandingCat`, `createSeatedCat`, and `updateCatAnimation`.
- Create the player with `createStandingCat(BROWN_TABBY_PALETTE)` and retain `name = 'placeholderPlayer'` for existing callers.
- Keep table-seat cats seated and preserve their existing placement y offsets.
- Create moving outlet NPCs as standing cats at root y `0`.
- In the returned scene `update(dt)`, compute player `x/z` delta from a stored previous position and call `updateCatAnimation` with speed/direction; reset the stored position when the player is reset.

- [x] **Step 5: Drive moving NPC animation from position deltas**

In `npcMesh.ts`:

- Change `update(entities)` to `update(entities, dt)`.
- Store one previous `{ x, z }` per `meshIndex`.
- Compute speed from position delta divided by `dt` with a zero guard.
- Treat `moving` and `wander` with nonzero speed as walk; all other states use idle.
- Set standing NPC root y to `0` and rotate it toward the movement direction only when speed is above threshold.
- Set arrow height from the standing cat height instead of the old seated-cat `MESH_Y`.

- [x] **Step 6: Pass clamped dt from the main loop**

Change only the existing call site in `main.ts`:

```ts
npcMeshManager.update(npcController.entities, dt);
```

Do not modify `NpcEntity`, `NpcController`, pathfinding, collision, or game state.

- [x] **Step 7: Run all tests and build**

Run:

```bash
npm test
npm run build
```

Expected: all existing tests plus cat tests pass; build exits with code 0.

- [x] **Step 8: Run browser verification**

Start the dev server from this worktree and verify:

- Player cat is a grounded brown tabby.
- Player walk, stop, and dash visibly change limbs/body/tail only.
- Moving NPCs walk while `moving`/`wander` and idle at rest.
- Seated table cats remain seated.
- NPC arrows stay above standing cats.
- No cat floats, sinks, rotates incorrectly, or changes collision behavior.

- [x] **Step 9: Commit the implementation**

```bash
git add src/scene/proceduralCat.ts src/scene/proceduralCat.test.ts src/scene/loadLibraryScene.ts src/scene/npcMesh.ts src/main.ts
git diff --cached --check
git -c user.name="Ben" -c user.email="ben@local" commit -m "feat: 程序化棕色虎斑猫与走路动画"
```

After verification, push this branch as a new PR. Do not modify or merge PR #31.
