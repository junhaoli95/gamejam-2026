// PR #16 fix:视线检测(segment vs AABB,2D xz 平面 slab method)。
// 纯 TS 零依赖,可单测。玩家→桩连线被任何 terrain AABB 阻挡 → 无视线(隔墙不算 near)。

export interface Aabb2D {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * 玩家 (px,pz)→ 目标 (ox,oz) 连线是否不被任何 AABB 阻挡。
 * slab method:对 x/z 两轴分别求线段在 AABB 范围内的参数区间,交集非空 = 被阻挡。
 */
export function hasLineOfSight(
  px: number,
  pz: number,
  ox: number,
  oz: number,
  boxes: ReadonlyArray<Aabb2D>,
): boolean {
  const dx = ox - px;
  const dz = oz - pz;
  for (const b of boxes) {
    let tMin = 0;
    let tMax = 1;
    let hit = true;
    for (const [d, c0, c1, start] of [[dx, b.minX, b.maxX, px], [dz, b.minZ, b.maxZ, pz]] as const) {
      if (Math.abs(d) < 1e-9) {
        if (start < c0 || start > c1) {
          hit = false;
          break;
        }
      } else {
        let t1 = (c0 - start) / d;
        let t2 = (c1 - start) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) {
          hit = false;
          break;
        }
      }
    }
    if (hit) return false; // 线段穿过某 box → 被阻挡 → 无视线
  }
  return true;
}
