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
    // 桩贴在某 collider 表面(柱电位嵌柱面 / 端板盒贴柱)。该 collider 是否算阻挡取决于
    // 玩家在哪一侧:玩家在桩所在面的外侧(同侧)→ 看到桩面,不算挡;
    // 玩家在柱对面/柱内 → 隔着柱,看不到桩面,算挡。
    // 桩面判定:桩坐标贴近 collider 某面 ±0.02,且另轴在 collider 范围内。
    let onSurfaceFace: 'x+' | 'x-' | 'z+' | 'z-' | null = null;
    const nearXMin = Math.abs(ox - b.minX) < 0.02;
    const nearXMax = Math.abs(ox - b.maxX) < 0.02;
    const nearZMin = Math.abs(oz - b.minZ) < 0.02;
    const nearZMax = Math.abs(oz - b.maxZ) < 0.02;
    const inXRange = ox > b.minX - 0.02 && ox < b.maxX + 0.02;
    const inZRange = oz > b.minZ - 0.02 && oz < b.maxZ + 0.02;
    if (nearXMin && inZRange) onSurfaceFace = 'x-';
    else if (nearXMax && inZRange) onSurfaceFace = 'x+';
    else if (nearZMin && inXRange) onSurfaceFace = 'z-';
    else if (nearZMax && inXRange) onSurfaceFace = 'z+';

    if (onSurfaceFace) {
      // 玩家必须在该面外侧(同侧)才不算挡;否则(对面/柱内)继续按普通 box 判定 → 挡
      const playerOnOutside =
        (onSurfaceFace === 'x+' && px >= b.maxX) ||
        (onSurfaceFace === 'x-' && px <= b.minX) ||
        (onSurfaceFace === 'z+' && pz >= b.maxZ) ||
        (onSurfaceFace === 'z-' && pz <= b.minZ);
      if (playerOnOutside) continue; // 同侧,看到桩面 → 不算挡
      // 对面 → 落到下面普通判定(线段穿过 box → 挡)
    }
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
