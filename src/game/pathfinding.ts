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
      return smoothPath(grid, path.reverse());
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

/**
 * 折点压缩(string pulling):贪心跳点 —— 从 path[i] 出发,沿原 path 向后找最远的 k,
 * 使 path[i]→path[k] 这条直线所穿过的所有 grid cell 均为 free,则抛弃 i+1..k-1。
 * 用 Bresenham 算直线覆盖的 cell,逐个 `isBlocked` 判定。
 * 结果只保留必要的"拐点"序列,NPC 沿长直线段匀速直行,消除 cell-中心 zigzag。
 * 保守:用膨胀后 grid 判定,只会少压缩、不会导出穿墙 path。
 */
function smoothPath(grid: Grid, path: Cell[]): Cell[] {
  if (path.length <= 2) return path;
  const out: Cell[] = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let k = path.length - 1;
    while (k > i + 1) {
      if (lineClear(grid, path[i], path[k])) break;
      k--;
    }
    out.push(path[k]);
    i = k;
  }
  return out;
}

/** Bresenham 整数直线:覆盖路径上所有 cell,全 free 返回 true。 */
function lineClear(grid: Grid, a: Cell, b: Cell): boolean {
  let x0 = a.x, z0 = a.z;
  const x1 = b.x, z1 = b.z;
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  while (true) {
    if (isBlocked(grid, { x: x0, z: z0 })) return false;
    if (x0 === x1 && z0 === z1) return true;
    const e2 = 2 * err;
    if (e2 > -dz) { err -= dz; x0 += sx; }
    if (e2 < dx) { err += dx; z0 += sz; }
  }
}
