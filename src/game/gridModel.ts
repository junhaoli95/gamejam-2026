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
