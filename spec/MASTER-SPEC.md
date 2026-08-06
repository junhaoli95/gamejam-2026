# 《1% 电》("Low Battery") — 项目 Master Spec

> **这份文档是项目的单一信息源(single source of truth)。** 所有锁定决策、架构、gameplay、技术约束、PR 路线图在此合并。后续 PR spec 引用本文档,不重复定义已锁定项。
>
> **更新规则**:任何 spec §6 / rule 8 级别的解锁或重大决策必须更新本文档。docs-only 微修订(≤10 行措辞)可直接 commit main(rule 7 例外)。

- 日期:2026-08-04(合并 08-01 设计 + 08-03 Layer 1 + 08-04 phone HUD brainstorming)
- 仓库:https://github.com/junhaoli95/gamejam-2026
- Jam:AI Browser Game Jam 4(2026-08-01 ~ 08-15,主题 CHARGE!)
- 部署:itch.io 网页手动上传(`npm run pack` 产出 zip)

---

## 1. 概念

你是图书馆里一只只剩 1% 电的猫,3 分钟内冲到空充电桩保命。其他动物也在抢桩——你的武器是右下角 GTA5 式手机 UI 查桩,**但查桩的工具耗的就是你要保的电**;冲刺抢桩耗的是有限不补的能量 pip。两种稀缺资源交织成策略核心。

### 1.1 主题命中(Charge 全部 4 个含义)

| 含义 | 命中机制 |
|---|---|
| ⚡ 充电(电池) | 玩家手机只有 1%,倒计时生存 |
| ⚡ 充能(能量) | 冲刺能量 pip 一次性、用完不补 |
| 🗡️ 突进 | Shift 冲刺动作本身 + NPC 也会抢桩突进 |
| 👑 谁说了算 | 玩家 vs NPC 抢充电位决战,你是/不是 in charge 在终局见分晓 |

### 1.2 玩家体验目标

- 评审 / 玩家首 3 分钟就能完整体验一局(jam 头号铁律)
- 操作极简:6 键 = 全部(WASD + Shift + 1/2/3 + E)
- "1% 电却还要开 app 耗电找桩" 的喜剧悖论一眼就懂
- 一直在被时间追、被 NPC 抢、做"现在开户还是憋着走过去"的选择
- 死了立刻想再开一把(roguelite 单局 ≈ 3 分钟)

---

## 2. 核心循环(一局 ≈ 3 分钟)

1. 玩家出生在图书馆入口,手机初始化为 1% ≈ 180 秒倒计时,电池本底以 1%/s 持续掉
2. 馆里散布 51 个充电桩(当前布局),状态:空 / 被 NPC 占 / 被玩家占(=胜)
3. 定位/导航靠**右下角手机 UI**(3 app 系统,见 §3):
   - **RADAR app**(×3 耗电):龙珠雷达显示方位 + 距离,无地形
   - **MAP app**(×2 耗电):GTA 俯视地图显示玩家位置 + 全部桩坐标,不显示占用状态
   - **QUERY app**(×4 耗电):同 MAP 地形 + outlet 占用状态着色(空绿/NPC红/你金)
4. 默认 app 全关,省电但瞎走;开户 = 找得快但电掉更快。**开户时机 = 唯一策略动作**
5. NPC 动物同场抢桩:你快到时被狗抢先 / 猫占用桩睡不死,逼你换下一个
6. 终局:
   - 玩家走到空桩按 E 插枪 → **胜利**(屏幕闪绿 + 加分音)
   - 电池降到 0% 手机黑屏 → **判负**
   - 重开 = pip 与电池自动满;桩位置与 NPC 性格随机重生(轻 roguelite)

---

## 3. Phone HUD 系统(3 app — spec §6 / rule 8 已解锁)

### 3.1 设计解锁记录

**原 spec §6 锁定 2 app**(MAP + QUERY),**rule 8 锁定 "2 app" scope**。2026-08-04 brainstorming 中用户提出 RADAR app 补全"瞎走寻宝" gameplay 梯度,决定解锁:
- spec §6:2 app → 3 app(加 RADAR)
- rule 8:"2 app" → "3 app"
- 操作键:5 键 → 6 键(WASD + Shift + 1/2/3 + E)

### 3.2 4 档信息梯度

| 状态 | 给什么 | 不给什么 | 耗电 | 玩法 |
|---|---|---|---|---|
| Home(app 全关) | 无 | 一切 | ×1 本底 | 完全瞎走寻宝 |
| RADAR [2] | 方位 + 距离(龙珠雷达 blip 角度+半径) | 地形/路径 · 占用状态 | ×3 | 知方向可能撞墙,要自己绕 |
| MAP [1] | 地形 + outlet 位置 + 玩家朝向 | 占用状态 | ×2 | 规划路线,不知占没占 |
| QUERY [3] | 地形 + outlet 位置 + 占用状态 | 无 | ×4 | 完整情报 |

**RADAR vs MAP 不重叠**:RADAR 给方位但无地形(可能撞墙);MAP 给地形但不知占用。两份不同信息,玩家可同时开(×5 耗电)拿方位+地形,或只开一个省钱。

### 3.3 操作(6 键)

| 键 | 动作 |
|---|---|
| WASD | 移动 |
| Shift | 冲刺(耗 1 颗 pip) |
| 1 | MAP app 开/关 |
| 2 | RADAR app 开/关 |
| 3 | QUERY app 开/关 |
| E | 插枪(仅近空桩时生效) |
| Esc | 退出指针锁 |

### 3.4 Phone chassis 视觉

**GTA5 smartphone 风**(brainstorming v6 拍板):
- 深黑 OLED bezel + 侧边按钮 SVG + 屏幕 inset 阴影
- 状态栏:时钟(装饰) + 信号/wifi SVG + **电池 icon 内嵌 M:SS 倒计时** + 隔壁显示 1% 数字
- 壁纸:暗冷色径向渐变,app grid 浮其上
- **时间为主单位**:大字 M:SS 红色发光(电池 icon 容器内),% 是辅助
- 低电警告:≤10% 红色 banner 滑入;≤3% 闪烁 + 心跳音;0:00 黑屏判负

### 3.5 App icon grid

- 3 个真 app:MAP(蓝渐变 🗺)、RADAR(橙渐变 📡)、QUERY(绿渐变 ⚡)
- 1 个"等待安装"占位(dashed border + 🐾 + "等待安装" label + grayscale 滤镜)
- **Onboarding 安装动画**(选项 D):开局 MAP/QUERY/RADAR 3 个真 app 各走 0.6s pending → installing(圆环进度 0→100%)→ ready(pulse 高亮 + "已安装")动画;第 4 个 icon 永远 pending 装饰
- 任意键可跳过 onboarding

### 3.6 MAP app 内部(GTA 升级 renderer)

- 复用 `src/ui/minimap.ts` renderer,升级 GTA 风(详见 §7.2)
- north-up,玩家三角箭头按 yaw 旋转
- outlet blip = 全绿(MAP 不显示占用状态)
- zone labels(书架区/自习区/走廊)
- 无交互(无缩放/平移/点击)

### 3.7 RADAR app 内部(龙珠雷达)

- 独立 canvas,不复用 GTA renderer(无地形,纯方位图)
- 圆形雷达:同心距离环(5m/15m/25m 标签),玩家中心点(无箭头)
- outlet blip:角度 = outlet 方位(`Math.atan2`),半径 = 直线距离(`Math.hypot`,1 行)
- sweep line 旋转动画(纯装饰)
- 底部大字 "12m · NE"(最近 outlet 距离 + 方位)
- 占用 count summary("51 空 / 0 占")

### 3.8 QUERY app 内部(GTA renderer + 状态色)

- 复用 `src/ui/minimap.ts` GTA renderer
- outlet blip 按状态着色:空 = `#2dff7a` 绿 / NPC 占 = `#ff4d4d` 红 / 玩家占 = `#ffd24a` 金
- 顶部 legend:● 空 51 · ● 占 0 · ● 你 0
- PR #9 阶段所有 blip 绿(NPC PR #11 才有红)

### 3.9 架构变更(相对 Layer 1)

- **删除 Layer 1 左下角独立 minimap**(PR #9 做):`main.ts` 移除 `createMinimap()` 调用 + dispose
- minimap renderer 只在 phone app 内挂载/卸载(MAP/QUERY 开时显示,关时隐藏)
- `src/ui/phoneHud.ts` 内部消费 `createMinimap()`,不改 main.ts 调用点

---

## 4. 资源系统

### 4.1 电池(被动倒计时)

- 开局 1% = 180 秒
- 本底 1%/s 持续掉
- 开 RADAR ×3、开 MAP ×2、开 QUERY ×4;多 app 叠加(如 RADAR+MAP = ×5)
- 电量 ≤10% 手机 UI 红色警告 banner;≤3% 闪烁 + 心跳音
- 0% = 黑屏判负

### 4.2 能量 pip(主动冲刺)

- **3 颗 lightning pip** 开局满
- Shift 触发冲刺:0.4s ×3 倍速 + 0.5s 冷却;耗 1 pip
- 冲刺方向 = 当前移动朝向;无朝向输入则不触发(防误操作)
- 冲刺时猫轻微拖尾粒子
- **单局内 pip 不补充**,下局自动重置满
- NPC 各自带 ≤1 颗 pip(稀有):检测到附近空桩且有竞争者接近时小概率用

### 4.3 两资源正交

电池 = 被时间追(持续耗、被动);能量 = 你追别人(按需花、主动)。两条独立资源 = 策略平面。典型决策:"开 QUERY app(×4 电池)确认空桩 + 1 pip 冲过去" vs "省钱瞎走"——选错(NPC 先 1 秒占桩)= pip 浪费心疼但下局再来。

---

## 5. NPC(OpponentController 之一)

状态机 4 状态:`pick-target`(最近空桩)→ `move`(直线 / 简避障)→ `occupy`(充 5~30s)→ `leave` → repeat。

### 5.1 性格差异(数据驱动,写在 `game/config.ts`)

| 动物 | 行为画像 | 耐心 | 充电时长 | 付费/抢位权重 |
|---|---|---|---|---|
| 🐶 狗 | 全场贯穿,占桩 5s 就走 | 极低 | 5-8s | 高(让你有空桩可拿) |
| 🐱 猫 | 选一桩霸座充电 | 中 | 25-35s | 中(逼你换桩的策略担当) |

底线首发 2 种动物即可撑起 3 局玩法变化;第 3 种(兔子)是 stretch。

### 5.2 外观可读性

- 头顶朝向 tween:NPC 转向目标桩时头先转 0.15s(让玩家读出意图)
- 头顶目标点小三角形:玩家打开 MAP app 时也可见,制造"它要去那儿"的紧张
- 占用桩时桩边小进度环 + 充电动画
- 故意犯错:到达后延迟 0.3s 才插枪(留出抢赢窗口,让玩家不绝望)

---

## 6. 场景(图书馆)

### 6.1 当前布局(32×24m 占位,rule 10 backlog:10x 扩张)

三区制(v6):
- **东(x>0)** 自习区:4 人桌 2 列 × 10 行,每张桌逆时针旋 90°;84 席坐 77 只占位猫,仅 7 空位
- **西(x<-4)** 书架区:3 排沿 Z 向书架,柱网 4 柱/排,豁口错位
- **中** 走廊+大堂:南北贯通,出生点在南端 (0, 8.5)
- **东墙** 窗墙:发光面 + 竖梃,冷色 DirectionalLight 模拟日光
- **四周** 深胡桃木墙壁

### 6.2 电位(51 个,3 种宿主)

| 类型 | 数量 | 视觉 |
|---|---|---|
| 柱电位 | 6 | 绿方块在柱 ±x 面低位 |
| 端板电位盒 | 2 | 书架排北端银灰盒 + 绿点 |
| 4 人桌电位 | 40 | 桌面中线 2 个/桌 × 20 桌 |
| 壁插 | 3 | 贴墙面,常亮 |

全部 emissive 绿色呼吸脉冲(统一视觉语言:"发光 = 可充电")。

### 6.3 GLB 落盘

`public/library/<kind>.glb`(Vite 静态目录,URL `library/<name>.glb`,dev/prod 一致)。`loadGlbNormalized` 按目标高度归一化 + 落地 y=0。5 种 ModelKind:bookshelf / column / studyTable / readingTable / wallSocket。

### 6.4 光照

- AmbientLight 0.5 + HemisphereLight 0.5 + DirectionalLight(东窗日光)0.45
- ≤4 PointLight(暖色阅读灯)
- 整体偏暗,表现"快闭馆"的吃紧感

---

## 7. 技术架构

### 7.1 分层纪律

```
src/
  game/      纯 TS 游戏逻辑:run/battery/npc/level/rng/输入抽象。零 DOM、零 Three.js 依赖,可单测
  scene/     Three.js 场景:只用 GLTFLoader / TextureLoader(微信适配层已验证)
  ui/        DOM 界面层:只读 SharedState、只发 AppAction。薄,可整体替换
  platform/  平台适配层:saveStore / audio / inputProvider / net(stretch)
  main.ts    入口:渲染器、相机、主循环
  debug/     dev-only 调试面板(lil-gui + Box3Helper)
snippets/    可复用代码片段(loadGlb、tween 等)
public/library/   Meshy GLB
spec/       所有 spec 文档
review/     review 文档 + backlog
```

**核心数据流单向**:`platform/inputProvider` → `game.step(input, dt) → WorldState` → `scene/` 渲染 + `ui/` 渲染。`game/` 层完全不知 Three/DOM 存在。

### 7.2 Layer 1 地基(PR #8 已 merge)

| 模块 | 文件 | 状态 |
|---|---|---|
| Grid 类型 + 适配器 | `src/game/gridModel.ts` | ✅ 80×60 cells, Uint8Array, 2 单测 |
| A* 寻路 | `src/game/pathfinding.ts` | ✅ 4-connected, 自写二叉堆, 4 单测 |
| config 单一数据源 | `src/game/config.ts` | ✅ world/player/camera 填实; dash/battery/npc schema 占位 |
| SharedState facade | `src/platform/sharedState.ts` | ✅ 接口钉死 + stub 实现(battery=1.0, pips=3) |
| Minimap renderer | `src/ui/minimap.ts` | ✅ 简单版(canvas 2D),PR #9 升级 GTA 风 |
| Phone HUD stub | `src/ui/phoneHud.ts` | ✅ 空 stub(PR #9 填实) |
| PlayerStats stub | `src/game/playerStats.ts` | ✅ 空 stub(PR #10 填实) |
| 第三人称控制器 | `src/player/thirdPersonController.ts` | ✅ 指针锁 + WASD + AABB + 相机 spring-damp |
| 场景构建器 | `src/scene/loadLibraryScene.ts` | ✅ v6 布局 + debug slider + GLB swap |
| Debug overlay | `src/debug/overlay.ts` | ✅ lil-gui(rowSpacing/seatSideDist/freeSeatCount/freeSeed) + Box3Helper |
| vitest | devDep | ✅ 6 tests pass |
| AGENTS rule 11 | 并行独立 agent + worktree | ✅ |

### 7.3 SharedState 接口(钉死,独立 agent 只消费不发明)

```ts
interface SharedState {
  player: { x: number; z: number; yaw: number };
  battery: number;       // 0-1, PR #10 填
  pips: number;          // 0-3, PR #10 填
  outlets: Array<{ x: number; z: number; occupied: boolean }>;
  npcs: Array<{ x: number; z: number; state: string }>;  // PR #11 填
  path?: Array<{ x: number; z: number }>;                // phone map app 用
}
type AppAction = { kind: 'query-outlets' } | { kind: 'toggle-map' } | { kind: 'close' };
```

### 7.4 OpponentController 抽象(多人 stretch 预留)

```ts
interface OpponentController {
  kind: 'npc' | 'remote';
  think(state: WorldState, dt: number): OpponentAction;
}
```

D2-D10:全部 NpcController。D11+ stretch:RemotePlayerController + `platform/net.ts` websocket,30s 无匹配 auto-fill NPC。

### 7.5 技术栈

- Vite + TypeScript + Three.js v0.185.1(无框架,纯代码驱动,无编辑器)
- vitest(`game/` 单测)
- lil-gui(dev-only debug overlay,dynamic import 不入 prod)
- 部署:itch.io 网页(`npm run pack` → zip)

### 7.6 微信移植约束(架构纪律)

- `game/` 禁止 import three / DOM / window(rule 1)
- 纹理 ≤2048px;模型统一 GLB 内嵌纹理;不用 ImageBitmapLoader(rule 2)
- 所有动画优先代码驱动(`snippets/tween.ts`),不依赖骨骼动画(rule 3)
- dt 一律 clamp 0.1s 上限(rule 5)

---

## 8. Git 工作流(AGENTS.md rule 7 + 11)

### 8.1 PR-based 铁律

- AI 在 feature branch 自由 commit,所有变更通过 PR 进 main
- branch 命名:`feat/<x>` / `chore/<x>` / `fix/<x>`
- `gh pr create` → 用户 review + merge(推荐 rebase & merge)
- merge 后同步:`git switch main && git pull --ff-only && git branch -D <branch> && git push origin :<branch>`
- 一个功能增量 = 一个 PR;开完 PR 说 "READY FOR REVIEW" 并停手
- push 前 `gh pr view <n> --json state` 确认 OPEN
- **docs-only 例外**:纯 `*.md` ≤10 行、无代码、spec 未被实现引用 → 可直接 commit main

### 8.2 Agent 命名

每个 agent 仓库本地 `git config user.name` 设独立名:
- 主 agent(本会话):`Snake <snake@agent.local>`
- 独立 agent 各自命名(用户分配)

### 8.3 并行独立 agent(rule 11)

- 主 agent 完成 Layer 1 地基后才可并行
- 用户在两个独立 opencode 会话里各自开 worktree:`git worktree add ../gamejam-2026-<branch> feat/<x>`
- 文件边界:UI agent → `src/ui/`;Game agent → `src/game/` + `src/player/`
- 两 agent 都不改 `src/main.ts` 调用点(Layer 1 钉死)
- 共享接口 = Layer 1 TS interface,只 implements 不 invent
- 两 PR 都开 → 主 agent review → 用户 merge 先开的 → 后开的 rebase

### 8.4 调试资源闭环(rule 9)

MCP 验证完 → `chrome-devtools_navigate_page` 到 `about:blank` 停渲染(不杀进程)。dev server 保持运行供试玩。

### 8.5 编辑熔断

连续 2 次互相回滚或纯装饰性 edit → 立即停 edit,跳 build/验证/commit。空行/注释措辞一律不动。

---

## 9. PR 路线图

### 已完成

| PR | 标题 | 状态 |
|---|---|---|
| #1 | chore: spec + PR workflow setup | MERGED |
| #2 | feat: scaffold library scene | MERGED |
| #3 | feat: first-person library v2+v3 | MERGED |
| #4 | feat: library v4 three-zone layout | MERGED |
| #5 | feat: debug overlay (lil-gui + Box3Helper) | MERGED |
| #7 | docs: spec Layer 1 realtime + rule 7 docs exception | MERGED |
| #8 | feat: Layer 1 foundation (grid/pathfinding/config/minimap/SharedState) | MERGED |

### 即将

| PR | 标题 | Agent | 工作量 | 文件边界 |
|---|---|---|---|---|
| **#9** | feat: phone HUD UI (3 app + GTA chassis + install animation) | 独立 agent A | 6-9h | `src/ui/` + 删 Layer 1 左下 minimap |
| **#10** | feat: dash pip + 电池消耗 + camera minDist | 独立 agent B | 6-8h | `src/game/` + `src/player/` |

### 后续

| PR | 标题 | 工作量 |
|---|---|---|
| #11 | NPC AI (consume pathfinding + occupy state) | ~4h |
| #12 | polish + itch 上传 | ~4h |
| (独立) | 场景 10x 扩张(rule 10 backlog) | 大改,单独 PR |
| (独立) | THREE.Clock → THREE.Timer(backlog #002) | 1 行,顺手 |

---

## 10. 关键决策记录

| # | 决策 | 日期 | 理由 |
|---|---|---|---|
| 1 | 不做地形编辑器 | 08-03 | jam 期 5-10h ROI 低于"纸笔画布局 → AI coding → 游戏循环微调" |
| 2 | pathfinding 是纯函数,与地形正交 | 08-03 | A* 在 mock grid 可单测全绿;`toGrid(Box3[])` 适配器接通真实地形 |
| 3 | SharedState facade + mount stubs = 反冲突核心 | 08-03 | 两独立 agent 不改 main.ts,只替换 stub 实现 |
| 4 | Grid 用 Uint8Array flat 一维 | 08-03 | 微信移植最稳;4800 cells = 4.8KB;`index = z*w + x` 算术快且无 GC |
| 5 | minimap 实时性硬约束 | 08-04 | 每帧从 getSharedState() 现读,禁止快照;30fps 节流是性能取舍不是借口 |
| 6 | spec §6 + rule 8 解锁:2 app → 3 app | 08-04 | RADAR 补全"瞎走寻宝" gameplay 梯度,4 档信息差异化 |
| 7 | 5 键 → 6 键 | 08-04 | 加 `3` 切 RADAR;6 键仍极简,不破坏 spec "极简操作"精神 |
| 8 | 删 Layer 1 左下 minimap | 08-04 | minimap 只在 phone 内,app 关 = 完全瞎走 =忠于 spec §6 tension |
| 9 | chassis = GTA smartphone 风 | 08-04 | 真实手机惯例 + 装饰性 CSS 细节,~4h,无交互复杂度 |
| 10 | 时间为主单位(M:SS 嵌入电池 icon) | 08-04 | time 是终极量化单位,% 是衍生辅助 |
| 11 | "等待安装"占位 + onboarding 动画 | 08-04 | 真实 App Store pending install 流程;开局仪式感 + 第 4 icon 永远 pending 装饰 |
| 12 | RADAR = 龙珠雷达(方位+距离,无地形) | 08-04 | 跟 MAP 不重叠(MAP 给地形不给方位,RADAR 给方位不给地形) |
| 13 | 相机 spring-damp(选项 A) | 08-04 | `camera.position.lerp(target, 1-exp(-12*dt))` 消除 ~80% 贴墙抖动 |
| 14 | docs-only 微修订可直接 commit main | 08-04 | rule 7 加例外:纯 *.md ≤10 行、无代码、spec 未被引用 → 免 PR |

---

## 11. Bug Backlog 摘要

(完整条目见 `review/2026-08-04-non-urgent-backlog.md`)

| # | 问题 | 优先级 | 归 PR | 状态 |
|---|---|---|---|---|
| 001 | 相机贴墙仍感拉近(damp 后第二档) | 中 | #10 | 待做(minDist=1.4 clamp,5 行) |
| 002 | THREE.Clock deprecated | 低 | #10 或顺手 | 待做(换 Timer,1 行) |

---

## 12. 性能预算

| 项 | 限制 |
|---|---|
| NPC 数 | ≤5(spec §7 底线 2 种) |
| 桩数 | 51(当前布局;rule 10 扩张后重算) |
| 同时实时点光源 | ≤4 |
| 粒子预算 | ≤30 |
| 对象池 | NPC/桩/粒子全程池化 |
| prod bundle | ≤620KB(vitest devDep 自动剥离;lil-gui dev-only dynamic import) |

---

## 13. 测试策略

- `game/` 全部 vitest 单测:battery 倍率、NPC 状态机流转、桩释放、胜负判定、rng 可复现、pathfinding、gridModel
- 视觉/scene 层不测(不值)
- 手感靠每天亲玩 5 分钟记 1 条"感觉不对"
- `npm run build` = tsc + vite,是类型门(无单独 lint/typecheck 脚本)
- `npm test` = vitest run

---

## 14. 参考资源(实地优势)

开发全程在图书馆实地进行,可即时观察:

1. 真实插座分布与占用规律 → 桩位生成权重(不要均匀撒点,要像真的)
2. 真人抢桩微行为(东张西望、看到别人起身立刻冲过来、占着桩低头玩手机不走、插队失败转身找下一个)→ NPC 状态机分支与延迟参数
3. 暖光/冷光混搭 + 木地板/书架材质 → Three.js 灯光/材质 reference
4. 过道/桌椅尺度 → 碰撞盒与俯视相机角度
5. 实地录闭馆提示音/翻书/脚步/椅子拖动 → 原创音效(jam 评分"原创音频"加分项)

---

## 15. Stretch Goals(D11+ 时间够才碰)

1. 真人多人 online(hybrid 架构已预留,OpponentController → RemotePlayerController)
2. 第三种 NPC 动物(兔子,普通乖顾客)
3. 第二场景(机场或咖啡角)
4. 分享模式(seed 复现 + 排行榜眺望)
5. 场景 10x 扩张(rule 10 backlog,向实地图书馆一层看齐)

---

## 16. 与咖啡馆的未来复用

### 复用

- Three.js pipeline、AABB 碰撞、程序 bob 动画、saveStore、Phone-UI overlay 技法
- `config.ts` 数据驱动平衡习惯
- NPC 状态机框架(pick/move/occupy/leave)→ 咖啡馆顾客(arrive/wait/leave)几乎一模一样
- OpponentController 抽象 → 咖啡馆"NPC 顾客 vs 真人好友光顾"双模
- SharedState facade + mount stub 架构 → 多 agent 并行开发模式

### 不复用

- 电池生存玩法、找桩胜条件、dash 抢位机制

### 结论

本作是 Three.js 实战 + 一款原创有趣 jam 游戏;NPC 状态机框架是咖啡馆直接复用的大宗。jam 价值(练 + Three.js 入门 + 原创有趣)已达成 + 咖啡馆 30% 代码债前置消除。

---

## 附录 A:相关文档索引

| 文档 | 路径 | 用途 |
|---|---|---|
| 原始设计 spec(被本文档合并/超越) | `spec/2026-08-01-1percent-battery-design.md` | 历史参考,锁定决策以本文档为准 |
| Layer 1 设计 spec | `spec/2026-08-03-layer1-foundation-design.md` | PR #8 实现依据 |
| Layer 1 实施计划 | `spec/2026-08-03-layer1-foundation-plan.md` | PR #8 任务分解 |
| PR #8 review | `review/2026-08-04-pr8-layer1-foundation-review.md` | review 记录 + bug 发现 |
| 非紧急 backlog | `review/2026-08-04-non-urgent-backlog.md` | 待修条目(相机 minDist、Clock deprecated 等) |
| AGENTS.md | `AGENTS.md` | 项目约定 + AI 协作守则(11 条 rules) |

## 附录 B:PR #9 phone HUD spec 待写

本文档 §3 已锁定 phone HUD 所有设计决策。PR #9 独立 agent spec 需补充:
- GTA minimap renderer 升级的具体 canvas API 细节(~110 行估算)
- 龙珠雷达 canvas 绘制细节(~50 行估算)
- onboarding 安装动画 CSS keyframe 细节
- chassis CSS 完整参数表
- 验收标准(参照 Layer 1 spec §11 格式)

## 附录 C:PR #10 dash/battery spec 待写

本文档 §4 已锁定资源系统数值。PR #10 独立 agent spec 需补充:
- `game/run.ts` / `game/battery.ts` / `game/dash.ts` 骨架
- 电池消耗公式 + app 倍率叠加逻辑
- dash pip 状态机 + cooldown
- camera minDist clamp(backlog #001,5 行)
- THREE.Clock → Timer(backlog #002,1 行)
- config.ts dash/battery 字段填实数
- 验收标准