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

function makeHarness(positions: Array<{ x: number; z: number }>, occupiable?: boolean[]) {
  const occupied = positions.map(() => false);
  const controller = createNpcController({
    getOutletCount: () => positions.length,
    getOutletPos: (i) => positions[i],
    isOutletOccupied: (i) => occupied[i],
    setOutletOccupied: (i, occ) => { occupied[i] = occ; },
    ...(occupiable ? { isOutletOccupiable: (i) => occupiable[i] } : {}),
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
    // 走 20s,每秒 2m → 本该到 (5,0),但被墙挡在 x=-0.88(wall minX - radius 0.38)
    for (let i = 0; i < 200; i++) controller.update(0.1);
    expect(e.x).toBeLessThanOrEqual(-0.88 + 1e-6);  // 停在墙左侧
    expect(e.x).toBeGreaterThanOrEqual(-0.88 - 1e-6);
    expect(e.z).toBeCloseTo(0, 6);  // z 方向不受影响
  });

  it('到达柱电位桩(桩在柱面)→ 切 occupying 时推出柱外', () => {
    // 柱 x∈[-0.5,0.5] z∈[-1,1];桩在柱 x+ 面 (0.5, 0)
    // 真实场景:NPC 从柱右侧远处走向柱面桩,最后到达时不能嵌柱
    const column = { minX: -0.5, minZ: -1, maxX: 0.5, maxZ: 1 };
    const controller = createNpcController({
      getOutletCount: () => 1,
      getOutletPos: () => ({ x: 0.5, z: 0 }),  // 桩在柱 x+ 面
      isOutletOccupied: () => false,
      setOutletOccupied: () => {},
      npcCount: 1,
      cfg,
      colliders: [column],
    });
    const e = controller.entities[0];
    e.x = 5; e.z = 0;  // 柱右侧远处
    controller.update(0.15);  // → moving,目标 0 号桩
    // 移动足够久(每帧 resolveCollision 推 NPC 出柱,NPC 会卡在柱右边缘 x=0.8)
    for (let i = 0; i < 500; i++) controller.update(0.1);
    // 到不了桩(被柱挡,简化版无绕路),但绝不能在柱内
    const insideColumn = e.x > -0.5 && e.x < 0.5 && e.z > -1 && e.z < 1;
    expect(insideColumn).toBe(false);
    expect(e.x).toBeGreaterThanOrEqual(0.88 - 1e-6);  // 柱右边缘外(radius 0.38)
  });

  it('不可占桩(壁插):最近桩不可占 → 跳过,选次近可占桩', () => {
    // 0 号(5m)= 壁插不可占,1 号(10m)= 可占
    const { controller } = makeHarness(
      [{ x: 5, z: 0 }, { x: 10, z: 0 }, { x: 15, z: 0 }],
      [false, true, true],
    );
    const e = controller.entities[0];
    controller.update(0.15);  // idle 完 → moving
    expect(e.state).toBe('moving');
    expect(e.targetOutletIndex).toBe(1);  // 跳过 0 号壁插
  });

  it('不可占桩(壁插):全部不可占 → 无目标,留在 idle', () => {
    const { controller } = makeHarness(
      [{ x: 5, z: 0 }, { x: 10, z: 0 }],
      [false, false],
    );
    const e = controller.entities[0];
    controller.update(0.15);  // idle 完 → 无目标可走
    expect(e.state).toBe('idle');
    expect(e.targetOutletIndex).toBe(-1);
  });

  it('兼容:未传 isOutletOccupiable(旧 harness/测试)→ 默认全部可占', () => {
    const { controller } = makeHarness([{ x: 5, z: 0 }, { x: 10, z: 0 }]);
    const e = controller.entities[0];
    controller.update(0.15);
    expect(e.targetOutletIndex).toBe(0);  // 最近可占
  });
});
