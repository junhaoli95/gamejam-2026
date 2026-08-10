# PR #12 — 整合 + UX 短期修复 + 视角改造 spec

> **本 PR 目标**:让游戏从"静态 demo"变成"移动端可玩闭环"。修 John review §6 整合 gap + 用户 PR #10 试玩反馈(4 项新增)+ 视角方案 D 改造。

- 日期:2026-08-06
- 作者:Snake(主程序员)
- 基线:`9d6ca48`(PR #10 rebase merge 后 main)
- 前置:PR #10(Sam phone HUD)+ PR #11(David dash/battery)均 merged
- 估工:1 人 50 分钟 / 2 人并行 35 分钟

---

## 1. 背景

PR #10 + PR #11 pass review + merged,但存在整合盲点(John §6)+ 用户新增 4 项反馈:

### 1.1 原 John §6 整合 gap

| 用户操作 | 期望 | 实际(merge 后状态) |
|---|---|---|
| 按 1 切 MAP | battery ×2 耗电 | HUD 切换 ✓ / battery 不变 ✗(全 ×1) |
| 按 2 切 RADAR | battery ×3 耗电 | HUD 切换 ✓ / battery 不变 ✗ |
| 按 3 切 QUERY | battery ×4 耗电 | HUD 切换 ✓ / battery 不变 ✗ |
| 电池 0% | 黑屏 + 失败弹窗 + 重开 | 黑屏 ✓ / 无失败弹窗 ✗ |
| 走近空桩按 E | 胜利弹窗 + 重开 | 无反馈 ✗ |

### 1.2 用户新增 4 项反馈

| 反馈 | 决策 |
|---|---|
| pip 不要做成 3 颗离散次数,改**连续能量条按量计费** | 重写 `dash.ts`,从 pip 计数 → energy 值(0~1),按时间消耗 |
| 随机刷新角色在电位面前表示占用 | 启动随机选 N 个桩 occupied=true,桩旁放占位 NPC(简化,不做完整 AI) |
| 桌子上有角色 → 该桩也变占用 | 同上一并:被占的桩 `outlets[i].occupied = true` |
| 已占用桩显红色不是绿色 | UI 层 + scene 层都得改红色 |
| 视角方案 D(方向键转向,删鼠标) | `thirdPersonController.ts` 删 pointer lock + 鼠标 yaw,改 strafe 键转向 |

---

## 2. 改动清单(6 文件,~180 行)

### 2.1 `src/platform/sharedState.ts`(2 行,协调文件)

```ts
export interface SharedState {
  player: { x: number; z: number; yaw: number };
  battery: number;
  pips: number;        // 保留字段名(改语义:0~1 连续能量,不是 0~3 计数)
  outlets: Array<{ x: number; z: number; occupied: boolean }>;
  npcs: Array<{ x: number; z: number; state: string }>;
  path?: Array<{ x: number; z: number }>;
  won?: boolean;       // PR #12 新增:胜利标记
}

export type AppAction =
  | { kind: 'toggle-app'; app: 'map' | 'radar' | 'query' }
  | { kind: 'restart' }
  | { kind: 'close' };
```

旧 `{kind:'query-outlets'}` / `{kind:'toggle-map'}` 移除(grep 确认仅 main.ts + phoneHud.ts 消费,本 PR 一并改)。

### 2.2 `src/game/dash.ts`(重写,~50 行)— David 边界

**从 pip 计数状态机重写为连续能量条**:

```ts
export interface DashConfig {
  startEnergy: number;       // 1.0(满)
  drainPerSec: number;       // 0.5(2 秒用完)
  regenPerSec: number;       // 0(单局不补,跟原 pip 规则一致)
  dashMult: number;          // 3.0
}

export interface DashState {
  energy: number;            // 0~1 连续
  isDashing: boolean;        // shift 按下且有能量
}

export function createDash(cfg: DashConfig): DashState {
  return { energy: cfg.startEnergy, isDashing: false };
}

/** 每帧调。shiftDown = 用户按住 Shift。返回当前速度倍率。 */
export function updateDash(
  state: DashState,
  cfg: DashConfig,
  shiftDown: boolean,
  hasDirection: boolean,  // 方向门控: WASD 无输入则不消耗(防误操作)
  dt: number,
): number {
  if (shiftDown && hasDirection && state.energy > 0) {
    state.isDashing = true;
    state.energy = Math.max(0, state.energy - cfg.drainPerSec * dt);
    return cfg.dashMult;
  }
  state.isDashing = false;
  state.energy = Math.min(cfg.startEnergy, state.energy + cfg.regenPerSec * dt);
  return 1;
}

export function resetDash(state: DashState, cfg: DashConfig): void {
  state.energy = cfg.startEnergy;
  state.isDashing = false;
}
```

**关键变化**:
- 无 cooldown / phase 状态机 — Shift 按住就冲,松开就停
- 能量条连续消耗,0.5/秒 = 2 秒纯冲刺用完
- `regenPerSec: 0` = 单局不补(忠于原 spec §4.2 "单局 pip 不补")
- `hasDirection` 门控保留(防静止按 Shift 误消耗)
- `dashMult: 3` 保留(冲刺 3 倍速)
- `getDashSpeedMult` 删除(直接从 `updateDash` 返回值用)

### 2.3 `src/game/config.ts`(改 dash schema,~5 行)— David 边界

```ts
dash: {
  startEnergy: 1.0,
  drainPerSec: 0.5,    // 2 秒纯冲刺用完
  regenPerSec: 0,      // 单局不补
  dashMult: 3,
},
```

旧 `startPips / dashDurationS / cooldownS` 移除。

### 2.4 `src/game/playerStats.ts`(改,~30 行)— David 边界

`mountPlayerStats` 适配新 `updateDash` 签名:

```ts
step(dt: number) {
  const input = controller.getInput();  // 读 shift + direction
  const mult = updateDash(dash, dashCfg, input.shift, input.fwd !== 0 || input.strafe !== 0, dt);
  updateBattery(battery, batteryCfg, opts.runtime.appOpen, dt);
  opts.runtime.battery = battery.percent;
  opts.runtime.pips = dash.energy;  // pips 字段语义改为 energy(0~1)
  currentDashMult = mult;
}
```

注意:`runtime.pips` 字段名保留(避免改 SharedState interface),但语义从"0~3 离散 pip"变为"0~1 连续 energy"。Phone HUD 消费时按 0~1 渲染能量条。

### 2.5 `src/main.ts`(~50 行)— David 边界

#### 2.5.1 onAppAction 接通(John §6)

```ts
mountPhoneHud({
  getSharedState,
  onAppAction: (action) => {
    if (action.kind === 'toggle-app') {
      const key = action.app === 'map' ? 'MAP' : action.app === 'radar' ? 'RADAR' : 'QUERY';
      runtime.appOpen[key] = !runtime.appOpen[key];
    } else if (action.kind === 'restart') {
      gameWon = false;
      gameOver = false;
      playerStats.reset();
      player.position.set(0, 0, 8.5);
      // 重新随机占位 NPC(见 §2.5.4)
      randomizeOccupiedOutlets();
    }
  },
});
```

#### 2.5.2 E 键近空桩判胜

```ts
let gameWon = false;
let gameOver = false;

window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE' || gameWon || gameOver) return;
  const s = getSharedState();
  const near = s.outlets.find(o =>
    !o.occupied && Math.hypot(o.x - s.player.x, o.z - s.player.z) < 1.5
  );
  if (near) {
    gameWon = true;
    console.log('[win] 充上电了');
  }
});
```

#### 2.5.3 SharedState wrap 加 won

```ts
function getSharedState() {
  const s = getRawSharedState();
  return { ...s, battery: runtime.battery, pips: runtime.pips, won: gameWon };
}
```

#### 2.5.4 随机占位 NPC(简化版,不做完整 AI)

```ts
// 占位 NPC:几个橙色球体,开局随机放在 N 个桩旁
const NPC_COUNT = 5;
const npcMeshes: THREE.Mesh[] = [];
const npcMat = new THREE.MeshStandardMaterial({ color: 0xff6b3a, roughness: 0.7 });

function randomizeOccupiedOutlets() {
  // 重置全部 occupied
  outlets.forEach(o => { o.occupied = false; });
  // 移除旧 NPC mesh
  npcMeshes.forEach(m => scene.remove(m));
  npcMeshes.length = 0;
  // 随机选 NPC_COUNT 个桩
  const indices = [...Array(outlets.length).keys()];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  for (let i = 0; i < NPC_COUNT && i < indices.length; i++) {
    const o = outlets[indices[i]];
    o.occupied = true;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), npcMat);
    m.position.set(o.x, 0.4, o.z + 0.6);  // 桩旁偏前
    scene.add(m);
    npcMeshes.push(m);
  }
}
randomizeOccupiedOutlets();  // 启动调用一次
```

5 个占位 NPC,桩被占则 `occupied=true`,scene 层桩 mesh 颜色也变红(见 §2.7)。

#### 2.5.5 game over 检测主循环内

```ts
playerStats.step(dt);
if (runtime.battery <= 0 && !gameOver && !gameWon) {
  gameOver = true;
}
```

### 2.6 `src/ui/phoneHud.ts`(~70 行)— Sam 边界

#### 2.6.1 RDR emit 补 + exclusive 切换 emit 顺序

```ts
function toggleApp(target: AppId): void {
  if (target === activeApp) {
    setActiveApp('home');
    if (target !== 'home') opts.onAppAction({ kind: 'toggle-app', app: target });
    return;
  }
  if (activeApp !== 'home') opts.onAppAction({ kind: 'toggle-app', app: activeApp });
  setActiveApp(target);
  opts.onAppAction({ kind: 'toggle-app', app: target });
}
```

所有 `toggle-map` / `query-outlets` 旧 emit 改为 `toggle-app`。

#### 2.6.2 删 banner 文字 + CSS(5 行)

```html
<div class="phone-lowbatt-banner"></div>
```

CSS `.phone-lowbatt-banner` 改纯红色横条无文字:删 `font` / `color` / `letter-spacing` / `text-align`,`height: 4px`。保留 `.show` + `.blink` + `transform` 动画。

#### 2.6.3 删 ready-pulse 绿框(8 行)

CSS 删 `.phone-app-icon.ready { animation: ready-pulse ... }` + `@keyframes ready-pulse`。保留一次性 `fade-state-in`。

#### 2.6.4 pip 能量条(连续 bar,不是 3 颗)(~25 行)

原"3 颗 pip 闪电 icon"方案改成一个连续能量条。

```html
<span class="phone-pip-bar">
  <span class="phone-pip-bar-fill"></span>
</span>
```

```css
.phone-pip-bar {
  position: absolute;
  left: 12px;            /* 时钟下方 */
  top: 28px;
  width: 60px;
  height: 4px;
  background: rgba(255,255,255,0.18);
  border-radius: 2px;
  overflow: hidden;
}
.phone-pip-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #ffb14d, #ff8800);
  transform-origin: left;
  transition: transform .1s linear;
}
.phone-pip-bar-fill.low { background: linear-gradient(90deg, #ff4d4d, #c92828); }
```

RAF loop:
```ts
const energy = Math.max(0, Math.min(1, state.pips));  // 0~1
pipBarFill.style.transform = `scaleX(${energy})`;
pipBarFill.classList.toggle('low', energy < 0.2);
```

位置:phone 状态栏左侧,时钟下方一条横条。视觉清晰, подходит移动端直觉。

#### 2.6.5 胜负弹窗(~30 行)

```html
<div class="phone-game-over overlay hidden">
  <div class="phone-game-card">
    <div class="phone-game-title">没电了</div>
    <div class="phone-game-subtitle">手机黑屏,你被困在图书馆</div>
    <button class="phone-restart-btn">再来一局</button>
  </div>
</div>
<div class="phone-game-win overlay hidden">
  <div class="phone-game-card">
    <div class="phone-game-title">充上电了!</div>
    <div class="phone-game-subtitle">你活了下来</div>
    <button class="phone-restart-btn">再来一局</button>
  </div>
</div>
```

CSS:overlay 全屏黑色半透(`rgba(0,0,0,0.85)`)+ 卡片居中圆角白字。按钮游戏风(`background: #2dff7a; color: #000; padding: 8px 24px; border: 0; border-radius: 8px`)。

RAF loop:
```ts
gameOverEl.classList.toggle('hidden', !(!state.won && state.battery <= 0));
gameWinEl.classList.toggle('hidden', !state.won);
```

restart 按钮 click → `opts.onAppAction({ kind: 'restart' })`。

胜/负状态下锁 1/2/3/E/Shift(在 main.ts 已有 `gameWon || gameOver` 早退门控)。

### 2.7 `src/scene/loadLibraryScene.ts`(~10 行)— David 边界

桩 emissive 颜色根据 `occupied` 切换。需要改 `outletMat` 为两类:

```ts
const outletMatEmpty = new THREE.MeshStandardMaterial({
  color: 0x2dff7a, emissive: 0x2dff7a, emissiveIntensity: 0.6,
});
const outletMatOccupied = new THREE.MeshStandardMaterial({
  color: 0xff4d4d, emissive: 0xff4d4d, emissiveIntensity: 0.6,
});
```

桩 mesh 创建时根据初始 `occupied` 选 material,被占时调换。`randomizeOccupiedOutlets()` 内同步改 mesh material。

或者更简单:每个桩 mesh `userData.occupied` 标志,`update(dt)` 内每帧根据 `outlets[i].occupied` 切 `mesh.material`(若变化)。

### 2.8 `src/player/thirdPersonController.ts`(~40 行改)— David 边界

**视角方案 D 改造**(删鼠标视角 + 改方向键转向):

删除:
- `pointerlockchange` / `requestPointerLock` / `pointerlockerror` 监听
- `mousemove` 内 `yaw -= movementX * sens` / `pitch += movementY * sens`
- `pitch` / `pitchMin` / `pitchMax` 上下视角 clamp
- overlay 点击进入指针锁相关(改由 main.ts overlay 处理)

新增:
```ts
// 方案 D:strafe 键(A/D)直接转 yaw, W/S 沿朝向前后
function update(dt: number) {
  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const shiftDown = keys.has('ShiftLeft') || keys.has('ShiftRight');

  // 转向(A/D 直接控 yaw, 转速 3 rad/s)
  if (strafe !== 0) {
    yaw -= strafe * 3.0 * dt;
  }

  // 移动(沿朝向)
  if (fwd !== 0) {
    const speed = CONFIG.player.walkSpeed * getDashMult();
    const moveX = -Math.sin(yaw) * fwd * speed * dt;
    const moveZ = -Math.cos(yaw) * fwd * speed * dt;
    // AABB 碰撞(现有逻辑保留)
    player.position.x += moveX;
    player.position.z += moveZ;
  }

  player.rotation.y = yaw;
  // 相机 spring-damp + minDist clamp 保留
}
```

`getInput()` 改:
```ts
getInput() {
  return {
    fwd: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
    strafe: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    shift: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
}
```

注意:strafe 在方案 D 下双重语义 — 既用于转向(A/D 转角色),也用于... 不,strafe 在 D 里只用于转向,不用作平移(W=前进 S=后退 A=左转 D=右转,无平移)。**这是坦克式控制**,不像 FPS 那种平移。

main.ts 的 Shift input 从 `input.shiftEdge`(边沿检测)改为 `input.shift`(持续):新 dash 模块按持续消耗能量。

### 2.9 `src/player/thirdPersonController.ts` NaN 防护(3 字符)— David 边界

```ts
// 现:if (dist < CONFIG.camera.minDist) {
// 改:if (dist > 1e-6 && dist < CONFIG.camera.minDist) {
```

### 2.10 `src/game/playerStats.ts` newline(1 字符)— David 边界

文件末尾补 `\n`。

### 2.11 `src/game/dash.test.ts` 改写(~50 行)— David 边界

旧 5 个 pip 测试改写为新连续能量条测试:
- 满能量 shift+方向 → 0.5 秒后能量=0.75(2 秒用完)
- 能量=0 时 shift+方向 → 不消耗,速度=1
- 无方向时 shift → 不消耗(方向门控)
- 松开 shift → 不回补(regenPerSec=0)
- reset → 能量回 1.0

### 2.12 `src/main.ts` overlay 提示改(~2 行)

```ts
overlay.textContent = 'WASD 移动(AD 转向)· Shift 冲刺 · 1/2/3 切 app · E 插枪';
```

overlay 可改成点击即开始,**不需要 pointer lock**,体验更直接。

---

## 3. 关键决策

### 3.1 dash 从离散 pip → 连续能量条

| | 旧(PR #11) | 新(PR #12) |
|---|---|---|
| 状态 | 3 颗 pip + 0.4s dash + 0.5s cooldown | 0~1 连续能量 |
| 触发 | Shift 边沿触发 1 pip 一次 | Shift 持续按住持续消耗 |
| 用完 | 3 次 dash 后不可再 dash | 2 秒纯冲刺后不可再 dash |
| 补充 | 单局不补 | 单局不补(regenPerSec=0) |
| 防误操作 | 方向门控 | 同 |

**用户反馈意图**:连续能量条更直觉,移动端友好。

### 3.2 视角方案 D vs 其他

demo 已验证 4 方案,用户选 D(方向键转向,删鼠标):
- A/D = 转向(W 转不是平移),W/S = 前进/后退
- 删 pointer lock + 鼠标 → 移动端友好(无鼠标依赖)
- 6 键操作简化为 5 键(WASD + Shift + 1/2/3 + E)

### 3.3 NPC 占桩 simplification

完整 NPC AI 是 PR #13 范围。PR #12 只做 **visual 占位**:
- 开局随机 5 个桩 occupied=true
- 桩旁放橙色球占位(不做 AI 动画 / 状态机 / 抢桩行为)
- restart 时重新随机
- 真正的 NPC move / 抢桩 / 头顶目标点 → PR #13

### 3.4 outlet 红绿(双重表达)

桩的 occupied 状态在**两个层级**都要反映:
1. scene 层:`outletMat` 颜色(空=绿 / 占=红)
2. UI 层:`phoneHud` 的 QUERY app blip 颜色(`blipColor(o)` 回调,空=绿 / 占=红)

第 2 层 Sam 的 phoneHud 在 QUERY app 已有 `blipColor` 按状态着色逻辑,只需让 `runtime` / `outlets` 真实传 occupied=true 即可(PR #11 时 outlets 是 stub `occupied:false`,PR #12 接通真实)。

---

## 4. 文件边界总览

| 文件 | 归属 | 改动量 | 内容 |
|---|---|---|---|
| `src/platform/sharedState.ts` | **协调文件** Snake 先改 | 2 行 | AppAction union + won 字段 |
| `src/game/dash.ts` | David | 重写 ~50 行 | 离散 pip → 连续能量条 |
| `src/game/dash.test.ts` | David | 重写 ~50 行 | 新能量条 5 测试 |
| `src/game/config.ts` | David | ~5 行 | dash schema 改 |
| `src/game/playerStats.ts` | David | ~30 行 | 适配新 dash + newline |
| `src/main.ts` | David | ~50 行 | onAppAction + E 键 + restart + NPC 占位 + game over |
| `src/scene/loadLibraryScene.ts` | David | ~10 行 | outlet mat 红绿切换 |
| `src/player/thirdPersonController.ts` | David | ~40 行改 | 视角 D + NaN 防护 |
| `src/ui/phoneHud.ts` | Sam | ~70 行 | RDR emit + UX 修复 + 能量条 + 胜负弹窗 |

David ~235 行 / Sam ~70 行,合计 ~305 行(含删除)。

---

## 5. AppAction union 最终形态

```ts
export type AppAction =
  | { kind: 'toggle-app'; app: 'map' | 'radar' | 'query' }
  | { kind: 'restart' }
  | { kind: 'close' };
```

---

## 6. 验收标准

### 6.1 整合闭环

- [ ] 按 1 切 MAP,battery 衰减从 ×1 升 ×2
- [ ] 按 2 切 RADAR,battery 衰减升 ×3
- [ ] 按 3 切 QUERY,battery 衰减升 ×4
- [ ] 按 1 开 MAP 后按 2 切 RADAR,MAP 自动关,battery = ×3
- [ ] 按 1 开 MAP 后按 1 回 home,MAP 关,battery 回 ×1

### 6.2 dash 连续能量条

- [ ] 按住 Shift + WASD,速度 ×3,能量条 2 秒内 1→0
- [ ] 能量=0 时按 Shift,不可冲刺,正常走路
- [ ] 按 Shift 无 WASD,不消耗能量(方向门控)
- [ ] 松开 Shift,能量不回补(regenPerSec=0)
- [ ] phone 状态栏左侧一条横向能量条,橙色渐变;能量 <0.2 变红
- [ ] 重开后能量回满

### 6.3 NPC 占桩 + 红绿

- [ ] 开局随机 5 个桩旁出现橙色占位球
- [ ] 被占桩 scene 层显红色(不再是绿色)
- [ ] 被占桩 phone QUERY app blip 显红色(`#ff4d4d`)
- [ ] 走近被占桩按 E,不判胜(因 `occupied=true`)
- [ ] restart 时重新随机占位

### 6.4 视角方案 D

- [ ] A/D 键转向角色 yaw,相机平滑跟转
- [ ] W/S 沿角色朝向前后移动
- [ ] 无 pointer lock,无鼠标依赖
- [ ] overlay 提示改 "WASD 移动(AD 转向)· Shift 冲刺 · 1/2/3 切 app · E 插枪"
- [ ] 点击 overlay 直接进入游戏(不锁鼠标)

### 6.5 UX 修复(原 PR #12)

- [ ] 红色低电 banner 无文字,纯红色横条
- [ ] app icon 安装完后无绿色持续高亮(只有一次性 fade-in)
- [ ] 电池到 0% → 黑屏 + 失败弹窗 + "再来一局"按钮
- [ ] 走近空桩(≤1.5m)按 E → 胜利弹窗 + "再来一局"按钮
- [ ] 点"再来一局" → 弹窗消失 + battery 回 100% / 能量回满 / 玩家回 (0, 8.5) / 重新随机占位
- [ ] 胜/负状态下按 E / 1/2/3 / Shift 无效

### 6.6 小毛疵

- [ ] `thirdPersonController.ts` minDist clamp 有 `dist > 1e-6` 守卫,无 NaN
- [ ] `playerStats.ts` 末尾有 newline

### 6.7 build / test

- [ ] `npm run build` 绿,bundle ≤640 KB
- [ ] `npm test` ≥17 pass(dash 测试改写后仍 5 个,其他不变,总 17)

---

## 7. 风险

### 7.1 dash 重写破坏现有手感

PR #11 David 的 3 pip + 0.4s 间隔 dash 已经 John review pass。PR #12 改为连续能量条 = 行为完全变:玩家可一气冲 2 秒,也可断续按 Shift。**playtest 后 play 调 `drainPerSec` 数值** — 0.5/秒 = 2 秒用完可能太短,实际可能需调成 0.33/秒 = 3 秒用完,贴近原 3 pip 总量(0.4×3=1.2s 冲刺时间)。

保守起步:`drainPerSec: 0.4`(2.5 秒纯冲刺用完),playtest 后调。

### 7.2 视角 D 转向速率

`yaw -= strafe * 3.0 * dt` — 3 rad/s = 172°/s。Demo 试感不错。游戏里调:`CONFIG.player.turnRate: 3.0` 提取常量便于 playtest 调。

### 7.3 NPC 占位球碰撞

占位球位置 `(o.x, 0.4, o.z + 0.6)` 可能与玩家碰撞。简化不做 NPC 碰撞(球只是 visual),实际玩起来玩家可穿过占位球。可接受,PR #13 加 NPC 控制器再加碰撞。

### 7.4 outlets 引用同步

`randomizeOccupiedOutlets()` 直接 mutate `outlets[i].occupied` — `outlets` 是 `loadLibraryScene` 返回的 array reference。`SharedState` facade 每次 `getSharedState()` 重新 map outlets,所以 occupied 变化自动反映到 SharedState。**需验证**:facade 的 `outlets.map(o => ({ ...o, occupied: false }))` 这句 stub 必须 改为 `occupied: o.occupied` 才能传真实值。这是 §2.1 一并改(`sharedState.ts` 那行)。

实际上 `sharedState.ts` 的 facade stub 当前是:
```ts
outlets: outlets.map(o => ({ ...o, occupied: false })),  // PR #11 stub
```
PR #12 改成:
```ts
outlets: outlets.map(o => ({ ...o })),  // 保留真实 occupied
```
加进 §2.1 改动清单。

### 7.5 胜利距离 1.5m

`Math.hypot(o.x - px, o.z - pz) < 1.5` 是 2D 距离。桩在地面 y=0,合理。4 人桌电位在桌面 y~0.75,距离仍用 2D,玩家走到桌旁即可,不需精确贴桩。playtest 后调。

---

## 8. 执行方案

### 方案 A:Snake 亲自一气呵成(推荐)

- 我在主 repo 开 `feat/pr12` branch
- 50 分钟内 6 文件 ~305 行全做完
- 自跑 build + test + MCP DOM 验证
- `gh pr create` → 用户 merge → 删 branch
- **优点**:整合 + NPC 占位 + 视角改造本就是协调 PR 一人做最快,无并行来回
- **缺点**:失去 Sam/David 练习机会

### 方案 B:Sam + David 并行

- 用户在 opencode 新建 2 工作区
- Snake 先 commit `sharedState.ts` 协调(2 行)
- Sam + David 各自 pull + 各自文件边界内做
- David 工作量 ~235 行, Sam ~70 行, 不均衡
- 3 次往返 + worktree 重建
- **不推荐** — David 工作量是 Sam 3 倍,并行收益低

**建议方案 A**。

---

## 9. 后续(不在本 PR)

- PR #13: NPC AI 完整版(consume pathfinding + occupy state 机 + 头顶目标点 + 抢桩行为)
- PR #14: polish + itch 上传
- multi-open UX(S-2 forward)
- terrain 在 MAP app 内描绘(S-7 forward)