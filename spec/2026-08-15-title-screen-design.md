# Title Screen + Level Select — Spec(2026-08-15)

> 设计已 brainstorming'approve(对话定稿)。本 spec 作实施依据 + 自审。
>
> Branch `feat/title-screen`。单 PR。

## 0. 决策记录(定稿,不再讨论)

- **结构**:两阶段 CSS(DOM 叠加) — Stage 1 标题 → Stage 2 选关
- **背景**:纯色黑/深棕 CSS(不跑 3D,加载快)
- **游戏名/title**:`CHARGE`
- **游戏内英文**:全部玩家可见文字英文(itch 前必备)
- **回标题**:game over/win retry 屏加 "Menu" 按钮 → 清 localStorage + reload
- **布局数据**:快照式 — 4 个布局(Open Lobby / Compact Study / Maze / Arena)进 repo `src/scene/layouts/layout{1,2,3,5}.json`;Islands(默认 index 4)= 现有 `src/scene/layout.json`(编辑器继续维护)
- **运行时切布局**:选完触发全页 `location.reload()`(jam 期最简,避免场景 teardown 重构)

## 1. UX 细节

### Stage 1 — Title
- 全屏黑底 `rgba(15,12,9,0.95)` CSS,中央 flex column
- 大字 `CHARGE`(字号 ~8vw / 粗体 / 间距宽 / 颜色 `#ffe9c4`)
- 副标:`Survive the blackout. Find a charge.`(`rgba(255,233,196,0.7)`)
- 操作提示(副标下,小字):
  `WASD move (A/D turn) · Shift dash · 1/2/3 apps · E plug in`
- 主按钮 `Start Game` → 切 Stage 2

### Stage 2 — Level Select
- 后退不显标题(Stage 2 内层叠加,有 Back 链回 Stage 1)
- 标题 `Select Level`
- 垂直按钮表(6 个):
  | 按钮 | 子名 | 状态 |
  |---|---|---|
  | Random | 5 pick 1 at random | — |
  | Open Lobby | 7 tables | layout1 |
  | Compact Study | 19 tables | layout2 |
  | Maze | 7 tables | layout3 |
  | Islands | 17 tables · default | layout.json (index 4) |
  | Arena | 9 tables | layout5 |
- Buttons 击中态:悬停 亮 + 边框白
- `← Back` 底部,回 Stage 1
- 默认选中(高亮):Islands(初次进入)

### 重载后流程
1. 模块加载 → `loadLibraryScene.ts` 调 `readLevelIndex()` → 选对应 `LAYOUT`
2. `main.ts` 顶部调 `mountTitleScreen({ onStart: mountStartOverlay })` 检测 localStorage:
   - 无 `titleLevelIndex` → 显示 Title(Stage 1 + Stage 2)
   - 有 → 跳过 Title,直接出"点击开始"overlay(音 gesture)
3. 玩家点 Stage 2 任一按钮 → 写 `localStorage.titleLevelIndex = N` → `location.reload()`

### 局内
- restart = 同布局不变
- game over / win retry 屏:`Retry`(重开同布局)+ `Menu`(清 localStorage + reload)两个按钮

## 2. 实施改动

### 2.1 `src/scene/layouts/layout{1,2,3,5}.json`(新建,已拷自 /var/folders PR #24 临时目录)
4 个布局 JSON,Sam 在 PR #24 验过有解。

### 2.2 `src/scene/loadLibraryScene.ts`(~10 行)
- 新增 `src/scene/layouts/layout1.json` 等 4 个 import
- 新增 `readLevelIndex(): number` 读 `localStorage.titleLevelIndex`(解析 1-5,默认 4;非法 → 4)
- 改:`const LAYOUT: LayoutData = layout`(行 89)→ 选 index 对应的布局
- 编辑器路径不动(仍改 `layout.json`,Islands 时生效)

### 2.3 `src/ui/titleScreen.ts`(新建 ~120 行)
- export `mountTitleScreen({ onStartClick }): void`
- 一份 CSS string + 两阶段 DOM
- Stage 1 → Start Game click → 隐藏 Stage 1 + 显 Stage 2
- Stage 2 按钮表 click → `localStorage.setItem('titleLevelIndex', N)` + `location.reload()`
- Back click → 回 Stage 1
- `hasSelectedBefore()` helper:main.ts 不调 mountTitle 如果 localStorage 已设

### 2.4 `src/main.ts`(~改动 3 处)
- import `mountTitleScreen` + `hasSelectedBefore`
- 替换现 overlay(行 37-60)为:
  - 若 `!hasSelectedBefore()`:调 `mountTitleScreen({ onStartClick: showStartOverlay })`(Title)
  - 否则:`showStartOverlay()`(原 overlay 逻辑,英文)
- `showStartOverlay()` 仍走现有 click → BGM gesture;不变 gameStarted 标志

### 2.5 英文化(~15 处玩家可见字符串)
| 文件 | 位置 | 旧 (中) | 新 (英) |
|---|---|---|---|
| `config.ts` | objectiveText | 电量耗尽之前找到充电位置 | Find a charging point before the battery dies |
| `gtaPrompt.ts:136` | charge prompt | 按 [E] 充电 | Press [E] to charge |
| `main.ts:38` | overlay 文字 | WASD 移动(AD 转向)· Shift 冲刺 · 1/2/3 切 app · E 插枪 | WASD move (A/D turn) · Shift dash · 1/2/3 apps · E plug in |
| `phoneHud.ts:530/532` | MAP header | ← 返回 (1) / 耗电 ×2 | ← Back (1) / Power ×2 |
| `phoneHud.ts:538/540` | RADAR header | ← 返回 (2) / 耗电 ×3 | ← Back (2) / Power ×3 |
| `phoneHud.ts:546/548` | QUERY header | ← 返回 (3) / 耗电 ×4 | ← Back (3) / Power ×4 |
| `phoneHud.ts:554` | gameOver | 没电了 / 手机黑屏,你被困在图书馆 / 再来一局 | No Power / Your phone died. Trapped in the library. / Retry |
| `phoneHud.ts:555` | win | 充上电了! / 你活了下来 / 再来一局 | Charged! / You survived. / Retry |
| `phoneHud.ts:598/610/659` | home/onboarding | 等待安装 / 等待 / 正在安装 / 已安装 | Pending Install / Pending / Installing / Installed |

### 2.6 `phoneHud.ts` retry 屏加 "Menu" 按钮
- gameOver / win 弹窗内补 `<button class="phone-menu-btn">Menu</button>`
- click handler: `localStorage.removeItem('titleLevelIndex'); location.reload()`
- CSS: retry 按钮下方小字小按钮(不抢 `Retry` 风头)

### 2.7 `src/scene/layoutData.test.ts` 扩展
- 改成循环 import 5 个布局 JSON 各跑原 6 项校验(用动态 `import.meta.glob` 或 5 个 static import + `describe.each`)
- 默认测 `layout.json`(Islands)= 兼容旧 case
- 测试目的:验证 4 个 snapshot 至少格式正确 + 环境/桌数合法(出生 3m / 桩数 / body kind 等);不重做 PR #24 的复杂 BFS — 那是给将来 procedural 用的,jam 期快照只验"结构合法"

## 3. 风险/边界

- **HMR 不破坏**:标题选关后 reload 一次性;编辑器改 `layout.json` 仍 HMR 秒级(Islands 唯一动态)
- **编辑器 + 4 snapshots 二路并存**:布局 1/2/3/5 要改必须手改文件(+ commit);Islands 改走编辑器。jam 期接受
- **localStorage 清/私隐**:无 → 默认 4(Islands)→ 显 Title;Manifest 试玩会显 Title,OK
- **音频**:reuse 现有 `mountAudio.startBGM()` 在 startOverlay click 后启动(满足 gesture policy);Title 屏不播音
- **reload 闪烁**:~200ms 黑屏 reload;可加 CSS 过渡但 jam 期不优化
- **不在本 PR**:标题动效 / 设置菜单 / 存档 / 标题音 / 多周目解锁 / 布局预览缩略图

## 4. 验证清单

- [ ] `npm run build`(tsc + vite)绿
- [ ] `npm run test` 全绿(含 layoutData.test 循环 5 布局)
- [ ] MCP chrome 5173 自验:
  - [ ] 首次打开 → Stage 1 出现,CHARGE 标题可见
  - [ ] Start Game → Stage 2 出现,6 个按钮可见,Islands 默认高亮
  - [ ] 点 Open Lobby → 重载 → 进游戏,布局 = Lobby(桌 7)
  - [ ] retry 屏显 Retry + Menu
  - [ ] 点 Menu → 重载 → 回 Stage 1 Title
  - [ ] console 无 error,无中文字符串(in-game 文案)
- [ ] 5 个布局各 reload 一遍均能进游戏(快速 smoke)

## 5. 估时

~3-4h。单 PR。