import { describe, expect, it } from 'vitest';
import { hasLineOfSight, type Aabb2D } from './los';

const WALL: Aabb2D = { minX: -1, minZ: -1, maxX: 1, maxZ: 1 };

describe('hasLineOfSight', () => {
  it('无障碍:空 box 列表 → 有视线', () => {
    expect(hasLineOfSight(0, 0, 10, 0, [])).toBe(true);
  });

  it('无障碍:线段平行于 box 且不在 box 范围(z 偏移) → 有视线', () => {
    // 从 (0,5) 到 (10,5),box z∈[-1,1] → 线段在 box 外,不被挡
    expect(hasLineOfSight(0, 5, 10, 5, [WALL])).toBe(true);
  });

  it('被挡:线段穿过 box 中心 → 无视线', () => {
    expect(hasLineOfSight(-3, 0, 3, 0, [WALL])).toBe(false);
  });

  it('被挡:斜线穿过 box 角落 → 无视线', () => {
    expect(hasLineOfSight(-3, -3, 3, 3, [WALL])).toBe(false);
  });

  it('擦边:线段刚好经过 box 边界 → 无视线(slab 判定) ', () => {
    // 从 (-2, 0) 到 (2, 0),box x∈[-1,1] z∈[-1,1] → 中心横穿
    expect(hasLineOfSight(-2, 0, 2, 0, [WALL])).toBe(false);
  });

  it('起点在 box 内 → 无视线', () => {
    expect(hasLineOfSight(0, 0, 3, 3, [WALL])).toBe(false);
  });

  it('垂直方向线段不穿 box → 有视线', () => {
    const box: Aabb2D = { minX: -1, minZ: -5, maxX: 1, maxZ: -4 }; // 离 x 轴很远
    expect(hasLineOfSight(0, 0, 0, -10, [box])).toBe(false); // 从 (0,0) 到 (0,-10) 会穿过 z∈[-5,-4] x∈[-1,1]
  });
});
