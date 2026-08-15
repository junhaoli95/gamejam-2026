# David — 非自习桌绿桩(公式化生成 + NPC 抢桩门控 + 编辑器同步)

**Dispatched**: 2026-08-15
**Agent**: David
**Base**: `main`(=`e567064`,PR #27 + #28 已 merge)
**Estimated**: 中-大改动,3-4h(hard stop 5h)
**Spec**: `spec/2026-08-15-mesh-outlet-green-design.md`(必读 — 设计细节 / 公式 / 测试全在那)

## 背景

非自习桌(柱电位 + 壁插)的"绿桩"目前是**残留副产物**:从 `columnCount/wallCount` 范围抽 N 个,NPC 占 `npc.count` 个标红,剩下才是绿。Islands 布局 `[1,1]+[1,1]+npc=3` → 池=2 < npc=3 → 全红 → **玩家无可充点,游戏不可解**。

要做的事:**废弃 `columnCount/wallCount` 范围**,改用公式推导池大小。绿桩数 = `max(meshGreenMin, meshNpcCount − rand)`。NPC 运行中:场上非自习绿桩 ≤ 1 时拒绝 `idle → moving`(不再抢桩),给玩家保留最后 1 充点。编辑器 UI + 5 布局文件同步迁移。

读 `spec/2026-08-15-mesh-outlet-green-design.md` 全文再开工,§3/§4/§5/§6/§7 是核心。

## 你的方法论(照 Peter 的)

- **TDD 优先**:改哪块先看测试文件;改算法前先在新测试里把期望行为 red→green 写下来
- **3 commit 一个 build milestone**;连续 3 次失败停下来报告
- **`npm test` + `npm run build` 全绿**才算 READY FOR REVIEW
- **不要 merge**:你只 commit + push + 开 PR + 说 "READY FOR REVIEW" 停手(用户 merge)
- **commit 身份**:`git config user.name "Snake" && git config user.email "snake@agent.local"`(worktree 级不要改全局 — 用户已配置 local)

## 不可破坏的不变项

- **自习桌桩(studyTable / studyTable-charge)逻辑不动**:`studyTableGreenRate` + 座位推导 + 摸奖桌恒绿跳过,完全不变
- **摸奖桌(studyTable-charge)**:作者正在删除全部布局里的摸奖桌;若布局文件还有 `studyTable-charge` 放置,逻辑上仍按自习桌一类处理(恒绿、跳过 NPC 预占 + 跳过 freeMeshGreenCount 计数)。本任务**不引入**新摸奖机制
- **PR #27 NPC 永久占桩语义不动**:NPC 到桩 occupying 后不离开;门控只在 `idle → moving` 转换加,不动 `:319/:341` 的 `setOutletOccupied(true)`
- **玩家可见文字全部英语**(代码/commit/PR 文档中文)。本任务 UI 改动只涉及编辑器(开发者工具,中英不限)+ 无新玩家可见 UI,但保留现状即可

## 实施步骤(按 spec §9)

### 任务 A:config + schema 兜底(15min)

`src/game/config.ts:55-57` `charging` 段加:
```ts
charging: {
  studyTableGreenRate: 0.05,
  meshGreenRandom: [1, 2] as const,
  meshGreenMin: 2,
},
```
**注意**:**不要**新增 `meshNpcCount`(它属于 layout,不是 CONFIG 兜底;fallback 用 `CONFIG.npc.count`,见 spec §3.3)。
`CONFIG.npc.count` 保留,`NpcSystem` 创建实体数改读 `LAYOUT.outlets.meshNpcCount ?? CONFIG.npc.count`(见任务 D §5)。

### 任务 B:5 布局文件 outlet 段重写(20min)

`src/scene/layout.json` + `src/scene/layouts/layout{1,2,3,5}.json` 5+1 个文件,每个 `outlets` 段按 spec §7 表改:

| 布局 | 原 col..wall | 建议 meshNpcCount | meshGreenRandom | meshGreenMin |
|------|--------------|-------------------|-----------------|--------------|
| layout.json (Islands) | [1,1]+[1,1] | 3 | [1,2] | 2 |
| layout1 (Open Lobby) | [4,6]+[2,4] | 5 | [1,2] | 2 |
| layout2 (Compact Study) | [4,6]+[2,4] | 3 | [1,2] | 2 |
| layout3 (Maze) | [1,1]+[1,1] | 2 | [1,1] | 1 |  ← 池子小,主动降
| layout5 (Arena) | [4,6]+[2,4] | 4 | [1,2] | 2 |

**Maze 特殊**:MeshNpc=2 + min=1 — 否则候选不够会 warn(见任务 C §4.1)。作者实测再调。

**diff 模板**(Islands):
```diff
   "outlets": {
-    "columnCount": [1, 1],
-    "wallCount": [1, 1],
+    "meshNpcCount": 3,
+    "meshGreenRandom": [1, 2],
+    "meshGreenMin": 2,
     "seed": null,
     "studyTableGreenRate": 0.05
   },
```

**注意**:Maze 我临时把 `meshGreenMin` 改为 1(spec §7 表写的是 2,但实测 Maze 候选 < 4 必被 warn + 调降,作者后续手动加柱/壁插候选更稳;先用 1 避免开局 warn 噪音)。

### 任务 C:`drawOutletSpots` + `randomizeOccupiedOutlets` 重构(核心,60-90min)

**`src/scene/loadLibraryScene.ts`**:

1. **删** `:230-249` 的 `drawCount(rng, LAYOUT.outlets.columnCount)` / `drawCount(rng, LAYOUT.outlets.wallCount)` 旧实现
2. **重写** `drawOutletSpots()`(`:233-249`)按 spec §4.1 公式:
   - `npcCount = LAYOUT.outlets.meshNpcCount ?? CONFIG.npc.count`
   - `randRange = LAYOUT.outlets.meshGreenRandom ?? CONFIG.charging.meshGreenRandom`
   - `rand = randInt(rng, randRange[0], randRange[1])`
   - `greenMin = LAYOUT.outlets.meshGreenMin ?? CONFIG.charging.meshGreenMin`
   - `greenTarget = max(greenMin, npcCount - rand)`
   - `need = npcCount + greenTarget`
   - `pool = shuffle([...layoutColumns(), ...wallCandidatesFromLayout()], rng)`
   - 若 `pool.length < need` → `console.warn` + `greenTarget = max(LAYOUT.outlets.meshGreenMin ?? CONFIG.charging.meshGreenMin, pool.length - npcCount)`(应保 npc 优先,green 兜底)
   - `drawn = pool.slice(0, min(need, pool.length))`
   - return `{ columns: drawn.filter(isColumn), walls: drawn.filter(isWall), seed, npcCount, greenTarget }`
3. **保** `:565-587` 柱电位/壁插 mesh 生成段(从 `outletDraw.columns / outletDraw.walls` 生成 `columnOutletMeshes` / `wallSocketMeshes`,face 规则同原)
4. **保** `:800-823` rebuild 时的同步顺序(柱 → 壁插 → 桌)
5. **重构** `randomizeOccupiedOutlets`(`:886-970`)按 spec §4.2:
   - 重置全绿(`:888-891`)不变
   - 桌桩分支(`:892-939`)完全不变
   - `meshBacked` 池(`:943-947`)不变,只是 size 现已 = `npcCount + greenTarget`
   - `targetCount = count ?? LAYOUT.outlets.meshNpcCount ?? CONFIG.npc.count`
   - `shuffle(meshBacked, rng).slice(0, targetCount)` 标红 + 摆坐猫(原 :957-964)
   - 剩下 `meshBacked[targetCount..]` 默认 `outletMatEmpty`(绿色)不动
6. **给 `outletPositions[i]` 加 `kind: 'mesh' | 'table'` 字段**:
   - 接口定义 `:251` `outlets: Array<{ x, z, occupied, occupiable, kind }>`
   - 柱 push(`:813`):`kind: 'mesh'`
   - 壁插 push(`:819`):`kind: 'mesh'`
   - 桌 outlet push(`buildOneStudyTable` 内):`kind: 'table'`(含 studyTable-charge)
   - 这字段仅供 SharedState 算 `freeMeshGreenCount`(任务 E)

### 任务 D:SharedState 加 `freeMeshGreenCount` + main.ts 接线(30min)

**SharedState**(`src/game/sharedState.ts` 或同名文件):加字段
```ts
freeMeshGreenCount: number;
```
**`src/main.ts`**:
1. `NpcSystem` 实体数(找 `npcCount` opts 行,预计 `:184`)改 `LAYOUT.outlets.meshNpcCount ?? CONFIG.npc.count`
2. game loop 每帧(或每 0.2s)算 `freeMeshGreenCount`:
```ts
const freeMeshGreenCount = outlets.reduce((acc, o) =>
  acc + (!o.occupied && o.kind === 'mesh' ? 1 : 0), 0);
```
3. 传给 `NpcSystem` 的 state(在 `npcCount` opts 附近):
```ts
{ freeMeshGreenCount }   // 新字段
```

### 任务 E:npc.ts 门控(30min)

**`src/game/npc.ts`**:

1. `NpcControllerOptions` 加 `freeMeshGreenCount?: number`(可选;缺省 Infinity,旧测试不破)
2. `update`(`:233-247`)的 `idle` 分支,在 `!goWander` 的 else 里加门控,按 spec §5.2:
```ts
} else {
  if ((opts.freeMeshGreenCount ?? Infinity) <= 1) {
    e.idleTimer = newIdleTimer();   // 拒绝 occupy,回 idle 等下一轮
  } else {
    const t = pickReachableOutlet(e);
    if (t >= 0) {
      e.state = 'moving';
    } else {
      e.idleTimer = newIdleTimer();
    }
  }
}
```
3. `pickReachableOutlet` / `pickNearestFreeOutlet` / `:278-285`(被抢桩重选)/ `:319/:341`(切红)**不动**

### 任务 F:layout-editor.html UI + 导出/导入(60min)

**`tools/layout-editor.html`**:
1. **HTML**:`:215-220` 删 `simColMin/Max/simWallMin/Max` 输入;加 `simMeshNpc`(NPC 数,默认 3)+ `simGreenMin/simGreenMax`(绿差随机,默认 1-2)+ 可选 `simGreenMinFloor`(绿下限,默认 2)
2. **JS 状态**:`:362` `sim` 对象改字段(删 columnMin/Max/wallMin/Max,加 meshNpc/greenMin/greenMax/greenMinFloor)
3. **`renderSim()`**(`:928-962`):按 spec §6.3 重写,公式 + pool + 红/绿 dot 可视化 + simInfo 文字
4. **`buildJson()`**(`:1202-1217`):outlets 段导出新 schema(见 spec §6.4)
5. **`stateFromJson()`**(`:1226-1247`):读新 schema;旧字段 `columnCount/wallCount` 若在 → 忽略 + console.warn("legacy schema, please reconfigure")
6. **`drawCount()` 函数**:可删可不删(仍被新 `randInt` 类似逻辑用 — 改用 `randInt(rng, min, max)` = `min + Math.floor(rng() * (max - min + 1))`,drawCount 没用就删)
7. **`bake-layout.mjs:59-61`**:默认 outlets 同步新 schema(同 spec §6.5)

### 任务 G:测试(30-45min)

1. **`src/scene/layoutData.test.ts`**:
   - 删 `:64-66` 对 columnCount/wallCount 的断言
   - 加循环校验 5 布局:`outlets.meshNpcCount` 整数 ≥ 0;`outlets.meshGreenRandom` [min, max] 合法;min ≤ max
2. **`src/game/npc.test.ts`** 加 2 条门控分支:
   - `freeMeshGreenCount = 1` + `idleTimer <= 0` → entity.state 仍 'idle'(不切 moving)
   - `freeMeshGreenCount = 2` + `idleTimer <= 0` + 有空桩 → 切 'moving'(原行为)
3. **`src/scene/loadLibraryScene` 行为测试**(若已有文件则改;若无则建一个 `loadLibraryScene.test.ts` 走 vitest,只测 `drawOutletSpots` 公式 — 可能需要 export 该函数。**或更轻**:测 5 布局文件加载后 `outletPositions.length ≥ meshNpcCount + meshGreenMin`,作为 unexport 函数的间接断言)。spec §8.3 提了具体期望。这步可选(David 时间够再做,若不做需在 PR 描述里说明)

### 任务 H:build + 自验(15min)

**你的责任是 spec §10.1 开发者侧自检**;§10.2 是用户手玩验收(David 完工后用户做 V1-V5,David 不必做)。

1. `npx tsc --noEmit` 干净
2. `npx vitest run` 全过(原 82 + 新门控 2-3 + schema 校验)
3. `npm run build` 绿(产物 ~650-680KB)
4. 无 `columnCount/wallCount` 在产线代码 / 5+1 布局 JSON 中残留(`grep -r columnCount src/scene/layout*.json src/scene/loadLibraryScene.ts tools/` 应无果,或只在 layout-editor.html 的 `stateFromJson` 兼容分支出现)
5. 编辑器手测(可选):`tools/layout-editor.html` open + load layout.json → 模拟器新 UI 显示 NPC/绿差输入 + simInfo 计算;save → JSON 含新 schema 无旧字段
6. MCP chrome 自验(可选,若 David 装了 chrome-devtools 工具):选 Islands 开局,MAP/RADAR/QUERY 至少扫到 ≥ 2 绿(轻量佐证即可,不要求做 V3 NPC 门控观察 — 那个留给用户手玩)

## PR

- 分支:`feat/mesh-outlet-green`(从 main 切)
- commit 风格:`feat(scene): 非自习桌绿桩公式化 + NPC 抢桩门控 — 池子大小由 meshNpcCount+greenTarget 推导` / `feat(editor): 布局编辑器适配新绿桩 schema` / `feat(layouts): 5 布局迁 outlets 新 schema` 等按你的 commit 节奏分
- push `git push -u origin feat/mesh-outlet-green`
- `gh pr create --title "feat: 非自习桌绿桩公式化 + NPC 门控 + 编辑器同步" --body "spec: spec/2026-08-15-mesh-outlet-green-design.md

开发者侧自检(spec §10.1)全绿。用户手玩验收(spec §10.2 V1-V5)待用户 review 时做。"` PR 描述引 spec 路径 + 说明验收分工
- 说 "READY FOR REVIEW" 停手,**不要 merge**(用户 merge);用户会在手玩 V1-V5 后决定

## 停止条件 / 报告模板

若你遇到:
- spec 里某段语义不明 / 冲突 → 停下来发个简短 impression 给用户(不要瞎猜)
- 3 次 build 失败 → 停 + 报告
- 5h hard stop → 把已完成项 push + PR draft + 报告剩余

## 你的回复给 Snake

完工后简短报告:
- 分支名 + PR URL
- tsc / vitest / build 状态(✓/✗ 数字)
- 5 布局文件改动确认(列每个文件的 meshNpcCount / meshGreenRandom / meshGreenMin 实际填值)
- 可选自验结论(tsc/vitest/build + 编辑器/MCP spot check)
- 提醒用户做 §10.2 V1-V5 手玩验收(用户验收不通过的处理路径见 spec §10.3)
- 任何 spec 与实现偏离的地方(及理由)

开始读 spec + 任务 A 吧。