// PR #16 B:NPC AI 简化版 —— 纯 TS 状态机,零 DOM/Three 依赖,可单测。
// 状态机:idle(随机停 2-5s)→ moving(A* 寻路走向最近空桩)→ occupying(占 8-15s)→ idle。
// 目标被抢(occupied)→ 立刻改选下一个空桩。PR #17 B:接入 gridModel+pathfinding,A* 绕障;
// 无 grid(旧 harness)→ 退化为直线走 + resolveCollision。

import type { Cell, Grid } from './gridModel';
import { worldToCell, cellToWorld, isBlocked } from './gridModel';
import { findPath } from './pathfinding';

export type NpcState = 'idle' | 'moving' | 'occupying';

export interface NpcEntity {
  x: number;
  z: number;
  state: NpcState;
  targetOutletIndex: number;  // -1 = 无目标
  idleTimer: number;          // idle 阶段倒计时
  occupyTimer: number;        // occupying 阶段倒计时
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
  occupyMinSec: number;
  occupyMaxSec: number;
  arriveDist: number;
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
  /** PR #17 B:A* 寻路网格(缺省 = 直线走,兼容旧测试)。rebuild 后须由调用方更新。 */
  grid?: Grid;
}

export interface NpcController {
  entities: NpcEntity[];
  update: (dt: number) => void;
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

  /** NPC 碰撞半径:比玩家 0.32 略大 + 视觉 margin(坐姿猫身体半宽 0.26,0.38 保证不贴柱) */
  const NPC_RADIUS = 0.38;

  /** 移动后碰撞推出:检测 NPC 圆是否陷入某 AABB,沿嵌入最浅的轴推出到贴面(与 player resolveAxis 同规则)。 */
  function resolveCollision(e: NpcEntity): void {
    const cols = opts.colliders;
    if (!cols || cols.length === 0) return;
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

  /** 遍历所有 outlets,找 isOutletOccupied(i)===false 且可占(非壁插)的最近一个;-1 = 无可选。exclude:跳过某桩(不可达重选用)。 */
  function pickNearestFreeOutlet(fromX: number, fromZ: number, exclude = -1): number {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < opts.getOutletCount(); i++) {
      if (i === exclude) continue;
      if (opts.isOutletOccupied(i)) continue;
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
    let t = pickNearestFreeOutlet(e.x, e.z, exclude);
    let excluded = exclude;
    while (t >= 0) {
      e.targetOutletIndex = t;
      if (computePath(e)) return t;
      excluded = t;
      t = pickNearestFreeOutlet(e.x, e.z, excluded);
    }
    return -1;
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
      occupyTimer: 0,
      meshIndex: i,
      path: [],
      pathX: [],
      pathZ: [],
      pathIdx: 0,
    });
  }

  function update(dt: number): void {
    for (const e of entities) {
      if (e.state === 'idle') {
        e.idleTimer -= dt;
        if (e.idleTimer <= 0) {
          const t = pickReachableOutlet(e);
          if (t >= 0) {
            e.state = 'moving';
          } else {
            e.idleTimer = newIdleTimer();  // 全占/全不可达,再等一轮
          }
        }
      } else if (e.state === 'moving') {
        // 目标被别人抢了(自己占的只会发生在 arrive 同帧,已切 occupying)→ 改选下一个空桩
        if (opts.isOutletOccupied(e.targetOutletIndex)) {
          const t = pickReachableOutlet(e, e.targetOutletIndex);
          if (t >= 0) {
            continue;
          } else {
            e.targetOutletIndex = -1;
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
          // 到达判定:path 走完 且 距桩 ≤ arriveDist(桩可能在 blocked cell,nearestFreeCell 是桩旁)
          const dx = p.x - e.x;
          const dz = p.z - e.z;
          const distToOutlet = Math.hypot(dx, dz);
          if (e.pathIdx >= e.path.length && distToOutlet <= cfg.arriveDist) {
            resolveCollision(e);
            e.state = 'occupying';
            e.occupyTimer = randRange(rng, cfg.occupyMinSec, cfg.occupyMaxSec);
            opts.setOutletOccupied(e.targetOutletIndex, true);
          } else {
            // 未到:若 path 已走完但桩还远(最后一个 cell 中心不可达)→ 沿路径方向直线逼近
            if (e.pathIdx >= e.path.length) {
              const step = Math.min(remaining, distToOutlet);
              if (distToOutlet > 1e-9) {
                e.x += (dx / distToOutlet) * step;
                e.z += (dz / distToOutlet) * step;
              }
            }
            resolveCollision(e);
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
            e.occupyTimer = randRange(rng, cfg.occupyMinSec, cfg.occupyMaxSec);
            opts.setOutletOccupied(e.targetOutletIndex, true);
          } else {
            const step = Math.min(cfg.walkSpeed * dt, dist);  // 防超调过头
            e.x += (dx / dist) * step;
            e.z += (dz / dist) * step;
            resolveCollision(e);  // PR #16 fix:移动后防穿墙推出
          }
        }
      } else {
        e.occupyTimer -= dt;
        if (e.occupyTimer <= 0) {
          opts.setOutletOccupied(e.targetOutletIndex, false);
          e.targetOutletIndex = -1;
          e.state = 'idle';
          e.idleTimer = newIdleTimer();
        }
      }
    }
  }

  /** 重置全部实体为 idle(位置不动,由 main.ts 重新对齐 npcMeshes);seed 化计时器可复现。 */
  function reset(seed?: number): void {
    rng = mulberry32((seed ?? Date.now()) | 0);
    for (const e of entities) {
      e.state = 'idle';
      e.targetOutletIndex = -1;
      e.path = [];
      e.pathX = [];
      e.pathZ = [];
      e.pathIdx = 0;
      e.idleTimer = newIdleTimer();
      e.occupyTimer = 0;
    }
  }

  function resolveAll(): void {
    for (const e of entities) resolveCollision(e);
  }

  return { entities, update, reset, resolveAll };
}
