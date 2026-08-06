# PR #10: Dash Pip + 电池消耗 + Camera minDist — 设计 spec

> **依据**:`spec/MASTER-SPEC.md` §4(资源系统,锁定数值)+ §7.3(SharedState 接口)+ §10/§11(决策 13 相机 damp、backlog #001/#002)+ 附录 C(PR #10 待写清单)。本 spec 仅补实骨架/公式/状态机/验收,**不质疑 §4 锁定数值**。
>
> **作者**:David(独立 agent B)。**Reviewer**:Snake(主程序员)+ John(总程序员 review only)。
>
> **文件边界**(AGENTS rule 11):可改 `src/game/**` + `src/player/thirdPersonController.ts` + 本 spec + `src/main.ts` 仅三处例外(Clock→Timer、mountPlayerStats 接线、Shift/方向 input 接 dash);**严禁** `src/ui/**` `src/scene/**` `src/debug/**` `src/platform/sharedState.ts`。

---

## 0. 待 Snake 决策的歧义(写在最前,不靠猜)

阅读 master spec + 用户 dispatch 指令时发现 3 处歧义,**列此待决策**,实现时先按"推荐选项"做,Snake 可在 review 时翻案。

### 0.1 电池消耗公式(Unit: %/s vs 直接倍率)

**歧义**:

- master spec §4.1 原文:"本底 1%/s 持续掉""开 RADAR ×3、开 MAP ×2、开 QUERY ×4;多 app 叠加(RADAR+MAP = ×5)"
- 用户 dispatch 指令:"drain = baseDrain × (1 + Σ app 倍率) × dt"
- master spec §3.2 表:"RADAR ×3 / MAP ×2 / QUERY ×4 / Home ×1 本底"
- master spec §4.1 又说"开局 1% = 180 秒"

**问题**:
1. 若按用户公式 `drain = baseDrain × (1 + Σ mult) × dt` 且 `baseDrain=1.0`、单 RADAR(`Σ mult=3`):drain = 1.0 × (1+3) = **4 %/s**,但 §3.2 锁定值是 **×3 整档**。
2. 只有公式 `drain = baseDrain × max(1, Σ mult) × dt`(基数为本底 ×1,app 倍率取总和、不足 1 取 1)能同时复现所有锁定数据点:
   - Home(全关):max(1, 0)=1 → ×1 ✓
   - RADAR:max(1, 3)=3 → ×3 ✓
   - MAP:max(1, 2)=2 → ×2 ✓
   - QUERY:max(1, 4)=4 → ×4 ✓
   - RADAR+MAP:max(1, 3+2)=5 → ×5 ✓
3. 单位矛盾:"1%/s 本底"+"180s = 0% 起步"若 baseDrain=1.0%/s,180 秒本底刚好耗光,但 spec 同时给 app 倍率,开户就不到 180s。最自洽的解读:**单位是"1%/s 只是叙事说法,实际 baseDrain 单位 = (1.0 / totalGameTimeS) %/s-per-base-unit"**,180s 是"完全瞎走(×1)条件下"的端到端时长。但 §4.1 行文更像直接 "%"。

**推荐选项 A**(本 spec 采用):`drainPerSec = baseDrain × max(1, Σ appMult)`,其中 `baseDrain = 1.0 / totalGameTimeS`(单位是 fraction/sec,即 1.0/180 ≈ 0.00556 fraction/s)
- 含义:360 ÷ 180 = 0.2s baseDrain 单位为 "fraction/sec",180 秒本底刚好耗光 1.0 → 0;开户按 mult 加速。
- 好处:180s 锁定时长在 Home 状态可复现;数值自洽;nan 百分比显示 = battery × 100。
- **需 Snake 确认**:此公式与 §4.1 "1%/s 本底"行文的吻合性(是不是叙事说法 vs 实际 1/180/s)。

**推荐选项 B**(备选):`drainPerSec = baseDrain × (1 + Σ appMult) × dt`,baseDrain 占位填 0.2(直接 %/s)
- 含义:baseDrain=0.2%/s,180s 本底耗 36%,加上开户平均一局耗光。
- 不选:与锁定数据点不符(RADAR 应 ×3 但此式得 ×4)。

### 0.2 CONFIG.battery 现有占位字段 vs spec schema 不匹配

**现象**:现 `src/game/config.ts` `battery` 段是 `drainMove / drainSprint / drainApp / drainIdle / totalGameTimeS`(下层毕业生手填旧 schema),**与 §4.1 锁定模型不符**。§4 是"本底 1×/s + app 倍率"两段叠加,无 Move/Sprint/Idle 区分。

**待决策**:是直接覆写这些字段为新 schema(本 spec 推荐,字段名变),还是保留旧字段做向后兼容(无消费方,实际无影响)?

**推荐**:直接覆写为 `startPercent / baseDrain / totalGameTimeS / appMult { RADAR, MAP, QUERY }`。无现有消费方(grep 确认仅 config.ts 自己引用),向后兼容无价值。

### 0.3 文件边界冲突(src/platform/sharedState.ts)

**现象**:
- 用户 dispatch "严禁动":`src/platform/sharedState.ts`
- 用户 dispatch "例外可动 src/main.ts":第 2 条 "接通 mountPlayerStats 调用所消费的 SharedState 真实更新(battery/pips 实时)"
- master spec §7.3 注释:"PR #10 填 battery/pips"
- 但 SharedState 的 `getSharedState()` 现在**硬编码**返回 `battery: 1.0, pips: 3`,stub 实现写在 `sharedState.ts` 里

**冲突**:SharedState 是 `readonly SharedState` 数据契约 + 实现 facade。Ai 不改 `sharedState.ts` 的话,SharedState 永远是 1.0/3 硬编码;改了就违反"严禁动"。

**推荐选项**(本 spec 采用):**不改 `sharedState.ts` 文件**,改在 `mountPlayerStats(opts)` 里订阅 SharedState 写入端。具体做法:
- `createSharedStateFacade` 返回对象加一个 `setBatteryPips(b: number, p: number)` 写入器(但此函数定义在 sharedState.ts——违禁)
- 替代方案(本 spec 采用):**在 `mountPlayerStats` 里创建 BatteryState + DashState 实例,通过 `main.ts` 主循环每帧调用 `mountPlayerStats` 返回的 update fn**,把值经 SharedState facade 的可变状态槽写入。
- **现实最简方案**(实施时,需 Snake 默许):main.ts 的 `createSharedStateFacade` 改为接受一个外部 mutable `runtimeStats = { battery, pips }` 引用,getSharedState() 读 runtimeStats 而非硬编码。**这等价于改 sharedState.ts**。**此决策列待 Snake 拍板**。

**临时默认**(我实施时先走):**只改 main.ts 接线,不改 sharedState.ts 文件本身**——在 main.ts 创建 `const runtimeStats = { battery: 1.0, pips: 3 }` 时,把 getSharedState 调用点的返回值改写为读 runtimeStats(即 main.ts 不直接调 createSharedStateFacade 的旧 getSharedState,而是包一层 newGetSharedState,return 时覆盖 battery/pips 字段)。这样 sharedState.ts 文件 0 改。**Snake 若允许我改 sharedState.ts facade 实现(签名不变),更干净**。

---

## 1. 文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/game/config.ts` | 修改 | `dash`/`battery` schema 占位 → 锁定实数;`camera.minDist=1.4` 新增 |
| `src/game/battery.ts` | 新建 | `BatteryState` 类 + `updateBattery(state, appOpen, dt)` 纯函数 + game-over 终态检测 |
| `src/game/battery.test.ts` | 新建 | 4 单测:基线 ×1 drift / 单 app 倍率 / 多 app 叠加 / 0% 边界 |
| `src/game/dash.ts` | 新建 | `DashState` 类 + 状态机 + cooldown + pip 守恒 + 方向门控 |
| `src/game/dash.test.ts` | 新建 | 4 单测:pip 3→0 递减 / cooldown 门 / 方向门控 / 单局不补 |
| `src/game/playerStats.ts` | 修改 | stub → 真实 BatteryState + DashState 实例化 + 暴露 `step(dt, input, appOpen)` |
| `src/player/thirdPersonController.ts` | 修改 | camera.position 算完后 5 行 minDist clamp |
| `src/main.ts` | 修改(3 处例外) | Clock→Timer;主循环接 mountPlayerStats 的 step;Shift/方向 input 消费 |
| `spec/2026-08-04-dash-battery-design.md` | 本文件 | — |

---

## 2. 电池系统(`src/game/battery.ts`)

### 2.1 数据结构

```ts
export interface BatteryState {
  percent: number;       // 0~1, 1.0 = 满
  isTerminal: boolean;   // percent <= 0 后置 true, 单次 fire
}

export interface BatteryConfig {
  startPercent: number;     // 1.0
  baseDrain: number;        // 见 §0.1, = 1.0 / totalGameTimeS
  totalGameTimeS: number;   // 180
  appMult: { RADAR: number; MAP: number; QUERY: number };  // {3, 2, 4}
}

export interface AppOpenState {
  // phone HUD 当前各 app 是否开——读 SharedState 的派生量,game 层不持有 UI
  RADAR: boolean;
  MAP: boolean;
  QUERY: boolean;
}
```

### 2.2 核心函数

```ts
export function createBattery(cfg: BatteryConfig): BatteryState;

// 每帧调用。drain = cfg.baseDrain * max(1, Σ appMult_i(若 open)) * dt
// percent 减到 0 后 clamp 0, 置 isTerminal=true (一次)
export function updateBattery(
  state: BatteryState,
  cfg: BatteryConfig,
  appOpen: AppOpenState,
  dt: number,
): void;

// 重开新局时
export function resetBattery(state: BatteryState, cfg: BatteryConfig): void;
```

### 2.3 消耗公式(锁定)

```text
Σmult = appMult.RADAR * appOpen.RADAR + appMult.MAP * appOpen.MAP + appMult.QUERY * appOpen.QUERY
factor = max(1, Σmult)        // Home(全关) = 1, 单 RADAR = 3, RADAR+MAP = 5
drainPerSec = cfg.baseDrain * factor
state.percent = max(0, state.percent - drainPerSec * dt)
if (state.percent <= 0 && !state.isTerminal) state.isTerminal = true
```

`baseDrain = 1.0 / 180 ≈ 0.00556 fraction/s` → Home 180s 耗光 1.0(§0.1 推荐选项 A,待 Snake 确认)。

### 2.4 终态处理

`isTerminal=true` 时上层(`mountPlayerStats` 调用方 main.ts)负责触发 game over UI / 黑屏。本 PR 暂用 `console.warn('[battery] terminal')` + `SharedState.battery=0`,不发 hook(避免跨 PR 引入新 event bus)。UI 黑屏由 Sam 在 PR #9 手机 HUD 内消费 SharedState.battery ≤ 0 实现。

---

## 3. Dash Pip 系统(`src/game/dash.ts`)

### 3.1 状态机

```text
                  RequestDash(hasDir=true, pip>0, cooldown==0)
       idle  ─────────────────────────────────────────►  dashing
         ▲                                                │
         │              0.4s 过                          ▼
         ◄───────────────────────────────────────── cooldown
         │              0.5s 过                          │
         │                                                ▼
         (pip=0 或一直无方向输入 → 留在 idle)
```

### 3.2 数据结构

```ts
export type DashPhase = 'idle' | 'dashing' | 'cooldown';

export interface DashState {
  pips: number;            // 0~3
  phase: DashPhase;
  phaseTimer: number;      // 当前 phase 剩余秒数
}

export interface DashConfig {
  startPips: number;       // 3
  dashDurationS: number;    // 0.4
  dashMult: number;         // 3 (速度倍率)
  cooldownS: number;        // 0.5
}

// 方向输入门控:WASD 中无任一按下 → 不允许触发(防误操作,§4.2)
export interface DirectionInput {
  fwd: number;   // -1, 0, +1
  strafe: number;
}

// 请求时主循环调; 返回此次是否真触发(消耗 1 pip)
export function requestDash(state: DashState, cfg: DashConfig, input: DirectionInput): boolean;

// 每帧调,推进 phaseTimer / 自动转 phase
export function updateDash(state: DashState, cfg: DashConfig, dt: number): void;

// 当前速度倍率(供 controller 读): dashing=cfg.dashMult, 否则 1
export function getDashSpeedMult(state: DashState, cfg: DashConfig): number;

// 重开新局:pips 满, phase=idle
export function resetDash(state: DashState, cfg: DashConfig): void;
```

### 3.3 触发判定

```text
requestDash(state, cfg, input):
  if (state.phase !== 'idle'):              return false
  if (state.pips < 1):                      return false
  if (input.fwd === 0 && input.strafe === 0): return false   // §4.2 方向门控
  state.pips -= 1
  state.phase = 'dashing'
  state.phaseTimer = cfg.dashDurationS
  return true

updateDash(state, cfg, dt):
  if (state.phase === 'idle'): return
  state.phaseTimer -= dt
  if (state.phaseTimer > 0): return
  if (state.phase === 'dashing'):
    state.phase = 'cooldown'
    state.phaseTimer = cfg.cooldownS
  else:  // cooldown
    state.phase = 'idle'
    state.phaseTimer = 0
```

### 3.4 单局 pip 不补

`resetDash` 仅在新一局开始时调用,局内**无任何 pip 补给函数**。

---

## 4. Camera minDist clamp(backlog #001)

### 4.1 config 增加

```ts
camera: {
  // ... 既有字段
  minDist: 1.4,   // 相机离 head 最近距离(米); 撞墙宁可侧滑不贴脸
}
```

### 4.2 thirdPersonController.ts 改动(5 行)

在 `camera.position.lerp(targetCamPos, dampFactor)` **之后**(即 damp 已算最终位置之后)、`camera.lookAt(lookTarget)` 之前插入:

```ts
const dir = tmp.subVectors(camera.position, headPos);
const dist = dir.length();
if (dist < CONFIG.camera.minDist) {
  dir.multiplyScalar(CONFIG.camera.minDist / dist);
  camera.position.copy(headPos).add(dir);
}
```

**副作用**(事先告知 review):墙角极限场景下可能看见墙内(目前无墙 mesh,无视觉影响);角色半身可能短暂出现,可接受(符合 backlog 提示)。

---

## 5. THREE.Clock → THREE.Timer(backlog #002)

### 5.1 src/main.ts:95

```ts
- const clock = new THREE.Clock();
+ const timer = new THREE.Timer();
```

### 5.2 src/main.ts:98(animate 内)

```ts
  function animate() {
    requestAnimationFrame(animate);
-   const dt = Math.min(clock.getDelta(), 0.1);
+   timer.update();
+   const dt = Math.min(timer.getDelta(), 0.1);
    ...
  }
```

**已验证 Three.js v0.185.1 exports `Timer`**(通过 `node -e "import('three').then(m=>{const t=new m.Timer();t.update();console.log(t.getDelta())})"` 实测),方法签名:`Timer` prototype = `connect / disconnect / getDelta / getElapsed / getTimescale / setTimescale / reset / dispose / update`。

---

## 6. config.ts 实数值(锁定)

```ts
export const CONFIG = {
  // ... world / player / camera(加 minDist: 1.4) 不变
  dash: {
    startPips: 3,
    dashDurationS: 0.4,      // spec §4.2 锁定 0.4s ×3
    dashMult: 3,             // ×3 速度
    cooldownS: 0.5,          // spec §4.2 锁定 0.5s
  },
  battery: {
    startPercent: 1.0,
    baseDrain: 1.0 / 180,    // ≈ 0.00556 fraction/s; Home 端到端 180s §0.1 选项 A
    totalGameTimeS: 180,
    appMult: {
      RADAR: 3,              // §3.2 锁定
      MAP: 2,                // §3.2 锁定
      QUERY: 4,              // §3.2 锁定
    },
  },
  // ... npc 不动
} as const;
```

旧占位字段(`pipCost / durationS / drainMove / drainSprint / drainApp / drainIdle`)直接删除(无消费方,grep 已确认)。

---

## 7. main.ts 接线(3 处例外)

### 7.1 主循环 step 接入

```ts
// 在 mountPlayerStats 给的返回里取 step 函数
const playerStats = mountPlayerStats({ getSharedState });   // PR #10 改返回

function animate() {
  requestAnimationFrame(animate);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  controller.update(dt);
  update(dt);
  playerStats.step(dt, controller.getInput?.(), getPhoneAppOpen?.());   // 待定 API §0.3
  ...
}
```

### 7.2 Shift + 方向 input 喂 dash

`thirdPersonController.ts` 现已经把 Shift 用作 sprintSpeed 加速(L112),PR #10 后:
- Shift 不再直接做 speed 倍率(改为 controller 读 `getDashSpeedMult(state)` 决定乘 dashMult 还是 walkSpeed)
- Shift 按下沿抖触发 `requestDash`(edge-trigger 而非 level-trigger,防持续按住连耗所有 pip)

**实现位置**:thirdPersonController 内捕获 shift 的 keydown **edge**(按键StateManager),把独占的"RequestDash 信号"通过 `getInput()` return 给 main.ts → mountPlayerStats.step 消费。

**注意**:`getInput()` 是 thirdPersonController 新 export 方法,**算可改 thirdPersonController.ts 边界内**,不违反 §0.3。

### 7.3 phone app 状态来源(Sam 守的)

mountPlayerStats 需要 `AppOpenState`(开/关),但 phone HUD(Sam 的)向 main 发 AppAction,不是直接报 AppOpen。**待 Snake 决策**:用 Sam 的 AppAction 流派 mountPlayerStats 内维护一个软状态(切换式)+ Sam 改 mountPhoneHud 外壳不变。**临时方案(实施时)**:在 main.ts 维护 `const appOpen = { RADAR:false, MAP:false, QUERY:false }`,`mountPhoneHud` 现状是 stub 不真报——本 PR 跑空载(全 false → ×1 idle),Sam 接通后由 Sam 在 PR #9 通过新 onAppAction callback 改 appOpen。**需 Snake 与 Sam 协调接线点**。

---

## 8. 验收标准(8 项,对应 layer1 spec §11 A-H 格式)

- [ ] **A. `src/game/battery.ts`**:`BatteryState` 类(percent + isTerminal),启动 percent=1.0,`updateBattery` 按 §2.3 公式:开 RADAR=×3,单 MAP=×2,RADAR+MAP=×5(单位 fraction/sec = `baseDrain × max(1, Σ mult) × dt`),percent ≤ 0 置 isTerminal=true(一次)。
- [ ] **B. `src/game/dash.ts`**:`DashState` 类(startPips=3,phase=idle/dashing/cooldown),`requestDash` 含 3 道门(phase==idle / pips ≥ 1 / input.fwd/strafe 非全零),消耗 1 pip + 进入 dashing(0.4s)+ 自动转 cooldown(0.5s)+ 自动回 idle;`getDashSpeedMult` 在 dashing 时返 cfg.dashMult,其余 1;`resetDash` 重置满 pips。
- [ ] **C. `battery.test.ts` 至少 4 个 case**:
  - C1 idle(全 app 关)100s 后 percent = 1 - 100×(1/180) ≈ 0.4444
  - C2 开 RADAR 1s:drain = (1/180) × 3 × 1 = 1/60 ≈ 0.01667
  - C3 开 RADAR+MAP 1s:drain = (1/180) × 5 × 1 = 1/36
  - C4 0% 边界:percent 达 0 后 clamp 0,isTerminal 从 false → true 一次,再 update 不二次触发
- [ ] **D. `dash.test.ts` 至少 4 个 case**:
  - D1 pip 3 → 2 → 1 → 0 连续 3 次 requestDash(均 hasDir),第 4 次 false
  - D2 dashing 期间 requestDash 返 false(phase 门)
  - D3 无方向(input.fwd=0,strafe=0)requestDash 返 false,不耗 pip(方向门控)
  - D4 dashing 0.4s → cooldown 0.5s → idle;cooldown 期间 requestDash 返 false;cooldown 完后 requestDash true 触发
- [ ] **E. `npm test` ≥ 8 tests pass**(原 6 + 新 4 battery + 新 4 dash = 14)。不破坏原 gridModel(2)/pathfinding(4)单测。
- [ ] **F. `src/game/config.ts`** `dash` + `battery` 字段从占位 → 锁定实数(§6),`camera.minDist = 1.4` 新增,旧占位字段(`pipCost / durationS / drainMove / drainSprint / drainApp / drainIdle`)删除。
- [ ] **G. `src/game/playerStats.ts mountPlayerStats`** 实现成真实 BatteryState + DashState 实例化,每帧 `step(dt, input, appOpen)` 推进,把 percent / pips 写进 SharedState 供 UI 读(通过 §0.3 推荐方案)。
- [ ] **H. `src/main.ts`** + `src/player/thirdPersonController.ts` backlog 清完:
  - H1 `THREE.Clock` → `THREE.Timer`(配置 `timer.update() / timer.getDelta()`)
  - H2 `camera.minDist clamp` 5 行生效
  - H3 Shift 信号 edge-trigger 经 `getInput()` 喂 `requestDash`;controller 用 `getDashSpeedMult` 决定速度

附加约束:
- 全部新增单测 vitest,`src/game/` 仍纯 TS 无 Three/DOM 依赖(rule 1,本地无 window/three import)
- 不引入任何新 npm 包
- dt 一律 clamp 0.1s 上限(rule 5,main.ts 保留)
- `npm run build` 绿
- `src/platform/sharedState.ts` 文件 0 改(签名不变)—— SharedState 只 implements 不改

---

## 9. 提交分块规划(每块 build+test 绿)

1. `docs: dash/battery design spec`(本文件)
2. `feat(config): lock dash/battery/camera.minDist values`(改 config.ts,删旧占位)
3. `feat(game): battery state + drain formula + 4 tests`(battery.ts + .test.ts)
4. `feat(game): dash state machine + 4 tests`(dash.ts + .test.ts)
5. `feat(game): wire mountPlayerStats real step + SharedState`(playerStats.ts)
6. `feat(player): camera minDist clamp`(thirdPersonController.ts 5 行)
7. `feat(main): THREE.Clock → THREE.Timer + dash/Shift input wiring`(main.ts + controller input edge)
8. (整坡 review fix)如有

---

## 10. 风险与回退

- **§0.1 公式悬而未决**:实现按推荐 A 走,Snake 若翻案,只改 `baseDrain` 单值,公式与测试 1 个常数改。回退成本 <1 commit。
- **§0.3 SharedState facade 边界**:实施时若 main.ts 做 wrapper 仍嫌脏,Snake 可在 review 时批一个微改 sharedState.ts 实现(只改实现不改签名)。回退成本中等。
- **dashShift 与走速联动**:thirdPersonController L112 既有 Shift=sprintSpeed,PR #10 后改为 dash-driven;若 dashMult 关掉时 sprintSpeed 字段无人读,可保留字段作"未来 sprint"用途,无浪费。
- **TIM 后退化**:Timer.getDelta() 首帧可能 ≈ 0(实测 8e-5 秒),与 Clock 行为一致,无回归。