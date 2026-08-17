# Procedural Library Props Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain bookshelf placeholder with a lightweight, stylized Three.js bookshelf built from hard-edged geometry and deterministic colored book blocks.

**Architecture:** Keep `loadLibraryScene.ts` responsible for placement, GLB fallback, and colliders. Move the visual construction and deterministic book-layout helper into `src/scene/proceduralLibraryProps.ts`; the builder merges all frame, shelf, and book box geometry into one vertex-colored Mesh per bookshelf. Tests cover the pure book layout, merged group structure, color attribute, and triangle budget without touching game logic or collision dimensions.

**Tech Stack:** TypeScript, Three.js, Vitest.

## Global Constraints

- Do not import Three.js into `src/game/`.
- Do not change `MODEL_DIMS`, layout data, AABB colliders, outlet logic, or GLB paths.
- Environment assets use hard edges, flat color blocks, and selective dark structure accents; do not add a global thick outline.
- Keep the bookshelf target at `3.0m × 2.4m × 0.6m` and under 5,000 triangles in the visual construction.
- Use fixed seed input so book placement is deterministic.

---

### Task 1: Add a Tested Procedural Bookshelf Builder

**Files:**
- Create: `src/scene/proceduralLibraryProps.ts`
- Create: `src/scene/proceduralLibraryProps.test.ts`
- Modify: `src/scene/loadLibraryScene.ts:344-360`

**Interfaces:**
- Produces `createProceduralBookshelf(dim, seed?) -> THREE.Group` for the scene placeholder.
- Produces `createBookLayout(dim, seed?) -> BookPlacement[]` for deterministic, bounded book blocks.
- Produces `createDoubleSidedBookLayout(dim, seed?) -> BookPlacement[]` for mirrored front/back book blocks.
- Consumes the existing `MODEL_DIMS.bookshelf` shape and the existing placeholder call only.

- [x] **Step 1: Write the failing tests**

Test the pure layout before writing the implementation:

```ts
import { describe, expect, it } from 'vitest';
import { createBookLayout } from './proceduralLibraryProps';

const DIM = { w: 3, h: 2.4, d: 0.6 };

describe('createBookLayout', () => {
  it('returns the same placements for the same seed', () => {
    expect(createBookLayout(DIM, 17)).toEqual(createBookLayout(DIM, 17));
  });

  it('keeps every book inside the bookshelf footprint and on a shelf row', () => {
    const layout = createBookLayout(DIM, 17);

    expect(layout.length).toBeGreaterThan(20);
    for (const book of layout) {
      expect(Math.abs(book.x) + book.w / 2).toBeLessThanOrEqual(DIM.w / 2 - 0.08);
      expect(book.y).toBeGreaterThan(0.1);
      expect(book.y + book.h).toBeLessThanOrEqual(DIM.h - 0.08);
      expect(Math.abs(book.z)).toBeLessThanOrEqual(DIM.d / 2);
    }
  });
});
```

Also add group-level assertions for a single colored mesh and the triangle budget:

```ts
it('builds the whole bookshelf as one colored mesh', () => {
  const group = createProceduralBookshelf(DIM, 17);
  const mesh = group.children[0] as THREE.Mesh;
  const position = mesh.geometry.getAttribute('position');
  const triangles = mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3;

  expect(group.children).toHaveLength(1);
  expect(group.name).toBe('proceduralBookshelf');
  expect(mesh).toBeInstanceOf(THREE.Mesh);
  expect(mesh.geometry.getAttribute('color')).toBeDefined();
  expect(triangles).toBeLessThan(5000);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/scene/proceduralLibraryProps.test.ts
```

Expected: FAIL because `src/scene/proceduralLibraryProps.ts` does not exist yet.

- [x] **Step 3: Implement the minimal procedural visual**

Implement `src/scene/proceduralLibraryProps.ts` with:

- A small seeded RNG local to this scene module.
- `createBookLayout()` generating 5 rows of varied book widths/heights, with bounded x positions, small deterministic y rotations, and palette colors `0xb08c5e`, `0x6b4a2f`, `0xf0ede6`, `0x9f5546`, `0x4d668f`, `0x73865d`.
- `createDoubleSidedBookLayout()` mirroring the same deterministic placements onto front and back faces.
- `createProceduralBookshelf()` creating a `THREE.Group` named `proceduralBookshelf` with exactly one child Mesh.
- Two warm-wood side posts, a top cap, a bottom plinth, no closed back panel, and five charcoal shelf rails.
- Temporary `BoxGeometry` parts with per-vertex colors merged through `BufferGeometryUtils.mergeGeometries()`.
- One `MeshStandardMaterial` with `vertexColors: true` and `flatShading: true`; no normal/roughness/metallic texture dependency.
- `castShadow = true` on the merged Mesh; no environment-wide outline.

Use the supplied dimensions and keep all visual geometry centered around x/z with its bottom at y=0. Do not create or modify colliders in this module.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
npm test -- src/scene/proceduralLibraryProps.test.ts
```

Expected: all focused tests pass.

- [x] **Step 5: Delegate the existing placeholder to the new builder**

In `loadLibraryScene.ts`, import `createProceduralBookshelf` and replace the body of `buildShelfPlaceholder()` with:

```ts
function buildShelfPlaceholder(dim: { w: number; h: number; d: number }): THREE.Group {
  return createProceduralBookshelf(dim, 17);
}
```

Do not change the placeholder placement, `MODEL_DIMS`, static collider creation, or async GLB swap. The procedural bookshelf is the fallback visual; an available `public/library/bookshelf.glb` may still replace it through the existing path.

- [x] **Step 6: Run the complete verification**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and the Vite build exits with code 0.

- [x] **Step 7: Inspect the worktree diff**

Run:

```bash
git status --short
git diff -- src/scene/loadLibraryScene.ts src/scene/proceduralLibraryProps.ts src/scene/proceduralLibraryProps.test.ts
```

Confirm that only the procedural bookshelf visual and its tests/plan changed; no game logic, layout, collider, or main-branch files are touched.
