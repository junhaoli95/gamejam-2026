import { describe, expect, it } from 'vitest';
import layout from './layout.json';

const LEGAL_KINDS = new Set([
  'studyTable', 'studyTable-charge', 'column', 'bookshelf',
  'readingTable', 'wallSocket', 'endPanelBox', 'wallBlock',
]);

const count = (k: string) => layout.placements.filter(p => p.kind === k).length;

describe('layout.json(编辑器保存的布局数据,scene 唯一真相源)', () => {
  it('room 宽高为偶数且在 8~128 范围', () => {
    expect(layout.room.w % 2).toBe(0);
    expect(layout.room.h % 2).toBe(0);
    expect(layout.room.w).toBeGreaterThanOrEqual(8);
    expect(layout.room.w).toBeLessThanOrEqual(128);
    expect(layout.room.h).toBeGreaterThanOrEqual(8);
    expect(layout.room.h).toBeLessThanOrEqual(128);
  });

  it('placements 非空,kind 全部合法,坐标为有限数字', () => {
    expect(layout.placements.length).toBeGreaterThan(0);
    for (const p of layout.placements) {
      expect(LEGAL_KINDS.has(p.kind)).toBe(true);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
      if (p.rotY !== undefined) expect([0, 90]).toContain(p.rotY);
    }
  });

  it('当前布局快照:20 桌 + 12 柱 + 6 书架 + 2 readingTable(数量随编辑器保存可变,此为现状)', () => {
    expect(count('studyTable')).toBe(20);
    expect(count('column')).toBe(12);
    expect(count('bookshelf')).toBe(6);
    expect(count('readingTable')).toBe(2);
  });

  it('★ 摸奖桌 0~2 个', () => {
    expect(count('studyTable-charge')).toBeGreaterThanOrEqual(0);
    expect(count('studyTable-charge')).toBeLessThanOrEqual(2);
  });

  it('outlets 随机参数合法:min<=max、范围合理、seed 为 null 或数字', () => {
    expect(layout.outlets.columnCount[0]).toBeLessThanOrEqual(layout.outlets.columnCount[1]);
    expect(layout.outlets.wallCount[0]).toBeLessThanOrEqual(layout.outlets.wallCount[1]);
    expect(layout.outlets.columnCount[1]).toBeLessThanOrEqual(12);
    expect(layout.outlets.seed === null || typeof layout.outlets.seed === 'number').toBe(true);
  });

  it('placements 坐标都落在房间内', () => {
    const hw = layout.room.w / 2, hh = layout.room.h / 2;
    for (const p of layout.placements) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(hw);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(hh);
    }
  });
});
