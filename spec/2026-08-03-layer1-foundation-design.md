# Layer 1 Foundation — Design Spec

**Date**: 2026-08-03
**Status**: Approved (brainstorming complete, ready for implementation plan)
**PR target**: #6
**Branch**: `feat/layer1-foundation`

## 1. 目的

为后续并行独立 agent PR(手机 HUD UI、dash pip + 电池消耗)提供共享地基。地基不实现任何 gameplay 业务,只钉死接口、提供算法工具、留好 main.ts 装配位。无地基直接放独立 agent 进空白项目 = 接口分歧 + 重复实现 + 合并冲突。

## 2. 范围

### 包含

| 文件 | 作用 | 行级别人 |
|---|---|---|
| `src/game/gridModel.ts` | `Grid` 类型 + `toGrid(box3[], w, d, cellSize): Grid` 适配器 | ~80 |
| `src/game/pathfinding.ts` | A* `findPath(grid, start, goal): Cell[] \| null` 纯函数 | ~120 |
| `src/game/pathfinding.test.ts` | 4 case 单测(mock grid) | ~60 |
| `src/game/gridModel.test.ts` | 1 个 Box3 → cells 覆盖验证 | ~30 |
| `src/game/config.ts` | 全局数值单一数据源 | ~60 |
| `src/ui/minimap.ts` | 2D canvas 俯视 renderer(只读) | ~150 |
| `src/main.ts` mount 位 | `mountPhoneHud` / `mountPlayerStats` 空调用 + SharedState facade | ~30 |
| `src/ui/phoneHud.ts` | `mountPhoneHud` 空 stub(PR #9 替换实现) | ~10 |
| `src/game/playerStats.ts` | `mountPlayerStats` 空 stub(PR #10 替换实现) | ~10 |
| `src/platform/sharedState.ts` | `getSharedState()` facade + `collectOutlets()` | ~40 |
| `src/scene/loadLibraryScene.ts` 扩展 | `LibraryScene` 接口加 `outlets: Array<{x,z,occupied}>` 字段 | ~15 |
| `vitest` 装好 | dev dep + test 脚本 | — |
| `AGENTS.md` rule 11 | 并行独立 agent + worktree 规约 | ~15 |

### 不包含(留给 独立 agent PR)

- 手机 HUD UI 实现 → PR #9
- dash pip + 电池消耗实现 → PR #10
- NPC AI、新场景元素、新桌椅
- 地形编辑器(根本不做 —— 见 §10 决策记录)

## 3. 算法层(`src/game/`)

### 3.1 Grid 类型 — `src/game/gridModel.ts`

```ts
export interface Cell { x: number; z: number; }  // 整数坐标
export interface Grid {
  cells: Uint8Array;   // 0=walkable, 1=blocked; flat 一维 index = z*w + x
  w: number;           // x 方向 cell 数
  d: number;           // z 方向 cell 数
  cellSize: number;    // 米/cell
}
export function toGrid(
  colliders: THREE.Box3[],     // 静态 + 桌区合并
  worldW: number, worldD: number,
  cellSize: number,
): Grid
```

**设计决策:**
- `cellSize = 0.4m` → 32×24m 地图 = 80×60 = 4800 cells。玩家直径 0.64m 占 1.6 cell,留余量不卡缝
- `Uint8Array` flat 一维 + `index = z*w + x` 算术:微信移植友好(无嵌套数组),内存紧凑(4.8KB)
- 0/1 单值:后续要加"cost 地形"再升 `Uint16Array`,jam 期不需要
- `toGrid` 遍历 Box3,对每个 cell 中心点测试是否落在任一 Box3 内 → 落入则 `cells[idx]=1`。时间复杂度 O(cells × colliders),4800×~100 = 48 万次,构建一次 <10ms,可接受
- 不缓存:`toGrid` 每次 rebuild 调一次即可。若性能有问题再上 `DirtyFlag`

### 3.2 A* 寻路 — `src/game/pathfinding.ts`

```ts
export function findPath(
  grid: Grid,
  start: Cell,
  goal: Cell,
): Cell[] | null
```

**算法约束:**
- 4-connected(不加对角)→ 路径"走廊感"更像图书馆,且 NPC 不会斜切墙角
- Manhattan heuristic:`h = |gx-sx| + |gz-sz|`
- 二叉堆优先队列自写 ~40 行,不引依赖(微信友好)
- 返回 cell 数组(含 start,不含 goal 反向 —— 调用侧自己处理);不可达返回 `null`
- start === goal 返回 `[start]`
- 边界:`start`/`goal` 越界或 blocked → 返回 `null`

**单测 4 case — `src/game/pathfinding.test.ts`:**

1. **直走**:5×5 全空,(0,0)→(4,0),期望 path 长 5,无绕弯
2. **绕障 L 形**:5×5 中 (1,0)-(1,3) 一列 blocked,(0,0)→(4,0),期望必须绕到 z≥4
3. **不可达**:5×5 中 (1,0)-(1,4) 整列 blocked,(0,*)→(4,*),期望 null
4. **同格**:start===goal,期望 `[start]`

## 4. UI 层(`src/ui/minimap.ts`)

### 4.1 渲染目标

- 独立 `<canvas>` 元素,CSS 定位左下角,180×136 px(比例 32:24 → 180:135,微调成 180:136)
- scale = 180/32 ≈ 5.625 px/m
- 30 FPS 节流(每 2 帧画一次,主 loop 60FPS 时)

### 4.2 数据源

通过 Layer 1 facade `getSharedState()` 拿 `SharedState`(见 §6),minimap 自身不直接访问 Three.js scene。

**实时性(硬约束,不是写死)**:minimap 每次渲染都从 `getSharedState()` 现读当前帧的 `player.x/z/yaw`、`outlets`、`npcs`、`path` —— **禁止任何形式的预渲染 / 启动时快照 / 静态截图**。玩家移动 → 橙点必须立即跟随;朝向变 → 朝向线必须立即转;NPC 走动 / outlet 占用状态变 → 必须立即反映。30 FPS 节流是性能取舍,不是"可以不实时"的借口。验收 §11-C 的"WASD 移动 → 橙点实时跟随"是硬门槛,不通过 = Layer 1 不合格。

### 4.3 渲染元素(只读 Layer 1)

| 元素 | 颜色 | 形状 |
|---|---|---|
| 地板 | `#e8e4d8` 浅灰米 | 矩形填整 canvas |
| 碰撞盒 | `#5a5a52` 深灰 | 矩形(按 Box3 投影) |
| 电位 | `#2dff7a` 绿 | 3px 方块(emissive 色一致) |
| 玩家 | `#e8913a` 橙 | 5px 圆点 + 朝向线 8px |
| (将来)NPC | `#8a8a8a` 灰 | 3px 圆点 |
| (将来)path | `#ffe066` 黄 | polyline |

"将来"项 = 接口已留,Layer 1 不画(数据为空)。独立 agent PR #9/#11 填实数据后自动出现。

### 4.4 不做的事(Layer 1 边界)

- 不做交互(点击/缩放/平移)→ PR #9 phone map app 包一层做
- 不做 path overlay → path 数据来自 PR #10 dash 系统不来自 minimap
- 不做 NPC 点 → PR #11 NPC AI 接入后自动显示
- 不做 raycast / 拖动 / 编辑

## 5. `src/game/config.ts` 单一数据源

```ts
export const CONFIG = {
  player: {
    walkSpeed: 3.0,
    sprintSpeed: 5.6,
    radius: 0.32,
    turnLerp: 14,
  },
  camera: {
    fov: 70,
    near: 0.05,
    far: 80,
    dist: 2.7,
    side: 0.35,
    up: 1.35,
    pitchMin: -0.12,
    pitchMax: 0.4,
    mouseSens: 0.0023,
  },
  dash: {
    pipCount: 3,           // PR #10 填实
    pipCost: 1,            // 一次冲刺耗几颗
    durationS: 0.6,
    cooldownS: 1.5,
  },
  battery: {
    startPercent: 1.0,     // PR #10 填实
    drainMove: 0.5,        // %/s 走动
    drainSprint: 2.0,      // %/s 冲刺
    drainApp: 1.0,         // %/s 开 app
    drainIdle: 0.2,        // %/s 站着
    totalGameTimeS: 180,
  },
  npc: {
    count: 3,              // PR #11 填
  },
} as const;
```

**Layer 1 只填 `player` + `camera`(从 controller 常量搬过来)。`dash` + `battery` + `npc` 列 schema 值占位,独立 agent PR #10/#11 填实。**

`thirdPersonController.ts` 改为 `import { CONFIG } from '../game/config'` 用 `CONFIG.player.*` / `CONFIG.camera.*`。debug overlay 的 bounds 同样从 config 拿(或 Layer 1 加 `CONFIG.world: { w, d }`)。

## 6. main.ts mount 位 + SharedState 接口(反冲突核心)

### 6.1 mount 位

```ts
// Layer 1 后 main.ts 末尾:
mountPhoneHud({ getSharedState, onAppAction });   // PR #9 独立 agent 填实
mountPlayerStats({ getSharedState });              // PR #10 独立 agent 填实
```

Layer 1 提供两个空 stub 函数(分别在 `src/ui/phoneHud.ts` 和 `src/game/playerStats.ts`,签名 `export function mountPhoneHud(opts) { /* PR#7 替换 */ }`),独立 agent 只替换所在文件实现。main.ts 调用点不动 —— 这是反冲突的关键:独立 agent 不改 main.ts。

### 6.2 SharedState 接口(钉死,独立 agent 只消费不发明)

```ts
export interface SharedState {
  player: { x: number; z: number; yaw: number };
  battery: number;       // 0-1,PR #10 填
  pips: number;          // 0-3,PR #10 填
  outlets: Array<{ x: number; z: number; occupied: boolean }>;
  npcs: Array<{ x: number; z: number; state: string }>;  // PR #11 填
  path?: Array<{ x: number; z: number }>;                // phone map app 用
}

export type AppAction =
  | { kind: 'query-outlets' }
  | { kind: 'toggle-map' }
  | { kind: 'close' };
```

### 6.3 facade 实现(Layer 1 stub)

```ts
// src/platform/sharedState.ts
export function createSharedStateFacade(
  player: THREE.Group,
  controller: ThirdPersonController,
  outlets: Array<{ x: number; z: number }>,
): { getSharedState: () => SharedState } {
  return {
    getSharedState: () => ({
      player: { x: player.position.x, z: player.position.z, yaw: controller.getYaw() },
      battery: 1.0,        // stub, PR #10 填
      pips: 3,             // stub
      outlets: outlets.map(o => ({ ...o, occupied: false })),  // PR #11 真实化
      npcs: [],            // stub, PR #11 填
      path: undefined,
    }),
  };
}
```

`outlets` 从 `loadLibraryScene.ts` 收集 —— Layer 1 扩展 `LibraryScene` 接口加 `outlets: Array<{x, z}>` 字段,createLibraryScene 返回时填入所有电位位置(柱电位 + 端板电位盒 + 4 人桌电位 + 壁插)。`controller.getYaw()` 需在 `ThirdPersonController` 接口加 getter。

## 7. vitest 装配

- `npm i -D vitest`
- `package.json` scripts 加 `"test": "vitest run"`、`"test:watch": "vitest"`
- `vite.config.ts` 不动(vitest 默认 mode 即可)
- 单测文件 `*.test.ts` 与源同目录(`src/game/pathfinding.test.ts`)
- CI 不接,jam 期本地跑

## 8. AGENTS.md rule 11(并行独立 agent + worktree)

**"独立 agent" 定义**:用户自己开的独立 opencode 会话,不是主 agent(本会话)dispatch 的 subagent。两独立 agent 各占一个 worktree、各自一个 opencode 会话窗口、各自一个 feature 分支,并行干活。主 agent(本会话)负责 Layer 1 地基 + review 两 PR + 协调冲突,不执行 PR #9/#10 实现。

```markdown
11. **并行独立 agent 工作流(地基后启用)**:
    - 主 agent 完成 Layer 1 (config + SharedState interface + mount points) 后才可并行
    - 用户在两个独立 opencode 会话里各自开 worktree:
      `git worktree add ../gamejam-2026-<branch> feat/<x>` 隔离工作目录
      (两 worktree 共享同一 .git,各自 checkout 各自分支,互不干扰)
    - 文件边界:
      - UI 独立 agent 只改 `src/ui/` + 替换 `src/ui/phoneHud.ts` 的 mountPhoneHud 实现
      - Game 独立 agent 只改 `src/game/` + `src/player/` + 替换 `src/game/playerStats.ts` 的 mountPlayerStats 实现
      - 两独立 agent 都不改 `src/main.ts` 的调用点(Layer 1 钉死)
    - 共享接口 = Layer 1 钉死的 TS interface,独立 agent 只 implements 不 invent
    - 两 PR 都开 → 主 agent(本会话)review → 用户 merge 先开的 → 后开的 rebase 到新 main
```

## 9. PR 排序

```
PR #8  Layer 1 (主 agent, 6-8h)              ← 本 spec
  ↓ merge
PR #9  手机 HUD + 地图 app (独立 agent A, worktree #1)  4-6h
PR #10  dash pip + 电池消耗 (独立 agent B, worktree #2)  6-8h  ← 用户的"丙"
  ↓ 两 PR 都开
主 agent(本会话)审 → 用户 merge #7 → #8 rebase → merge #8
  ↓
PR #11  NPC AI (consume pathfinding)  ~4h
PR #12 polish + itch 上传
```

## 10. 决策记录

### 10.1 不做地形编辑器

**背景**:用户提"做编辑器可视化摆物体"。讨论后明确:jam 期 5-10h 投入 ROI 低于"用户纸笔画第一版布局 → AI coding → 后续微调走游戏循环"。编辑器赛后多场景化再考虑。

**替代方案**:
- 第一版布局:用户在纸上 / Excalidraw 画平面图 → 给 AI 一个锚点维度(如"整馆 30m 宽")→ AI 按比例 + 常识补全所有米数 → coding
- 微调:用户看 localhost:5173 真实游戏 → 说"过道加宽、自习区靠东" → AI 改常量 → Vite HMR 自动刷 → 用户再看。一轮 30 秒
- 数值参数调优:PR #5 已装的 lil-gui slider 实时拖

### 10.2 pathfinding 不依赖地形编辑器

A* 是纯函数 `(grid, start, goal) → path`,在 mock grid 上可单测全绿。"接通真实地形"是 `toGrid(box3[], ...)` 适配器的事,与算法正交。Layer 1 两者都做,但分别可独立验证。

### 10.3 SharedState facade 是反冲突核心

两独立 agent 同时改 main.ts = 必冲突。Layer 1 钉死 `mountPhoneHud(opts)` / `mountPlayerStats(opts)` 两个调用点 + `SharedState` TS interface,独立 agent 只替换 stub 实现不改调用点。文件边界 + 接口契约双保险。

### 10.4 Grid 用 Uint8Array flat 一维

不嵌套数组、不引 immutable lib、不 Map。微信移植最稳;4800 cells = 4.8KB 内存可忽略;`index = z*w + x` 算术比 `cells[z][x]` 快且无 GC 压力。

## 11. 验收标准

### A. 构建与类型（命令行可验）

- [ ] `npm run build` 绿(tsc + vite，零 TS 错，零 vite error)
- [ ] `npm test` 绿(vitest：pathfinding 4 case + gridModel 1 case = 5 个全 pass)
- [ ] `npm run dev` 起得来，无控制台红错（GLB 404 warn 不算——目前 Meshy 还没落盘）
- [ ] `git diff main --stat` 不含 `vitest` / `@vitest` 进 `dependencies`（必须在 `devDependencies`）
- [ ] prod bundle 体积 ≤ 现状 +5KB（minimap renderer 不引重依赖，lil-gui 已 gate 不入 prod；用 `npm run build && du -h dist/assets/*.js` 对比）

### B. 算法层（`src/game/`，单测验证）

- [ ] `npm test` 5 个 case 名可读，输出形如：
  ```
  ✓ pathfinding: straight line 5x5 empty grid
  ✓ pathfinding: L-shape obstacle detour
  ✓ pathfinding: unreachable returns null
  ✓ pathfinding: start===goal returns [start]
  ✓ gridModel: single Box3 covers correct cells
  ```
- [ ] `pathfinding.ts` 不 import `three` / 不访问 `window` / `document`（架构纪律 rule 1，用 `grep -E "import.*three|window|document" src/game/pathfinding.ts` 应无输出）
- [ ] `gridModel.ts` 只 import `three` 的 `Box3`/`Vector3` 类型（适配器层例外，但不得 import `Scene`/`Mesh` 等渲染对象）

### C. Minimap 可视化（浏览器肉眼验）

- [ ] `http://localhost:5173` 右下角（或左下角，spec §4.1 定的左下）出现 180×136px canvas，浅灰米底色
- [ ] canvas 上可见深灰矩形群 = 碰撞盒投影（书架列、柱网、桌椅排）
- [ ] canvas 上可见 3 个绿色方块 = 电位标记（柱电位 + 端板盒 + 桌电位，与 3D 场景里 emissive 绿点位置一致）
- [ ] canvas 上可见橙色圆点 = 玩家，带一条 8px 朝向线
- [ ] **WASD 移动 → 橙点实时跟随**（30 FPS 节流，不强求 60）
- [ ] **鼠标转视角 → 朝向线同步转**
- [ ] 按 F 切 collider helper 时，minimap 不受影响（两套独立渲染）
- [ ] minimap 无交互（点击/拖动不响应）—— Layer 1 边界，交互留给 PR #9

### D. config.ts 单一数据源（代码 + 行为双验）

- [ ] `src/player/thirdPersonController.ts` 顶部 `WALK_SPEED` / `SPRINT_SPEED` / `PLAYER_RADIUS` / `TURN_LERP` / `CAM_*` / `MOUSE_SENS` / `PITCH_*` 等常量全删
- [ ] 该文件改 `import { CONFIG } from '../game/config'`，用 `CONFIG.player.walkSpeed` 等
- [ ] **行为零回归**：dev 下走/跑/转视角/碰撞/相机防穿 手感与 PR #5 merge 时一致（你上次玩过的 v6 状态）
- [ ] `grep -n "WALK_SPEED\|SPRINT_SPEED\|CAM_DIST" src/player/thirdPersonController.ts` 应无输出
- [ ] `CONFIG.dash` / `CONFIG.battery` / `CONFIG.npc` 字段存在但值为占位（PR #10/#11 填实）—— `grep -A3 "dash:" src/game/config.ts` 能看到 schema

### E. SharedState facade + mount 位（调试器验）

- [ ] `src/main.ts` 末尾有 `mountPhoneHud({...})` 和 `mountPlayerStats({...})` 两个调用
- [ ] 两调用分别指向 `src/ui/phoneHud.ts` 和 `src/game/playerStats.ts` 的 stub 函数
- [ ] stub 函数体为空或仅 `console.log('[stub] mountPhoneHud called')`，dev 下控制台能看到 stub 被调用一次
- [ ] `getSharedState()` 在控制台可手动调（暴露到 `window.__debug.getSharedState()` 或 dev console eval）—— 返回对象含 `player.x/z/yaw` 真实值、`outlets` 数组非空（电位数 ≥ 当前场景电位总数）、`battery: 1.0`、`pips: 3`、`npcs: []`、`path: undefined`
- [ ] `LibraryScene` 接口扩展 `outlets: Array<{x, z}>` 字段—— `createLibraryScene()` 返回值含此字段，长度 = 柱电位数 + 端板盒数 + 桌电位数(20×2) + 壁插数(3)

### F. AGENTS.md + 文档

- [ ] `AGENTS.md` 新增 rule 11，标题 `## 硬性规则` 下编号 11
- [ ] rule 11 含：独立 agent 定义、worktree 命令、文件边界、接口契约、PR 合并顺序
- [ ] rule 7 的 commit 作者身份改为当前 agent 名（每个 agent 独立命名；主 agent 现名 `Snake`）

### G. Git / 流程

- [ ] 分支 `feat/layer1-foundation`，从 `main`（PR #7 spec 修订 merge 后）切出
- [ ] commit 作者 `Snake <snake@agent.local>`（`git log --format='%an %ae' -5` 全是 Snake；其他独立 agent 各用自己的命名）
- [ ] commit 信息英文，格式 `type: summary`
- [ ] PR 标题 `feat(layer1): foundation for parallel agents — grid/pathfinding/config/minimap`
- [ ] PR body 含 spec 链接 + 验收 checklist 勾选截图/输出
- [ ] push 前 `gh pr view 8 --json state` 确认 PR #8 仍 OPEN（本 PR 自身）

### H. 不应出现（反向验收）

- [ ] 无新场景元素（桌/椅/猫/墙/灯 不增不减不改）
- [ ] 无 dash / 电池 / NPC 业务代码（schema 占位不算）
- [ ] 无 lil-gui 新增控件（debug overlay 维持 PR #5 状态）
- [ ] `src/main.ts` 调用点之外无文件改动 `mountPhoneHud` / `mountPlayerStats` 签名
- [ ] 无 `docs/` 目录（spec 统一进 `spec/`）

## 12. 不在本 spec

- 手机 HUD 视觉设计(GTA5 phone 样式、2 app 布局)→ PR #9 spec
- dash pip 状态机 + 电池消耗公式 → PR #10 spec
- NPC AI 状态机 → PR #11 spec
- 场景尺度 backlog(rule 10)的 10x 扩张 → 独立 PR
