import { describe, it, expect } from 'vitest';
import { Box3, Vector3 } from 'three';
import { toGrid, isBlocked, worldToCell, cellToWorld } from './gridModel';

describe('gridModel', () => {
  it('single Box3 covers correct cells', () => {
    const box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const grid = toGrid([box], 10, 10, 1);

    expect(isBlocked(grid, { x: 4, z: 4 })).toBe(true);
    expect(isBlocked(grid, { x: 5, z: 4 })).toBe(true);
    expect(isBlocked(grid, { x: 4, z: 5 })).toBe(true);
    expect(isBlocked(grid, { x: 5, z: 5 })).toBe(true);
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
