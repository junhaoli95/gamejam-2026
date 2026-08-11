// PR #16 B:NPC AI 简化版 —— 纯 TS 状态机,零 DOM/Three 依赖,可单测。
// 状态机:idle(随机停 2-5s)→ moving(直线走向最近空桩)→ occupying(占 8-15s)→ idle。
// 目标被抢(occupied)→ 立刻改选下一个空桩。无 A*,只跟距离直线走(完整版留 PR #17)。

export type NpcState = 'idle' | 'moving' | 'occupying';

export interface NpcEntity {
  x: number;
  z: number;
  state: NpcState;
  targetOutletIndex: number;  // -1 = 无目标
  idleTimer: number;          // idle 阶段倒计时
  occupyTimer: number;        // occupying 阶段倒计时
  meshIndex: number;          // 对应 scene npcMeshes 数组 index
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

  /** NPC 半径(轻量常量,与 player radius 0.32 同量级,避免 NPC 太贴墙) */
  const NPC_RADIUS = 0.3;

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

  /** 遍历所有 outlets,找 isOutletOccupied(i)===false 的最近一个;-1 = 全占。 */
  function pickNearestFreeOutlet(fromX: number, fromZ: number): number {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < opts.getOutletCount(); i++) {
      if (opts.isOutletOccupied(i)) continue;
      const p = opts.getOutletPos(i);
      const d = Math.hypot(p.x - fromX, p.z - fromZ);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
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
    });
  }

  function update(dt: number): void {
    for (const e of entities) {
      if (e.state === 'idle') {
        e.idleTimer -= dt;
        if (e.idleTimer <= 0) {
          const t = pickNearestFreeOutlet(e.x, e.z);
          if (t >= 0) {
            e.targetOutletIndex = t;
            e.state = 'moving';
          } else {
            e.idleTimer = newIdleTimer();  // 全占,再等一轮
          }
        }
      } else if (e.state === 'moving') {
        // 目标被别人抢了(自己占的只会发生在 arrive 同帧,已切 occupying)→ 改选下一个空桩
        if (opts.isOutletOccupied(e.targetOutletIndex)) {
          const t = pickNearestFreeOutlet(e.x, e.z);
          if (t >= 0) {
            e.targetOutletIndex = t;
          } else {
            e.targetOutletIndex = -1;
            e.state = 'idle';
            e.idleTimer = newIdleTimer();
          }
          continue;
        }
        const p = opts.getOutletPos(e.targetOutletIndex);
        const dx = p.x - e.x;
        const dz = p.z - e.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= cfg.arriveDist) {
          e.state = 'occupying';
          e.occupyTimer = randRange(rng, cfg.occupyMinSec, cfg.occupyMaxSec);
          opts.setOutletOccupied(e.targetOutletIndex, true);
        } else {
          const step = Math.min(cfg.walkSpeed * dt, dist);  // 防超调过头
          e.x += (dx / dist) * step;
          e.z += (dz / dist) * step;
          resolveCollision(e);  // PR #16 fix:移动后防穿墙推出
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
      e.idleTimer = newIdleTimer();
      e.occupyTimer = 0;
    }
  }

  function resolveAll(): void {
    for (const e of entities) resolveCollision(e);
  }

  return { entities, update, reset, resolveAll };
}
