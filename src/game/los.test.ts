import { describe, expect, it } from 'vitest';
import { hasLineOfSight, toLosBoxes, type Aabb2D } from './los';

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

  it('桩贴柱面(柱电位):玩家在桩同侧 → 有视线', () => {
    // 柱 x∈[-0.5,0.5] z∈[-1,1];桩在柱 x=0.5 表面(柱电位嵌柱面)
    const column: Aabb2D = { minX: -0.5, minZ: -1, maxX: 0.5, maxZ: 1 };
    // 玩家在柱右侧(同侧,px > maxX),桩在柱右表面 → 看到桩面,有视线
    expect(hasLineOfSight(2, 0, 0.5, 0, [column])).toBe(true);
  });

  it('桩贴柱面:玩家绕到柱对面(背面)→ 被挡,无视线', () => {
    const column: Aabb2D = { minX: -0.5, minZ: -1, maxX: 0.5, maxZ: 1 };
    // 玩家在柱左侧(px < minX),桩在柱右表面 → 隔着柱,看不到桩 → 无视线
    expect(hasLineOfSight(-3, 0, 0.5, 0, [column])).toBe(false);
  });

  it('桩贴柱面:玩家与桩同侧但贴近柱侧(柱旁)→ 有视线', () => {
    const column: Aabb2D = { minX: -0.5, minZ: -1, maxX: 0.5, maxZ: 1 };
    // 桩在柱右表面,玩家从右侧靠近(px=1.0 > maxX)→ 有视线
    expect(hasLineOfSight(1.0, 0, 0.5, 0, [column])).toBe(true);
  });

  it('桩不在表面但被挡:目标在 collider 后方 → 无视线', () => {
    const column: Aabb2D = { minX: -0.5, minZ: -1, maxX: 0.5, maxZ: 1 };
    // 桩在柱后方远处,不在表面 → 被挡
    expect(hasLineOfSight(-3, 0, 3, 0, [column])).toBe(false);
  });
});

describe('toLosBoxes(矮家具过滤)', () => {
  const box = (y: number) => ({ min: { x: -0.9, y: 0, z: -0.6 }, max: { x: 0.9, y, z: 0.6 } });

  it('高墙(柱 3.4 / 书架 2.4)→ 保留', () => {
    expect(toLosBoxes([box(3.4), box(2.4)])).toEqual([
      { minX: -0.9, minZ: -0.6, maxX: 0.9, maxZ: 0.6 },
      { minX: -0.9, minZ: -0.6, maxX: 0.9, maxZ: 0.6 },
    ]);
  });

  it('矮家具(桌 0.75 / 椅 0.9 / 阅读桌 0.75)→ 过滤', () => {
    expect(toLosBoxes([box(0.75), box(0.9)])).toEqual([]);
  });
});

describe('桌面电位(桩=桌中心,矮桌不挡)', () => {
  // 桌 collider:studyTable 1.8×1.2×h0.75(矮);桩在桌中心;玩家站桌边
  const table = { min: { x: -0.9, y: 0, z: -0.6 }, max: { x: 0.9, y: 0.75, z: 0.6 } };

  it('玩家站桌边(桌外 0.5m),桩=桌中心 → 有视线(可充电)', () => {
    const boxes = toLosBoxes([table]);
    // 桌子被过滤 → 视线畅通
    expect(hasLineOfSight(0, -1.1, 0, 0, boxes)).toBe(true);
  });

  it('回归保护:若不过滤矮桌,玩家站桌边→桌中心必被自身 AABB 挡 → 这正是 bug 场景', () => {
    // 原始 collider(不过滤)在 los 里 → 无视线(bug 复现)
    expect(hasLineOfSight(0, -1.1, 0, 0, [WALL])).toBe(false);
  });

  it('高墙仍挡:玩家与桩之间有书架(高)隔开 → 无视线', () => {
    const shelf = { min: { x: -1.5, y: 0, z: -0.3 }, max: { x: 1.5, y: 2.4, z: 0.3 } };
    const boxes = toLosBoxes([table, shelf]);
    // 玩家站桌南边,桩在桌中心,书架横在玩家与桌之间 → 书架挡 → 无视线
    expect(hasLineOfSight(0, -4, 0, 0, boxes)).toBe(false);
  });

  it('椅子(矮 0.9)在玩家与桌桩之间 → 不挡', () => {
    const chair = { min: { x: -0.225, y: 0, z: -1.1 }, max: { x: 0.225, y: 0.9, z: -0.2 } };
    const boxes = toLosBoxes([table, chair]);
    expect(hasLineOfSight(0, -1.6, 0, 0, boxes)).toBe(true);
  });
});
