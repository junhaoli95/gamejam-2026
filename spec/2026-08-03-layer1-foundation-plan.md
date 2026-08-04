# Layer 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build shared foundation (grid model, A* pathfinding, config single-source-of-truth, minimap renderer, SharedState facade, mount stubs) that enables parallel independent agents to build phone HUD and dash/battery without conflicts.

**Architecture:** `game/` layer = pure TS (zero Three.js DOM deps except gridModel adapter). `ui/minimap.ts` = 2D canvas reading from `getSharedState()` facade. `main.ts` = wiring hub with pre-drilled mount points. All cross-agent interfaces nailed as TS types.

**Tech Stack:** TypeScript, Three.js r0.185, vitest, canvas 2D API

## Global Constraints

- `game/` 不得 import `three` 的渲染对象(Scene/Mesh/Renderer),仅允许 import 类型(Box3/Vector3)做适配
- `cellSize = 0.4m`,world 32×24m → grid 80×60 = 4800 cells,Uint8Array flat
- A* = 4-connected + Manhattan heuristic + 自写二叉堆,零依赖
- minimap = 180×136px canvas,30fps 节流,每次渲染现读 getSharedState()(禁止快照)
- commit 作者 `Snake <snake@agent.local>`
- spec: `spec/2026-08-03-layer1-foundation-design.md`

---

### Task 1: vitest setup + config.ts

**Files:**
- Create: `src/game/config.ts`
- Modify: `package.json` (add vitest devDep + test script)
- Modify: `src/player/thirdPersonController.ts:28-40` (delete constants, import CONFIG)

**Interfaces:**
- Produces: `CONFIG` object with `world`/`player`/`camera`/`dash`/`battery`/`npc` sections

- [ ] **Step 1: Install vitest**

```bash
npm i -D vitest
```

- [ ] **Step 2: Add test scripts to package.json**

Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create config.ts**

```ts
export const CONFIG = {
  world: { w: 32, d: 24, cellSize: 0.4 },
  player: {
    walkSpeed: 3.0,
    sprintSpeed: 5.6,
    radius: 0.32,
    turnLerp: 14,
  },
  camera: {
    fov: 70,
    near: 0.05,
    far: 80,
    dist: 2.7,
    side: 0.35,
    up: 1.35,
    pitchMin: -0.12,
    pitchMax: 0.4,
    mouseSens: 0.0023,
    collidePad: 0.25,
    collideSteps: 8,
  },
  dash: {
    pipCount: 3,
    pipCost: 1,
    durationS: 0.6,
    cooldownS: 1.5,
  },
  battery: {
    startPercent: 1.0,
    drainMove: 0.5,
    drainSprint: 2.0,
    drainApp: 1.0,
    drainIdle: 0.2,
    totalGameTimeS: 180,
  },
  npc: {
    count: 3,
  },
} as const;
```

- [ ] **Step 4: Refactor controller to use CONFIG**

In `src/player/thirdPersonController.ts`:
- Add `import { CONFIG } from '../game/config';` at top
- Delete lines 28-40 (all hardcoded constants)
- Replace all references: `WALK_SPEED` → `CONFIG.player.walkSpeed`, `SPRINT_SPEED` → `CONFIG.player.sprintSpeed`, `PLAYER_RADIUS` → `CONFIG.player.radius`, `TURN_LERP` → `CONFIG.player.turnLerp`, `CAM_DIST` → `CONFIG.camera.dist`, `CAM_SIDE` → `CONFIG.camera.side`, `CAM_UP` → `CONFIG.camera.up`, `PITCH_MIN` → `CONFIG.camera.pitchMin`, `PITCH_MAX` → `CONFIG.camera.pitchMax`, `MOUSE_SENS` → `CONFIG.camera.mouseSens`, `CAM_COLLIDE_PAD` → `CONFIG.camera.collidePad`, `CAM_COLLIDE_STEPS` → `CONFIG.camera.collideSteps`
- Add `getYaw: () => number` to `ThirdPersonController` interface
- In the returned object, add `getYaw: () => yaw`

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: zero TS errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(layer1): vitest + config.ts single source of truth + controller refactor"
```

---

### Task 2: gridModel.ts (TDD)

**Files:**
- Create: `src/game/gridModel.ts`
- Create: `src/game/gridModel.test.ts`

**Interfaces:**
- Produces: `Cell`, `Grid`, `toGrid()`, `worldToCell()`, `cellToWorld()`, `isBlocked()`

- [ ] **Step 1: Write the failing test**

`src/game/gridModel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Box3, Vector3 } from 'three';
import { toGrid, isBlocked, worldToCell, cellToWorld } from './gridModel';

describe('gridModel', () => {
  it('single Box3 covers correct cells', () => {
    // World 10m x 10m, cellSize 1m → 10x10 grid
    // Box3 from (-1,-1,-1) to (1,1,1) → 2x2m box centered at origin
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const grid = toGrid([box], 10, 10, 1);

    // Cell centers: (x+0.5)*1 - 5 = x-4.5
    // Cells (4,4),(5,4),(4,5),(5,5) have centers in [-1,1]x[-1,1]
    expect(isBlocked(grid, { x: 4, z: 4 })).toBe(true);
    expect(isBlocked(grid, { x: 5, z: 4 })).toBe(true);
    expect(isBlocked(grid, { x: 4, z: 5 })).toBe(true);
    expect(isBlocked(grid, { x: 5, z: 5 })).toBe(true);
    // Outside the box
    expect(isBlocked(grid, { x: 6, z: 5 })).toBe(false);
    expect(isBlocked(grid, { x: 3, z: 4 })).toBe(false);
  });

  it('worldToCell and cellToWorld are consistent', () => {
    const grid = toGrid([], 32, 24, 0.4);
    const world = { x: 3.5, z: -2.1 };
    const cell = worldToCell(world.x, world.z, grid);
    const back = cellToWorld(cell, grid);
    expect(Math.abs(back.x - world.x)).toBeLessThan(0.4);
    expect(Math.abs(back.z - world.z)).toBeLessThan(0.4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/gridModel.test.ts`
Expected: FAIL — `Cannot find module './gridModel'`

- [ ] **Step 3: Write gridModel.ts**

```ts
import type { Box3 } from 'three';

export interface Cell { x: number; z: number; }

export interface Grid {
  cells: Uint8Array;
  w: number;
  d: number;
  cellSize: number;
}

export function toGrid(
  colliders: Box3[],
  worldW: number,
  worldD: number,
  cellSize: number,
): Grid {
  const w = Math.ceil(worldW / cellSize);
  const d = Math.ceil(worldD / cellSize);
  const cells = new Uint8Array(w * d);

  for (let zi = 0; zi < d; zi++) {
    for (let xi = 0; xi < w; xi++) {
      const wx = (xi + 0.5) * cellSize - worldW / 2;
      const wz = (zi + 0.5) * cellSize - worldD / 2;
      for (const b of colliders) {
        if (wx >= b.min.x && wx <= b.max.x && wz >= b.min.z && wz <= b.max.z) {
          cells[zi * w + xi] = 1;
          break;
        }
      }
    }
  }

  return { cells, w, d, cellSize };
}

export function worldToCell(wx: number, wz: number, grid: Grid): Cell {
  const halfW = grid.w * grid.cellSize / 2;
  const halfD = grid.d * grid.cellSize / 2;
  return {
    x: Math.floor((wx + halfW) / grid.cellSize),
    z: Math.floor((wz + halfD) / grid.cellSize),
  };
}

export function cellToWorld(c: Cell, grid: Grid): { x: number; z: number } {
  const halfW = grid.w * grid.cellSize / 2;
  const halfD = grid.d * grid.cellSize / 2;
  return {
    x: (c.x + 0.5) * grid.cellSize - halfW,
    z: (c.z + 0.5) * grid.cellSize - halfD,
  };
}

export function isBlocked(grid: Grid, c: Cell): boolean {
  if (c.x < 0 || c.x >= grid.w || c.z < 0 || c.z >= grid.d) return true;
  return grid.cells[c.z * grid.w + c.x] === 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/gridModel.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(layer1): gridModel — Grid type + toGrid adapter with tests"
```

---

### Task 3: pathfinding.ts (TDD)

**Files:**
- Create: `src/game/pathfinding.ts`
- Create: `src/game/pathfinding.test.ts`

**Interfaces:**
- Consumes: `Cell`, `Grid`, `isBlocked` from `./gridModel`
- Produces: `findPath(grid, start, goal): Cell[] | null`

- [ ] **Step 1: Write 4 failing tests**

`src/game/pathfinding.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Grid, isBlocked } from './gridModel';
import { findPath } from './pathfinding';

function emptyGrid(w: number, d: number): Grid {
  return { cells: new Uint8Array(w * d), w, d, cellSize: 1 };
}

function gridWithBlocked(w: number, d: number, blocked: Array<[number, number]>): Grid {
  const cells = new Uint8Array(w * d);
  for (const [x, z] of blocked) cells[z * w + x] = 1;
  return { cells, w, d, cellSize: 1 };
}

describe('findPath', () => {
  it('straight line in empty grid', () => {
    const grid = emptyGrid(5, 5);
    const path = findPath(grid, { x: 0, z: 0 }, { x: 4, z: 0 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    expect(path![0]).toEqual({ x: 0, z: 0 });
    expect(path![4]).toEqual({ x: 4, z: 0 });
  });

  it('L-shape obstacle detour', () => {
    // Block column x=1, z=0..3 (leave z=4 open)
    const blocked: Array<[number, number]> = [[1,0],[1,1],[1,2],[1,3]];
    const grid = gridWithBlocked(5, 5, blocked);
    const path = findPath(grid, { x: 0, z: 0 }, { x: 4, z: 0 });
    expect(path).not.toBeNull();
    // Path must go through z=4 to get around
    const maxZ = Math.max(...path!.map(c => c.z));
    expect(maxZ).toBeGreaterThanOrEqual(4);
    // Verify no blocked cell in path
    for (const c of path!) {
      expect(isBlocked(grid, c)).toBe(false);
    }
  });

  it('unreachable returns null', () => {
    // Block entire column x=1
    const blocked: Array<[number, number]> = [[1,0],[1,1],[1,2],[1,3],[1,4]];
    const grid = gridWithBlocked(5, 5, blocked);
    const path = findPath(grid, { x: 0, z: 0 }, { x: 4, z: 0 });
    expect(path).toBeNull();
  });

  it('start === goal returns single cell', () => {
    const grid = emptyGrid(5, 5);
    const path = findPath(grid, { x: 2, z: 2 }, { x: 2, z: 2 });
    expect(path).toEqual([{ x: 2, z: 2 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/game/pathfinding.test.ts`
Expected: FAIL — `Cannot find module './pathfinding'`

- [ ] **Step 3: Write pathfinding.ts**

```ts
import type { Cell, Grid } from './gridModel';
import { isBlocked } from './gridModel';

export function findPath(grid: Grid, start: Cell, goal: Cell): Cell[] | null {
  if (start.x === goal.x && start.z === goal.z) return [start];
  if (isBlocked(grid, start) || isBlocked(grid, goal)) return null;

  const w = grid.w;
  const total = w * grid.d;
  const idx = (x: number, z: number) => z * w + x;

  const cameFrom = new Int32Array(total).fill(-1);
  const gScore = new Float32Array(total).fill(Infinity);
  const fScore = new Float32Array(total).fill(Infinity);
  const closed = new Uint8Array(total);

  const heap: number[] = [];
  const startIdx = idx(start.x, start.z);
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(start, goal);
  heapPush(startIdx);

  while (heap.length > 0) {
    const current = heapPop();
    if (closed[current]) continue;
    const cx = current % w;
    const cz = Math.floor(current / w);

    if (cx === goal.x && cz === goal.z) {
      const path: Cell[] = [];
      let cur = current;
      while (cur !== -1) {
        path.push({ x: cur % w, z: Math.floor(cur / w) });
        cur = cameFrom[cur];
      }
      return path.reverse();
    }

    closed[current] = 1;

    const neighbors = [
      { x: cx + 1, z: cz },
      { x: cx - 1, z: cz },
      { x: cx, z: cz + 1 },
      { x: cx, z: cz - 1 },
    ];

    for (const n of neighbors) {
      if (n.x < 0 || n.x >= w || n.z < 0 || n.z >= grid.d) continue;
      const nIdx = idx(n.x, n.z);
      if (closed[nIdx] || grid.cells[nIdx] === 1) continue;

      const tentativeG = gScore[current] + 1;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + heuristic(n, goal);
        heapPush(nIdx);
      }
    }
  }

  return null;

  function heuristic(a: Cell, b: Cell): number {
    return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
  }

  function heapPush(node: number): void {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (fScore[heap[parent]] <= fScore[heap[i]]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }

  function heapPop(): number {
    const top = heap[0];
    heap[0] = heap[heap.length - 1];
    heap.pop();
    let i = 0;
    const n = heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && fScore[heap[l]] < fScore[heap[smallest]]) smallest = l;
      if (r < n && fScore[heap[r]] < fScore[heap[smallest]]) smallest = r;
      if (smallest === i) break;
      [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
      i = smallest;
    }
    return top;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/game/pathfinding.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(layer1): A* pathfinding — 4-connected, binary heap, 4 test cases"
```

---

### Task 4: loadLibraryScene outlets + SharedState interface + facade

**Files:**
- Modify: `src/scene/loadLibraryScene.ts` (extend LibraryScene + collect outlets)
- Create: `src/platform/sharedState.ts` (SharedState interface + facade)
- Modify: `src/player/thirdPersonController.ts:14-16` (getYaw already added in Task 1)

**Interfaces:**
- Consumes: `CONFIG.world` from config, `controller.getYaw()` from Task 1
- Produces: `SharedState` interface, `createSharedStateFacade()`, `LibraryScene.outlets`

- [ ] **Step 1: Extend LibraryScene interface with outlets**

In `src/scene/loadLibraryScene.ts`, add to `LibraryScene` interface:
```ts
  /** 所有电位位置(柱电位+端板盒+桌电位+壁插),供 SharedState/minimap 消费。 */
  outlets: Array<{ x: number; z: number }>;
```

- [ ] **Step 2: Collect outlets in createLibraryScene return**

In `createLibraryScene()`, collect all outlet positions before the return statement:
```ts
  const outletPositions: Array<{ x: number; z: number }> = [];
  for (const c of poweredColumns) {
    outletPositions.push({ x: c.x + c.face * (MODEL_DIMS.column.w / 2), z: c.z });
  }
  for (const b of endPanelBoxes) {
    outletPositions.push({ x: b.x, z: b.z - MODEL_DIMS.column.d / 2 });
  }
  for (const p of placements) {
    if (p.kind === 'studyTable') {
      for (const ox of STUDY_OUTLET_OFFSETS) {
        outletPositions.push({ x: p.x + ox, z: p.z });
      }
    }
  }
  // wallSockets
  for (const p of placements) {
    if (p.kind === 'wallSocket') outletPositions.push({ x: p.x, z: p.z });
  }
```

Add `outlets: outletPositions` to the return object.

- [ ] **Step 3: Create SharedState interface + facade**

`src/platform/sharedState.ts`:
```ts
import type * as THREE from 'three';
import type { ThirdPersonController } from '../player/thirdPersonController';

export interface SharedState {
  player: { x: number; z: number; yaw: number };
  battery: number;
  pips: number;
  outlets: Array<{ x: number; z: number; occupied: boolean }>;
  npcs: Array<{ x: number; z: number; state: string }>;
  path?: Array<{ x: number; z: number }>;
}

export type AppAction =
  | { kind: 'query-outlets' }
  | { kind: 'toggle-map' }
  | { kind: 'close' };

export interface SharedStateFacade {
  getSharedState: () => SharedState;
}

export function createSharedStateFacade(
  player: THREE.Group,
  controller: ThirdPersonController,
  outlets: Array<{ x: number; z: number }>,
): SharedStateFacade {
  return {
    getSharedState: () => ({
      player: {
        x: player.position.x,
        z: player.position.z,
        yaw: controller.getYaw(),
      },
      battery: 1.0,
      pips: 3,
      outlets: outlets.map(o => ({ ...o, occupied: false })),
      npcs: [],
      path: undefined,
    }),
  };
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: zero TS errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(layer1): LibraryScene.outlets + SharedState interface + facade"
```

---

### Task 5: Mount stubs

**Files:**
- Create: `src/ui/phoneHud.ts`
- Create: `src/game/playerStats.ts`

**Interfaces:**
- Consumes: `SharedState`, `AppAction` from `platform/sharedState`
- Produces: `mountPhoneHud()`, `mountPlayerStats()` (stubs for PR #7/#8)

- [ ] **Step 1: Create phoneHud.ts stub**

```ts
import type { SharedState, AppAction } from '../platform/sharedState';

export interface PhoneHudOptions {
  getSharedState: () => SharedState;
  onAppAction: (action: AppAction) => void;
}

export function mountPhoneHud(_opts: PhoneHudOptions): void {
  // PR #7: GTA5-style phone UI with map + outlet-query apps
  console.log('[stub] mountPhoneHud called — PR #7 will implement');
}
```

- [ ] **Step 2: Create playerStats.ts stub**

```ts
import type { SharedState } from '../platform/sharedState';

export interface PlayerStatsOptions {
  getSharedState: () => SharedState;
}

export function mountPlayerStats(_opts: PlayerStatsOptions): void {
  // PR #8: dash pip + battery consumption system
  console.log('[stub] mountPlayerStats called — PR #8 will implement');
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: zero TS errors

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(layer1): mount stubs — phoneHud + playerStats (PR #7/#8 fill)"
```

---

### Task 6: minimap.ts

**Files:**
- Create: `src/ui/minimap.ts`

**Interfaces:**
- Consumes: `SharedState` from `platform/sharedState`, `CONFIG.world` from `game/config`
- Produces: `createMinimap(getSharedState)` returning `{ canvas, update, dispose }`

- [ ] **Step 1: Write minimap.ts**

```ts
import { CONFIG } from '../game/config';
import type { SharedState } from '../platform/sharedState';
import type * as THREE from 'three';

const MINI_W = 180;
const MINI_H = 136;
const SCALE = MINI_W / CONFIG.world.w; // ≈ 5.625 px/m
const FRAME_SKIP = 2; // 30fps at 60fps

export interface MinimapHandle {
  canvas: HTMLCanvasElement;
  update: (colliders: THREE.Box3[], state: SharedState) => void;
  dispose: () => void;
}

export function createMinimap(): MinimapHandle {
  const canvas = document.createElement('canvas');
  canvas.width = MINI_W;
  canvas.height = MINI_H;
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '12px',
    bottom: '12px',
    border: '1px solid rgba(0,0,0,0.3)',
    borderRadius: '4px',
    pointerEvents: 'none',
    zIndex: '5',
  });
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  let frame = 0;
  let lastColliders: THREE.Box3[] = [];

  function update(colliders: THREE.Box3[], state: SharedState): void {
    frame++;
    if (frame % FRAME_SKIP !== 0) return;

    // World → canvas: worldX ∈ [-16,16] → canvasX ∈ [0,180]
    const toX = (wx: number) => (wx + CONFIG.world.w / 2) * SCALE;
    const toY = (wz: number) => (wz + CONFIG.world.d / 2) * SCALE;

    // Background
    ctx.fillStyle = '#e8e4d8';
    ctx.fillRect(0, 0, MINI_W, MINI_H);

    // Colliders (only redraw if changed)
    if (colliders !== lastColliders) {
      lastColliders = colliders;
    }
    ctx.fillStyle = '#5a5a52';
    for (const b of lastColliders) {
      const x = toX(b.min.x);
      const y = toY(b.min.z);
      const w = (b.max.x - b.min.x) * SCALE;
      const h = (b.max.z - b.min.z) * SCALE;
      ctx.fillRect(x, y, Math.max(1, w), Math.max(1, h));
    }

    // Outlets (green)
    ctx.fillStyle = '#2dff7a';
    for (const o of state.outlets) {
      ctx.fillRect(toX(o.x) - 1.5, toY(o.z) - 1.5, 3, 3);
    }

    // NPCs (gray, if any)
    ctx.fillStyle = '#8a8a8a';
    for (const n of state.npcs) {
      ctx.beginPath();
      ctx.arc(toX(n.x), toY(n.z), 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Path (yellow, if any)
    if (state.path && state.path.length > 1) {
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toX(state.path[0].x), toY(state.path[0].z));
      for (let i = 1; i < state.path.length; i++) {
        ctx.lineTo(toX(state.path[i].x), toY(state.path[i].z));
      }
      ctx.stroke();
    }

    // Player (orange dot + heading line)
    const px = toX(state.player.x);
    const py = toY(state.player.z);
    ctx.fillStyle = '#e8913a';
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    // Heading line: yaw=0 → looking -z → up on minimap
    const dx = -Math.sin(state.player.yaw) * 8;
    const dy = -Math.cos(state.player.yaw) * 8;
    ctx.strokeStyle = '#e8913a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx, py + dy);
    ctx.stroke();
  }

  function dispose(): void {
    canvas.remove();
  }

  return { canvas, update, dispose };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: zero TS errors

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(layer1): minimap — 2D canvas top-down renderer, 30fps, realtime"
```

---

### Task 7: main.ts wiring + AGENTS.md rule 11

**Files:**
- Modify: `src/main.ts` (wire facade + mounts + minimap + debug)
- Modify: `AGENTS.md` (add rule 11)

**Interfaces:**
- Consumes: all prior tasks

- [ ] **Step 1: Wire main.ts**

Add imports and wire up facade + minimap + mount stubs. The final main.ts:

```ts
import * as THREE from 'three';
import { createLibraryScene, DEFAULT_DEBUG_PARAMS } from './scene/loadLibraryScene';
import { createThirdPersonController } from './player/thirdPersonController';
import { createSharedStateFacade } from './platform/sharedState';
import { createMinimap } from './ui/minimap';
import { mountPhoneHud } from './ui/phoneHud';
import { mountPlayerStats } from './game/playerStats';
import './style.css';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  CONFIG.camera.fov,
  window.innerWidth / window.innerHeight,
  CONFIG.camera.near,
  CONFIG.camera.far,
);

// --- Scene ---
const { scene, player, colliders, outlets, update, rebuildTableZone, setColliderHelpersVisible } =
  createLibraryScene(DEFAULT_DEBUG_PARAMS);

// --- 点击进入指针锁的提示遮罩 ---
const overlay = document.createElement('div');
overlay.textContent = '点击画面进入 · WASD 移动 · Shift 加速 · 鼠标转视角 · Esc 退出';
Object.assign(overlay.style, {
  position: 'fixed',
  inset: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(20, 16, 10, 0.55)',
  color: '#ffe9c4',
  font: '16px/1.6 system-ui, sans-serif',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  zIndex: '10',
});
document.body.appendChild(overlay);

// --- Controller ---
const controller = createThirdPersonController({
  camera,
  dom: renderer.domElement,
  player,
  colliders,
  bounds: { w: CONFIG.world.w, d: CONFIG.world.d },
  overlay,
});

// --- SharedState facade (Layer 1 stub; PR #8 fills battery/pips) ---
const { getSharedState } = createSharedStateFacade(player, controller, outlets);

// --- Mount stubs (PR #7/#8 replace implementations) ---
mountPhoneHud({
  getSharedState,
  onAppAction: (action) => console.log('[stub] app action:', action),
});
mountPlayerStats({ getSharedState });

// --- Minimap ---
const minimap = createMinimap();

// --- Debug: expose getSharedState to window for console eval ---
if (import.meta.env.DEV) {
  Object.assign(window, { __debug: { getSharedState } });
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Debug overlay (dev only) ---
if (import.meta.env.DEV) {
  import('./debug/overlay').then(({ attachDebugGui }) => {
    attachDebugGui({
      rebuildTableZone,
      setColliderHelpersVisible,
      defaultParams: DEFAULT_DEBUG_PARAMS,
    });
  });
}

// --- Game loop ---
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  controller.update(dt);
  update(dt);
  renderer.render(scene, camera);
  minimap.update(colliders, getSharedState());
}
animate();
```

Note: need to add `import { CONFIG } from './game/config';` at top.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: zero TS errors

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: 6 tests pass (2 gridModel + 4 pathfinding)

- [ ] **Step 4: Add AGENTS.md rule 11**

After rule 10, add:
```markdown
11. **并行独立 agent 工作流(地基后启用)**:
    - 主 agent 完成 Layer 1 (config + SharedState interface + mount points) 后才可并行
    - 用户在两个独立 opencode 会话里各自开 worktree:
      `git worktree add ../gamejam-2026-<branch> feat/<x>` 隔离工作目录
      (两 worktree 共享同一 .git,各自 checkout 各自分支,互不干扰)
    - 文件边界:
      - UI 独立 agent 只改 `src/ui/` + 替换 `src/ui/phoneHud.ts` 的 mountPhoneHud 实现
      - Game 独立 agent 只改 `src/game/` + `src/player/` + 替换 `src/game/playerStats.ts` 的 mountPlayerStats 实现
      - 两独立 agent 都不改 `src/main.ts` 的调用点(Layer 1 钉死)
    - 共享接口 = Layer 1 钉死的 TS interface,独立 agent 只 implements 不 invent
    - 两 PR 都开 → 主 agent(本会话)review → 用户 merge 先开的 → 后开的 rebase 到新 main
```

- [ ] **Step 5: Verify prod bundle excludes vitest**

Run: `npm run build && du -h dist/assets/*.js`
Expected: bundle size ≤ 620KB (vitest is devDep, auto-stripped)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(layer1): main.ts wiring + AGENTS rule 11 — foundation complete"
```

---

### Task 8: MCP visual verification

- [ ] **Step 1: Start dev server + navigate**

```
npm run dev (already running on 5173)
chrome-devtools navigate to http://localhost:5173
```

- [ ] **Step 2: Verify minimap visible**

Take snapshot, expect canvas element at left-bottom 180×136px.

- [ ] **Step 3: Verify minimap realtime**

Click to enter pointer lock, WASD move, take screenshot → orange dot must move.

- [ ] **Step 4: Verify console stubs**

`list_console_messages` → expect `[stub] mountPhoneHud called` + `[stub] mountPlayerStats called`.

- [ ] **Step 5: Verify window.__debug.getSharedState()**

`evaluate_script: () => window.__debug.getSharedState()` → expect object with player.x/z/yaw real values, outlets array non-empty, battery: 1.0, pips: 3.

- [ ] **Step 6: Navigate to about:blank (stop rendering, save power)**

- [ ] **Step 7: Push + create PR**

```bash
git push -u origin feat/layer1-foundation
gh pr create --title "feat(layer1): foundation — grid/pathfinding/config/minimap/SharedState" --body "..."
```
