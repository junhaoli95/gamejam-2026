# Phone HUD UI — Design Spec (PR #9)

**Date**: 2026-08-04
**Status**: Approved (master spec §3 已锁定全决策; 本 spec 补实技术细节)
**Target PR**: #9 — feat: phone HUD UI (3 app + GTA chassis + install animation)
**Branch**: `opencode/glowing-tiger` (opencode 内置 worktree, base = main @ `9a7e1d2`)
**Agent**: Sam (`<sam@agent.local>`)
**Baseline**: master spec `spec/MASTER-SPEC.md` §3 / §7 / §10 / §12 / §13 + 附录 B

## 1. 目的

为 Layer 1 已钉死的 `mountPhoneHud()` 调用点提供完整 GTA smartphone HCI 实现。3 真 app + 占位、chassis 装饰、安装仪式感动画;消除 Layer 1 左下角独立 minimap,minimap renderer 收编进手机内仅作 MAP/QUERY app。

本 spec 补实 master 附录 B 列的待写技术细节:
1. GTA minimap renderer 升级的 canvas 2D API
2. 龙珠雷达 canvas 绘制细节
3. onboarding 安装动画 CSS keyframe 细节
4. chassis CSS 完整参数表
5. 验收标准 (参照 Layer 1 spec §11 的 A-H 格式)

## 2. 范围

### 2.1 包含 (file boundary — AGENTS rule 11 + dispatch)

| 文件 | 改动 | 估行 |
|---|---|---|
| `spec/2026-08-04-phone-hud-design.md` | 本文件 | — |
| `src/ui/phoneHud.ts` | 空 stub → 完整实现 (chassis CSS / 状态栏 / 电池 / app grid / onboarding / 3 app 切换 / RAF 循环 / 键盘) | ~750 |
| `src/ui/minimap.ts` | API 重构: `createMinimap(canvas, opts)` 接 caller canvas; GTA 风升级 (zone labels + vignette + N 标 + 三角 yaw 箭头); MAP/QUERY 复用 | ~180 |
| `src/main.ts` | **仅 3 处删**: `import { createMinimap }`、`const minimap = createMinimap()`、RAF 内 `minimap.update(...)` | -3 |

### 2.2 不包含 (留给其他 PR / file boundary)

- 电池数值消耗公式 / `startPercent` / drain 调整 → PR #10 (David, `src/game/` + `src/player/`)
- pip 状态机 / dash 冲刺 → PR #10
- NPC 占用 red blip 写入 → PR #11 (`occupied` 字段当前 stub 全 false,全绿 blip)
- 心跳音 ≤3% 状态触发 → 在 phoneHud 内留 TODO 注释,David 接 audio 系统
- 改 `src/platform/sharedState.ts` 签名 → file boundary 严禁 (见 §16 S-1)

## 3. 架构

### 3.1 PhoneHudOptions (签名钉死 + 可加 optional 兼容字段)

```ts
export interface PhoneHudOptions {
  getSharedState: () => SharedState;
  onAppAction: (action: AppAction) => void;
}
```

main.ts 调用点 (Layer 1 钉死,不动):
```ts
mountPhoneHud({
  getSharedState,
  onAppAction: (action) => console.log('[stub] app action:', action),
});
```

未来 PR 可加 optional props (如 `getColliders?: () => THREE.Box3[]` 用于 terrain),PR #9 不加。

### 3.2 文件改动 (零冲突原则)

- **minimap.ts**: 旧 `createMinimap(): MinimapHandle` (自建 canvas + 挂 body); 新 `createMinimap(canvas: HTMLCanvasElement, opts?: MinimapOptions): MinimapHandle` (caller 传 canvas,只内部绘,不 appendChild/remove)。Terrain 绘制**移除** (PR #9 acceptance §3.6 只列 north-up + arrow + blips + zone labels;terrain 留 forward)。
- **main.ts**: 删 3 行 (Layer 1 standalone minimap 接线)。phoneHud 接管所有 minimap 渲染 (在 chassis 内)。
- **phoneHud.ts**: 完整实现,内部自管 RAF loop + DOM。

### 3.3 phone DOM 结构

```
.phone-hud-root                       ← fixed right-bottom 容器 (24px 边距)
  ├ .phone-chassis                    ← 黑 bezel 圆角 + 侧边按钮
  │   ├ .phone-side-btn.power        (right)
  │   ├ .phone-side-btn.volume.up   (right)
  │   ├ .phone-side-btn.volume.down (right)
  │   ├ .phone-side-btn.silence      (left)
  │   └ .phone-screen                 ← inset 阴影 屏幕 + 阴冷色径向壁纸 + 黑屏 overlay
  │       ├ .phone-screen-blackout     ← 0% 黑屏 overlay (默认 opacity 0)
  │       ├ .phone-status-bar
  │       │   ├ .phone-clock            ← 装饰 "9:41"
  │       │   ├ .phone-signal-icons     ← SVG (4 bar + 扇形 wifi)
  │       │   └ .phone-battery
  │       │       ├ .phone-battery-shell ← 电池槽 (36×16 px SVG outline)
  │       │       │   └ .phone-battery-fill ← 容量条 (transform: scaleY = battery)
  │       │       ├ .phone-battery-time   ← 电池槽内嵌 M:SS 红色发光
  │       │       └ .phone-battery-pct   ← 隔壁 % 数字 (辅助)
  │       ├ .phone-lowbatt-banner      ← ≤10% 红色滑入; ≤3% 加 .blink
  │       └ .phone-app-area
  │           ├ .phone-home               ← grid + 8 虚位 (display)
  │           │   └ .phone-app-grid       ← 4 icon (3 真 + 1 dashed 占位)
  │           ├ .phone-app-view.map       ← 含 .phone-app-canvas
  │           ├ .phone-app-view.radar     ← 含 canvas + 底部读数 bar
  │           └ .phone-app-view.query     ← 含 canvas + 顶部 legend bar
```

`phone-home` 内含 `phone-app-grid` + 8 静默虚位 (留动作 forward,不解 lock)。 App 切换靠 `.active` class 切 `display` (单 app 前台显示; home = none active)。

### 3.4 RAF 循环 + 实时性硬约束 (master §10 决策 5)

mount 时:
1. 注入 CSS (idempotent — 检查 `#phone-hud-styles` 是否存在)
2. 构建 DOM/canvas + 注册键盘 (1/2/3 toggle + any-key skip)
3. 启 `requestAnimationFrame(loop)`
4. loop 每帧:
   - `const state = opts.getSharedState();`  ← 现读,不缓存
   - status bar: 电池 fill 高度 = battery; M:SS 文本 = `format(battery * CONFIG.battery.totalGameTimeS)`; % 文本 = `Math.round(battery * 100)`
   - 阈值 class 切换: `battery <= 0.10` → banner show; `<= 0.03` → banner .blink; `<= 0.00` → blackout opacity 1
   - activeApp === 'map'|'query': `minimap.update(state)`
   - activeApp === 'radar': radar canvas draw + 底部 "X · NE" 文本 + capacity count
5. canvas 内绘制沿用 minimap 节流 FRAME_SKIP=2 (墙面避免每帧重 51 blip); 静态文本与电池条每帧跟.

### 3.5 与 main.ts 解耦

phoneHud 不通过 main RAF 驱动 (main 调用点锁死)。phoneHud 内部独立 RAF 调用 `opts.getSharedState()` — 这与 minimap 实时硬约束一致 (无快照)。

## 4. Phone chassis CSS 参数表

### 4.1 尺寸 / bezel

| 参数 | 值 |
|---|---|
| Chassis 外尺寸 | 260 × 540 px |
| Screen 内尺寸 | 240 × 500 px (inset 10px) |
| Chassis 圆角 | 28 px |
| Screen 圆角 | 18 px |
| Chassis 背景 | `linear-gradient(165deg, #1a1a1c 0%, #0a0a0c 65%, #000 100%)` |
| Chassis 边线 | `1.5px solid #2a2a2e` |
| Chassis 投影 | `0 14px 44px rgba(0,0,0,0.58), 0 2px 8px rgba(0,0,0,0.4)` |
| Screen 内陷阴影 | `inset 0 0 22px rgba(0,0,0,0.88), inset 0 1px 0 rgba(255,255,255,0.06)` |
| Screen 背景 (壁纸) | `radial-gradient(circle at 30% 18%, #1a2235 0%, #0d111c 55%, #05080f 100%)` |
| 容器 `position / inset` | `position: fixed; right: 20px; bottom: 20px; z-index: 5` |

### 4.2 状态栏 (高 24px)

| 元素 | 样式 |
|---|---|
| 时钟 "9:41" | `9px/24px -apple-system, sans-serif; color:#fff` (左) |
| Signal (4 bar) | SVG inline `<rect>` ×4 递减高度; `fill:#fff` (右-2) |
| Wifi 扇形 | SVG inline path 三同心 60° 弧; `fill:#fff` (右-1) |
| 电池槽 | SVG `<rect>` 28×14 outline 2.5px `#cfcfcf`; 缺口右边 2×8 表示正极 |
| 电池槽 fill | `<rect>` 内嵌 26×10 充填,`fill:#e8e4d8` 正常 / `#ff4d4d` ≤10%; `transform: scaleY(battery)` 原点底部 |
| 电池槽内 M:SS | `bold 8px ui-monospace, monospace; color:#ff5a5a; text-shadow:0 0 5px rgba(255,80,80,0.75)` (右对齐叠在 shell 上方) |
| %-数字 | `bold 9px sans-serif; color:#ff5a5a` (电池 icon 右隔壁 6px 间距) |
| Master spec §10 决策 10 anchor | M:SS 是主单位; % 是辅助 |

### 4.3 侧边按钮 (位置以 chassis 为锚)

| 按钮 | side | top | size | color | radius |
|---|---|---|---|---|---|
| Power | right | 110px | 3 × 44 | `#222` | `0 2px 2px 0` |
| Volume+ | right | 175px | 3 × 26 | `#222` | `0 2px 2px 0` |
| Volume− | right | 215px | 3 × 26 | `#222` | `0 2px 2px 0` |
| Silence | left | 180px | 3 × 22 | `#222` | `2px 0 0 2px` |

### 4.4 低电警告 CSS

```css
.phone-lowbatt-banner {
  position: absolute; top: 24px; left: 0; right: 0;
  margin: 0 auto; padding: 4px 10px;
  max-width: 88%; text-align: center;
  background: linear-gradient(180deg,#ff4d4d,#c92828);
  color: #fff; font: bold 10px sans-serif; letter-spacing: .06em;
  border-radius: 0 0 8px 8px;
  transform: translateY(-110%);
  transition: transform .35s cubic-bezier(.22,1,.36,1);
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(255,77,77,0.4);
}
.phone-lowbatt-banner.show { transform: translateY(0); }
.phone-lowbatt-banner.blink { animation: lb-blink 0.7s steps(2,end) infinite; }
@keyframes lb-blink {
  0%, 49%   { opacity: 1; }
  50%, 100% { opacity: 0.35; }
}
.phone-screen-blackout {
  position: absolute; inset: 0;
  background: #000;
  opacity: 0;
  transition: opacity .12s linear;
  pointer-events: none;
}
.phone-screen-blackout.show { opacity: 1; }
```

注: ≤3% blink 旁加代码 TODO: `// ⚠ ≤3% blink: heartbeat SFX 留 PR #10 / David`。

## 5. App icon grid (3 真 + 1 占位)

每 icon: 60 × 80 px (60×60 glyph + label 区)。

| app | bg 渐变 | label | glyph | 边框 |
|---|---|---|---|---|
| MAP | `linear-gradient(135deg, #2d5d8a 0%, #1a3a5e 100%)` | "MAP" | 🗺 | `1px solid rgba(255,255,255,0.12)`, radius 12 |
| RADAR | `linear-gradient(135deg, #c97632 0%, #8a4912 100%)` | "RADAR" | 📡 | 同上 |
| QUERY | `linear-gradient(135deg, #2e8a4a 0%, #185f30 100%)` | "QUERY" | ⚡ | 同上 |
| pending | `transparent` + `filter: grayscale(1)` | "等待安装" | 🐾 | `1.5px dashed rgba(255,255,255,0.25)`, radius 12 |

label 文: `10px sans-serif; color: rgba(255,255,255,0.85); text-align: center; margin-top: 4px`。

Grid 布局: `display: grid; grid-template-columns: repeat(3, 60px); gap: 18px; padding: 18px; justify-content: center` (2×2 layout for 4 icons). 第 5–12 槽: 占满 `--phone-app-bg-alpha: rgba(255,255,255,0.04)` 圆角纯装饰虚位 (PR #9 仅 4 真+n 个处于 home 时显示)。

## 6. Onboarding 安装动画

### 6.1 状态机 (CSS-driven,JS 只切 class)

```
pending  ──[200ms delay 每加 200ms 错峰]──▶ installing ──[600ms 环 0→100%]──▶ ready ↓ 持久
                                            ↑ 第 4 占位永远停 pending
```

3 真 app 错峰启动:
- MAP:    t =   0ms 起 installing (持续 0–600ms)
- RADAR:  t = 200ms (持续 200–800ms)
- QUERY:  t = 400ms (持续 400–1000ms)
- 时序总 ~1.0s 后 3 真 app 全 ready 持续 pulse

### 6.2 icon SVG + keyframes

每真 icon 内嵌 SVG progress ring:
```html
<svg class="install-ring" viewBox="0 0 56 56">
  <circle class="install-track" cx="28" cy="28" r="26"
          fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
  <circle class="install-active" cx="28" cy="28" r="26"
          fill="none" stroke="#2dff7a" stroke-width="2.5"
          stroke-dasharray="163.42" stroke-dashoffset="163.42"
          transform="rotate(-90, 28, 28)"/>
</svg>
```
incircle circumference = 2π·26 ≈ 163.42

CSS:
```css
.phone-app-icon { position: relative; }
.install-ring { position: absolute; inset: 0; pointer-events: none; }
.install-active { transition: stroke-dashoffset .05s linear; }

.phone-app-icon.installing .install-active {
  animation: install-ring 600ms linear forwards;
}
@keyframes install-ring {
  from { stroke-dashoffset: 163.42; }
  to   { stroke-dashoffset: 0; }
}

.phone-app-icon.ready .install-ring { display: none; }
.phone-app-icon.ready {
  animation: ready-pulse 1.6s ease-in-out infinite;
}
@keyframes ready-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(45,255,122,0.55); }
  50%      { box-shadow: 0 0 0 9px rgba(45,255,122,0); }
}
.phone-app-icon.ready .icon-state-tag {
  /* 注入 "已安装" tag,默认 opacity 0 fade-in */
  animation: fade-state-in .45s ease-out forwards;
}
@keyframes fade-state-in { from { opacity: 0; } to { opacity: 1; } }

.phone-app-icon.pending .install-active { stroke-dashoffset: 163.42; }
.phone-app-icon.pending .glyph { filter: grayscale(0.8) brightness(0.6); }
```

state tag = label 下方/旁边 "等待" / "正在安装" / "已安装" 三种文本,根据 class 切换。

### 6.3 ANYKEY 跳过 (无 modal)

phoneHud 在 mount 时启 `onboardingActive = true` flag。监 `window.keydown`:
- 如 onboardingActive && key 是任一有效键 → `skipOnboarding()`: 清 setTimeout 队列、3 真 app class 强置 `.ready`、onboardingActive=false
- 如该 key 是 1/2/3 → 之后 fall through 至 app toggle (兼容 spec §3.3 6 键操作流;不构成双意图冲突,因 onboarding 切到 ready 后 toggle 是新的事)

## 7. MAP app (GTA 风 minimap renderer)

### 7.1 复用 src/ui/minimap.ts (API 重构)

新 API:
```ts
export interface MinimapOptions {
  blipColor?: (o: { x: number; z: number; occupied: boolean }) => string;  // default () => '#2dff7a' (MAP 全绿)
  zoneLabels?: boolean;  // default true; false = QUERY 复用时仍需 zone labels (保持 true)
  onTopLegend?: boolean; // false for MAP (no top legend); true for QUERY (legend bar)
}
export interface MinimapHandle {
  resize?: (w: number, h: number) => void;  // optional for phone chassis resize forward
  update: (state: SharedState) => void;     // 仅 SharedState (不再吃 colliders)
  dispose: () => void;                        // 移除 canvas 监听 (canvas 自身由 caller 管理 DOM)
}
export function createMinimap(canvas: HTMLCanvasElement, opts?: MinimapOptions): MinimapHandle;
```

caller (phoneHud) 设置 canvas.width/height + style; createMinimap 内开 2D context + 设 zone label 字号 / vignette / 节流计数; update() 每帧 (节流后) 重画。

### 7.2 canvas 2D API (节流 FRAME_SKIP=2)

```ts
// (节流逻辑在函数内: let frame=0; if (++frame % 3 !== 0) return;  // ~20fps)

// 1) 清画布 + 深灰青地板
ctx.fillStyle = '#1c2329';  // GTA 风
ctx.fillRect(0, 0, W, H);

// 2) vignette (四周渐暗)
const grd = ctx.createRadialGradient(W/2, H/2, 40, W/2, H/2, Math.max(W, H)/1.2);
grd.addColorStop(0, 'rgba(0,0,0,0)');
grd.addColorStop(1, 'rgba(0,0,0,0.55)');
ctx.fillStyle = grd;
ctx.fillRect(0, 0, W, H);

// 3) Zone labels (静态位置 — 基于世界区域 master §6.1)
const ZONES = [
  { x: -8, z: -4, text: '书架区' },  // 西书架 (x < -4)
  { x:  8, z: -4, text: '自习区' },  // 东自习 (x > 0)
  { x:  0, z:  5, text: '走廊'   },  // 中走廊
];
ctx.font = '11px sans-serif';
ctx.fillStyle = 'rgba(255,255,255,0.34)';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
for (const z of ZONES) ctx.fillText(z.text, toX(z.x), toY(z.z));

// 4) Outlet blips 全绿 (MAP default blipColor)
ctx.shadowColor = opts.blipColor; ctx.shadowBlur = 5;
ctx.fillStyle = opts.blipColor;
for (const o of state.outlets) {
  ctx.fillRect(toX(o.x) - 1.5, toY(o.z) - 1.5, 3, 3);
}
ctx.shadowBlur = 0;

// 5) N 指示 (顶部居中,固定)
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 10px sans-serif';
ctx.textAlign = 'center'; ctx.textBaseline = 'top';
ctx.fillText('N', W/2, 4);
ctx.strokeStyle = 'rgba(255,255,255,0.45)';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(W/2, 13); ctx.lineTo(W/2, 22);
ctx.stroke();

// 6) Player 三角箭头 (yaw 旋转, north-up)
const px = toX(state.player.x);
const py = toY(state.player.z);
ctx.save();
ctx.translate(px, py);
ctx.rotate(state.player.yaw);  // 0 ⇒ 朝 -z 屏幕上方
ctx.fillStyle = '#ffb142';
ctx.beginPath();
ctx.moveTo(0, -6);     // tip
ctx.lineTo(-4, 4);
ctx.lineTo(0, 2);
ctx.lineTo(4, 4);
ctx.closePath();
ctx.fill();
ctx.strokeStyle = '#fff';
ctx.lineWidth = 0.8;
ctx.stroke();
ctx.restore();
```

世界→屏变换 (沿用 Layer 1):
```
scale = W / CONFIG.world.w
toX(wx) = (wx + CONFIG.world.w/2) * scale
toY(wz) = (wz + CONFIG.world.d/2) * scale  // NOTE: 用 H/d 缩放Y? Layer 1 用 MINI_W/w 作通用 scale → 等比; 若 canvas 不同宽高比需要分轴或 letterbox
```

PR #9 实作:缺省 `scale = Math.min(W/CONFIG.world.w, H/CONFIG.world.d)` 输 `letterbox = (W - worldWidthSS)/2`, `(H - worldDepthSS)/2` 居中填. 见 §16-S5 (open).

### 7.3 不做 (PR #9 边界)
- 无交互 (点击/缩放/拖动);绝不 ray cast 到 3D 场景

## 8. RADAR app (龙珠雷达)

### 8.1 独立 canvas (不复 GTA renderer)

canvas 与 MAP 同尺寸 (phone-screen 内 220×220 居中 + 下方读数区 30px) 。phoneHud 内 RADAR canvas 由 phoneHud 自己直接 2D 绘制 (不复 createMinimap)。

### 8.2 canvas 2D API (per-frame, sweep 全帧)

```ts
// 全帧 (无节流 — sweep 全帧动; blip 51 个 atan2 < 1ms 总)
// 1) 清 + 黑底
ctx.fillStyle = '#0c0f17';
ctx.fillRect(0, 0, W, H);

// 2) 雷达圆 clip
const cx = W/2;
const cy = 18 + (H - 46) / 2;  // 下方留 28px 给读数 & capacity
const R  = Math.min(W, H - 46) / 2 - 8;
ctx.save();
ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

// 圆底 (深绿径向)
const bg = ctx.createRadialGradient(cx, cy, 8, cx, cy, R);
bg.addColorStop(0, 'rgba(20, 90, 50, 0.45)');
bg.addColorStop(1, 'rgba(8, 30, 18, 0.55)');
ctx.fillStyle = bg; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

// 3) 距离环: 5m / 15m / 25m (R = 25m)
for (const rM of [5, 15, 25]) {
  const rPx = (rM / 25) * R;
  ctx.strokeStyle = rM === 25 ? 'rgba(0,255,135,0.55)' : 'rgba(0,255,135,0.22)';
  ctx.lineWidth   = rM === 25 ? 1.3 : 0.8;
  ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, Math.PI * 2); ctx.stroke();
  if (rM !== 25) {
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(120, 230, 170, 0.65)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(rM + 'm', cx + 2, cy - rPx);
  }
}

// 4) 十字基线 (N-S / E-W)
ctx.strokeStyle = 'rgba(0,255,135,0.22)';
ctx.lineWidth = 0.6;
ctx.beginPath();
ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
ctx.stroke();

// 5) sweep line (旋转 — 全帧动)
const t = performance.now() / 1000;
const sweep = (t * 1.6) % (Math.PI * 2);  // ~2.5 圈/秒 (装饰节奏)
const sx = cx + Math.cos(sweep) * R;
const sy = cy + Math.sin(sweep) * R;
const sg = ctx.createLinearGradient(cx, cy, sx, sy);
sg.addColorStop(0, 'rgba(0,255,135,0.65)');
sg.addColorStop(1, 'rgba(0,255,135,0)');
ctx.strokeStyle = sg; ctx.lineWidth = 1.6;
ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.stroke();

// 6) outlet blip (方位 + 距离)
let nearest: { dist: number; angle: number } | null = null;
for (const o of state.outlets) {
  const dx = o.x - state.player.x;
  const dz = o.z - state.player.z;
  const dist = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);  // 屏幕上 = atan2(Δz, Δx), 屏幕yz 上对应东 = 右 = +x
  const rPx = Math.min(dist / 25, 1) * R;  // 超过 25m clip 圆
  if (rPx > R) continue;
  const bx = cx + Math.cos(angle) * rPx;
  const by = cy + Math.sin(angle) * rPx;
  ctx.fillStyle = '#2dff7a';
  ctx.beginPath(); ctx.arc(bx, by, 2.4, 0, Math.PI * 2); ctx.fill();
  if (!nearest || dist < nearest.dist) nearest = { dist, angle };
}

// 7) player 中心点 (无箭头)
ctx.fillStyle = '#ffb142';
ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
ctx.restore();  // 解 clip

// 8) 底部读数 "12m · NE"
let reading = '雷达无信号';
if (nearest) {
  // angle 弧度 → 8 分位 compass. E=0,N=-π/2,W=-π/3,S=π/2 ... (屏幕 y 向下 ⇒ 北 = 上 = atan2(-1,0)=-π/2)
  const COMPASS = ['E','SE','S','SW','W','NW','N','NE'];
  // 把 [-π, π] 映射到 [0, 8) 的索引: idx = round(((angle + 2π) mod 2π) / (π/4))
  const idx = Math.round((((angle = nearest.angle) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  reading = `${Math.round(nearest.dist)}m · ${COMPASS[idx]}`;
}
ctx.font = 'bold 16px sans-serif';
ctx.fillStyle = '#2dff7a';
ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
ctx.fillText(reading, W/2, H - 26);

// 9) capacity count summary
const emptyN = state.outlets.filter(o => !o.occupied).length;
const occN   = state.outlets.filter(o =>  o.occupied).length;
ctx.font = '10px monospace';
ctx.fillStyle = 'rgba(220,220,220,0.6)';
ctx.fillText(`${emptyN} 空 / ${occN} 占`, W/2, H - 10);
```

(`angle = nearest.angle` 兼顾 TS const-correct — 写法上把 idx 行 straightened)

写字楼 §16 S6 注:8 分位 compass 顺序 + idx 公式 (开 Snake 决策北方约定).

### 8.3 不做 (PR #9 边界)
- 无占用色 (PR #11)
- 无 sweep 与 blip 相消动画 ("ping 探测" 留 forward)

## 9. QUERY app (GTA renderer + 占用状态着色)

### 9.1 复用 src/ui/minimap.ts

```ts
const minimapQuery = createMinimap(queryCanvas, {
  blipColor: (o) => o.occupied ? '#ff4d4d' : '#2dff7a',
  zoneLabels: true,
});
// SharedState.occupied 当前 stub 全 false → 全绿 (PR #11 接 NPC 后变红)
// PR #11 升级 SharedState.occupied 类型为 status enum ('free'|'npc'|'player') 时,
//   blipColor 改写为 tristate → '#2dff7a'/'#ff4d4d'/'#ffd24a' (本 PR 不需)
```

### 9.2 顶部 legend bar (高 24px,在 query app view canvas 上方)

```html
<div class="phone-query-legend">
  <span class="legend-dot" style="background:#2dff7a"></span> 空 <span id="q-empty">51</span>
  <span class="sep">·</span>
  <span class="legend-dot" style="background:#ff4d4d"></span> 占 <span id="q-occupied">0</span>
  <span class="sep">·</span>
  <span class="legend-dot" style="background:#ffd24a"></span> 你 <span id="q-yours">0</span>
</div>
```

count 实时计算: `qEmpty = outlets.filter(!o)`,`qOccupied = outlets.filter(o)`,`qYours = 0` (player 自占模式未实现,stub)。

Legend CSS: `font: 10px monospace; color: rgba(255,255,255,0.85); padding: 4px 10px; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px)`

## 10. App 切换 + onAppAction emit 规则

### 10.1 activeApp 状态机 (PR #9 简化为单前台)

```
home  ⇄ 1 ⇄  MAP
home  ⇄ 2 ⇄  RADAR
home  ⇄ 3 ⇄  QUERY

任意 app on 时按其他 app: 关前者开后者 (单前台切换)
```

(Multi-open: master §3.2 留 forward; PR #9 暂用单前台 — battery 倍率 PR #10 接通后再决定 multi-open UX. 见 §16 S-2.)

```ts
let activeApp: AppId = 'home';
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (onboardingActive) skipOnboarding();
  if (e.repeat) return;
  switch (e.code) {
    case 'Digit1': toggleApp('map');    break;
    case 'Digit2': toggleApp('radar');  break;
    case 'Digit3': toggleApp('query');  break;
  }
});

function toggleApp(a: AppId): void {
  activeApp = (activeApp === a) ? 'home' : a;
  updateAppViewsDisplay();          // 切 .active class
  updateHomeViewDisplay();          // home = grid 显隐
  if (a === 'map')   opts.onAppAction({ kind: 'toggle-map' });
  if (a === 'query') opts.onAppAction({ kind: 'query-outlets' });
  // a === 'radar'  ⚠ §16-S1: 当前 AppAction union 缺 toggle-radar, 不发 action
}
```

注: emit 在 toggle 时无论开/关都发同 kind (toggle 语意)。toggle 关时的语义留给 PR #10 接通电池接通后解读 (likely 调用方内部用集合追踪 open apps)。

### 10.2 onAppAction 当前 union 与缺口

| app | open 事件 | close 事件 | 已 wire |
|---|---|---|---|
| MAP (1)    | `toggle-map`     | `toggle-map`    | ✔ |
| QUERY (3)  | `query-outlets`  | `query-outlets` | ✔ |
| RADAR (2)  | —— 缺 `toggle-radar` —— | —— | ✘ (见 §16-S1) |

## 11. 实时性硬约束 (master §10 决策 5)

每帧 RAF 通过 `getSharedState()` 现读。严禁任何形式:
- 缓存 player prevX/prevZ / yaw
- 启动时 outlets 静态截图
- 启动 battery 快照
- 在 phoneHud 内对 outlet/player 物体去做 reference stable 化 (SharedState 是 plain object snapshot,每帧全新)

验收 (§15): WASD 移动 → 玩家箭头/雷达 blip 实时跟随 (节流可,但数据必须每帧来自新 SharedState)。

## 12. main.ts 编辑 (Layer 1 standalone minimap 删除 — 精确 3 处)

基线 9a7e1d2 `src/main.ts`, PR #9 diff:

```diff
   import { mountPhoneHud } from './ui/phoneHud';
   import { mountPlayerStats } from './game/playerStats';
   import { CONFIG } from './game/config';
-  import { createMinimap } from './ui/minimap';
   import './style.css';
```

```diff
   mountPlayerStats({ getSharedState });

-  // --- Minimap ---
-  const minimap = createMinimap();

   // --- Debug: expose getSharedState to window for console eval ---
```

```diff
   function animate() {
     requestAnimationFrame(animate);
     const dt = Math.min(clock.getDelta(), 0.1);
     controller.update(dt);
     update(dt);
     renderer.render(scene, camera);
-    minimap.update(colliders, getSharedState());
   }
```

无 dispose (Layer 1 main.ts 未调 minimap.dispose())。删除后对象孤立,GCD 接管。

## 13. 性能预算 (master §12)

- phoneHud RAF 全帧 ~60fps: 每帧只读 SharedState (廉价 getter) + DOM/canvas 浅更新
- minimap canvas: FRAME_SKIP=2 (每 3 帧画一次, ~20fps phone canvas draw)。 51 blip 全帧实测 <3ms/frame
- RADAR canvas: 全帧 ~60fps: sweep 动画 + 51 blip × atan2 ≈ <1.5ms/frame
- 不引 npm 新包; CSS 用 `system-ui` / `ui-monospace` / `monospace` 内置字体 (无 webfont 下载)
- prod bundle: ≤ baseline + 12KB (估算 ~7KB phoneHud + ~5KB minimap refactor + spec *.md 不入 bundle)
- **master §12 ≤620KB 上限可能被破**:基线 9a7e1d2 `dist/assets/*.js` 已 = 619.00 kB (gzip 158.93 kB),仅余 1 KB headroom。 本 PR +5~12 KB raw,将落到 ~624~631 kB,破 §12 上限 ~4~11 KB。 见 §16-S8 (需 Snake 决策)。

## 14. 测试策略 (master §13)

- 不增单测 — UI/visual 不在 vitest 测 (`game/` 单测是 layer 纪律,UI 不测)
- 原 6 tests 不增不减: pathfinding 4 (`src/game/pathfinding.test.ts`) + gridModel 2 (`src/game/gridModel.test.ts`)
- 手动验证: §15 全 checklist 浏览器肉眼验 (`npm run dev` → http://localhost:5173)
- `npm run build` = tsc + vite 绿 (类型门;无单独 lint/typecheck 脚本)
- `npm test` = vitest run,6 pass

## 15. 验收标准 (A-I, 参照 Layer 1 spec §11)

### A. 构建与类型 (命令行可验)

- [ ] `npm run build` 绿 (tsc + vite),零 TS error, 零 warning
- [ ] `npm test` 6 pass: pathfinding 4 + gridModel 2 — 不增不减
- [ ] `npm run dev` 起得来,无控制台红错
- [ ] prod bundle 体积 ≤ baseline 9a7e1d2 + 12KB (`du -h dist/assets/*.js`)
- [ ] `git diff main --stat` **不含** `README*` / `src/game/**` / `src/player/**` / `src/scene/**` / `src/debug/**` / `src/platform/sharedState.ts` / `package.json` / `package-lock.json`

### B. Phone chassis 视觉 (浏览器肉眼)

- [ ] 右下角出现 GTA 黑色 bezel 圆角悬浮手机,260×540,padding 20px 距右下,屏幕 inset 阴影
- [ ] 机身边线 + 侧边按钮 SVG: 右侧电源 / 音量+ / 音量−,左侧静音 (位置感对位真机)
- [ ] 状态栏 24px 高: 左装饰 "9:41" + 4 bar signal + 扇形 wifi; 右 battery icon (28×14 outline + fill)
- [ ] 电池槽内嵌红色发光 "3:00" (M:SS, stub battery=1.0 ⇒ battery×180s=180s 一致); 电池 icon 右隔壁 "100%" 辅助 (stub battery=1.0)
- [ ] 壁纸: 暗冷色径向渐变 (左上 #1a2235 → 黑); chassis 屏幕非纯黑而是带 planning textures 微光

### C. App icon grid + onboarding (浏览器肉眼)

- [ ] 4 个 icon 显示 (3 真 + 1 dashed 占位);占位 dashed 灰 + 🐾 + label "等待安装" 永远不动画
- [ ] 开局 ~1 秒内,3 真 app icon 经历 pending (灰环 + glyph 灰 + label "等待") → installing (绿环 0→100%) → ready (环消失,icon 亮,box shadow pulse, label "已安装") 三段动画
- [ ] MAP / RADAR / QUERY 三真 app 错峰 0/200/400ms 启动 installing
- [ ] 总 ~1.0s 后 3 真 icon 全 ready
- [ ] ANY KEY (WASD/Shift/Esc/1/2/3 任一) → 立即 skip onboarding,3 真 icon 跳 .ready;后续游戏正常继续

### D. Battery 实时反映 + 阈值逻辑

- [ ] Stub state (battery=1.0,GCD stub): M:SS="3:00"; %="100%"; 电池 fill scaleY=1.0; banner 不显;无 blackout
- [ ] 代码 grep 验阈值逻辑 (PR #10 接 real battery 后即触发):
  - `battery <= 0.10` → 加 `.show` (CSS transform:translateY(0) 滑入)
  - `battery <= 0.03` → 额外加 `.blink` (CSS keyframe 0.7s 持续)
  - `battery <= 0`   → `.phone-screen-blackout.show` opacity 1
- [ ] ≤3% blink 附近代码含 `TODO ⚠ 心跳音 SFX 留 PR #10 / David` 注释

### E. MAP app (1 键) — 浏览器肉眼

- [ ] 按 1: chassis 内 MAP view 显示 (canvas + zone labels "书架区/自习区/走廊" + outlet 全绿 blip + 顶居中 N 指示)
- [ ] 再按 1: 回 home (canvas 隐藏, grid + 壁纸复原)
- [ ] WASD 移动 → 玩家三角箭头位置实时跟随 (FRAME_SKIP 节流可接受)
- [ ] 鼠标转角 → 三角箭头朝向同步 (yaw 0 ⇒ tip 朝屏 -y 上方[GTA north-up])
- [ ] outlet 不动 / vignette / N 标 一致呈现
- [ ] MAP 顶部无 legend (与 QUERY 区分)

### F. RADAR app (2 键) — 浏览器肉眼

- [ ] 按 2: chassis 内 RADAR view 显示 (深绿背景圆 + 同心环 5m/15m/25m + 标签 + 玩家中心橙点无箭头 + 绿色 outlet blip 散布)
- [ ] sweep line 持续旋转 (~2.5 圈/秒可见装饰)
- [ ] 底部大字 "Xm · NE/E/SE..." (X 最近 outlet 距离, 8 分位方位)
- [ ] 底部小字 "51 空 / 0 占" (stub count)
- [ ] WASD 移动 → outlet blip 位置实时变化 (player 中心固定)

### G. QUERY app (3 键) — 浏览器肉眼

- [ ] 按 3: chassis 内 QUERY view 显示 (顶部 legend bar + 复用 GTA renderer 主区)
- [ ] legend "● 空 51 · ● 占 0 · ● 你 0" 实时从 `state.outlets.filter()` 计算
- [ ] outlet blip 全绿 (stub occupied=false)
- [ ] 复用 MAP renderer (N 标/vignette/三角箭头/zone labels) 风格一致

### H. main.ts + 反向验收 (不应出现)

- [ ] `git diff main -- src/main.ts` 仅 3 处删可见 (import / minimap const / RAF update)
- [ ] 不应出现:
  - `src/game/**`/`src/player/**`/`src/scene/**`/`src/debug/**`/`src/platform/sharedState.ts` 任何改动
  - main.ts 中 `mountPhoneHud` / `mountPlayerStats` 调用点改动 (只删 minimap 接线)
  - 无新 npm 包 (`package.json` 与 `package-lock.json` 不动)
  - 无 NPC red blip 实际着色 (PR #11 范围)
  - 无 dash / 电池消耗 formula 代码 (PR #10 范围)
  - 无新 test 文件 / 新 vitest case (6 tests 不增不减)
  - 不在 `src/platform/sharedState.ts` 加 `'toggle-radar'` (file boundary 严禁; 见 §16-S1)

### I. Git / 流程

- [ ] branch `opencode/glowing-tiger` (opencode 内置 worktree 例外使用; 非 `feat/*` 是 dispatch 许可)
- [ ] commit 作者 `Sam <sam@agent.local>` (`git log --format='%an %ae'` 全 Sam)
- [ ] commit 信息英文, 格式 `type: summary`, 分 ~6-10 个
- [ ] PR 标题 `feat: phone HUD UI (3 app + GTA chassis + install animation)`
- [ ] PR body 含本 spec 链接 + §15 checklist 勾选输出 + build/test 输出截屏
- [ ] push 前自验 §15 全符合

## 16. 需 Snake 决策 (本 PR 不擅自决定; spec 锚点)

### S-1. AppAction union 缺 `'toggle-radar'` ⇒ RADAR 切换无 action emit

**问题**: master §7.3 钉死的 `AppAction = 'query-outlets' | 'toggle-map' | 'close'` — 不含 RADAR toggle。 master §3 升级到 3 app 后,RADAR 切换需发 action (PR #10 用以 wire ×3 battery 倍率)。

**File boundary 冲突**: dispatch 严禁改 `src/platform/sharedState.ts` 签名。

**本 PR 处置**: phoneHud 内 RADAR toggle 不发 action (内部 state 切换 + DOM 切换仍正常),代码注释标记 `// ⚠ §16-S1:RADAR toggle 无对应 AppAction,留 Snake 加 {kind:'toggle-radar'} 到 union` (phoneHud.ts RADAR 分支处)。

**建议 Snake**: 1-line docs/小 PR `docs: extend AppAction union for 3-app unlock` 加 `{kind:'toggle-radar'}` 到 union; 或升级 union 形如 `{kind:'toggle-app'; app:'map'|'radar'|'query'} | {kind:'close'}` (统一化但破坏既有 `toggle-map`/`query-outlets` 调用方语义 — PR #10 还未接通 consume,可适配)。 决定后我 patch phoneHud 一行 `onAppAction` 即可。

### S-2. Multi-app open vs exclusive toggle (master §3.2 与 §3.8 表面冲突)

**问题**: §3.2 提"玩家可同时开 RADAR+MAP 拿方位+地形 (×5 耗电)"; §3.8 / dispatch verification 说 "1/2/3 切对应 app" (暗示单前台切换)。

**本 PR 处置 (简化)**: exclusive 单前台切换 — 一次只 1 app 显示; 再按回 home; 按 Y (他 app) 关前开 Y。 Multi-open UX (split-screen) 留 forward 实现。

**建议 Snake**: PR #10 接通 battery 倍率后在 SharedState 同步 multi-open UX (确认 exclusive vs multi)。 单 app 只追 activeApp 一个变量,multi 需 `Set<AppId>` + UI layout。 决定后我 PR #9 视觉接受。

### S-3. 电池显示约定 — master §3.4 "1% 数字" vs stub `battery=1.0` ⇒ 屏幕 "100%"

**问题**: master §3.4 chassis 状态栏 "隔壁显示 1% 数字",表示开局显示 "1%"。 但 stub `SharedState.battery=1.0`,本 PR 显示 `Math.round(battery*100)` ⇒ "100%"; 按 `CONFIG.battery.totalGameTimeS=180`,`sec = battery*180`,stub=1.0 ⇒ "3:00"。

`%` 与 `sec` 二者 scaling 不同 (`*100` vs `*180`) ⇐ 时序虽同 (battery 同),但显数不同。 "1% = 180s ⇒ battery=0.01 ⇒ `battery*180=1.8sec` ≠ 180" 数学不可同时为真.

**本 PR 处置**: `pct = round(battery*100)`、 `sec = round(battery * CONFIG.battery.totalGameTimeS)` ⇒ "100% / 3:00". 阈值 `<=0.10` 与 `<=0.03` 走 `battery` 比例 (与 displayed `pct<=10` 同义).

**建议 Snake**: OK 让 David (PR #10) 决定 `startPercent` 真实值 (`startPercent = 1.0` ⇒ "100% / 3:00"⇒主题 "1%" 是 narrative 而非硬显示; OR `startPercent = 0.01` ⇒ "1% / 0:02" 但要 sec scaling 改 `*18000`; master §3.4 真要"开局 1%", 必选后一项 ⇒ 手机总电是真 5 小时 = 1% 180sec 残 —jam narrative 通). PR #9 视觉逻辑在同一 scaling 下相同, 不阻塞.

### S-4. Onboarding 期间 WASD 与 1/2/3 同按下

**问题**: onboarding active 时 WASD 已可控制 (game loop 已起 controller.update); 1/2/3 触发 BOTH `skipOnboarding()` + `toggleApp()` 单键两意图.

**本 PR 处置**: onboarding active 时,任意键 first `skipOnboarding()`, 同 frame 内 fall through `toggleApp('map'/'radar'/'query')`. UX 预期: 按 1 跳过动画 + 同时开 MAP (强力用户体验). 不冲突.

**建议 Snake**: OK OR `if onboarding: 只 skip 不 toggle`. 默认透传.

### S-5. minimap canvas 宽高比 confinement

**问题**: chassis 屏幕 240×500 utilitarian area 给 MAP, m/d = 32/24 ≈ 1.33 (横偏). 240×MAX canvas ⇒ 必 letterbox 或分轴缩 → 现世界比例水平填满 canvas 宽 (W=240 = 32m×7.5px/m), Y fill = 24m×7.5px/m=180 (canvas 高 180, 上下留空 ~30). 战轴不会跑掉.

**本 PR 处置**: `scale = min(W/CONFIG.world.w, H/CONFIG.world.d)`, `letterboxX = (W - worldW*scale)/2 / scale [↔ worldX add offset]`. 录代码 `toX(wx) = (wx + CONFIG.world.w/2) * scale + offsetX`. 简洁 1 行.

### S-6. RADAR 8 分位 compass 索引公式

**问题**: `angle = atan2(dz, dx)` (屏幕 y 朝下 ⇒ 北在屏上方对应 atan2 dz=-1 dx=0 = -π/2). 8 分位循环索引公式需 ANCHOR 确认:

```
COMPASS = ['E','SE','S','SW','W','NW','N','NE'];
idx = round(((angle + 2π) mod 2π) / (π/4)) % 8
```

E (0)=atan2(0,1)=0 ⇒ idx=0=E ✓; NE (-π/4)=atan2(-1,1)? Y/z 向下: dz=-1 ⇒ atan2(-1,1)=−π/4 ⇒ idx=round((-π/4+2π)/(π/4))=round(7)=7=NE ✓

E, NE 排序正确. 但 angular 锚玩家移动方向 (player 自带 yaw) 浦?: master §3.7 RADAR 内"角度 = outlet 方位", 无需 yaw 旋 (world-space). 故用 `atan2(dz, dx)`. 答案 anchor 一致的.

**本 PR 处置**: 用 `COMPASS = ['E','SE','S','SW','W','NW','N','NE']`. 不动 yaw.

**建议 Snake**: OK 不改.

### S-7. PR #9 视觉地域 (colliders / terrain) 描绘

**问题**: master §3.6 MAP "升级 GTA 风" 留 space for 真地形绘制 (书架矩形等), 但 acceptance only 列 zone labels + blips + arrow. Terrain 简处不画 = OK by acceptance? 我判断是的 (dispatch verbatim 不含 "terrain must render" 字眼). 但若 master §3.6 言外之意要求 terrain 可视, PR #9 必加 `getColliders` optional prop — main.ts call site 不变更 (作 optional, 实际不传 ⇒ 不画 terrain) ⇒ 不破 file boundary. 留 forward OR pr9 增 optional.

**本 PR 处置**: 不画 terrain (只 zone labels + blips + N + vignette). 不加 `getColliders` optional (forward干净).

**建议 Snake**: OK 不画 / PR #11 决定. Terrain 简化是 visual 风格主张, 不阻塞 acceptance.

### S-8. prod bundle 破 master §12 ≤620KB 上限

**问题**: 基线 9a7e1d2 `npm run build` 产出 `dist/assets/index-*.js = 619.00 kB` (gzip 158.93 kB), 仅 1 KB headroom to §12 "≤620KB" 上限。 exp本 PR +5~12 KB raw → ~624~631 kB, 破上限 ~4~11 KB。

**根因**: master §12 的 620 KB 数字是 Layer 1 (PR #8) 时订立的, 那时 phone HUD 3-app + chassis 还未在 spec 中显形 (PR #9 spec 是 08-04 才补)。 spec §6 phone HUD、§3.4 GTA chassis 写实后, ~7 KB CSS+JS 不可避免。

**File boundary / Spec boundary 冲突**: 修 master §12 数字本身属 docs-only 微修订 (≤10 行 / 无代码 / spec 已被 PR #9 引用, 但 §12 本身是预算 anchor 非实现 source, 仍属预算微调而非 def 已实施变更)。 dispatch 严禁我 push main。

**本 PR 处置**:
- 实际 bundle 大小实测后, 在 PR body 中如实报 (e.g. "post-PR dist/assets `index-*.js` = 628.34 kB / gzip ~160 kB")
- 不刻意"为≤620KB而压"—不做手动混淆 / 不删 master §3 锁定 UX
- 不在 PR #9 范围内做 code-splitting (master §12 注脚只列 vitest/lil-gui 路径, 没说要 split three.js — three.js ~600 KB 本身是 §12 上限不可能稳守的根本)

**建议 Snake**: 开个 1-line docs-only commit 直接 push main (rule 7 例外许可 ≤10 行 / 无代码): bump master §12 from `≤620KB` ⇒ `≤640KB` (或更显: 加注 "phone HUD (PR #9) 后: ≤640KB; 三大 future-bound-growth 锚 baseline"。 如改 640 KB, 本 PR 即合规如初)。 我不擅自 push main 也不改 master spec — 等你决策。

## 17. 决定记录

| # | 决策 | 来源 | 理由 |
|---|---|---|---|
| 9-1 | chassis 用 GTA5 smartphone 视觉 | master §3.4 / §10 决策 9 | 真实手机惯例, jam 期 ~4h 代码 + CSS |
| 9-2 | 时间为主单位 (M:SS 嵌电池 icon) | master §10 决策 10 | time 是终极排序单位, % 是衍生辅助 |
| 9-3 | onboarding = 选项 D (install 动画 + 占位) | master §3.5 / §10 决策 11 | 真实 App Store pending install 流, 第 4 icon 永远 pending |
| 9-4 | 多 app 凹陷 canvas 各自 | §3.6/§3.7/§3.8 | 不同信息架构, 不同 renderer, 单前台切换简单 |
| 9-5 | main.ts 删 Layer 1 左下独立 minimap | master §3.9 / §10 决策 8 | minimap 只在 phone 内, app 关 = 完全瞎走,忠于 §6 tension |
| 9-6 | RADAR 不复 GTA renderer |_master §3.7 | 龙珠雷达无地形, 纯方位图 |
| 9-7 | 实时 RAF 全帧读 getSharedState | master §10 决策 5 / §13 | 每帧现读, 无缓存 |
| 9-8 | 单前台切换 (multi-open forward) | §16-S2 (本 PR 暂用) | master §3.2 multi-open 留 PR #10 电池接通后回填 |
| 9-9 | 不画 terrain (colliders) | §16-S7 | acceptance 不要求, forward optional getColliders |
| 9-10 | bundle 超 master §12 ≤620KB 标 S-8 让 Snake 决策 | §16-S8 | 不擅自改 master spec; PR body 实测报大小 |