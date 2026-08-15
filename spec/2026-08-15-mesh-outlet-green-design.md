# 非自习桌绿桩 spec(2026-08-15)

> 状态:draft / 待 David 实施
> 关联:PR #27 寻路 NPC / PR #28 标题屏 / Sam 五布局(PR #24)
> 范围:仅"非自习桌桩"(柱电位 + 壁插)的绿/红生成逻辑 + NPC 抢桩门控。自习桌桩(studyTable / studyTable-charge)逻辑不变。

## 1 背景与问题

PR #27 之前,非自习桌(柱 + 壁插)的"绿桩"是个**残留项**:

- `layout.json` 的 `outlets.columnCount / wallCount = [min, max]` 定义每局随机抽几个柱/壁插生成 mesh(原 `drawOutletSpots` 算法)
- `randomizeOccupiedOutlets(count = CONFIG.npc.count)`(`src/scene/loadLibraryScene.ts:886`)从这批 drawn 桩里 Fisher-Yates 抽 `count` 个标红 + 摆坐猫(装饰)
- **剩下没被抽中的 = 绿桩**(数量 = drawn − npc.count,**毫无 rate 锁定,可以为 0**)

实测 Islands 布局:
- `columnCount=[1,1]` + `wallCount=[1,1]` → 每局必出 1 柱 + 1 壁插,drawn pool = 2
- `npc.count=3` → 抽 min(3, 2) = 2 个全标红 → **绿桩 = 0**
- 3 个 QUERY/RADAR/MAP 任意扫都看不到绿,游戏不可解

根因:**没有"绿桩数"的概念**,只剩"红桩 = npc.count"和"绿桩 = 副产物"。

## 2 设计目标

- **保证有解**:每局至少 1 个非自习桌绿桩,玩家总能找到充点
- **难度可调**:绿桩数 = 配置 + 随机跨度(差值越大越简单),由布局作者按布局物件密度调
- **难度对抗**:NPC 运行中不能再把场上**最后一个**非自习桌绿桩抢红 → 玩家至少留 1 充点
- **概念分离**:
  - **红桩(装饰/障碍)**:开局预占(坐猫),沿用原算法
  - **绿桩(有意义桩)**:`绿桩数 = npc.count − 随机差`(`meshGreenMin` 兜底)由公式算
- **schema 简化**:废弃 `columnCount / wallCount`,因为池子大小由公式推导(不再作者手设范围)
- **编辑器同步**:作者在编辑器改"NPC 数"和"绿随机差",实时预览;导出新 schema

## 3 schema 变更

### 3.1 `layout.json` / `layouts/layout{1,2,3,5}.json` 的 `outlets` 段

**废弃**:
- `columnCount: [min, max]` — 池子大小改由公式推导
- `wallCount: [min, max]` — 同上

**新增**:
- `meshNpcCount: number` — 本布局 NPC 数(= 红桩/坐猫数)。缺则用 `CONFIG.charging.meshNpcCount` 兜底
- `meshGreenRandom: [min, max]` — 绿桩差随机范围,随机差 `rand ∈ [min, max]` 整数;**绿数 = max(meshGreenMin, meshNpcCount − rand)**
- `meshGreenMin: number`(可选,缺则用 `CONFIG.charging.meshGreenMin = 2`)— 绿数下限

**保留**:
- `seed: number | null` — 每局 RNG seed(同原)
- `studyTableGreenRate: number` — 自习桌绿桩率(自习桌逻辑不变)

### 3.2 新 schema 示例

```json
{
  "room": { "w": 32, "h": 24 },
  "outlets": {
    "meshNpcCount": 3,
    "meshGreenRandom": [1, 2],
    "meshGreenMin": 2,
    "seed": null,
    "studyTableGreenRate": 0.05
  },
  "placements": [ ... ]
}
```

### 3.3 `src/game/config.ts` 兜底

`CONFIG.charging` 段加:

```ts
charging: {
  studyTableGreenRate: 0.05,
  meshGreenRandom: [1, 2] as const,
  meshGreenMin: 2,
},
```

`CONFIG.npc.count` 用途不变:仍是 `NpcSystem` 创建实体数 + `randomizeOccupiedOutlets` 默认 `count`,**本布局有 `LAYOUT.outlets.meshNpcCount` 时覆盖**(randomize 内部读 layout 优先,见 §4.2)。`meshNpcCount` 不进 CONFIG — layout 才是"按布局定 NPC 数"的归属;CONFIG.npc.count 是无 layout 兜底。**注意若 `LAYOUT.outlets.meshNpcCount` 与 `CONFIG.npc.count` 不一致,`NpcSystem` 创建实体数 (= npc.count) 与红桩数 (= meshNpcCount) 会错位**——David 决定:`main.ts` 创建 `NpcSystem` 时应读 `LAYOUT.outlets.meshNpcCount ?? CONFIG.npc.count` 而非硬编码 `CONFIG.npc.count`。

## 4 运行时算法(`src/scene/loadLibraryScene.ts`)

### 4.1 池子推导替代 `drawOutletSpots`

废弃 `drawOutletSpots()` 的 `columnCount/wallCount` 路径。新算法:

```ts
function drawOutletSpots():
  rng = mulberry32(gameSeed())
  // 1. 公式算红+绿
  npcCount   = LAYOUT.outlets.meshNpcCount ?? CONFIG.charging.meshNpcCount
  randRange  = LAYOUT.outlets.meshGreenRandom ?? CONFIG.charging.meshGreenRandom
  rand       = randInt(rng, randRange[0], randRange[1])   // 闭区间整数
  greenMin   = LAYOUT.outlets.meshGreenMin ?? CONFIG.charging.meshGreenMin
  greenTarget = max(greenMin, npcCount - rand)
  need       = npcCount + greenTarget                     // 池子总大小

  // 2. 候选池(沿用原有 layoutColumns() + wallCandidatesFromLayout())
  allCols = layoutColumns()                               // 布局 placements 里的柱
  allWalls = wallCandidatesFromLayout()                   // 南/西墙候选(同原算法)
  pool = shuffle([...allCols, ...allWalls], rng)          // 混洗(柱/壁插同池)

  // 3. 池子不够 → 警告 + 回退(保 npc 优先,绿降)
  if pool.length < need:
    console.warn(`[layout] 布局候选(柱${allCols.length}+墙${allWalls.length}=${pool.length}) < 公式需 ${need}（npc ${npcCount} + 绿 ${greenTarget}）。绿桩下调到 ${max(0, pool.length - npcCount)}。建议布局加柱/壁插候选。`)
    greenTarget = max(0, pool.length - npcCount)
    need = min(pool.length, npcCount + greenTarget)

  // 4. 选 drawn = 前 need 个(已洗)
  drawn = pool.slice(0, need)
  cols_drawn  = drawn.filter(isColumn)       // 用于生成 columnOutletMeshes
  walls_drawn = drawn.filter(isWall)         // 用于生成 wallSocketMeshes
  return { columns: cols_drawn, walls: walls_drawn, seed, npcCount, greenTarget }
```

**关键不变量**:
- `meshBacked` 池(原 `:943-947`)`npcCount + greenTarget` 个 mesh-backed 桩
- 顺序仍 `columnCount → wallCount → studyTable`(避免表测试 break),只是 column/wall 元素来自 `drawn`
- `layoutColumns()` / `wallCandidatesFromLayout()` 不改(候选生成同原)
- face / 位置同原(`columnFace`/柱半宽偏移)

### 4.2 `randomizeOccupiedOutlets` 重构(`loadLibraryScene.ts:886-970`)

签名保留:`(count?: number, seed?: number) => void`。内部行为:

```ts
function randomizeOccupiedOutlets(count?, seed = NPC_SEED):
  // 1. 重置全绿(同原 :888-891)
  for i in outletPositions:
    outletPositions[i].occupied = false
    for m in outletMeshGroups[i]: m.material = outletMatEmpty

  // 2. 桌桩分支完全不变（:892-939,greenRate + 座位推导；★studyTable-charge 跳过同原）

  // 3. meshBacked 池筛选（原 :943-947）：保留 npcCount + greenTarget 个
  const meshBacked = [i for i in 0..outletMeshGroups.length
                      if outletMeshGroups[i].length > 0 && !tableOutletSeatKeys[i]]

  // 4. 由 §4.1 drawOutletSpots 已保证 meshBacked.length = npcCount + greenTarget。
  //    这里抽红 = (count ?? layoutNpcCount) 个；剩下保持 outletMatEmpty = 绿。
  const layoutNpcCount = LAYOUT.outlets.meshNpcCount ?? CONFIG.npc.count
  const targetCount = count ?? layoutNpcCount
  shuffle(meshBacked, rng)
  for k in 0..min(targetCount, meshBacked.length):
    idx = meshBacked[k]
    outletPositions[idx].occupied = true
    for m in outletMeshGroups[idx]: m.material = outletMatOccupied
    npc = createSeatedCat(randomFur(), randomAngle())
    npc.position.set(o.x, 0.45, o.z + 0.8)        // 同原摆位
    scene.add(npc); npcMeshes.push(npc)
  // 剩 meshBacked[targetCount..] 保持绿色 = 玩家可充点
```

**与原算法差异**:
- 池子大小由公式锁(`npcCount + greenTarget`)而非作者手设范围
- `greenTarget` 通过代码不变量"剩 = 总 - 红"隐式得到;不在 randomize 里强标绿
- `count` 参数若未传 → 用 `LAYOUT.outlets.meshNpcCount ?? CONFIG.npc.count`(签名兼容)

### 4.3 接口 / 数据暴露

仅通过 SharedState 暴露 `freeMeshGreenCount`(见 §5.3)。**不需要** export `getNpcCount/getMeshGreenCount` 函数 — 历史会话上的"export helper"想法废弃,采用 SharedState 加字段的最干净路径。

## 5 NPC 抢桩门控(`src/game/npc.ts`)

### 5.1 语义

当`场上非自习桌绿桩数 ≤ 1` 时,NPC `idle → moving`(occupying 转换)被门控:
- 不切换到 moving(去抢桩)
- 继续 idle(重置 `idleTimer` 等下一轮)或转 wander(`wanderChance` 仍生效,因为 wander 不抢桩)

### 5.2 触发点

`src/game/npc.ts:233-247`:

```ts
if (e.state === 'idle') {
  e.idleTimer -= dt;
  if (e.idleTimer <= 0) {
    const goWander = rng() < cfg.wanderChance && pickWanderTarget(e);
    if (goWander) {
      e.state = 'wander';   // wander 不受门控影响(wander 不抢桩)
    } else {
      // ★新增门控:场上非自习绿桩 ≤ 1 → 拒绝 occupy,回 idle(等下一轮再掷骰)
      if (opts.freeMeshGreenCount <= 1) {
        e.idleTimer = newIdleTimer();   // 重置计时,等玩家充/桩变化后下一轮再试
        // fallthrough 到本 if 末尾(继续 idle 状态,不切 moving)
      } else {
        const t = pickReachableOutlet(e);
        if (t >= 0) {
          e.state = 'moving';
        } else {
          e.idleTimer = newIdleTimer();
        }
      }
    }
  }
}
```

**注意**:
- 门控只在 `idle → moving`(occupying 转换)加。**不动** `:319/:341` 的 `setOutletOccupied(target, true)` — 因为这是 moving 已走完(桩已到达),撤掉就是退占;门控阻止的是新抢桩行为,不阻止已抢桩的标红
- 门控不影响 `wander`:wander 不抢桩、不切色,允许继续 — NPC 仍可在场内走动增加"有 NPC 在干活"的氛围
- 门控进入条件 `freeMeshGreenCount <= 1`,但旧测试 harness 不传 SharedState 字段 → `opts.freeMeshGreenCount` 缺省为 `Infinity` 或合适 sentinel 让门控不触发(保留旧测试行为)
- `pickReachableOutlet` / `pickNearestFreeOutlet` 不动

### 5.3 SharedState 字段

SharedState(`src/game/sharedState.ts` 或对应文件)加字段:

```ts
interface SharedState {
  ...
  /** 非"自习桌"的空(未占)桩数 = 柱电位 + 壁插中 occupied=false 的数量。每帧 update 时算一次。 */
  freeMeshGreenCount: number;
}
```

每帧 update 逻辑(在 `main.ts` game loop 或 NPC系统的 update 入口):

```ts
const freeMeshGreenCount = outlets.reduce((acc, o, i) =>
  acc + (!o.occupied && isMeshOutlet(i) ? 1 : 0), 0);
// 其中 isMeshOutlet(i) = !tableOutletSeatKeys[i] && outletMeshGroups[i].length > 0
// 或更简单:把 tableOutletSeatKeys 透出,或者给 outletPositions[i] 加 kind: 'mesh'|'table' 字段
```

**reflection**:`outletPositions[i]` 当前无 kind 字段。最干净是 `loadLibraryScene.ts` 给 `outletPositions[i]` 加 `kind: 'mesh' | 'table'`,或暴露 helper `isMeshOutlet(i)` via controller。**推荐** 给每条 `outletPositions[i]` 加 `kind` 字段,避免 SharedState 算 freeMeshGreenCount 时反推 `tableOutletSeatKeys`(那是 internal)。

## 6 布局编辑器(`tools/layout-editor.html`)

### 6.1 UI 改动

`<div id="simBox">`(`:209-225`)改造:

**删**:
- `:216` 柱电位 min/max 输入 `simColMin/simColMax`
- `:219` 墙电位 min/max 输入 `simWallMin/simWallMax`

**加**:
- NPC 数输入 `<input id="simMeshNpc" type="number" min="0">`(默认 3)
- 绿桩差随机范围输入对 `<input id="simGreenMin"> ~ <input id="simGreenMax">`(默认 [1, 2])
- 输出文字行改造:`绿 <b>{greenTarget}</b> · 红 <b>{npc}</b> · 池子需求 <b>{need}</b>`(超越布局候选数时红字 + warn)

### 6.2 sim 状态

```js
let sim = {
  seed: 12345,
  fixSeed: false,
  meshNpc: 3,           // 新增(替代 columnMin/Max, wallMin/Max)
  greenMin: 1,          // 新增(随机差 min)
  greenMax: 2,          // 新增(随机差 max)
  greenMinFloor: 2,     // 新增（可选：meshGreenMin global floor；加输入或硬编码 2）
  greenRate: 0.05,      // 保留(自习桌绿桩率)
};
```

### 6.3 渲染 sim(`renderSim()`)

```js
function renderSim() {
  // 清旧 sim-dot/sim-cand/sim-green
  // 1. 公式算 demand
  const rng = mulberry32(sim.seed);
  const rand = sim.greenMin + Math.floor(rng() * (sim.greenMax - sim.greenMin + 1));
  const greenTarget = Math.max(sim.greenMinFloor, sim.meshNpc - rand);
  const need = sim.meshNpc + greenTarget;
  // 2. 候选池(沿用 layoutColumns 逻辑 + wallCandidates)
  const cols = elements.filter(e => e.kind === 'C');
  const cands = wallCandidates(ROOM_W, ROOM_H);
  const pool = shuffle([...cols, ...cands], rng);
  const warn = pool.length < need;
  // 3. 绘制:need 个标 dot(前 sim.meshNpc 红 / 剩 greenTarget 绿)
  for (let k = 0; k < Math.min(need, pool.length); k++) {
    const p = pool[k];
    if (isCol(p)) dotAt(p.x + face(p.x) * 0.46, p.z, k < sim.meshNpc ? 'sim-dot-red-dry' : 'sim-green');
    else dotAt(p.x, p.z, k < sim.meshNpc ? 'sim-dot-red-dry' : 'sim-green');
  }
  // 4. simInfo 文字:种子、npc、绿数、需求、警告
  simInfo.textContent = `seed ${sim.seed} · npc ${sim.meshNpc} · 绿 ${greenTarget} · 池子需求 ${need}${warn ? ' · ⚠候选不足（剩 ${pool.length}）' : ''}`;
}
```

(原 `simInfo` 的"柱/墙"分开计数显示删除;新增"红/绿"可视化更直观)

### 6.4 导出/导入

**`buildJson()`**(`:1202-1217`):

```js
outlets: {
  meshNpcCount: sim.meshNpc,
  meshGreenRandom: [sim.greenMin, sim.greenMax],
  meshGreenMin: sim.greenMinFloor,
  seed: sim.fixSeed ? sim.seed : null,
  studyTableGreenRate: sim.greenRate,
},
```

**`stateFromJson()`**(`:1226-1247`)兼容:

```js
const meshNpc = typeof o.meshNpcCount === 'number' ? o.meshNpcCount
  : (DEFAULT.meshNpc);      // 旧 schema 没 meshNpcCount → 兜底
const gr = Array.isArray(o.meshGreenRandom) ? o.meshGreenRandom
  : (o.columnCount && o.wallCount ? deriveLegacyGreenFromCounts(o) : [1, 2]);
const gMin = typeof o.meshGreenMin === 'number' ? o.meshGreenMin : 2;
```

`deriveLegacyGreenFromCounts`:旧 schema 用 columnCount/wallCount 反推近似 `meshNpcCount`(随机范围 max + wall max)和 `meshGreenRandom`(可填默认 [1,2] + warn)。**可省略** — 因为 5 个布局会手改而非自动 migrate,见 §7。

### 6.5 bake-layout.mjs

`tools/bake-layout.mjs:59-61` 默认 outlets 同步:

```js
outlets: {
  meshNpcCount: 3,
  meshGreenRandom: [1, 2],
  meshGreenMin: 2,
  seed: null,
  studyTableGreenRate: 0.05,
},
```

## 7 5 个布局迁移(`src/scene/layout.json` + `layouts/layout{1,2,3,5}.json`)

每个文件改 `outlets` 段:

```diff
- "columnCount": [a, b],
- "wallCount": [c, d],
+ "meshNpcCount": N,           // 见下表,作者实测再调
+ "meshGreenRandom": [1, 2],   // 默认,作者实测再调
+ "meshGreenMin": 2,
  "seed": null,
  "studyTableGreenRate": 0.05,
```

**建议首次值**(基于原 `columnCount/wallCount` 范围 + 布局物件数保守填,作者 playtest 调):

| 布局 | 原 col..wall | 桌数(≈给定候选规模) | 建议 meshNpcCount | 说明 |
|------|--------------|---------------------|-------------------|------|
| Open Lobby | [4,6] + [2,4] | 7 | 5 | 池最大,npc 放宽 |
| Compact Study | [4,6] + [2,4] | 19 | 3 | 桌多,装饰桩可少 |
| Maze | [1,1] + [1,1] | 7 | 2 | **最紧缺**:如 npc=3 则 pool 至少 5,但 Maze 候选不够 — 借机把 npc=2 让作者决定要不要加柱/壁插 |
| Islands | [1,1] + [1,1] | 17 | 3 | 同 PR #28 默认布局 |
| Arena | [4,6] + [2,4] | 9 | 4 | 池宽 |

**注意**:布局候选(柱 + 壁插)若 < `npcCount + greenTarget`,§4.1 会 warn + 调降绿桩。Maze 这种小池子布局作者要决定:
- (a) 增加布局里的 `column` / 墙候选(改布局物件)
- (b) 主动下调 meshNpcCount

**摸奖桌说明**:`studyTable-charge`(摸奖桌)在用户已删除/即将删除过程中。如仍有残留,逻辑上仍按自习桌一类处理(恒绿、跳过 NPC 预占 + 跳过 freeMeshGreenCount 计数)。spec 不引入新行为。

## 8 测试

### 8.1 `src/scene/layoutData.test.ts`

加循环校验 5 布局:
- `outlets.meshNpcCount` 是整数 ≥ 0
- `outlets.meshGreenRandom` 是 `[min, max]`,min ≤ max,min ≥ 0
- `outlets.meshGreenMin`(若有)是整数 ≥ 0
- 删除原 `:64-66` 对 `columnCount/wallCount` 的旧断言(旧字段不再存在)
- 或加兼容断言:旧字段允许存在(导入时忽略),新字段必存在

### 8.2 `src/scene/loadLibraryScene.test.ts`(若存在)或新增

`drawOutletSpots` 行为单测(若 `drawOutletSpots` 不 export,改测 `randomizeOccupiedOutlets` 的可观察效果):
- 给定 `LAYOUT.outlets.meshNpcCount = 3, meshGreenRandom = [1, 2], meshGreenMin = 2`,布局候选(柱 + 壁插)5 个 → drawn pool = `3 + max(2, 3-rand)` 个,其中前 3 红剩 ≥2 绿
- 池子不够 `pool.length < need` 时:warn + 调降 greenTarget 到 `max(0, pool.length - npc)`(必须保 npc 优先)

### 8.3 `src/game/npc.test.ts` 门控分支

新增测试:`freeMeshGreenCount = 1`(或 0)时,NPC `idle` 不切到 `moving`(保持 `idle` 且不调用 `pickReachableOutlet`):
- 模拟 `idleTimer <= 0 + freeMeshGreenCount=1` → assert `entity.state === 'idle'`(不切 moving)
- 模拟 `freeMeshGreenCount=2` → 正常切 moving(原行为)

### 8.4 编辑器手测

打开 `tools/layout-editor.html`,load `layout.json`:
- 模拟器面板显示新输入(NPC / 绿差 min..max / 绿下限)
- 调整 meshNpc 数,simInfo 实时算"绿+红"
- 池子不够时 warn 文字 + dot 不超出候选边界
- save → JSON 含新 schema、无 columnCount/wallCount

## 9 实施步骤建议

1. config.ts + 布局 schema 改(layout.json + 5 个布局手动 outlet 段重写)
2. `loadLibraryScene.ts`:`drawOutletSpots` 重构 + `randomizeOccupiedOutlets` 调用方
3. `loadLibraryScene.ts`:给 `outletPositions[i]` 加 `kind` 字段 + controller 暴露 `isMeshOutlet` helper
4. `sharedState.ts`:`freeMeshGreenCount` 字段
5. `main.ts`:game loop 算 freeMeshGreenCount 并写 SharedState
6. `npc.ts`:门控 `idle → moving`(用 `opts.freeMeshGreenCount <= 1`)
7. `npc.test.ts`:门控分支
8. `layout-editor.html` + `bake-layout.mjs`:UI/导出/导入
9. `layoutData.test.ts`:新 schema 断言
10. 5 个布局手动改 outlet 段(数值按 §7 表)
11. tsc + vitest + Vite build
12. MCP chrome 自验:Islands 布局每局至少 1 绿;NPC 门控触发时不再切 occupying

## 10 验收标准

### 10.1 开发者侧(David 完工前自检)

- `tsc --noEmit` 干净
- `vitest run` 全过(82 + 新增门控分支)
- Vite build 绿(产物 ~650-680KB)
- 无 `columnCount/wallCount` 在产线代码 / 5+1 布局 JSON 中残留
- 编辑器:能 load + save 5 个布局(新 schema),模拟器预览计算正确("绿/红/池子需求"数字无误)

### 10.2 用户实际验收(手玩 — 用户验收 David 的工作)

> 这一组验收是**玩家侧实操**,不依赖 MCP chrome 自动化。David 完工后,用户照此清单在浏览器里跑一遍。

**环境**:用户本地跑 `npm run dev`,浏览器开 `http://localhost:5173`,用已 merge 的 feat 分支 build。

**V1:每局有绿桩(不再全红)**
1. 标题屏 → Start Game → 选 Islands → Start
2. 进游戏后,按 `3`(开 QUERY app,4× 耗电但能看到桩色)
3. 在地图上转一圈,数一数"非自习桌绿桩"(柱面/墙根的绿色发光方块,**不含自习桌面上的绿方块**)
4. **通过条件**: Islands 每局至少 2 个非自习绿桩(对应 `meshGreenMin=2`)
5. 再连续重玩 3 局(retry 屏 → Menu → 选 Islands → Start),每局绿桩数 ≥ 2

**V2:难度跨度可感知(随机差生效)**
1. 选 Islands 连开 5 局,数每局非自习绿桩数
2. **通过条件**: 5 局里至少出现 2 种不同绿桩数(比如 2 和 3),证明 `meshGreenRandom=[1,2]` 随机差生效;若每次都是 2,可能 `rand` 取值范围被算死,报回 David

**V3:NPC 门控触发(玩家有最后一桩可用)**
1. 选 Islands 开局,QUERY 开起
2. 引导 NPC 占桩(玩家站在远离柱+壁插绿桩处,NPC 会寻路去抢空桩——前 `meshNpcCount` 个开局已红,需要引导 NPC wander 到其他桩,实测:把你自己占在一个桩上充电,NPC 会换桩 —— 观察 NPC 抢桩行为)
3. 反复充完又切走,直到场上**非自习桌绿桩只剩 1 个**(自习桌绿桩不算)
4. 站在那最后 1 个绿桩旁观察 NPC 行为
5. **通过条件**: 看到 NPC 不再来抢这个最后绿桩(NPC 在附近 idle 或 wander,但不再 moving 逼近)。若 NPC 仍逼近并把它占红 → 门控失效,报回 David

**V4:5 布局全跑通(迁移成功)**
1. 标题屏依次选 Open Lobby / Compact Study / Maze / Islands / Arena → Start
2. 每个布局开局后 QUERY 看一眼
3. **通过条件**: 5 个布局全部能开,无 console 报错(`F12` 看 console 有没有 `warn [layout] 布局候选 <need`)。Maze 若出现 warn 是预期的(§7 §11 已说明),其他 4 个布局不应 warn
4. 每个布局绿桩数 ≥ 该布局 meshGreenMin(Maze=1,其余=2)

**V5:编辑器(可选,用户方便时做)**
- 浏览器开 `tools/layout-editor.html`
- 右侧"电位模拟"面板:**没有**柱电位 min/max、墙壁插 min/max 两个输入;**有** NPC 数 + 绿差 min..max 输入
- 调整 NPC 数,看 simInfo 文字"绿/红/池子需求"实时计算
- Load / Save 按钮:save 后下载的 JSON 含 `meshNpcCount / meshGreenRandom / meshGreenMin`,**不含** `columnCount / wallCount`
- (若编辑器有 save server 跑着,可直接保存到 layout.json,验证后回滚)

### 10.3 验收不通过的处理

- V1 失败(0 绿):公式未生效,David 查 `drawOutletSpots` 是否真接入 randomize
- V2 失败(每局绿数恒定):`meshGreenRandom` 范围被算成单值,查 `rand` 闭区间整数实现
- V3 失败(NPC 仍抢最后桩):门控条件 `<= 1` 写错或 `freeMeshGreenCount` 未传到 NPC,David 查 `npc.ts:233-247` + `main.ts` SharedState 接线
- V4 失败(warn 或不开):布局文件 schema 改错,或 `NpcSystem` 实体数与 `meshNpcCount` 错位(spec §3.3 已警告,David 查 `main.ts` NpcSystem 创建处)

## 11 风险 / 不变项

- **自习桌桩不动**:studyTable / studyTable-charge 的 `studyTableGreenRate` + 座位推导 + 摸奖桌恒绿跳过 全部不变
- **NPC 运行中"释放桩"**:原 PR #27 是"永久占桩"(NPC 到桩 occupying 后不再离开)。所以门控 `≤ 1` 不会无限延续 — 玩家充完一个桩(桩不释放,NPC 也不释放),只有当玩家占着某个桩(把 NPC 排走)时才可能把 NPC 排出的桩空出来。门控语义是"NPC 别再抢",与"NPC 已占的不撤"并存
- **`columnCount/wallCount` 字段软兼容**:旧 JSON 加载不报错(忽略即可)。但所有 5 + 1 布局文件本 PR 一并改成新 schema,实操不会遇到旧字段
- **runtime seed 复用**:`drawOutletSpots` 与 `randomizeOccupiedOutlets` 共用同 `gameSeed`,新算法里两次 RNG 抽样(rand 一次 + shuffle 一次)与原算法 RNG 流不完全一致 — 但对玩家无感(本来就是每局随机)

## 12 Follow-up(不在本 spec)

- GLB 替换(/public 下待用户提供资产)
- itch.io 上传(pack.sh 已就绪)
- 摸奖机制 gameplay(studyTable-charge 摸奖玩法 — 用户已决定先删全部摸奖桌,本 spec 不引入)