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
