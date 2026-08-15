# Peter — NPC 壁插占用修复 + 寻路接入

**Dispatched**: 2026-08-14
**Agent**: Peter
**Base**: `feat/study-table-green-rate`(用户实测分支,含绿桩改动;若已 merge 到 main 则基于 main)
**Estimated**: 任务 A 20-30min,任务 B 40-60min(hard stop 90min)

## 背景

两个已确诊 bug,根因都查清了,照做即可。

1. **壁插被 NPC 占用**:墙壁插 mesh 用常亮绿材质 `socketMat`(loadLibraryScene.ts:488-494),不在 `outletMeshGroups` 里(rebuild 时 `outletMeshGroups.push([])` 空数组,line 810)。但它的 `occupied` 初始是 `false`(line 808)。NPC 的 `pickNearestFreeOutlet`(npc.ts)只查 `occupied` 不看类型 → 把壁插当空桩抢 → 到达后 `setOutletOccupied(true)` 改 `occupied`,但 mesh group 是空数组切不了色 → **视觉还是绿,玩家却因 `occupied=true` 不能充** → "绿桩不能充电" + NPC 无限循环占同一壁插(释放后最近空桩又是它)。

2. **NPC 无寻路**:npc.ts moving 状态直线走(npc.ts:146-149),`resolveCollision` 只推出不绕路 → 被书架/墙挡住顶住不动,一直朝目标方向顶。**寻路模块已写好但未接入**:`gridModel.ts` + `pathfinding.ts` 已有测试(gridModel 2 + pathfinding 4)。

## 你的方法论(照旧)

- 单元测试优先:改哪块先看对应测试文件,纯 TS 逻辑零 MCP
- 3 个 commit 一批 build 一次;连续 3 次失败停止并报告
- `npm test`(全部)+ `npm run build` 必须绿

---

## 任务 A:壁插不能被 NPC 占用(先做,小改动)

**方案**:给 NPC 选择加"可占"判定,排除壁插:

1. `src/scene/loadLibraryScene.ts`:
   - `outletPositions` 元素加 `occupiable: boolean`(接口定义 line ~654 附近 + push 处)
   - 柱电位 push(line 803):`occupiable: true`
   - 壁插 push(line 808):`occupiable: false`
   - 桌 outlet push(buildOneStudyTable 内 line ~720):`occupiable: true`
   - `LibraryScene` 接口(line ~236)outlets 类型同步加字段(可选 — 若影响 sharedState 消费则先不加,仅 NPC 用)

2. `src/game/npc.ts`:
   - `NpcControllerOptions` 加 `isOutletOccupiable: (i: number) => boolean`(可选?默认 `() => true` 兼容现有测试)
   - `pickNearestFreeOutlet` 加:`if (opts.isOutletOccupiable && !opts.isOutletOccupiable(i)) continue;`

3. `src/main.ts`(line 161-170 opts):加 `isOutletOccupiable: (i) => outlets[i].occupiable !== false`

**注意**:壁插 `occupied` 保持 `false`(玩家仍可充,常亮语义不变)。只让 NPC 不选它。

**测试**:`src/game/npc.test.ts` 加 1-2 条:3 个桩(2 可占 + 1 不可占)时,NPC 只选可占的。

**提交**:分支 `fix/npc-wall-socket` → commit(`fix(npc): NPC 不再占用墙壁插 — 常亮可充语义不破`)→ PR(base=`feat/study-table-green-rate`)

---

## 任务 B:NPC 接入寻路(基于任务 A,中改动)

**现状**:npc.ts moving 直线走(npc.ts:146-149)。`gridModel.ts` 已提供 `toGrid(colliders, worldW, worldD, cellSize)` + `worldToCell(wx, wz, grid)` + `cellToWorld(c, grid)` + `isBlocked(grid, c)`;`pathfinding.ts` 已提供 `findPath(grid, start, goal): Cell[] | null`(A*)。`CONFIG.world = { w: 32, d: 24, cellSize: 0.4 }`(config.ts:7)。

**接入方案**:

1. `src/main.ts`:
   - 构建 grid:`const npcGrid = toGrid(colliders, CONFIG.world.w, CONFIG.world.d, CONFIG.world.cellSize)`
   - opts 加 `grid: npcGrid`

2. `src/game/npc.ts`:
   - `NpcControllerOptions` 加 `grid?: Grid`(可选,兼容测试)
   - `NpcEntity` 加 `path: Cell[]`(当前行进路径)
   - moving 状态改:
     - 选好 `targetOutletIndex` 时(含被抢改选):`findPath(grid, worldToCell(e), worldToCell(outletPos))`,存 `e.path`;null(不可达)→ 换下一个空桩或回 idle
     - 每帧:沿 `path` 逐 cell 走(walkSpeed 不变),`cellToWorld` 取 cell 中心作为临时目标点;到达当前 cell 中心切下一个
     - 最后一个 cell 到达 → 原 arrival 逻辑(dist <= arriveDist → occupying)
     - 目标被抢:清 path 重算
   - 保持纯 TS 零 DOM/Three(现状原则),`Cell`/`Grid`/`worldToCell`/`cellToWorld`/`findPath` 从 `./gridModel`/`./pathfinding` import
   - **resolveCollision 保留**(走路径时仍有极小穿墙兜底)

3. `src/game/npc.test.ts` 适配:
   - 现有直线测试会挂(走法变了)— 重写/适配:用小网格(如 20×20 cellSize 1,两堵墙柱)
   - 至少 4 条:**可达→绕障到桩**、**不可达→换目标/停**、**目标被抢→中途改道**、**完整周期 idle→moving→occupying→idle 仍 work**(含占据变红/释放回绿)

**验证**:`npm test` 全绿 + `npm run build`。

**提交**:分支 `feat/npc-pathfinding` → commit(`feat(npc): NPC 接入 A* 寻路 — 书架不再挡路`)→ PR(base=`feat/study-table-green-rate`)

---

## 注意事项

- 两个任务**顺序做**:A commit + PR 完再开 B。A 即使先落,A 不依赖 B。
- **不要动绿桩逻辑**(`studyTableGreenRate`/`freeSeats`/`tableOutletSeatKeys`/`randomizeOccupiedOutlets` 的选择分支)— 那是另一条 PR 的领地。
- 不要动 `loadLibraryScene.ts` 的 outlet 视觉部分(材质/位置),只加 `occupiable` 字段。
- commit 中文摘要,PR body 写 根因 → 修复。
- 结束后 `git pull` 同步 base(用户可能已 merge)。
- 报告:两个 PR 的 URL + 测试通过数。
