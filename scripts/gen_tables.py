#!/usr/bin/env python3
"""生成分布式自习桌布局:替换 layout.json 里的 studyTable 条目。

规则:
- 书架行 x 坐标(rotY=90 的列): -35,-30,-22,-14,-6,7,14,22,30,37
- 走廊中心 x: -32.5,-26,-18,-10,0.5,10.5,18,26,33.5
- 每条走廊沿 z 方向每隔 5m 放 1-2 张桌
- 避开柱子(0.9×0.9,安全距离 2.0m)
- 避开书架(0.6×3.0 rot90,安全距离 1.5m)
- 桌间最小间距 3.0m(保证 inflate 后通道 ≥1m)
- 横向书架(无 rotY)也要避开
"""
import json, math, sys

LAYOUT_PATH = sys.argv[1] if len(sys.argv) > 1 else "src/scene/layout.json"

with open(LAYOUT_PATH) as f:
    data = json.load(f)

placements = data["placements"]

# 收集所有非自习桌的占位物及其 AABB
bookshelves = []
columns = []
for p in placements:
    if p["kind"] == "studyTable" or p["kind"] == "studyTable-charge":
        continue
    if p["kind"] == "bookshelf":
        rot = abs(abs(p.get("rotY", 0)) - math.pi/2) < 0.01
        w = 0.6 if rot else 3.0
        d = 3.0 if rot else 0.6
        bookshelves.append((p["x"], p["z"], w, d))
    elif p["kind"] == "column":
        columns.append((p["x"], p["z"], 0.9, 0.9))

TABLE_W, TABLE_D = 1.8, 1.2
TABLE_HW, TABLE_HD = TABLE_W/2, TABLE_D/2

# 安全间距(桌边到其他物边的最小距离)
SHELF_MARGIN = 1.2
COLUMN_MARGIN = 1.0
TABLE_MARGIN = 1.5  # 桌与桌之间

# 走廊中心 x 坐标
AISLE_CENTERS = [-32.5, -26, -18, -10, 0.5, 10.5, 18, 26, 33.5]

# 每条走廊的 z 范围(房间 z: -36 ~ 36)
Z_MIN, Z_MAX = -32, 32
Z_STEP = 5.0  # 沿 z 每 5m 一个放置点

def overlaps(x, z):
    """检查桌放在 (x,z) 是否与书架/柱冲突或太近"""
    # 检查书架
    for bx, bz, bw, bd in bookshelves:
        dx = abs(x - bx) - (TABLE_HW + bw/2 + SHELF_MARGIN)
        dz = abs(z - bz) - (TABLE_HD + bd/2 + SHELF_MARGIN)
        if dx < 0 and dz < 0:
            return True
    # 检查柱
    for cx, cz, cw, cd in columns:
        dx = abs(x - cx) - (TABLE_HW + cw/2 + COLUMN_MARGIN)
        dz = abs(z - cz) - (TABLE_HD + cd/2 + COLUMN_MARGIN)
        if dx < 0 and dz < 0:
            return True
    return False

# 生成新桌位
new_tables = []
placed = []  # 已放的桌中心

for aisle_x in AISLE_CENTERS:
    z = Z_MIN
    while z <= Z_MAX:
        # 交替放 1 张和 2 张(走廊宽时放 2 张)
        # 走廊宽度(到最近书架行的距离)
        aisle_half = 3.0  # 大多数走廊 8m 宽,半宽 4m,桌半宽 0.9,余 3.1m

        # 单桌放走廊中心
        if not overlaps(aisle_x, z):
            # 检查与已放桌的距离
            ok = True
            for px, pz in placed:
                if abs(px - aisle_x) < TABLE_W + TABLE_MARGIN and abs(pz - z) < TABLE_D + TABLE_MARGIN:
                    ok = False
                    break
            if ok:
                new_tables.append({"kind": "studyTable", "x": round(aisle_x, 1), "z": round(z, 1)})
                placed.append((aisle_x, z))
                z += Z_STEP
                continue

        # 尝试偏移放(左右各试)
        for offset in [1.8, -1.8]:
            tx = aisle_x + offset
            if not overlaps(tx, z):
                ok = True
                for px, pz in placed:
                    if abs(px - tx) < TABLE_W + TABLE_MARGIN and abs(pz - z) < TABLE_D + TABLE_MARGIN:
                        ok = False
                        break
                if ok:
                    new_tables.append({"kind": "studyTable", "x": round(tx, 1), "z": round(z, 1)})
                    placed.append((tx, z))
                    break

        z += Z_STEP

# 也在中央区域(x: -3~4)零散放几张,但不堆叠
central_spots = [(-3, -25), (-3, -18), (3, -22), (3, -15), (-3, 20), (3, 25), (0, 28)]
for cx, cz in central_spots:
    if not overlaps(cx, cz):
        ok = True
        for px, pz in placed:
            if abs(px - cx) < TABLE_W + TABLE_MARGIN and abs(pz - cz) < TABLE_D + TABLE_MARGIN:
                ok = False
                break
        if ok:
            new_tables.append({"kind": "studyTable", "x": cx, "z": cz})
            placed.append((cx, cz))

# 替换布局中的自习桌
new_placements = [p for p in placements if p["kind"] not in ("studyTable", "studyTable-charge")]
new_placements.extend(new_tables)

data["placements"] = new_placements

# 统计
print(f"书架数: {len(bookshelves)}")
print(f"柱子数: {len(columns)}")
print(f"新自习桌数: {len(new_tables)}")
print(f"总 placements: {len(new_placements)}")

# 验证:检查每张桌是否与所有其他物有通道
# 简单检查:每张桌周围 2m 内至少有一个方向是空的
blocked_count = 0
for tx, tz in placed:
    directions = [(0, 2.5), (0, -2.5), (2.5, 0), (-2.5, 0)]
    has_open = False
    for dx, dz in directions:
        cx, cz = tx + dx, tz + dz
        if not overlaps(cx, cz):
            # 也不与另一张桌太近
            ok = True
            for px, pz in placed:
                if (px, pz) == (tx, tz):
                    continue
                if abs(px - cx) < 1.5 and abs(pz - cz) < 1.5:
                    ok = False
                    break
            if ok:
                has_open = True
                break
    if not has_open:
        blocked_count += 1
        print(f"  ⚠ 桌 ({tx},{tz}) 四周可能阻塞")

if blocked_count == 0:
    print("✓ 所有桌至少有一个开放方向")
else:
    print(f"⚠ {blocked_count} 张桌可能阻塞")

with open(LAYOUT_PATH, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"\n已写入 {LAYOUT_PATH}")
