# 《1% 电》数值调优表

> 所有可调手感数值集中在此文档 + `src/game/config.ts`。playtest 后改这里 → 同步 config → commit。
>
> **调试方式**:打开 `src/game/config.ts`,按下表"代码位置"列找到对应行,直接改数字保存,Vite HMR 热更新,无需重启。
>
> rule 7 例外:本文件(docs-only *.md)微调可直 commit main,无需 PR。但 `config.ts` 数值同步必须走 PR(代码变更)。
>
> 日期:2026-08-08(初版,随 PR #13 创建)

---

## 电池系统

| 参数 | 当前值 | 代码位置 | config 路径 | 说明 |
|---|---|---|---|---|
| startPercent | 0.10 | `src/game/config.ts:29` | battery.startPercent | 开局电量(1% 电主题);PR #13 从 1.0→0.10 |
| totalGameTimeS | 180 | `src/game/config.ts:31` | battery.totalGameTimeS | 标称满电续航 |
| baseDrain | 0.10/180 | `src/game/config.ts:30` | battery.baseDrain | 本底耗电;**方案 B**:`startPercent / totalGameTimeS`,让 10% 仍玩 180s |
| appMult.RADAR | 3 | `src/game/config.ts:33` | battery.appMult.RADAR | 开 RADAR 耗电倍率 |
| appMult.MAP | 2 | `src/game/config.ts:34` | battery.appMult.MAP | 开 MAP 耗电倍率 |
| appMult.QUERY | 4 | `src/game/config.ts:35` | battery.appMult.QUERY | 开 QUERY 耗电倍率 |

**方案 B 公式**:`实际游戏时长 = startPercent / baseDrain = totalGameTimeS`(满电续航不变,百分比是显示数字)

**方案 A(不采用)**:`baseDrain = 1/180`,startPercent=0.10 玩 18 秒太短。

**消费方**(改这些数字影响哪些文件):
- `src/game/battery.ts:13-16` — BatteryConfig 接口读取
- `src/game/battery.ts:33-35` — drainFactor 求和 RADAR/MAP/QUERY
- `src/game/battery.ts:48-56` — updateBattery 用 baseDrain × factor × dt 扣电
- `src/game/battery.ts:45` — 重置时回 startPercent
- `src/game/playerStats.ts:63-65` — 把 CONFIG.battery 映射成 BatteryConfig

---

## 能量系统(dash)

| 参数 | 当前值 | 代码位置 | config 路径 | 说明 |
|---|---|---|---|---|
| startEnergy | 1.0 | `src/game/config.ts:23` | dash.startEnergy | 满能量 |
| drainPerSec | 0.4 | `src/game/config.ts:24` | dash.drainPerSec | 冲刺消耗速率(2.5s 用完);PR #12 从 0.5→0.4 |
| regenPerSec | 0 | `src/game/config.ts:25` | dash.regenPerSec | 单局不补 |
| dashMult | 3 | `src/game/config.ts:26` | dash.dashMult | 冲刺速度倍率 |

**消费方**:
- `src/game/dash.ts:14-17` — DashConfig 接口
- `src/game/dash.ts:35` — `state.energy - cfg.drainPerSec * dt` 扣能量
- `src/game/dash.ts:36` — 返回 `cfg.dashMult` 作速度倍率
- `src/game/dash.ts:40` — `cfg.regenPerSec > 0` 才回补(当前 0 = 不补)
- `src/game/dash.ts:46` — 重置回 startEnergy
- `src/game/playerStats.ts:73-76` — CONFIG.dash 映射
- `src/player/thirdPersonController.ts` — controller 通过 `getDashMult` 回调读 dashMult(不直接读 config)

---

## 玩家移动

| 参数 | 当前值 | 代码位置 | config 路径 | 说明 |
|---|---|---|---|---|
| walkSpeed | 3.0 | `src/game/config.ts:4` | player.walkSpeed | 步行速度 m/s |
| sprintSpeed | 5.6 | `src/game/config.ts:5` | player.sprintSpeed | sprint 速度(目前未用,冲刺走 dashMult) |
| radius | 0.32 | `src/game/config.ts:6` | player.radius | 碰撞半径 |
| turnLerp | 14 | `src/game/config.ts:7` | player.turnLerp | 转向插值速率 |
| turnRate | 2.0 | `src/game/config.ts:8` | player.turnRate | 视角 D 转向速率 rad/s;PR #12 顺手从 3.0→2.0 |

**消费方**:
- `src/player/thirdPersonController.ts` — 全部读 CONFIG.player;turnRate 是 A/D 键 yaw 旋转速率,walkSpeed 是 W/S 前后速度,radius 是 AABB 碰撞推回

---

## 相机

| 参数 | 当前值 | 代码位置 | config 路径 | 说明 |
|---|---|---|---|---|
| fov | 70 | `src/game/config.ts:11` | camera.fov | 视野角 |
| near | 0.05 | `src/game/config.ts:12` | camera.near | 近裁切面 |
| far | 80 | `src/game/config.ts:13` | camera.far | 远裁切面 |
| dist | 2.7 | `src/game/config.ts:14` | camera.dist | 越肩距离 |
| side | 0.35 | `src/game/config.ts:15` | camera.side | 越肩偏移 |
| up | 1.35 | `src/game/config.ts:16` | camera.up | 越肩高度 |
| collidePad | 0.25 | `src/game/config.ts:17` | camera.collidePad | 碰撞 padding |
| collideSteps | 8 | `src/game/config.ts:18` | camera.collideSteps | 碰撞细分步数 |
| dampLambda | 12 | `src/game/config.ts:19` | camera.dampLambda | 阻尼频率 |
| minDist | 1.4 | `src/game/config.ts:20` | camera.minDist | 碰撞 clamp 最近;PR #11 加 |

**消费方**:
- `src/main.ts:17-22` — PerspectiveCamera 构造用 fov/near/far
- `src/player/thirdPersonController.ts` — 越肩相机更新读 dist/side/up/collidePad/collideSteps/dampLambda/minDist

---

## NPC

| 参数 | 当前值 | 代码位置 | config 路径 | 说明 |
|---|---|---|---|---|
| count | 3 | `src/game/config.ts:39` | npc.count | NPC 占位数;PR #13 从 5→3(playtest 再调) |

**消费方**:
- `src/scene/loadLibraryScene.ts:770` — `randomizeOccupiedOutlets(count, seed)` 默认参数读 CONFIG.npc.count
- `src/main.ts` (PR #13 David 改)— restart 时传 `CONFIG.npc.count` 作 count 参数

---

## HUD 提示系统(PR #13 新增)

| 参数 | 当前值 | 代码位置 | config 路径 | 说明 |
|---|---|---|---|---|
| promptRange | 1.5 | `src/game/config.ts:42`(PR #13 加) | hud.promptRange | 近空桩触发左上 prompt 距离 m |
| objectiveText | "电量耗尽之前找到充电位置" | `src/game/config.ts:43`(PR #13 加) | hud.objectiveText | 中下常驻任务条文案 |

**消费方**(PR #13 实现后):
- `src/main.ts` getSharedState wrap — `nearOutlet = outlets.some(o => !o.occupied && dist < CONFIG.hud.promptRange)`
- `src/main.ts` — `mountGtaPrompt({ objectiveText: CONFIG.hud.objectiveText })`
- `src/ui/gtaPrompt.ts` — RAF 读 `state.nearOutlet` 控制左上 prompt 显隐;启动时读 objectiveText 写入中下任务条

**同时影响 main.ts 现有 E 键胜利判定**(`src/main.ts:108-109`):
- E 键 handler 用硬编码 `< 1.5` 距离判胜,与 `hud.promptRange=1.5` 同值但未联动
- PR #13 可选:把 `1.5` 改为 `CONFIG.hud.promptRange` 让两处联动调(promptDistance = 胜利距离,改一处免脱节)

---

## 胜利判定

| 参数 | 当前值 | 代码位置 | 位置说明 | 备注 |
|---|---|---|---|---|
| winDistance | 1.5 | `src/main.ts:109` | E 键 handler `Math.hypot(...) < 1.5` | 与 hud.promptRange 同值,可联动(见上节) |

---

## 四人桌 1 桩逻辑(PR #13 新增)

| 参数 | 当前值 | 代码位置 | 位置说明 | 备注 |
|---|---|---|---|---|
| seatsPerTable | 4 | `src/scene/loadLibraryScene.ts:638-661`(SEAT_OFFSETS × 2 side) | buildOneStudyTable 座位循环 | 4 座位都坐 NPC = 桩占;1-3 空 = 桩空 |
| outletsPerTable | 2(共享 1 个 state) | `src/scene/loadLibraryScene.ts:628-636`(STUDY_OUTLET_OFFSETS) | buildOneStudyTable outlet 循环 | 视觉 2 个 mesh,数据 1 个 outlet(PR #13 #4 改) |

**关键数据结构**(PR #13 David 改):
- `outletPositions: Array<{x,z,occupied}>` — 每 studyTable 1 项(不再 2 项)
- `outletMeshGroups: THREE.Mesh[][]` — 新增,每 outlet 对应一个 mesh 数组(柱/端板单元素,studyTable 双元素,壁插空数组)
- `setOutletOccupied(index, occ)` 遍历 `outletMeshGroups[index]` 全切色

---

## Playtest 待调(2026-08-08 初版,优先级排序)

### 高优先级(影响单局体验)

- [ ] **startPercent** 试 0.05 / 0.10 / 0.15 / 0.20 → 改 `src/game/config.ts:29`,挑紧张但不绝望的值
- [ ] **npc.count** 试 2 / 3 / 5 → 改 `src/game/config.ts:39`,挑"有竞争但不绝望"的值
- [ ] **turnRate** 试 1.5 / 2.0 / 2.5 → 改 `src/game/config.ts:8`,挑舒服的转向(用户反馈 3.0 太快)

### 中优先级(影响手感)

- [ ] **drainPerSec** 试 0.3 / 0.4 / 0.5 → 改 `src/game/config.ts:24`,挑冲刺够用但不浪费的值
- [ ] **appMult 各值** 试 (2,3,4) vs (1.5,2.5,3.5) vs (3,2,4) 排序 → 改 `src/game/config.ts:33-35`,挑有开户策略感的组合
- [ ] **camera.dist** 试 2.2 / 2.7 / 3.2 → 改 `src/game/config.ts:14`,挑看得到角色 + 看得到环境的平衡

### 低优先级(jam 后调)

- [ ] walkSpeed 试 2.5 / 3.0 / 3.5 → `src/game/config.ts:4`
- [ ] dashMult 试 2 / 3 / 4 → `src/game/config.ts:26`
- [ ] camera.fov 试 65 / 70 / 75 → `src/game/config.ts:11`

---

## 历史变更记录

| 日期 | 参数 | 旧值 | 新值 | PR | 理由 |
|---|---|---|---|---|---|
| 2026-08-06 | dash.drainPerSec | 0.5 | 0.4 | PR #12 | pip 连续能量条重写,改按时间计 |
| 2026-08-06 | dash.startEnergy | 3(整数 pip) | 1.0(连续 0~1) | PR #12 | pip 改连续能量条 |
| 2026-08-06 | player.turnRate | 3.0 | 2.0 | main 顺手 commit | 用户反馈视角转速太快 |
| 2026-08-08 | battery.startPercent | 1.0 | 0.10 | PR #13 | 1% 电主题;方案 B 实际仍玩 180s |
| 2026-08-08 | npc.count | 5 | 3 | PR #13 | 用户要求"调少给我感受" |