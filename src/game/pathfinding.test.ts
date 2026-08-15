import { describe, it, expect } from 'vitest';
import type { Grid } from './gridModel';
import { isBlocked } from './gridModel';
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
  it('straight line in empty grid (path smoothing)', () => {
    const grid = emptyGrid(5, 5);
    const path = findPath(grid, { x: 0, z: 0 }, { x: 4, z: 0 });
    expect(path).not.toBeNull();
    // smoothPath:空 grid 直线只有 2 个端点 waypoints,不再每 cell 一个
    expect(path!.length).toBe(2);
    expect(path![0]).toEqual({ x: 0, z: 0 });
    expect(path![1]).toEqual({ x: 4, z: 0 });
  });

  it('L-shape obstacle detour (compressed, all cells free)', () => {
    const blocked: Array<[number, number]> = [[1,0],[1,1],[1,2],[1,3]];
    const grid = gridWithBlocked(5, 5, blocked);
    const path = findPath(grid, { x: 0, z: 0 }, { x: 4, z: 0 });
    expect(path).not.toBeNull();
    const maxZ = Math.max(...path!.map(c => c.z));
    expect(maxZ).toBeGreaterThanOrEqual(4);
    for (const c of path!) {
      expect(isBlocked(grid, c)).toBe(false);
    }
  });

  it('never returns mid-waypoints on a clear diagonal-free straight line', () => {
    // 8×1 空走廊,起点到终点无障碍 — 即使 A* 输出多 cell,压缩后只有 2 个端点
    const grid = emptyGrid(8, 3);
    const path = findPath(grid, { x: 0, z: 1 }, { x: 7, z: 1 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
    expect(path![0]).toEqual({ x: 0, z: 1 });
    expect(path![1]).toEqual({ x: 7, z: 1 });
  });

  it('unreachable returns null', () => {
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
