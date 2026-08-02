# 《1% 电》(working title, "Low Battery") 设计文档

- 日期：2026-08-01
- 状态：已锁定（brainstorming 完成，待写实施计划）
- 索引：本作是 brainstorming 协议的最终产物；下一步走 `writing-plans` 技能拆 D2-D14 任务
- 仓库：https://github.com/junhaoli95/gamejam-2026

---

## 1. 概念

你是图书馆里一只只剩 1% 电的猫，3 分钟内冲到空充电桩保命。其他动物也在抢桩——你的武器是右下角 GTA5 式手机 UI 查桩，**但查桩的工具耗的就是你要保的电**；冲刺抢桩耗的是有限不补的能量 pip。两种稀缺资源交织成策略核心。

## 2. 主题命中（Charge 全部 4 个含义）

| 含义 | 命中机制 |
|---|---|
| ⚡ 充电（电池） | 玩家手机只有 1%，倒计时生存 |
| ⚡ 充能（能量） | 冲刺能量 pip 一次性、用完不补 |
| 🗡️ 突进 | Shift 冲刺动作本身 + NPC 也会抢桩突进 |
| 👑 谁说了算 | 玩家 vs NPC 抢充电位决战，你是/不是 in charge 在终局见分晓 |

## 3. 玩家体验目标

- 评审 / 玩家首 3 分钟就能完整体验一局（jam 头号铁律）
- 操作极简：方向键移动、1 个冲刺键、2 个 app 切换键、1 个交互键——5 个键 = 全部
- "1% 电却还要开 app 耗电找桩" 的喜剧悖论一眼就懂
- 一直在被时间追、被 NPC 抢、做"现在开户还是憋着走过去"的选择
- 死了立刻想再开一把（roguelite 单局 ≈ 3 分钟）

## 4. 核心循环（一局 ≈ 3 分钟）

1. 玩家出生在图书馆入口，手机初始化为 1% ≈ 180 秒倒计时，电池本底以 1%/s 持续掉
2. 馆里散布 6~9 个充电桩，状态：空 / 被 NPC 占 / 被玩家占（=胜）
3. 定位/导航靠**右下角手机 UI**：
   - **地图 app**（开时电池消耗 ×2）：显示玩家位置 + 全部桩的坐标（不显示占用状态）
   - **占用 app**（开时电池消耗 ×4）：实时显示哪些桩空着
4. 默认 app 都关，省电但瞎走；开户 = 找得快但电掉更快。**开户时机 = 唯一策略动作**
5. NPC 动物同场抢桩：你快到时被狗抢先 / 猫占用桩睡不死，逼你换下一个
6. 终局：
   - 玩家走到空桩按 E 插枪 → **胜利**（屏幕闪绿 + 加分音）
   - 电池降到 0% 手机黑屏 → **判负**
   - 重开 = pip 与电池自动满；桩位置与 NPC 性格随机重生（轻 roguelite）

## 5. 操作

| 键 | 动作 |
|---|---|
| WASD / 方向键 | 移动 |
| Shift | 冲刺（耗 1 颗 pip） |
| `1` | 切换地图 app 开/关 |
| `2` | 切换占用 app 开/关 |
| E | 插枪（仅近空桩时生效） |

**砍掉鼠标**，纯键盘——避免鼠标+键盘双控 UI 反馈翻倍。

## 6. 资源系统

### 6.1 电池（被动倒计时）

- 开局 1% = 180 秒
- 本底 1%/s 持续掉
- 开地图 app 时总耗电 ×2；开占用 app 时 ×4；两个都开 ×6
- 电量 ≤10% 手机 UI 出现红色警告；≤3% 闪烁 + 心跳音
- 0% = 黑屏判负

### 6.2 能量 pip（主动冲刺）

- **3 颗 lightning pip**（默认）开局满
- Shift 触发冲刺：0.4s ×3 倍速 + 0.5s 冷却；耗 1 pip
- 冲刺方向 = 当前移动朝向；无朝向输入则不触发（防误操作）
- 冲刺时猫轻微拖尾粒子
- **单局内 pip 不补充**，下局自动重置满
- NPC 各自带 ≤1 颗 pip（稀有）：检测到附近空桩且有竞争者接近时小概率用——让"被抢"成为戏剧性而非每次发生

### 6.3 两资源正交

电池 = 被时间追（持续耗、被动）；能量 = 你追别人（按需花、主动）。两条独立资源 = 策略平面。典型决策："开占用 app（×4 电池）确认空桩 + 1 pip 冲过去" vs "省钱瞎走"——选错（NPC 先 1 秒占桩）= pip 浪费心疼但下局再来。

## 7. NPC（OpponentController 之一）

状态机 4 状态：`pick-target`（最近空桩）→ `move`（直线 / 简避障）→ `occupy`（充 5~30s）→ `leave` → repeat。

### 7.1 性格差异（数据驱动，写在 `game/config.ts`）

| 动物 | 行为画像 | 耐心 | 充电时长 | 付费/抢位权重 |
|---|---|---|---|---|
| 🐶 狗 | 全场贯穿，占桩 5s 就走 | 极低 | 5-8s | 高（让你有空桩可拿） |
| 🐱 猫 | 选一桩霸座充电 | 中 | 25-35s | 中（逼你换桩的策略担当） |

底线首发 2 种动物即可撑起 3 局玩法变化；第 3 种（兔子）是 stretch。

### 7.2 外观可读性（防"NPC 看着傻"）

- 头顶朝向 tween：NPC 转向目标桩时头先转 0.15s（让玩家读出意图）
- 头顶目标点小三角形：玩家打开地图 app 时也可见，制造"它要去那儿"的紧张
- 占用桩时桩边小进度环 + 充电动画
- 故意犯错：到达后延迟 0.3s 才插枪（留出抢赢窗口，让玩家不绝望）

## 8. 场景（图书馆）

### 8.1 布局（紧凑可导航）

- 入口区 → 3 个小区块：
  1. 大读写桌区：桌下槽位 ×2
  2. 独立学习格一排 ×2
  3. 安静角共享长排插 ×2~3
- 书架作为碰撞墙 + 些许遮挡（走过书架才看到抢桩的狗，戏剧出现）
- 1-2 个暖沙发区点缀（未来咖啡馆换皮时即"座位"区）
- 紧凑但供 4-5 条可走的小过道，1-2 分钟可扫一遍

### 8.2 光照

- 夜灯暖色主光源（馆内暖白日光 + AmbientLight 0.7 + HemisphereLight 0.4，已写进 `main.ts`）
- 另加 4 个暖色阅读点光源（性能预算内：光源 ≤4 实时，超了的烘焙/假发光 sprite）
- 整体偏暗，表现"快闭馆"的吃紧感

### 8.3 与咖啡馆的未来换皮对照

充电桩→咖啡桌、电量%→口渴度、霸座→久坐客人、拔线→催单、NPC 抢桩→高峰期顾客排队。骨架抽象同一个 `OpponentController`，未来咖啡馆的"顾客 arrive/wait/leave" 与本作"NPC pick/move/occupy/leave" 几乎一模一样。

## 9. 美术方向

- **动森风**：圆润低多边形、大色块、柔光照、暖色调
- **主角**：猫（Meshy prompt 走 "cute chubby low-poly cat, animal crossing style, 2k texture")
- **NPC**：狗 + (兔子 stretch)，2-3 种动物，程序 bob/wobble 不绑骨
- **充电桩**：可爱小插座 + 亮点 bead；占用时小火花粒子；充满时桩轻微发光
- **手机 UI**：CSS/DOM 纯手画精致 phone chassis 居右下；电量条 + 红告警（≤10%）+ 闪烁（≤3%）+ 心跳音（≤3%）；2 个 app 图标；点开浮起面板（地图盒 / 占用网格）。告警阈值与 §6.1 一致

## 10. 技术架构

见 `AGENTS.md`「架构纪律」节。要点重述：

### 10.1 模块

| 文件 | 职责 |
|---|---|
| `game/config.ts` | 全部数值单一数据源：本底耗电、app 倍率、桩数、pip 数、移速、dash 倍速、NPC 性格表 |
| `game/types.ts` | Run / Player / Npc / Spot / Battery / Opponent / RunResult / WorldState / InputState |
| `game/rng.ts` | 种子化 PRNG（每局一 seed，复现+将来分享模式 stretch） |
| `game/run.ts` | `step(input, dt) → state \| result` 纯逻辑心跳 |
| `game/npc.ts` | NpcController：状态机 |
| `game/battery.ts` | 电量递减 + app 倍率 |
| `game/level.ts` | 桩位生成 + 碰撞盒数据驱动 |
| `game/opponent.ts` | OpponentController 抽象 |
| `game/input.ts` | 抽象输入（wasd/interact/app toggles/dash），platform 填 |
| `scene/gameScene.ts` | 场景总控，消费 WorldState 渲染 |
| `scene/libraryView.ts` | 场景几何 + 书架碰撞盒来源 |
| `scene/playerView.ts` | 猫 GLB + 程序 bob/dash 拖尾 |
| `scene/npcView.ts` | NPC 实例化 + 状态对应动画 |
| `scene/spotView.ts` | 桩进度环 + 火花/充满发光 |
| `scene/effects.ts` | 插枪绿闪、黑屏、低电红边屏幕渐晕 |
| `scene/camera.ts` | 固定俯视相机随玩家平移 |
| `platform/saveStore.ts` | 已有，存 bestTime（最快胜利用时） |
| `platform/audio.ts` | 接口占位，Suno + 实地录音后接 |
| `platform/inputProvider.ts` | DOM 监听键盘喂 game/input |
| `platform/net.ts` | stretch：websocket 客户端，RemotePlayerController 用 |
| `ui/phoneHud.ts` | 右下手机壳 + 电量条 + 2 app 面板 |
| `ui/topHud.ts` | 倒计时 / best |
| `ui/endScreens.ts` | 胜/负结算 + 重开 |
| `ui/onboarding.ts` | 前 10 秒口令式教学 |

### 10.2 数据流

```
inputProvider → game.step(input, dt) → WorldState
                                       ├─ scene.render(state)
                                       └─ ui.render(state)
```

`game/` 完全不知 Three/DOM 存在。这是可测、可移植、可未来接微信的根。

### 10.3 OpponentController（多人 stretch 预留）

```ts
interface OpponentController {
  kind: 'npc' | 'remote';
  think(state: WorldState, dt: number): OpponentAction;
}
```

D2-D10：全部 `NpcController`。D11+ 时间够：写 `platform/net.ts` websocket 客户端 + `RemotePlayerController`，main menu 加 "Online" 开关，30s 无匹配 auto-fill NPC（防 jam 评审干等）。

## 11. 控制器与碰撞细节（新手头号坑）

- 顶视角相机：低 FOV 正交/低 perspective（已写 `main.ts`），随玩家平移不旋转（无 3D 晕）
- 移动分量拆解 X/Z 独立做 AABB 步长扫描（不引物理引擎）
- 防穿墙：若分量方向被挡住，归零该分量保留另一分量（沿墙滑动）
- 步长过长（大于玩家碰撞半径）时分两步扫描，防穿薄书架
- D2 端到端走通控制器；不行降级 click-to-move（保底 fallback）

## 12. 错误处理与性能预算

| 项 | 限制 |
|---|---|
| NPC 数 | ≤5 |
| 桩数 | ≤9 |
| 同时实时点光源 | ≤4 |
| 粒子预算 | ≤30 |
| 对象池 | NPC/桩/粒子全程池化 |
| WebGL 不支持 | 友好提示页（jam 加分项） |
| 存档损坏 | try/catch 重置 |
| 帧率低 | 角色上限；DrawCall 合批 |

## 13. 测试策略

- `game/` 全部 vitest 单测：battery 倍率、NPC 状态机流转、桩释放、胜负判定、rng 可复现
- 视觉/scene 层不测（不值）
- **手感靠每天亲玩 5 分钟记 1 条"感觉不对"**（D2+ 开发者铁律，D9-D10 重点）

## 14. 排期（13 天，今 D1 = 主题锁日，紧）

| 阶段 | 天 | 产出 | 铁律目标 |
|---|---|---|---|
| 核心 | D2 | `game/` core 骨架 + AABB + 键盘走路 + 电池本底掉 | 能走撞墙、电在掉 |
| 核心 | D3 | 桩 + 胜负 + 手机 UI 草稿（电量 + 2 app 有效耗电） | 完整跑通胜/负，无美术 |
| 核心 | D4 | NPC 状态机 + 性格 + 占用可视化 | **vertical slice，记第 1 条"感觉不对"** |
| 美术 | D5-D6 | 图书馆场景 + 猫 GLB + NPC 动物 GLB | — |
| 美术 | D7 | 相机/粒子/插枪/黑屏/HUD 整合 | 完整一局有艺术 |
| juice | D8 | Suno 音频 + 实地录音 + onboarding 口令 + juice | — |
| 手感 | D9-D10 | 亲玩调平衡（电池倍率/NPC 速度/桩数）+ 录 GIF | 每天写"感觉不对" |
| 收尾 | D11-D12 | bestTime 存储/重开/主菜单 + **stretch 多人** + 二场景 stretch | polish |
| 提交 | D13 | bug bash + profiler + 打包 + 传 itch + 评别人 20+ | reciprocity |
| 保底 | D14 | 缓冲 / devlog ×2 / 最终提交 | — |

## 15. 风险与缓解

| 风险 | P×I | 缓解 |
|---|---|---|
| 角色控制器穿墙（新手头号坑） | 3×3 | D2 端到端走通；不行退化 click-to-move |
| Meshy 猫质量低 | 2×2 | D1 试下单；不行降级程序拼球+三角耳（风格统一反而更可爱） |
| NPC 抢桩不爽 | 2×3 | D4 急试；调 NPC 速度/桩数/故意延迟 0.3s |
| 电池平衡太难/太易 | 2×2 | D9-D10 调 |
| scope creep | 2×3 | 守住 scoped：单场景/2 app/3 pip；多场景/多 app/升级树 是 stretch |
| 多人延迟/断连 | 2×2 | D11+ 才动；30s 无匹配 auto-fill NPC |

## 16. 实施坑（来自 brainstorming 讨论，7 项）

1. **jam 评审没人在线匹配** → 30s auto-fill NPC（hybrid 设计支柱）
2. 角色控制器穿墙/卡边角 → AABB 步长分量扫描；D2 不行降级 click-to-move
3. NPC 意图不可读 → 头顶目标三角形 + 朝向 tween
4. 多 NPC + 暖点光源掉帧 → 光源 ≤4、对象池、合批
5. app 耗电无反馈 → 电池条耗电箭头动画
6. Meshy 猫尺寸/风格不一 → `loadGlbNormalized`（已备）
7. 鼠标+键盘双控反馈翻倍 → 砍鼠标，只键盘

## 17. 参考资源（实地优势）

开发全程在图书馆实地进行，可即时观察：

1. 真实插座分布与占用规律 → 桩位生成权重（不要均匀撒点，要像真的）
2. 真人抢桩微行为（东张西望、看到别人起身立刻冲过去、占着桩低头玩手机不走、插队失败转身找下一个）→ NPC 状态机分支与延迟参数
3. 暖光/冷光混搭 + 木地板/书架材质 → Three.js 灯光/材质 reference
4. 过道/桌椅尺度 → 碰撞盒与俯视相机角度
5. 实地录闭馆提示音/翻书/脚步/椅子拖动 → 原创音效（jam 评分"原创音频"加分项）

## 18. stretch goals（D11+ 时间够才碰，按价值排序）

1. 真人多人 online（hybrid 架构已预留， OpponentController 接 RemotePlayerController）
2. 第三种 NPC 动物（兔子，普通乖顾客）
3. 第二场景（机场或咖啡角）
4. 分享模式（seed 复现 + 排行榜眺望）

## 19. 与咖啡馆的未来复用（诚实）

### 复用

- Three.js 顶视角 pipeline、AABB 碰撞、程序 bob 动画、saveStore、Phone-UI overlay 技法
- `config.ts` 数据驱动平衡习惯
- **NPC 状态机框架**（pick/move/occupy/leave）→ 咖啡馆顾客（arrive/wait/leave）几乎一模一样
- OpponentController 抽象 → 咖啡馆未来"NPC 顾客 vs 真人好友光顾" 双模

### 不复用

- 电池生存玩法
- 找桩胜条件
- dash 抢位机制

### 结论

接受取舍：本作是 Three.js 实战 + 一款原创有趣 jam 游戏；NPC 状态机框架是咖啡馆直接复用的大宗。jam 价值（练 + Three.js 入门 + 原创有趣）已达成 + 咖啡馆 30% 代码债前置消除。

---

## 附录：今晚用户侧手活（并行）

- itch 草稿页描述更新成新概念《1% 电》（可由 AI 起草文案）
- Meshy 下单"动森风可爱猫"GLB 试质量（决定 D5 是否降级到程序拼猫）