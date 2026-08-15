import { describe, expect, it } from 'vitest';
import layout from './layout.json';
// PR #28:5 个选关布局快照(Sam PR #24 验过的 5 个;Islands = layout.json)
import layout1 from './layouts/layout1.json';  // Open Lobby
import layout2 from './layouts/layout2.json';  // Compact Study
import layout3 from './layouts/layout3.json';  // Maze
import layout5 from './layouts/layout5.json';  // Arena

const LEGAL_KINDS = new Set([
  'studyTable', 'studyTable-charge', 'column', 'bookshelf',
  'readingTable', 'wallSocket', 'endPanelBox', 'wallBlock',
]);

type LayoutData = typeof layout;

// 5 个布局快照循环校验(Islands = layout.json 默认);结构与边界合法性 + 数量约束
const ALL_LAYOUTS: Array<{ name: string; data: LayoutData }> = [
  { name: 'Open Lobby (layout1)',    data: layout1 as LayoutData },
  { name: 'Compact Study (layout2)', data: layout2 as LayoutData },
  { name: 'Maze (layout3)',          data: layout3 as LayoutData },
  { name: 'Islands (default layout.json)', data: layout },
  { name: 'Arena (layout5)',        data: layout5 as LayoutData },
];

describe('5 个布局快照(标题屏可选,PR #28)', () => {
  for (const { name, data } of ALL_LAYOUTS) {
    const count = (k: string) => data.placements.filter(p => p.kind === k).length;

    describe(`${name}`, () => {
      it('room 宽高为偶数且在 8~128 范围', () => {
        expect(data.room.w % 2).toBe(0);
        expect(data.room.h % 2).toBe(0);
        expect(data.room.w).toBeGreaterThanOrEqual(8);
        expect(data.room.w).toBeLessThanOrEqual(128);
        expect(data.room.h).toBeGreaterThanOrEqual(8);
        expect(data.room.h).toBeLessThanOrEqual(128);
      });

      it('placements 非空,kind 全部合法,坐标为有限数字,rotY ∈ {0,90}', () => {
        expect(data.placements.length).toBeGreaterThan(0);
        for (const p of data.placements) {
          expect(LEGAL_KINDS.has(p.kind)).toBe(true);
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.z)).toBe(true);
          if (p.rotY !== undefined) expect([0, 90]).toContain(p.rotY);
        }
      });

      it('各 kind 数量合理(快照只做结构校验,不锁死每种必须存在)', () => {
        const tables = count('studyTable') + count('studyTable-charge');
        expect(tables).toBeGreaterThanOrEqual(1);
        expect(count('column')).toBeGreaterThanOrEqual(0);
        expect(count('bookshelf')).toBeGreaterThanOrEqual(0);
        expect(count('readingTable')).toBeGreaterThanOrEqual(0);
        expect(count('wallBlock')).toBeGreaterThanOrEqual(0);
      });

      it('★ 摸奖桌 0~2 个', () => {
        expect(count('studyTable-charge')).toBeGreaterThanOrEqual(0);
        expect(count('studyTable-charge')).toBeLessThanOrEqual(2);
      });

      it('outlets 随机参数合法:min<=max、范围合理、seed 为 null 或数字', () => {
        expect(data.outlets.columnCount[0]).toBeLessThanOrEqual(data.outlets.columnCount[1]);
        expect(data.outlets.wallCount[0]).toBeLessThanOrEqual(data.outlets.wallCount[1]);
        expect(data.outlets.columnCount[1]).toBeLessThanOrEqual(12);
        expect(data.outlets.seed === null || typeof data.outlets.seed === 'number').toBe(true);
      });

      it('placements 坐标都落在房间内', () => {
        const hw = data.room.w / 2, hh = data.room.h / 2;
        for (const p of data.placements) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(hw);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(hh);
        }
      });
    });
  }
});