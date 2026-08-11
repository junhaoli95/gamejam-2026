import { describe, it, expect } from 'vitest';
import { createNpcController, type NpcConfig } from './npc';

const cfg: NpcConfig = {
  walkSpeed: 2,
  idleMinSec: 0.1,
  idleMaxSec: 0.1,
  occupyMinSec: 0.2,
  occupyMaxSec: 0.2,
  arriveDist: 0.5,
};

function makeHarness(positions: Array<{ x: number; z: number }>) {
  const occupied = positions.map(() => false);
  const controller = createNpcController({
    getOutletCount: () => positions.length,
    getOutletPos: (i) => positions[i],
    isOutletOccupied: (i) => occupied[i],
    setOutletOccupied: (i, occ) => { occupied[i] = occ; },
    npcCount: 1,
    cfg,
  });
  return { controller, occupied };
}

describe('NPC 简化版状态机 (PR #16)', () => {
  it('完整周期:idle → moving → occupying(占桩变红)→ 离开(回绿)回 idle', () => {
    const { controller, occupied } = makeHarness([{ x: 20, z: 0 }, { x: 30, z: 0 }]);
    const e = controller.entities[0];

    // idle 0.1s 后自动进 moving,目标 = 最近的空桩(0 号,20m 外)
    controller.update(0.15);
    expect(e.state).toBe('moving');
    expect(e.targetOutletIndex).toBe(0);

    // 走 10s × 2m/s = 20m → 到桩(到达判定在下一帧),进 occupying 且桩变红
    controller.update(10);
    expect(e.x).toBeCloseTo(20, 6);
    expect(e.state).toBe('moving');  // 已到桩,待下一帧 arrival 判定
    controller.update(0.01);
    expect(e.state).toBe('occupying');
    expect(occupied[0]).toBe(true);

    // 占 0.2s 后离开,桩回绿,回 idle 等下一轮
    controller.update(0.25);
    expect(e.state).toBe('idle');
    expect(occupied[0]).toBe(false);
    expect(e.targetOutletIndex).toBe(-1);
  });

  it('目标被玩家/其他 NPC 抢了 → 立刻改选下一个空桩继续走', () => {
    const { controller, occupied } = makeHarness([{ x: 10, z: 0 }, { x: 20, z: 0 }]);
    const e = controller.entities[0];

    controller.update(0.15);  // idle 完,目标 = 0 号(10m 外)
    expect(e.targetOutletIndex).toBe(0);

    // 玩家抢先占 0 号桩
    occupied[0] = true;
    controller.update(0.1);
    expect(e.state).toBe('moving');
    expect(e.targetOutletIndex).toBe(1);  // 改选 1 号
  });

  it('reset(seed) 确定性:同 seed 计时器一致,实体全回 idle', () => {
    const { controller } = makeHarness([{ x: 10, z: 0 }, { x: 20, z: 0 }]);
    const e = controller.entities[0];

    controller.update(0.15);   // 进 moving
    controller.update(10);     // 走到 0 号桩 occupying
    controller.reset(42);
    expect(e.state).toBe('idle');
    expect(e.targetOutletIndex).toBe(-1);
    const t1 = e.idleTimer;
    expect(t1).toBeGreaterThanOrEqual(cfg.idleMinSec);
    expect(t1).toBeLessThanOrEqual(cfg.idleMaxSec);

    // 同 seed 再 reset → 计时器完全一致(确定性)
    controller.reset(42);
    expect(e.idleTimer).toBe(t1);
  });

  it('防穿墙:移动穿过 collider → 被推出到 AABB 外', () => {
    // 墙:竖在 x∈[-0.5,0.5] z∈[-10,10],NPC 从 (-5,0) 走向 (5,0) 会被挡
    const wall = { minX: -0.5, minZ: -10, maxX: 0.5, maxZ: 10 };
    const controller = createNpcController({
      getOutletCount: () => 1,
      getOutletPos: () => ({ x: 5, z: 0 }),
      isOutletOccupied: () => false,
      setOutletOccupied: () => {},
      npcCount: 1,
      cfg,
      colliders: [wall],
    });
    const e = controller.entities[0];
    e.x = -5; e.z = 0;
    controller.update(0.15);  // idle 完 → moving
    // 走 20s,每秒 2m → 本该到 (5,0),但被墙挡在 x=-0.8(wall minX - radius 0.3)
    for (let i = 0; i < 200; i++) controller.update(0.1);
    expect(e.x).toBeLessThanOrEqual(-0.8 + 1e-6);  // 停在墙左侧
    expect(e.x).toBeGreaterThanOrEqual(-0.8 - 1e-6);
    expect(e.z).toBeCloseTo(0, 6);  // z 方向不受影响
  });
});
