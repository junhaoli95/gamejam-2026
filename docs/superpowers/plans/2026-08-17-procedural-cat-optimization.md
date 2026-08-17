# Procedural Cat Block Style and Rendering Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visually broken cat parts with a coherent Minecraft-style block cat while reducing static seated-cat rendering from dozens of meshes per scene to one shared-geometry mesh per seated cat.

**Architecture:** `src/scene/proceduralCat.ts` will have two explicit construction paths. Standing player/NPC cats keep named child meshes and a `WeakMap` rig so legs, arms, body, head, tail, and ears can animate. Seated cats use a pre-baked vertex-colored `BufferGeometry` built with `BufferGeometryUtils.mergeGeometries`, one static mesh per cat, shared by palette key, and no animation rig. `loadLibraryScene.ts` will keep the existing group and disposal interfaces but stop updating seated cats every frame.

**Tech Stack:** TypeScript, Three.js `0.185.1`, `three/addons/utils/BufferGeometryUtils.js`, Vitest, Vite.

## Global Constraints

- Work only in `opencode/ben-procedural-cat`; continue updating OPEN PR #32 and do not merge it.
- Do not import Three.js into `src/game/`.
- Keep player radius, movement speed, NPC pathfinding, colliders, state-machine semantics, and the `createStandingCat`/`createSeatedCat` public signatures unchanged.
- Use low-poly geometry, `flatShading`, shared cached materials/geometries, and no GLB/PBR/fur texture.
- Main cat palette remains `#6B4A2F`, `#8B6445`, `#F0E6D2`, `#2A211D`, with amber eyes.
- The standing cat root remains grounded at `y=0`; animation must not move gameplay roots.
- Clamp animation `dt` through the existing main-loop clamp; do not add a second unclamped clock.
- Dynamic standing cats are limited to `12` renderable meshes each; seated cats use one static mesh with at most two material groups.
- Shared geometry and the shared eye texture must not be disposed by an individual cat's teardown path.

---

### Task 1: Add regression tests for visual boundaries and mesh budget

**Files:**
- Modify: `src/scene/proceduralCat.test.ts`

**Interfaces:**
- Consumes the existing `createStandingCat`, `createSeatedCat`, `updateCatAnimation`, and `BROWN_TABBY_PALETTE` exports.
- Produces failing tests that define the new block geometry, eye orientation, limb clearance, and static seated-cat budget before implementation.

- [ ] **Step 1: Add standing geometry assertions**

Append a test in the `procedural cat geometry` suite that reads the named meshes and checks the exact geometry family and dimensions:

```ts
it('uses a coherent block silhouette for the standing cat', () => {
  const cat = createStandingCat(BROWN_TABBY_PALETTE);
  const body = cat.getObjectByName('body') as THREE.Mesh;
  const head = cat.getObjectByName('head') as THREE.Mesh;
  const leftLeg = cat.getObjectByName('leftLeg') as THREE.Mesh;
  const leftArm = cat.getObjectByName('leftArm') as THREE.Mesh;
  const leftFoot = cat.getObjectByName('leftFoot') as THREE.Mesh;

  expect(body.geometry.type).toBe('BoxGeometry');
  expect(head.geometry.type).toBe('BoxGeometry');
  expect(leftLeg.geometry.type).toBe('BoxGeometry');
  expect(leftArm.geometry.type).toBe('BoxGeometry');
  expect(leftFoot.geometry.type).toBe('BoxGeometry');
  expect((body.geometry as THREE.BoxGeometry).parameters.width).toBeCloseTo(0.62);
  expect(Math.abs(leftArm.position.x)).toBeGreaterThan(0.31);
});
```

- [ ] **Step 2: Add eye-facing and limb-clearance assertions**

Add a test that verifies the plane's local `+Z` normal has been rotated toward the cat's local `-Z` face, and that the standing leg top does not deeply overlap the body bottom:

```ts
it('faces eyes forward and keeps limbs outside the body', () => {
  const cat = createStandingCat(BROWN_TABBY_PALETTE);
  const eye = cat.getObjectByName('leftEye') as THREE.Mesh;
  const body = cat.getObjectByName('body') as THREE.Mesh;
  const leg = cat.getObjectByName('leftLeg') as THREE.Mesh;
  const eyeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(eye.quaternion);
  const bodyGeometry = body.geometry as THREE.BoxGeometry;
  const legGeometry = leg.geometry as THREE.BoxGeometry;
  const bodyBottom = body.position.y - bodyGeometry.parameters.height / 2;
  const legTop = leg.position.y + legGeometry.parameters.height / 2;

  expect(eye.geometry.type).toBe('PlaneGeometry');
  expect(eyeNormal.z).toBeLessThan(-0.9);
  expect(legTop - bodyBottom).toBeLessThanOrEqual(0.03);
});
```

- [ ] **Step 3: Add the seated mesh-budget assertion**

Extend the seated-cat test so the static path is explicit:

```ts
it('bakes seated cats into one static renderable mesh', () => {
  const cat = createSeatedCat(BROWN_TABBY_PALETTE, 0);
  let meshCount = 0;
  cat.traverse(object => { if (object instanceof THREE.Mesh) meshCount++; });

  expect(cat.userData.staticProceduralCat).toBe(true);
  expect(meshCount).toBe(1);
});
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```bash
npm test -- src/scene/proceduralCat.test.ts
```

Expected: the new block-head, eye-normal, limb-clearance, and one-mesh seated assertions fail against the current sphere/13-mesh implementation; existing walk and animation tests continue to pass.

---

### Task 2: Rebuild the dynamic standing cat as a coherent block model

**Files:**
- Modify: `src/scene/proceduralCat.ts:1-314`
- Modify: `src/scene/proceduralCat.test.ts` only if a named-part expectation must be updated to the final names

**Interfaces:**
- Consumes the existing `CatPalette`, `CatMotion`, `CatPose`, and `CatRig` contracts.
- Produces a standing cat with named `body`, `head`, `leftLeg`, `rightLeg`, `leftArm`, `rightArm`, `leftFoot`, `rightFoot`, `leftEye`, `rightEye`, `leftEar`, `rightEar`, and `tail` objects.
- Keeps `createStandingCat`, `updateCatAnimation`, and `disposeProceduralCat` signatures unchanged.

- [ ] **Step 1: Add shared geometry and resource helpers**

Import the same utility already used by the bookshelf implementation:

```ts
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
```

Add a module-level geometry cache keyed by shape and dimensions. Every cached geometry must set `geometry.userData.sharedResource = true` so disposal can skip it:

```ts
const sharedGeometryCache = new Map<string, THREE.BufferGeometry>();

function sharedGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = sharedGeometryCache.get(key);
  if (cached) return cached;
  const geometry = factory();
  geometry.userData.sharedResource = true;
  sharedGeometryCache.set(key, geometry);
  return geometry;
}
```

Use this helper for the repeated standing Box/Cone/Plane dimensions. Keep the existing color-keyed material cache and the single 64x64 eye `DataTexture`.

- [ ] **Step 2: Replace the standing body and head geometry**

Use these standing dimensions and local positions:

```ts
body: new THREE.BoxGeometry(0.62, 0.58, 0.48), position [0, 0.64, 0]
head: new THREE.BoxGeometry(0.62, 0.52, 0.50), position [0, 1.12, -0.10]
```

Place the body bottom at `0.35`, the head with only a small overlap above the body, and keep the root at `y=0`. Replace the spherical muzzle and chest patch with thin BoxGeometry pieces on the `-Z` front face. Move the tabby stripe from the current `+Z` position to a visible `-Z` front position.

- [ ] **Step 3: Replace standing legs, arms, feet, and facial planes**

Use these dimensions and positions so the parts are visually attached without being embedded:

```ts
legs:  new THREE.BoxGeometry(0.20, 0.34, 0.20), x = +/-0.16, y = 0.17, z = 0
feet:  new THREE.BoxGeometry(0.22, 0.08, 0.28), x = +/-0.16, y = 0.04, z = -0.08
arms:  new THREE.BoxGeometry(0.16, 0.32, 0.16), x = +/-0.38, y = 0.57, z = 0
eyes:  new THREE.PlaneGeometry(0.15, 0.15), x = +/-0.15, y = 0.04, z = -0.27
```

Set each eye plane's `rotation.y = Math.PI` because PlaneGeometry's front normal is `+Z` while the cat face is `-Z`. Set `renderOrder = 1` and keep the shared `MeshBasicMaterial` map so the eyes remain visible above the head surface without creating per-cat textures. Do not use `DoubleSide` as the primary fix; correct orientation is the root fix.

- [ ] **Step 4: Preserve the existing dynamic animation rig**

Keep `CatRig` references pointed at the new box meshes. Continue applying walk phase to legs and opposite phase to arms, body bob to the body, head bob to the head, and sway to the tail/ears. The root group position must remain untouched. Keep `dt` clamping inside `updateCatAnimation` and do not allocate geometry or materials during animation.

- [ ] **Step 5: Make disposal safe for shared resources**

Change `disposeProceduralCat` so it only disposes geometry when `object.geometry.userData.sharedResource !== true`. Do not dispose `materialCache` materials, the shared eye material, or the shared eye texture from an individual cat teardown.

- [ ] **Step 6: Run focused tests and verify GREEN for the dynamic path**

Run:

```bash
npm test -- src/scene/proceduralCat.test.ts
```

Expected: standing geometry, eye orientation, limb clearance, walk pose, dash pose, root stability, and existing seated tests pass except the seated one-mesh test, which is completed in Task 3.

---

### Task 3: Add the merged static seated-cat path

**Files:**
- Modify: `src/scene/proceduralCat.ts:144-279`
- Modify: `src/scene/proceduralCat.test.ts`

**Interfaces:**
- Consumes the palette and existing `createSeatedCat(palette, rotationY)` signature.
- Produces a `proceduralSeatedCat` group with `userData.proceduralCat = true`, `userData.staticProceduralCat = true`, one mesh child, and no `CatRig` entry.

- [ ] **Step 1: Implement vertex-color append helpers**

Add a local helper matching the bookshelf merge pattern. It must transform each small part into seated-cat local space, write a color attribute for every vertex, and append the geometry to a list:

```ts
function appendColoredGeometry(
  geometries: THREE.BufferGeometry[],
  geometry: THREE.BufferGeometry,
  color: number,
  position: THREE.Vector3Tuple,
  rotationY = 0,
): void {
  geometry.rotateY(rotationY);
  geometry.translate(...position);
  const colorAttribute = new Float32Array(geometry.attributes.position.count * 3);
  const vertexColor = new THREE.Color(color);
  for (let index = 0; index < geometry.attributes.position.count; index++) {
    vertexColor.toArray(colorAttribute, index * 3);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorAttribute, 3));
  geometries.push(geometry);
}
```

The helper must dispose only temporary input geometries after the final merge, never the cached merged result.

- [ ] **Step 2: Build and cache one seated geometry per palette key**

Build the seated silhouette from low-detail boxes/cones/capsules using the existing seated proportions: compact body, head, two short legs/arms, ears, tail, cream chest/muzzle/feet, and small colored eye planes. Bake all pieces into one geometry with `BufferGeometryUtils.mergeGeometries(geometries, false)`, keyed by the five palette colors. Use vertex colors with one shared `MeshStandardMaterial({ vertexColors: true, flatShading: true })`, so the returned cat has one mesh and no material array/groups.

The seated geometry cache must contain the transformed local geometry, not world placement. `createSeatedCat` applies the requested `rotationY` to the group, preserving the existing `loadLibraryScene` placement and teardown behavior.

- [ ] **Step 3: Replace the seated constructor and disable its rig**

Create the static group as follows:

```ts
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
```

Do not add the group to `rigs`; `updateCatAnimation` must continue returning immediately for groups without a dynamic rig.

- [ ] **Step 4: Run focused tests and verify the static budget**

Run:

```bash
npm test -- src/scene/proceduralCat.test.ts
```

Expected: all focused tests pass, including exactly one seated mesh and all existing animation tests.

---

### Task 4: Remove static per-frame animation and validate scene integration

**Files:**
- Modify: `src/scene/loadLibraryScene.ts:1014-1045`
- Modify: `src/scene/proceduralCat.test.ts` only if integration-facing metadata needs an assertion

**Interfaces:**
- Consumes the unchanged `createSeatedCat` group contract and the existing `staticSeatedCats`/`tableSeatedCats` sets used for teardown.
- Produces the same `LibraryScene.update(dt)` and `rebuildTableZone` behavior without iterating seated cats every frame.

- [ ] **Step 1: Remove the two seated animation loops**

Delete only these per-frame calls from the returned scene update:

```ts
const seatedMotion = { speed: 0, directionX: 0, directionZ: 0, isDashing: false, dt };
for (const cat of staticSeatedCats) updateCatAnimation(cat, seatedMotion);
for (const cat of tableSeatedCats) updateCatAnimation(cat, seatedMotion);
```

Keep both sets and their `.clear()` calls because `rebuildTableZone` still needs to track cats for disposal and table-zone replacement. Keep player animation, outlet pulsing, NPC animation, and all game-state logic unchanged.

- [ ] **Step 2: Run the complete test suite and build**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: all test files pass, TypeScript/Vite build exits with code 0, and `git diff --check` emits no whitespace errors.

- [ ] **Step 3: Verify the default scene mesh budget**

Use the existing default layout calculation as the acceptance baseline:

```text
17 study tables * 4 seats = 68 seats
68 seats - DEFAULT_FREE_SEAT_COUNT(6) = 62 seated cats
62 static meshes + 4 dynamic standing cats * 12 maximum = <= 110 cat meshes
```

Confirm the seated constructor test reports one mesh and the standing constructor test reports no more than twelve meshes. Confirm no geometry is created inside `updateCatAnimation` or `LibraryScene.update` for seated cats.

- [ ] **Step 4: Browser visual verification**

Reload `http://127.0.0.1:5175/` in the existing Chrome game tab and inspect a front-facing standing cat and several seated cats. Verify all of the following:

- Both eyes are visible from the cat's front and angled front view.
- The head is a shallow block rather than a sphere.
- Arms sit outside the body silhouette and do not disappear into the torso.
- Legs connect at the body underside without extending through the torso.
- Feet touch the floor and do not float or sink.
- Seated cats keep the same block style and remain on their chairs.
- Player/NPC walk and dash animation still move only child parts.
- NPC arrows remain above standing cats.

- [ ] **Step 5: Commit the implementation**

After all verification commands pass, commit only the implementation and test changes:

```bash
git status --short
git add src/scene/proceduralCat.ts src/scene/proceduralCat.test.ts src/scene/loadLibraryScene.ts
git diff --cached --check
git -c user.name="Ben" -c user.email="ben@local" commit -m "feat: 优化方块猫造型与静态猫渲染"
```

- [ ] **Step 6: Update the open PR**

Before pushing, verify the PR is still open, then push the current branch:

```bash
gh pr view 32 --json state,headRefName
git push origin opencode/ben-procedural-cat
```

Expected: `state` is `OPEN`, the push updates PR #32, and no merge operation is performed.
