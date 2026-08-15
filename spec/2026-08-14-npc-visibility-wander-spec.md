# NPC 视线门控 + Wander 状态

**日期**: 2026-08-14
**作者**: Snake + tommy brainstorm
**状态**: 设计已确认,待实施
**实施者**: Snake(本会话)
**相关代码**: `src/game/npc.ts`, `src/game/config.ts`, `src/scene/npcMesh.ts`, `src/main.ts`

## 背景与动因

Gamejam 期间测 NPC 时发现两个直观问题:

1. **NPC 行动有"不被观测也发生"的违和感**——玩家若不看着 NPC,他在墙另一边照样寻路抢桩。等于"NPC 跟我没关系"的存在,失去了 NPC 作为压力来源的命力。
2. **NPC 铁定地走 idle → moving → occupying**,没有"遇到过 NPC 但没动身去抢桩"的拟人化变种——所有 NPC 一进 idle 都立刻选目标动身,缺少犹豫/闲逛的真实感。

根本动因: **沉浸感/拟人化**为主(让 NPC 看起来像带着手机找桩的真人);策略压力是顺带赠送。

## 目标

- 在视线系统(`hasLineOfSight`,现存)之上加门控:玩家看不到的 NPC 一律冻结,不计时不动。
- 加一个 `wander` 状态到现有 `idle/moving/occupying` 状态机:从 idle 出来时掷骰,可能去闲逛而不是去抢桩。
- NPC 闲逛完回 idle,重置 idleTimer,再掷下一次(状态机是真循环,不是"走过一次就完了")。

## 非目标(YAGNI)

- 不做 NPC 间个性差异(flaky/prowler 等"人格"标签)
- 不做"视线外减速"的后台仿真
- 不做视线锥角(360° LoS 用 hasLineOfSight 直线,已有)
- 不做 minimap 上的 NPC 状态额外可视化(头顶箭头配色已是)

## 设计

### 状态机变更

原:
```
idle (2-5s) → moving → occupying (永久)
```

新:
```
idle (2-5s)
  ├─ 50% → wander (随机走到附近某点,不占桩)
  │         ↓ 到点
  │       idle (重置 idleTimer,重新掷骰)
  └─ 50% → moving → occupying (永久)
```

`wander` 语义: NPC 像在桌之间徘徊找座的走。不取桩目标、不收结束事件、只是到点回 idle 再决定。它给了玩家"这个 NPC 犹豫了,我赶紧抢"的拟人化压力反馈。

### 视线门控

`npc.update(dt)` 进入状态机分支之前,**对每个 NPC 判一次**:

```
if (withoutLineOfSight(player, npc)) return;
```

**含义**:
- 看不到的 NPC 整体跳过 update:不递减 idleTimer、不推进 path、不掷骰。
- 玩家躲在没有视线的角落 → 所有看不到的 NPC 暂停 → 电池还在掉(180s 机制不变)→ 玩家得主动离开角落去找桩才有人竞抢 → 探索玩法循环成立。
- 已进入 `occupying` 的 NPC 不需要后续更新(本就永久占用),冻结对它无影响。

**视线复用**: `hasLineOfSight(playerX, playerZ, npcX, npcZ, losBoxes)`,与 `nearOutlet` 用同一 `losBoxes = toLosBoxes(colliders)`,过滤矮家具(桌/椅不算遮挡)。复用现有 `main.ts:104` losBoxes 构造。

### 配置(`config.ts npc:` 段)

```ts
npc: {
  count: 3,
  walkSpeed: 2.2,
  idleMinSec: 2,
  idleMaxSec: 5,
  arriveDist: 0.8,
  // 新增:
  wanderChance: 0.5,     // idle 结束时掷骰走 wander 的概率(0.5 = 50%)
  wanderRadius: 4,       // wander 目标点距离上限(m),在 NPC 附近 0~4m 找 free cell
},
```

已删除字段: `occupyMinSec`, `occupyMaxSec`(永久占用后无计时)—— 实现阶段一并从 config 删,清干净。

### 实现要点

**`npc.ts`**:
1. `NpcState` 加 `'wander'` 成员
2. `NpcEntity` 复用 `path/pathIdx/pathX/pathZ`(wander 也走 A*;目标在 `wanderRadius` 球内随机找一个 free cell)
3. idle 分支结束掷骰: `rng() < cfg.wanderChance ? pickWanderTarget() : pickReachableOutlet()`
4. **新分支** `else if (e.state === 'wander')`: 复用 path-following 走法;走完 pathIdx → 切回 idle + 重置 idleTimer(真循环)
5. `update(dt, losInfo)` 签名加 `losInfo: { playerX, playerZ, losBoxes } | undefined`:进入循环时先 `if (losInfo && !hasLineOfSight(...)) continue` 跳过此 NPC。`undefined` 时跳过门控(测试兼容)。

**`main.ts`**:
- 每帧调用 `npcController.update(dt, { playerX, playerZ, losBoxes })`,直接复用 `losBoxes`(已有,行 104)。
- 单元测试兼容不传视为不过滤(旧测试不连玩家/LOS)。

**`npcMesh.ts`**:
- 新颜色: wander = 橙 `0xff9b3a`(rgba 255,155,58),opacity 0.9。与 idle 绿、moving 黄区分明显。
- `STATE_COLOR` / `STATE_OPACITY` 加 wander 项。

**`config.ts`**:
- 加 `wanderChance`, `wanderRadius`;删 `occupyMinSec`, `occupyMaxSec`(无释放机制后无意义)。

### 测试计划(在 `npc.test.ts` 扩展)

新增:
1. `wander 目标在 radius 内` —— 掷骰到 wander 分支,targetOutletIndex=-1,进入 wander,path 非空且 endpoint 距 NPC ≤ wanderRadius
2. `wander 完成回 idle 并重置 idleTimer` —— 跑完 path,确认 state=idle,targetOutletIndex=-1,idleTimer 在 [idleMinSec, idleMaxSec] 间(证明是"重新掷骰"不是"结束")
3. `视线阻断时 NPC 完全不动` —— 喂 losInfo 含一道墙恰好挡 player→NPC,update(60),NPC 位置/状态/idleTimer 不变
4. `occupying 永久持有(回归)` —— 沿用现有占用后 60s/120s 仍 occupying 测试,确保新视线门控不破坏永久占用
5. `losInfo===undefined 时不过滤(兼容旧测试)` —— 喂 undefined,NPC 正常移动;证明无 losInfo 时状态机照常跑

清理:
- 占用 8-15s 后释放的旧测试(已在前一个 commit 删除)
- 配置里 occupyMinSec/Max 测试引用同步扫掉

### 风险与平衡

- **wanderChance=0.5 高→玩家无压力**:初始定 0.5 后期可降;留 `config` 一行可调不需改代码
- **视线门控可被滥用**:玩家可刻意绕墙躲到没 NPC 视线区,但电池 180s 强制出关不破玩法
- **wander 在小空间找不到 free cell**:降级为切回 idle(你 wander 找不到地方就发呆,符合拟人)
- **多个 NPC 同时 freeze 玩家不察觉**: 电池时钟仍在走,且 minimap 不显 NPC state —— 玩家只能靠远处桩主动变红才洞悉

### 实施 PR 划分

单 PR,5 文件改动(`npc.ts` + `npcMesh.ts` + `config.ts` + `main.ts` + `npc.test.ts`)。预计 ~40 行实现代码 + ~30 行测试。

### 验证标准

- `npm run typecheck && npm run test` 全绿
- 手测开局:NPC 出现犹豫(头顶橙箭头)的样子;玩家躲墙后 NPC 均停下
- 平衡:`wanderChance=0.5` 推荐初始,实测若 NPC 不抢桩 → 降到 0.3 / 0.2