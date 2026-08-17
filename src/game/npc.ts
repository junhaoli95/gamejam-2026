// PR #16 B:NPC AI 简化版 —— 纯 TS 状态机,零 DOM/Three 依赖,可单测。
// 状态机:idle(随机停 2-5s)→ wander(50% 闲逛)或 moving(A* 寻路走向最近空桩)
//         → occupying(永久占用,不再释放)。wander 到点回 idle 重新掷骰(真循环)。
// 目标被抢(occupied)→ 立刻改选下一个空桩。PR #17 B:接入 gridModel+pathfinding,A* 绕障;
// 无 grid(旧 harness)→ 退化为直线走 + resolveCollision。
// 视线门控(losInfo):玩家看不到的 NPC 整体跳过 update —— 不计时、不动、不掷骰(冻结)。

import type { Cell, Grid } from './gridModel';
import { worldToCell, cellToWorld, isBlocked } from './gridModel';
import { findPath } from './pathfinding';
import { hasLineOfSight } from './los';
import type { Aabb2D } from './los';

export type NpcState = 'idle' | 'wander' | 'moving' | 'occupying';

export interface NpcEntity {
  x: number;
  z: number;
  state: NpcState;
  targetOutletIndex: number;  // -1 = 无目标
  idleTimer: number;          // idle 阶段倒计时
  meshIndex: number;          // 对应 scene npcMeshes 数组 index
  path: Cell[];               // PR #17 B:当前 A* 路径(cell 序列,path[0]=起点 cell)
  pathIdx: number;            // 当前正在走向 path[pathIdx]
  pathX: number[];            // 对应 world x(最后一点 = 桩真实 x)
  pathZ: number[];            // 对应 world z(最后一点 = 桩真实 z)
}

export interface NpcConfig {
  walkSpeed: number;
  idleMinSec: number;
  idleMaxSec: number;
  arriveDist: number;
  /** idle 结束时掷骰走 wander 的概率(0~1) */
  wanderChance: number;
  /** wander 目标点距离上限(m) */
  wanderRadius: number;
}

/** 视线门控输入:玩家位置 + 遮挡盒(losBoxes 已过滤矮家具)。传 undefined = 不过滤(测试/旧 harness 兼容)。 */
export interface NpcLosInfo {
  playerX: number;
  playerZ: number;
  losBoxes: Aabb2D[];
}

export interface NpcControllerOptions {
  getOutletCount: () => number;
  getOutletPos: (i: number) => { x: number; z: number };
  isOutletOccupied: (i: number) => boolean;
  setOutletOccupied: (i: number, occ: boolean) => void;
  npcCount: number;
  cfg: NpcConfig;
  /** 碰撞盒列表(轻量 AABB,与 player colliders 同源;npc 移动后推出防穿墙) */
  colliders?: Array<{ minX: number; minZ: number; maxX: number; maxZ: number }>;
  /** PR #17 A:桩是否可被 NPC 占用(壁插常亮不可占;缺省 = 全部可占,兼容旧测试) */
  isOutletOccupiable?: (i: number) => boolean;
  /** 判断桩是否属于非自习桌 mesh 桩;用于保留最后 1 根绿桩时扣除 NPC 预定。 */
  isOutletMesh?: (i: number) => boolean;
  /** PR #17 B:A* 寻路网格(缺省 = 直线走,兼容旧测试)。rebuild 后须由调用方更新。 */
  grid?: Grid;
  /** PR #27 门控(2026-08-15):场上非自习桌绿桩数。≤1 时 NPC idle 不再抢桩(给玩家留最后 1 充点)。
   *  缺省 = Infinity → 门控不触发(旧测试/无布局 harness 兼容)。main.ts 每帧更新该字段。 */
  freeMeshGreenCount?: number;
  /** 场地边界(房间宽深),NPC 移动后 clamp 防穿墙(玩家靠 controller bounds,NPC 需另加)。
   *  缺省 = 不 clamp(旧测试兼容)。main.ts 传 { w: CONFIG.world.w, d: CONFIG.world.d }。 */
  bounds?: { w: number; d: number };
}

export interface NpcController {
  entities: NpcEntity[];
  update: (dt: number, losInfo?: NpcLosInfo) => void;
  reset: (seed?: number) => void;
  /** PR #16 fix:对全部实体跑一次碰撞推出(初始化 sync 后调用,清初始嵌柱) */
  resolveAll: () => void;
}

/** 确定性 PRNG(mulberry32,与 scene 同款)—— 同 (seed, 调用序) 永远产同一序列,可单测。 */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNpcController(opts: NpcControllerOptions): NpcController {
  const cfg = opts.cfg;
  let rng = mulberry32(1);

  /**
   * 目标预定表:occupied 只表示已经坐下,不表示正在赶来的 NPC。
   * NPC 选桩与真正到达之间跨越多帧,必须单独预定,否则同一帧多个 idle
   * 实体会同时选中同一根绿桩。
   */
  const reservedOutletBy = new Map<number, number>(); // outlet index -> entity meshIndex

  /** NPC 碰撞半径:比玩家 0.32 略大 + 视觉 margin(坐姿猫身体半宽 0.26,0.38 保证不贴柱) */
  const NPC_RADIUS = 0.38;

  /** 移动后碰撞推出:检测 NPC 圆是否陷入某 AABB,沿嵌入最浅的轴推出到贴面(与 player resolveAxis 同规则)。 */
  function resolveCollision(e: NpcEntity): void {
    const cols = opts.colliders;
    if (cols) {
      for (const b of cols) {
        const insideX = e.x > b.minX - NPC_RADIUS && e.x < b.maxX + NPC_RADIUS;
        const insideZ = e.z > b.minZ - NPC_RADIUS && e.z < b.maxZ + NPC_RADIUS;
        if (!insideX || !insideZ) continue;
        // 算两个轴各自的嵌入深度,推嵌入浅的轴(最小推出,避免误推)
        const overlapX = Math.min(e.x - (b.minX - NPC_RADIUS), (b.maxX + NPC_RADIUS) - e.x);
        const overlapZ = Math.min(e.z - (b.minZ - NPC_RADIUS), (b.maxZ + NPC_RADIUS) - e.z);
        if (overlapX <= overlapZ) {
          e.x = e.x < (b.minX + b.maxX) / 2 ? b.minX - NPC_RADIUS : b.maxX + NPC_RADIUS;
        } else {
          e.z = e.z < (b.minZ + b.maxZ) / 2 ? b.minZ - NPC_RADIUS : b.maxZ + NPC_RADIUS;
        }
      }
    }
    // 场地边界 clamp(墙不在 colliders 里,玩家靠 controller bounds,NPC 需另加)
    if (opts.bounds) {
      const hw = opts.bounds.w / 2 - NPC_RADIUS;
      const hd = opts.bounds.d / 2 - NPC_RADIUS;
      e.x = Math.min(hw, Math.max(-hw, e.x));
      e.z = Math.min(hd, Math.max(-hd, e.z));
    }
  }

  /** 遍历所有 outlets,找未占用、未被其他 NPC 预定且可占(非壁插)的最近一个;-1 = 无可选。
   * exclude:跳过某桩(不可达重选用); reserver:允许当前实体继续看到自己的预定。
   *  保底 N+1:玩家有桩可充由 main.ts 启动时校验 NPC 数 + 初始预占 ≤ 总桩 - 1 保证 ——
   *  不在此函数里检查 freeCount(那样会让单元测试只用 1~3 桩时无法模拟普通占用流程)。
   */
  function pickNearestFreeOutlet(fromX: number, fromZ: number, exclude = -1, reserver = -1): number {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < opts.getOutletCount(); i++) {
      if (i === exclude) continue;
      if (opts.isOutletOccupied(i)) continue;
      const reservedBy = reservedOutletBy.get(i);
      if (reservedBy !== undefined && reservedBy !== reserver) continue;
      // PR #17 A:壁插(occupiable=false)常亮可充,不让 NPC 占
      if (opts.isOutletOccupiable && !opts.isOutletOccupiable(i)) continue;
      const p = opts.getOutletPos(i);
      const d = Math.hypot(p.x - fromX, p.z - fromZ);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /** 当前仍可用的非自习桌绿桩数;有分类回调时直接读实时 occupied,避免同帧滞后。 */
  function countFreeMeshOutlets(): number {
    if (!opts.isOutletMesh) return opts.freeMeshGreenCount ?? Infinity;
    let count = 0;
    for (let i = 0; i < opts.getOutletCount(); i++) {
      if (opts.isOutletMesh(i) && !opts.isOutletOccupied(i)) count++;
    }
    return count;
  }

  /** 预定表中属于 mesh 的数量;桌面桩 reservation 不应消耗“最后 1 根 mesh 绿桩”保底。 */
  function countReservedMeshOutlets(): number {
    let count = 0;
    for (const outletIndex of reservedOutletBy.keys()) {
      if (!opts.isOutletMesh || opts.isOutletMesh(outletIndex)) count++;
    }
    return count;
  }

  /** 预定新桩后仍必须至少留 1 根 mesh 绿桩给玩家。 */
  function canReserveOutlet(): boolean {
    return countFreeMeshOutlets() - countReservedMeshOutlets() > 1;
  }

  /** 清除实体当前目标及其预定,用于目标被抢/重置/重新选桩。 */
  function releaseOutletReservation(e: NpcEntity): void {
    if (e.targetOutletIndex >= 0 && reservedOutletBy.get(e.targetOutletIndex) === e.meshIndex) {
      reservedOutletBy.delete(e.targetOutletIndex);
    }
    e.targetOutletIndex = -1;
    e.path = [];
    e.pathX = [];
    e.pathZ = [];
    e.pathIdx = 0;
  }

  /** 桩/起点可能落在 blocked cell(柱面桩贴柱、桌中心桩)→ 找最近 free cell 作寻路端点。 */
  function nearestFreeCell(grid: Grid, wx: number, wz: number): Cell {
    const start = worldToCell(wx, wz, grid);
    if (!isBlocked(grid, start)) return start;
    for (let r = 1; r <= 8; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const c = { x: start.x + dx, z: start.z + dz };
          if (!isBlocked(grid, c)) return c;
        }
      }
    }
    return start;
  }

  /** 用 grid 算到 e.targetOutletIndex 的路径。无 grid → 直线模式,返回 true。false = 该桩不可达。 */
  function computePath(e: NpcEntity): boolean {
    const grid = opts.grid;
    if (!grid) return true;
    const p = opts.getOutletPos(e.targetOutletIndex);
    const path = findPath(
      grid,
      nearestFreeCell(grid, e.x, e.z),
      nearestFreeCell(grid, p.x, p.z),
    );
    if (!path) return false;
    e.path = path;
    e.pathIdx = 1;  // path[0] = 起点 cell,直接跳过
    e.pathX = e.path.map(c => cellToWorld(c, grid).x);  // 缓存 world 坐标(cell 中心)
    e.pathZ = e.path.map(c => cellToWorld(c, grid).z);
    return true;
  }

  /** 选一个可达空桩作为目标;全不可达/全占 → -1。 */
  function pickReachableOutlet(e: NpcEntity, exclude = -1): number {
    // 重新选桩前先释放旧目标,避免旧 reservation 泄漏。
    releaseOutletReservation(e);
    if (!canReserveOutlet()) return -1;
    let t = pickNearestFreeOutlet(e.x, e.z, exclude, e.meshIndex);
    let excluded = exclude;
    while (t >= 0) {
      e.targetOutletIndex = t;
      if (computePath(e)) {
        reservedOutletBy.set(t, e.meshIndex);
        return t;
      }
      excluded = t;
      t = pickNearestFreeOutlet(e.x, e.z, excluded, e.meshIndex);
    }
    releaseOutletReservation(e);
    return -1;
  }

  /** wander:在 NPC 附近 wanderRadius 球内随机找一个 free cell 作目标;找不到 → false(回 idle)。 */
  function pickWanderTarget(e: NpcEntity): boolean {
    const grid = opts.grid;
    if (!grid) return false;  // 无 grid 直接回 idle(不随机走直线,避免飘)
    const start = nearestFreeCell(grid, e.x, e.z);
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = rng() * Math.PI * 2;
      const r = rng() * cfg.wanderRadius;
      const cx = e.x + Math.cos(ang) * r;
      const cz = e.z + Math.sin(ang) * r;
      const goal = nearestFreeCell(grid, cx, cz);
      if (goal.x === start.x && goal.z === start.z) continue;  // 目标=起点,重抽
      const path = findPath(grid, start, goal);
      if (path) {
        e.targetOutletIndex = -1;  // wander 无桩目标
        e.path = path;
        e.pathIdx = 1;
        e.pathX = e.path.map(c => cellToWorld(c, grid).x);
        e.pathZ = e.path.map(c => cellToWorld(c, grid).z);
        return true;
      }
    }
    return false;  // 8 次都没找到 → 回 idle
  }

  function randRange(rng: () => number, min: number, max: number): number {
    return min + rng() * (max - min);
  }

  function newIdleTimer(): number {
    return randRange(rng, cfg.idleMinSec, cfg.idleMaxSec);
  }

  const entities: NpcEntity[] = [];
  for (let i = 0; i < opts.npcCount; i++) {
    entities.push({
      x: 0,
      z: 0,
      state: 'idle',
      targetOutletIndex: -1,
      idleTimer: newIdleTimer(),
      meshIndex: i,
      path: [],
      pathX: [],
      pathZ: [],
      pathIdx: 0,
    });
  }

  function update(dt: number, losInfo?: NpcLosInfo): void {
    for (const e of entities) {
      // 视线门控:玩家看不到的 NPC 整体冻结(不计时、不动、不掷骰)。
      // losInfo === undefined(旧 harness/测试)→ 不过滤。
      if (losInfo && !hasLineOfSight(losInfo.playerX, losInfo.playerZ, e.x, e.z, losInfo.losBoxes)) {
        continue;
      }
      if (e.state === 'idle') {
        e.idleTimer -= dt;
        if (e.idleTimer <= 0) {
          // 掷骰:可能去闲逛(wander),也可能直接去抢桩(moving)
          const goWander = rng() < cfg.wanderChance && pickWanderTarget(e);
          if (goWander) {
            e.state = 'wander';
          } else {
            // ★ 抢桩门控:pickReachableOutlet 同时检查实时绿桩和在途 reservation,
            // 保证首次抢桩/中途改抢都不会吃掉最后 1 根充点。
            const t = pickReachableOutlet(e);
            if (t >= 0) {
              e.state = 'moving';
            } else {
              e.idleTimer = newIdleTimer();  // 保底容量不足/全占/全不可达,再等一轮
            }
          }
        }
      } else if (e.state === 'wander') {
        // 闲逛:逐 waypoint 走到目标 free cell,走完回 idle(真循环,重新掷骰)
        let remaining = cfg.walkSpeed * dt;
        while (remaining > 1e-9 && e.pathIdx < e.path.length) {
          const cwX = e.pathX[e.pathIdx];
          const cwZ = e.pathZ[e.pathIdx];
          const dx = cwX - e.x;
          const dz = cwZ - e.z;
          const dist = Math.hypot(dx, dz);
          if (dist <= remaining) {
            e.x = cwX;
            e.z = cwZ;
            remaining -= dist;
            e.pathIdx++;
          } else {
            e.x += (dx / dist) * remaining;
            e.z += (dz / dist) * remaining;
            remaining = 0;
          }
        }
        if (e.pathIdx >= e.path.length) {
          resolveCollision(e);
          e.state = 'idle';
          e.idleTimer = newIdleTimer();  // 重新掷骰 → 可能再 wander 或 moving
        } else {
          resolveCollision(e);
        }
      } else if (e.state === 'moving') {
        // 目标被别人抢了(自己占的只会发生在 arrive 同帧,已切 occupying)→ 改选下一个空桩
        if (opts.isOutletOccupied(e.targetOutletIndex)) {
          const t = pickReachableOutlet(e, e.targetOutletIndex);
          if (t >= 0) {
            continue;
          } else {
            e.state = 'idle';
            e.idleTimer = newIdleTimer();
          }
          continue;
        }
        const p = opts.getOutletPos(e.targetOutletIndex);
        if (opts.grid && e.path.length > 1) {
          // A* 路径模式:逐 waypoint 走(cell 中心),走完最后 cell = 到达桩附近
          let remaining = cfg.walkSpeed * dt;
          while (remaining > 1e-9 && e.pathIdx < e.path.length) {
            const cwX = e.pathX[e.pathIdx];
            const cwZ = e.pathZ[e.pathIdx];
            const dx = cwX - e.x;
            const dz = cwZ - e.z;
            const dist = Math.hypot(dx, dz);
            if (dist <= remaining) {
              e.x = cwX;
              e.z = cwZ;
              remaining -= dist;
              e.pathIdx++;
            } else {
              e.x += (dx / dist) * remaining;
              e.z += (dz / dist) * remaining;
              remaining = 0;
            }
          }
          // 到达判定:路径终点或碰撞推出后已进入桩的有效半径都算到达。
          // 桩贴墙/柱时,最后 waypoint 可能在碰撞体另一侧;若只等 pathIdx 走完,
          // NPC 会每帧向 waypoint 走、再被 resolveCollision 推回,永远停在 moving。
          const reachedPathEnd = e.pathIdx >= e.path.length;
          resolveCollision(e);
          const distToOutlet = Math.hypot(p.x - e.x, p.z - e.z);
          if (reachedPathEnd || distToOutlet <= cfg.arriveDist) {
            e.state = 'occupying';
            reservedOutletBy.delete(e.targetOutletIndex);
            opts.setOutletOccupied(e.targetOutletIndex, true);
          } else {
            // 未到:继续追踪下一个 waypoint。
          }
        } else {
          // 直线模式(无 grid / path 未算):原逻辑
          const dx = p.x - e.x;
          const dz = p.z - e.z;
          const dist = Math.hypot(dx, dz);
          if (dist <= cfg.arriveDist) {
            // 到达:切 occupying。桩在柱面时 NPC 可能走进柱 —— resolveCollision 推出;
            // 若推出后仍在柱内(多柱重叠/极端),沿来路反向退 0.5m 兜底。
            resolveCollision(e);
            e.state = 'occupying';
            reservedOutletBy.delete(e.targetOutletIndex);
            opts.setOutletOccupied(e.targetOutletIndex, true);
          } else {
            const step = Math.min(cfg.walkSpeed * dt, dist);  // 防超调过头
            e.x += (dx / dist) * step;
            e.z += (dz / dist) * step;
            resolveCollision(e);  // PR #16 fix:移动后防穿墙推出
          }
        }
      } else {
        // 占用即永久(NPC 占桩后不再释放,桩单向消耗)。
        // occupyTimer / idle 退出逻辑已移除 —— 一旦 occupying,本局此 NPC 不再变 state。
      }
    }
  }

  /** 重置全部实体为 idle(位置不动,由 main.ts 重新对齐 npcMeshes);seed 化计时器可复现。 */
  function reset(seed?: number): void {
    rng = mulberry32((seed ?? Date.now()) | 0);
    reservedOutletBy.clear();
    for (const e of entities) {
      e.state = 'idle';
      releaseOutletReservation(e);
      e.idleTimer = newIdleTimer();
    }
  }

  function resolveAll(): void {
    for (const e of entities) resolveCollision(e);
  }

  return { entities, update, reset, resolveAll };
}
