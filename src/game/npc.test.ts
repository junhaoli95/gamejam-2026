import { describe, it, expect } from 'vitest';
import { Box3, Vector3 } from 'three';
import { createNpcController, type NpcConfig } from './npc';
import { toGrid, cellToWorld, type Grid } from './gridModel';

const cfg: NpcConfig = {
  walkSpeed: 2,
  idleMinSec: 0.1,
  idleMaxSec: 0.1,
  arriveDist: 0.5,
  wanderChance: 0,       // 测试默认不 wander(确定性 → moving)
  wanderRadius: 4,
};

// 寻路测试:cellSize 1 时最后 cell 中心离桩 ≤0.707m,arriveDist 需覆盖
const pathCfg: NpcConfig = { ...cfg, arriveDist: 0.8 };

function makeHarness(positions: Array<{ x: number; z: number }>, occupiable?: boolean[], grid?: Grid) {
  const occupied = positions.map(() => false);
  const controller = createNpcController({
    getOutletCount: () => positions.length,
    getOutletPos: (i) => positions[i],
    isOutletOccupied: (i) => occupied[i],
    setOutletOccupied: (i, occ) => { occupied[i] = occ; },
    ...(occupiable ? { isOutletOccupiable: (i) => occupiable[i] } : {}),
    ...(grid ? { grid } : {}),
    npcCount: 1,
    cfg: grid ? pathCfg : cfg,
  });
  return { controller, occupied };
}

function makeMultiNpcHarness(positions: Array<{ x: number; z: number }>, npcCount: number) {
  const occupied = positions.map(() => false);
  const controller = createNpcController({
    getOutletCount: () => positions.length,
    getOutletPos: (i) => positions[i],
    isOutletOccupied: (i) => occupied[i],
    setOutletOccupied: (i, occ) => { occupied[i] = occ; },
    npcCount,
    cfg,
  });
  return { controller, occupied };
}

describe('NPC 简化版状态机 (PR #16)', () => {
  it('同一帧多个 NPC 不会预定同一个空桩', () => {
    const { controller, occupied } = makeMultiNpcHarness(
      [{ x: 10, z: 0 }, { x: 20, z: 0 }],
      2,
    );
    const [first, second] = controller.entities;

    // 两个 NPC 都从原点出发;没有 reservation 时会同时选中 0 号桩。
    controller.update(0.15);
    expect(first.state).toBe('moving');
    expect(second.state).toBe('moving');
    expect(first.targetOutletIndex).toBe(0);
    expect(second.targetOutletIndex).toBe(1);

    // 两个目标都应最终完成占用,且不会互相覆盖同一根桩。
    controller.update(10);
    controller.update(0.01);
    expect(first.state).toBe('occupying');
    expect(second.state).toBe('occupying');
    expect(occupied).toEqual([true, true]);
  });

  it('完整周期:idle → moving → occupying(占桩变红,永久占用 —— 不再释放)', () => {
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

    // 占桩后永久保持 —— 长时间过去仍 occupying,桩仍红
    controller.update(120);
    expect(e.state).toBe('occupying');
    expect(occupied[0]).toBe(true);
    expect(e.targetOutletIndex).toBe(0);
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

  it('桩在碰撞体边缘且 NPC 被推出时仍会完成占用', () => {
    // 真实场景中的墙/柱面桩:NPC 到达桩附近后会被 resolveCollision 推到碰撞体外,
    // 不能要求它继续走到被碰撞体挡住的最后一个 waypoint。
    const column = new Box3(new Vector3(-0.5, 0, -1), new Vector3(0.5, 3, 1));
    const occupied = [false];
    const grid = toGrid([column], 20, 20, 0.4, 0.38);
    const controller = createNpcController({
      getOutletCount: () => 1,
      getOutletPos: () => ({ x: 0.5, z: 0 }),
      isOutletOccupied: () => occupied[0],
      setOutletOccupied: (_i, occ) => { occupied[0] = occ; },
      npcCount: 1,
      cfg: pathCfg,
      grid,
      colliders: [{ minX: -0.5, minZ: -1, maxX: 0.5, maxZ: 1 }],
    });
    const e = controller.entities[0];
    e.x = 4; e.z = 0;
    controller.update(0.15);

    // 模拟真实卡死状态:NPC 已被推出到柱外,但当前 waypoint 仍在柱的另一侧。
    // 旧逻辑会每帧向 waypoint 走、再被推出,永远不会 pathIdx++。
    e.x = 0.88; e.z = 0;
    e.path = [{ x: 10, z: 10 }, { x: 9, z: 10 }, { x: 8, z: 10 }];
    e.pathX = [0.88, -0.5, -0.5];
    e.pathZ = [0, 0, 0];
    e.pathIdx = 1;
    for (let i = 0; i < 10 && e.state !== 'occupying'; i++) controller.update(0.1);

    expect(e.state).toBe('occupying');
    expect(occupied[0]).toBe(true);
    expect(e.x).toBeGreaterThanOrEqual(0.88 - 1e-6);
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

describe('NPC A* 寻路 (PR #17 B)', () => {
  // 世界 20×20,cellSize 1 → x,z ∈ [-10,10];短竖墙 x∈[-0.5,0.5] z∈[-1,1](占 cell x=9, z∈[9,10],两端可绕)
  const wall = new Box3(new Vector3(-0.5, 0, -1), new Vector3(0.5, 3, 1));
  const wallGrid = toGrid([wall], 20, 20, 1);

  it('可达:墙挡直线 → A* 绕障走到桩并占用(变红)', () => {
    const { controller, occupied } = makeHarness([{ x: 5, z: 0 }], undefined, wallGrid);
    const e = controller.entities[0];
    e.x = -5; e.z = 0;
    controller.update(0.15);  // idle 完 → moving,目标 0 号 (5,0)
    expect(e.state).toBe('moving');
    expect(e.targetOutletIndex).toBe(0);
    console.log('[DBG] path', JSON.stringify(e.path), 'idx', e.pathIdx);
    // 绕路约 12 cells ≈ 6s;给 20s
    for (let i = 0; i < 200; i++) {
      controller.update(0.1);
      if (i % 20 === 0 || i < 25) console.log(`[DBG] f${i}`, e.x.toFixed(2), e.z.toFixed(2), 'idx', e.pathIdx);
    }
    console.log('[DBG] final', e.state, e.x.toFixed(2), e.z.toFixed(2), 'idx', e.pathIdx, 'pathlen', e.path.length);
    expect(e.state).toBe('occupying');
    expect(occupied[0]).toBe(true);
    expect(e.x).toBeGreaterThan(4);   // 桩 (5,0) 附近
    expect(Math.abs(e.z)).toBeLessThan(1.5);
  });

  it('不可达:最近桩被墙围死 → 改选可达桩', () => {
    // 0 号桩 (0,0) 在 0.3m 厚墙围出的封闭盒内(不可达);1 号桩 (8,0) 在外
    const walls = [
      new Box3(new Vector3(-2.6, 0, -2.6), new Vector3(2.6, 3, -2.3)),
      new Box3(new Vector3(-2.6, 0, 2.3), new Vector3(2.6, 3, 2.6)),
      new Box3(new Vector3(-2.6, 0, -2.3), new Vector3(-2.3, 3, 2.3)),
      new Box3(new Vector3(2.3, 0, -2.3), new Vector3(2.6, 3, 2.3)),
    ];
    const closedGrid = toGrid(walls, 20, 20, 1);
    const { controller } = makeHarness([{ x: 0, z: 0 }, { x: 8, z: 0 }], undefined, closedGrid);
    const e = controller.entities[0];
    e.x = -8; e.z = 0;
    controller.update(0.15);
    expect(e.state).toBe('moving');
    expect(e.targetOutletIndex).toBe(1);  // 0 号最近但不可达 → 改选 1 号
    // 16m ÷ 2m/s = 8s 走到;occupy 0.2s。追踪是否到达过桩 1 并占用
    let sawOccupying = false;
    for (let i = 0; i < 200; i++) {
      controller.update(0.1);
      if (e.targetOutletIndex === 1 && e.state === 'occupying') sawOccupying = true;
    }
    expect(sawOccupying).toBe(true);
    expect(e.x).toBeGreaterThan(6);  // 桩 (8,0) 附近(走完整个周期后可能已 idle 但位置保留)
  });

  it('目标被抢 → 中途改道(重新寻路到新桩)', () => {
    const { controller, occupied } = makeHarness([{ x: 5, z: 0 }, { x: 5, z: -6 }], undefined, wallGrid);
    const e = controller.entities[0];
    e.x = -5; e.z = 0;
    controller.update(0.15);
    expect(e.targetOutletIndex).toBe(0);  // (5,0) 最近
    occupied[0] = true;                   // 玩家抢先
    controller.update(0.1);
    expect(e.targetOutletIndex).toBe(1);  // 改选 (5,-6)
    for (let i = 0; i < 300; i++) controller.update(0.1);
    expect(e.state).toBe('occupying');
    expect(e.targetOutletIndex).toBe(1);
  });

  it('完整周期(有 grid):idle→moving→occupying(红,永久 —— 不释放回 idle)', () => {
    const grid = toGrid([], 20, 20, 1);
    const { controller, occupied } = makeHarness([{ x: 4, z: 0 }], undefined, grid);
    const e = controller.entities[0];
    e.x = 0; e.z = 0;
    controller.update(0.15);  // → moving
    expect(e.state).toBe('moving');
    for (let i = 0; i < 100; i++) controller.update(0.1);  // 4m @2m/s = 2s
    expect(e.state).toBe('occupying');
    expect(occupied[0]).toBe(true);
    controller.update(60);  // 长时间过去 —— 永久占用,不再释放
    expect(e.state).toBe('occupying');
    expect(occupied[0]).toBe(true);
  });
});

describe('NPC wander + 视线门控 (2026-08-14)', () => {
  const wanderCfg: NpcConfig = { ...cfg, wanderChance: 1 };  // 必 wander

  function makeWanderHarness(occupiable?: boolean[], grid?: Grid) {
    const positions = [{ x: 10, z: 0 }, { x: 15, z: 0 }];
    const occupied = positions.map(() => false);
    const controller = createNpcController({
      getOutletCount: () => positions.length,
      getOutletPos: (i) => positions[i],
      isOutletOccupied: (i) => occupied[i],
      setOutletOccupied: (i, occ) => { occupied[i] = occ; },
      ...(occupiable ? { isOutletOccupiable: (i) => occupiable[i] } : {}),
      ...(grid ? { grid } : {}),
      npcCount: 1,
      cfg: grid ? { ...wanderCfg, arriveDist: 0.8 } : wanderCfg,
    });
    return { controller, occupied };
  }

  it('wander 目标在 radius 内,不占桩', () => {
    const grid = toGrid([], 20, 20, 1);
    const { controller, occupied } = makeWanderHarness(undefined, grid);
    const e = controller.entities[0];
    e.x = 0; e.z = 0;
    controller.update(0.15);  // idle 完 → wanderChance=1 → wander
    expect(e.state).toBe('wander');
    expect(e.targetOutletIndex).toBe(-1);  // wander 无桩目标
    expect(e.path.length).toBeGreaterThan(1);
    const end = e.path[e.path.length - 1];
    const endWorld = cellToWorld(end, grid);
    expect(Math.hypot(endWorld.x - 0, endWorld.z - 0)).toBeLessThanOrEqual(wanderCfg.wanderRadius + 0.5);
    expect(occupied[0]).toBe(false);
    expect(occupied[1]).toBe(false);
  });

  it('wander 完成 → 回 idle 并重置 idleTimer(真循环,重新掷骰)', () => {
    const grid = toGrid([], 20, 20, 1);
    const { controller } = makeWanderHarness(undefined, grid);
    const e = controller.entities[0];
    e.x = 0; e.z = 0;
    controller.update(0.15);  // → wander
    expect(e.state).toBe('wander');
    // 走满 20s(wanderRadius 4m ÷ 2m/s ≈ 2s)。wanderChance=1 时走完回 idle(重置 idleTimer)
    // 后立刻又掷骰 → 再次 wander,所以中途必然出现 idle 瞬间,但结束时可能在 wander 也可能 idle。
    // 断言:完整跑完后能观测到"wander → idle → wander"循环发生(证明真循环,不是一次性)
    let sawIdle = false;
    for (let i = 0; i < 200; i++) {
      controller.update(0.1);
      if (e.state === 'idle') sawIdle = true;
    }
    expect(sawIdle).toBe(true);  // wander 走完回 idle 至少发生一次(真循环)
    expect(e.targetOutletIndex).toBe(-1);  // wander 永不设桩目标
  });

  it('视线阻断时 NPC 完全不动', () => {
    const grid = toGrid([], 20, 20, 1);
    // 玩家 (-5,0),NPC (0,0);墙挡在中间 x∈[-2,2] z∈[-1,1](高墙)
    const wall = { minX: -2, minZ: -1, maxX: 2, maxZ: 1 };
    const { controller } = makeWanderHarness(undefined, grid);
    const e = controller.entities[0];
    e.x = 0; e.z = 0;
    const losInfo = { playerX: -5, playerZ: 0, losBoxes: [wall] };
    const beforeX = e.x, beforeZ = e.z, beforeTimer = e.idleTimer, beforeState = e.state;
    controller.update(60, losInfo);  // 60s 冻结 —— 什么都不该变
    expect(e.x).toBe(beforeX);
    expect(e.z).toBe(beforeZ);
    expect(e.idleTimer).toBe(beforeTimer);
    expect(e.state).toBe(beforeState);
  });

  it('有视线时 NPC 照常推进(门控开启但看得到)', () => {
    const grid = toGrid([], 20, 20, 1);
    const { controller } = makeWanderHarness(undefined, grid);
    const e = controller.entities[0];
    e.x = 0; e.z = 0;
    // 玩家同侧无遮挡
    const losInfo = { playerX: -5, playerZ: 0, losBoxes: [] };
    controller.update(0.15, losInfo);
    expect(e.state).toBe('wander');
  });

  it('losInfo===undefined 时不过滤(兼容旧 harness/测试)', () => {
    const grid = toGrid([], 20, 20, 1);
    const { controller } = makeWanderHarness(undefined, grid);
    const e = controller.entities[0];
    e.x = 0; e.z = 0;
    controller.update(0.15);  // 不传 losInfo
    expect(e.state).toBe('wander');  // 正常推进
  });
});

describe('NPC 抢桩门控(非自习桌绿桩 ≤1 时拒绝 idle→moving,2026-08-15)', () => {
  it('freeMeshGreenCount=1 + idleTimer<=0 → 保持 idle,不切 moving(不抢最后绿桩)', () => {
    const controller = createNpcController({
      getOutletCount: () => 1,
      getOutletPos: () => ({ x: 5, z: 0 }),
      isOutletOccupied: () => false,
      setOutletOccupied: () => {},
      npcCount: 1,
      cfg,
      freeMeshGreenCount: 1,
    });
    const e = controller.entities[0];
    controller.update(0.15);  // idle 0.1s 后到点,门控应拒绝
    expect(e.state).toBe('idle');
    expect(e.targetOutletIndex).toBe(-1);
  });

  it('freeMeshGreenCount=2 + idleTimer<=0 + 有空桩 → 正常切 moving(原行为)', () => {
    const controller = createNpcController({
      getOutletCount: () => 1,
      getOutletPos: () => ({ x: 5, z: 0 }),
      isOutletOccupied: () => false,
      setOutletOccupied: () => {},
      npcCount: 1,
      cfg,
      freeMeshGreenCount: 2,
    });
    const e = controller.entities[0];
    controller.update(0.15);
    expect(e.state).toBe('moving');
    expect(e.targetOutletIndex).toBe(0);
  });

  it('在途 reservation 也计入保底 → 两根绿桩只允许一个 NPC 出发', () => {
    const occupied = [false, false];
    const controller = createNpcController({
      getOutletCount: () => occupied.length,
      getOutletPos: (i) => ({ x: (i + 1) * 10, z: 0 }),
      isOutletOccupied: (i) => occupied[i],
      setOutletOccupied: (i, occ) => { occupied[i] = occ; },
      isOutletMesh: () => true,
      npcCount: 2,
      cfg,
      freeMeshGreenCount: 2,
    });
    const [first, second] = controller.entities;

    controller.update(0.15);
    expect(first.state).toBe('moving');
    expect(first.targetOutletIndex).toBe(0);
    expect(second.state).toBe('idle');
    expect(second.targetOutletIndex).toBe(-1);

    // 第一只占桩后,场上只剩 1 根绿桩;第二只仍不能出发。
    controller.update(10);
    controller.update(0.01);
    expect(first.state).toBe('occupying');
    expect(occupied).toEqual([true, false]);
    expect(second.state).toBe('idle');
  });

  it('缺省(未传 freeMeshGreenCount)→ 门控不触发,兼容旧 harness', () => {
    const { controller } = makeHarness([{ x: 5, z: 0 }]);
    const e = controller.entities[0];
    controller.update(0.15);
    expect(e.state).toBe('moving');  // 原行为
  });
});
