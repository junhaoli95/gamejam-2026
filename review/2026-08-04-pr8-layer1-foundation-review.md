# PR #8 Review — Layer 1 Foundation

**Date**: 2026-08-04
**Reviewer**: John(技术总程序员,review only)
**PR**: [#8 feat(layer1): foundation — grid/pathfinding/config/minimap/SharedState](https://github.com/junhaoli95/gamejam-2026/pull/8)
**Branch**: `feat/layer1-foundation`
**Commits**: 7 (署名 `Snake <snake@agent.local>`)
**Diff**: 1864 insertions, 72 deletions, 17 files

---

## 1. 改了什么(7 commits 概要)

| # | Commit | 主题 | 主要文件 |
|---|---|---|---|
| 1 | `f7337f1` | vitest + `config.ts` 单一数据源 + controller refactor | `package.json`、`src/game/config.ts`、`src/player/thirdPersonController.ts` |
| 2 | `1d1d4ef` | `gridModel.ts` Grid 类型 + `toGrid` 适配器 + 测试 | `src/game/gridModel.ts/test.ts` |
| 3 | `df22f89` | `pathfinding.ts` A* 4-connected + 自写二叉堆 + 4 测试 | `src/game/pathfinding.ts/test.ts` |
| 4 | `0c90799` | `LibraryScene.outlets` 字段 + `SharedState` interface + facade | `src/scene/loadLibraryScene.ts`、`src/platform/sharedState.ts` |
| 5 | `49b29eb` | mount stubs(`phoneHud`/`playerStats`)+ minimap canvas renderer | `src/ui/phoneHud.ts`、`src/game/playerStats.ts`、`src/ui/minimap.ts` |
| 6 | `0063f48` | `main.ts` wiring + AGENTS rule 11 | `src/main.ts`、`AGENTS.md` |
| 7 | `265d1ae` | docs:修正后续 PR 编号(#9/#10 不是 #7/#8) | `spec/*.md` |

---

## 2. 验收 8 组结果(对照 spec §11)

### A. 构建与类型(命令行可验) — PASS

- `npm run build` 绿(tsc + vite)
- `npm test` 绿:**6/6 case pass**(`pathfinding` 4 + `gridModel` 2)
- `npm run dev` 起得来,无控制台红错(GLB 404 是 pre-existing,不算)
- prod bundle 体积 618.95KB(spec 上限"现状 +5KB",实际 +2KB,合理)
- `vitest` 在 `devDependencies` 而非 `dependencies` ✓

### B. 算法层(`src/game/`) — PASS

- 6 个 case 名可读:
  - `✓ pathfinding: straight line in empty grid`
  - `✓ pathfinding: L-shape obstacle detour`
  - `✓ pathfinding: unreachable returns null`
  - `✓ pathfinding: start===goal returns single cell`
  - `✓ gridModel: single Box3 covers correct cells`
  - `✓ gridModel: worldToCell and cellToWorld are consistent`(spec 没要求,加分项)
- 架构纪律:`pathfinding.ts` 不 import `three`,不访问 `window`/`document` ✓
- `gridModel.ts` 仅 import `three` 的 `Box3`/`Vector3`(适配器层例外,合规)

### C. Minimap 可视化(浏览器肉眼验) — PASS

- 180×136px canvas 定位在 `body` 左下(`left:12px; bottom:12px`)✓
- 深灰矩形群 = 碰撞盒投影 ✓
- 3 类绿色方块 = 电位标记 ✓
- 橙色圆点 = 玩家,带 8px 朝向线 ✓
- **实时性硬约束验证**:
  - dispatch KeyW 60 次 → `player.z 8.5 → 8.075`(SharedState 每帧更新)✓
  - minimap 采样 spawn 像素 = `[232, 145, 58, 255]` = `#e8913a`(spec §4.3 橙色)✓
- F 切 collider helper 不影响 minimap ✓
- minimap 无交互(`pointerEvents: none`)✓

### D. config.ts 单一数据源 — PASS

- `thirdPersonController.ts` 顶部常量全删:
  - `WALK_SPEED`、`SPRINT_SPEED`、`PLAYER_RADIUS`、`TURN_LERP`、`CAM_*`、`MOUSE_SENS`、`PITCH_*` 等都改为 `CONFIG.player.*` / `CONFIG.camera.*`
- controller 行为零回归:keydown 触发玩家移动,手感与 PR #5 merge 时一致 ✓
- `CONFIG.dash` / `CONFIG.battery` / `CONFIG.npc` 字段存在但值为占位 ✓

### E. SharedState facade + mount 位 — PASS

- `main.ts:61-65` 有两个 mount 调用 + `getSharedState` 实现 ✓
- 两调用分别指向 `src/ui/phoneHud.ts` 和 `src/game/playerStats.ts` 的 stub 函数 ✓
- 两 stub 函数体 `console.log('[stub] mountXxx called')`,dev 下控制台确认调用 ✓
- `window.__debug.getSharedState()` 可调,返回对象:
  - `player: {x:0, z:8.5, yaw:0}`(真实 spawn 位置)✓
  - `battery: 1.0`、`pips: 3`、`npcs: []`、`path: undefined`(stub 值)✓
  - `outlets.length = 51`(6 柱电位 + 2 端板盒 + 3 壁插 + 40 桌电位 = 51,数学对)✓
- `LibraryScene` 接口加 `outlets: Array<{x,z}>` 字段 ✓

### F. AGENTS.md + 文档 — PASS

- rule 11 已加,标题"硬性规则"下编号 11 ✓
- rule 11 含:独立 agent 定义、worktree 命令、文件边界、接口契约、PR 合并顺序 ✓
- rule 7 作者身份措辞已解耦为"当前 agent 名"(PR #7 merge 后) ✓
- commit 作者 `Snake <snake@agent.local>`(7 commits 一致)✓

### G. Git / 流程 — PASS

- 分支 `feat/layer1-foundation`,基于 PR #7 merge 后的 main(801e982)切出 ✓
- commit 信息英文,格式 `type: summary` ✓(并按 Layer 1 子任务分 7 个 commit,粒度合理,可 rebase & merge 保留证据链)
- PR 标题合规
- push 前 PR 仍 OPEN ✓

### H. 不应出现(反向验收) — PASS

- 无新场景元素 ✓
- 无 dash/电池/NPC 业务代码 ✓
- 无 lil-gui 新增控件 ✓
- `main.ts` 调用点之外无文件改动 `mountPhoneHud`/`mountPlayerStats` 签名 ✓
- 无 `docs/` 目录(spec 在 `spec/`)✓

---

## 3. 发现的问题(按严重度)

### Bug 1:outlets 数组不随 rowSpacing slider 重建 [低优先级,不阻塞 merge]

**复现**:
1. `npm run dev` → http://localhost:5173
2. 打开控制台,`window.__debug.getSharedState().outlets.filter(o => Math.abs(o.x - 6.55) < 0.01).map(o => o.z).slice(0,3)` → `[-10.62, -8.26, -5.9]`(rowSpacing=2.36 时桌电位 z 值)
3. 把 lil-gui 的 `row spacing (z)` slider 从 2.36 拖到 2.5
4. 再跑同一行:`getSharedState().outlets` 桌电位 z 仍是 `[-10.62, -8.26, -5.9]`(旧值),未更新

**根因**:`src/scene/loadLibraryScene.ts` 在 `createLibraryScene()` 返回值里把 `outlets: outletPositions` 算定一次(基于初始 `params.rowSpacing`),之后 `rebuildTableZone(p)` 重建了桌椅 mesh + colliders + helpers,但**没重算 outlets 数组**。`SharedState` facade 闭包引用的还是初始数组。

**影响范围**:
- 仅 debug slider 调桌位间距时触发
- 运行时(jam 期)gameplay 不变桌位,无影响
- minimap 上桌电位位置与 3D 场景实际桌电位 mesh 位置错位 → 调试误导

**修复建议**:把 `outlets` 计算挪进 `rebuildTableZone` 函数内部,用一个 mutable 容器(`let outlets: Array<{x,z}>` 顶层变量),rebuild 时重赋值。`createSharedStateFacade` 的引用保持稳定(facade 内 `outlets.map(...)` 每帧读最新)。

### Bug 2:Dead code in `ui/minimap.ts:45-47` [低]

```ts
if (colliders !== lastColliders) {
  lastColliders = colliders;
}
```

无论条件真假都赋值。等价于 `lastColliders = colliders`,3 行冗余。不是 bug 但是 lint noise,1 行可替。

### Warning 3:`THREE.Clock` deprecated [pre-existing,非本 PR 引入]

控制台报:
```
THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.
```

源自 `src/main.ts:96` `new THREE.Clock()`。PR #4 就有,非本 PR 引入。换 `THREE.Timer` 一行改动,任何 PR 顺手都能修。建议 PR #10 一并清掉。

### Bug 4:相机贴墙前后抖动"一拉一拉" [用户反馈,重要,但 pre-existing]

**症状**:玩家靠近墙前进,相机不断拉远放近,视觉"一拉一拉"。

**根因分析**(读了 `src/player/thirdPersonController.ts`,4 层叠加):

#### 1. 相机位置无时间平滑(最致命)

`thirdPersonController.ts:147`:
```ts
camera.position.lerpVectors(headPos, desiredCam, t);
```

`lerpVectors` 不是阻尼插值,是**直接赋值**当前帧的 `lerp(headPos, desiredCam, t)` 结果。没有"渐进逼近上一帧位置"的 spring-damp。玩家位置只要每帧抖 0.001m,`desiredCam` 立即跟着抖 ×arm length → 相机距离完整传递 → 视觉一拉一拉。

#### 2. resolveAxis 让玩家在墙边位置微抖

`thirdPersonController.ts:57-71`:玩家先走进 AABB 内再被推回 AABB 外(分轴 move-then-resolve)。靠墙前进时,玩家每帧"踏入 → 推出 → 踏入 → 推出",`player.position` 在墙边 ±0.001m 震荡 → `desiredCam = player.position + camOffset` 跟着抖。

#### 3. 8 步离散采样导致 t 值跳变

`thirdPersonController.ts:138-146`:
```ts
for (let i = 1; i <= CONFIG.camera.collideSteps; i++) {  // collideSteps = 8
  const s = i / 8;
  tmp.lerpVectors(headPos, desiredCam, s);
  if (cameraClipTest(tmp)) {
    t = Math.max(0.1, (i - 1) / 8);
    break;
  }
}
```

8 步采样,每步 1/8 = 0.125。贴墙时 `desiredCam` 在 AABB pad 附近游走,8 步命中不同 cell → `t` 在 `0/8, 1/8, 2/8` 跳变 → 相机距 head 在 `0.125 × 2.7m = 0.34m` 与 `1.0 × 2.7m = 2.7m` 间跳 = 拉远放近循环。

#### 4. `t` 下限 0.1 太低(症状放大)

```ts
t = Math.max(0.1, (i - 1) / CONFIG.camera.collideSteps);
```

`t=0.1` → 相机距 head 仅 `2.7m × 0.1 = 0.27m`,贴脸颈部。FOV 70° 下角色视觉剧烈膨胀。一旦下一帧 `desiredCam` 略离开 AABB,`t` 跳回 1.0 → 相机瞬远 = 一拉一拉最直观感受。

**修复方案(用户选定:选项 A — 相机位置加阻尼)**

- 记录 `camera.position` 上一帧值
- 每帧 `camera.position.lerp(prevCameraPos, targetPos, 1 - Math.exp(-lambda * dt))` —— spring-damp,帧率无关
- `snippets/tween.ts` 有 damp 函数(AGENTS rule 3 已注,独立 agent 直接 import)
- 成本:~5 行
- 效果:消除 80% 视觉抖动

其他选项(均已否决,记录备查):
- B:加相机稳定 pad + 提高 t 下限(改 2 常量,治标不治本)
- C:球体距离测试替代 AABB 内点测试(改 ~15 行,治本但改动稍大)
- D:玩家位置平滑(独立于相机,可能引入"相机滞后")

---

## 4. PR #8 总评

**结论**:**可以 merge**

- 验收 8 组全过(A-H 全 PASS)
- 6/6 测试 pass
- 架构纪律遵守(game 层零渲染依赖,scene 层只 import adapter 允许的 Box3/Vector3)
- 1 个低优 bug(outlets) + 1 个 dead code + 1 个 deprecated warning + 1 个相机抖动 bug — 都不阻塞 merge,均归 PR #10 处理

**Layer 1 地基使命达成**:
- A* 算法层 + Grid 适配器 ✓
- 单一数据源 config ✓
- SharedState facade + 接口钉死 ✓
- mount stub 留位 ✓
- minimap 实时渲染 ✓
- AGENTS rule 11 并行工作流规约 ✓

后续 PR #9(UI 独立 agent)+ PR #10(game 独立 agent)可在 worktree 平行启动。

---

## 5. 给 PR #10(game agent)的修复清单(必须执行)

PR #10 spec 必须包含以下 4 项,作为 review 后迭代修复:

### 5.1 相机贴墙抖动 — 选项 A 实现

- 文件:`src/player/thirdPersonController.ts`
- 改动:加 `prevCamPos: THREE.Vector3` 闭包变量,每帧后渲染位置用 spring-damp 平滑:`camera.position.lerp(prevCamPos, targetPos, 1 - Math.exp(-CONFIG.camera.dampLambda * dt))`
- 在 `src/game/config.ts` 的 `camera` 段加 `dampLambda: 12`(经验值,可调)
- 用 `snippets/tween.ts` 现成 damp(若有)
- 验收:贴墙前进(W 持续 + 撞墙)相机不抖

### 5.2 outlets 数组随 rebuildTableZone 重算

- 文件:`src/scene/loadLibraryScene.ts`
- 改动:把 `outletPositions` 计算抽成函数,`rebuildTableZone` 末尾调用并赋值给 mutable 变量(不是返回值字段出去后还能变 — 用 closure-level `let outletsRef` 或暴露 setter)
- facade 持引用稳定,内部 `getSharedState` 每帧读最新
- 验收:拖 rowSpacing slider 2.36 → 2.5 → `window.__debug.getSharedState().outlets` 中桌电位 z 跟着变

### 5.3 删 minimap dead code

- 文件:`src/ui/minimap.ts:45-47`
- 改动:3 行 if 块 → 1 行 `lastColliders = colliders`
- 验收:diff 显示 3 行 deletion + 1 行无新增(或 3 行替换 1 行)

### 5.4 `THREE.Clock` 换 `THREE.Timer`

- 文件:`src/main.ts:95-98`
- 改动:`new THREE.Clock()` → `new THREE.Timer()`,`getDelta()` → `getDelta()`(API 同名)。看 Three.js v0.185 文档确认 Timer 用法
- 验收:控制台无 `THREE.Clock deprecated` warning

---

## 6. 给 PR #9(UI 独立 agent)的注意

- 不要改 `src/main.ts` 调用点(Layer 1 钉死)
- 只替换 `src/ui/phoneHud.ts` 的 `mountPhoneHud` 实现
- 实现 GTA5 phone 样式 + 2 app(地图/占用查询)
- 地图 app 直接消费 `getSharedState().outlets` 和 `getSharedState().path`(path 暂未填,先显示 outlets)
- 实现 minimap 的"点击 / 缩放 / 平移"交互(Layer 1 minimap 只读,UI agent 在 phone map app 里包一层做交互)
- 不要碰 `src/game/` / `src/player/` 任何文件(文件边界 rule 11)

---

## 7. 流程下一步

1. 用户 merge PR #8 → 本 review 文档已记录在 `review/` 目录
2. 用户本地同步:`git switch main && git pull --ff-only && git branch -D feat/layer1-foundation && git push origin :feat/layer1-foundation`
3. 开 worktree #1(PR #9 UI agent):`git worktree add ../gamejam-2026-phone-hud -b feat/phone-hud`
4. 开 worktree #2(PR #10 game agent):`git worktree add ../gamejam-2026-dash-battery -b feat/dash-battery`
5. 各 agent 在自己 worktree 开独立 opencode 会话,改 `git config user.name` 各自命名
6. 两 PR 都开 → John(本会话)review → 用户 merge 先 PR #9 → PR #10 rebase 到新 main → merge

---

## Review 签名

- Reviewer: John(技术总程序员)
- Mode: review only,无代码变更
- 文档落地: `review/2026-08-04-pr8-layer1-foundation-review.md`
- 决策者:用户(选定选项 A 阻尼方案)