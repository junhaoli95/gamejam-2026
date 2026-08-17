import { CONFIG } from '../game/config';
import type { SharedState, AppAction } from '../platform/sharedState';
import { createMinimap, type MinimapHandle } from './minimap';

// ============================================================================
// Phone HUD — GTA5-styled smartphone overlay (PR #9, master §3)
// ----------------────────────────------------------------------------------------
// File boundary (`ag` rule 11 + dispatch):
//   - Owns src/ui/phoneHud.ts and consumes createMinimap() from
//     src/ui/minimap.ts (rewritten in this PR).  Layer-1 main.ts call-site is
//     untouched (only deletions of standalone minimap wiring per §12).
//   - Never mutates src/platform/sharedState.ts.  AppAction union gap (no
//     'toggle-radar') flagged in §16-S1 — RADAR toggle runs internally but
//     does NOT emit onAppAction().
//
// Realtime hard constraint (master §10 decision 5):
//   The internal RAF re-reads `opts.getSharedState()` every frame.  No
//   startup snapshots, no caching.  Per-app canvases throttle redraws (MAP/QUERY
//   via minimap FRAME_SKIP=2; RADAR full-frame sweep) but all data is fresh.
//
// Sample / % scaling (§16-S3):
//   M:SS  = round(battery * CONFIG.battery.totalGameTimeS)
//   pct   = round(battery * 100)
//   battery ∈ [0,1] comes from SharedState (stub=1.0 ⇒ "3:00" / "100%").
// ============================================================================

export interface PhoneHudOptions {
  getSharedState: () => SharedState;
  onAppAction: (action: AppAction) => void;
}

type AppId = 'home' | 'map' | 'radar' | 'query';

const STYLE_ID = 'phone-hud-styles';
const CSS = `
.phone-hud-root {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 5;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  user-select: none;
}
.phone-chassis {
  position: relative;
  width: 260px;
  height: 540px;
  border-radius: 28px;
  background: linear-gradient(165deg, #1a1a1c 0%, #0a0a0c 65%, #000 100%);
  border: 1.5px solid #2a2a2e;
  box-shadow: 0 14px 44px rgba(0,0,0,0.58), 0 2px 8px rgba(0,0,0,0.4);
  filter: drop-shadow(0 0 12px rgba(0,0,0,0.4));
}
.phone-side-btn {
  position: absolute;
  background: #222;
  box-shadow: inset -1px 0 0 rgba(255,255,255,0.06);
}
.phone-side-btn.power { right: -3px; top: 110px; width: 3px; height: 44px; border-radius: 0 2px 2px 0; }
.phone-side-btn.vol-up { right: -3px; top: 175px; width: 3px; height: 26px; border-radius: 0 2px 2px 0; }
.phone-side-btn.vol-dn { right: -3px; top: 215px; width: 3px; height: 26px; border-radius: 0 2px 2px 0; }
.phone-side-btn.silence { left: -3px; top: 180px; width: 3px; height: 22px; border-radius: 2px 0 0 2px; }

.phone-screen {
  position: absolute;
  inset: 10px;
  border-radius: 18px;
  background: radial-gradient(circle at 30% 18%, #1a2235 0%, #0d111c 55%, #05080f 100%);
  box-shadow: inset 0 0 22px rgba(0,0,0,0.88), inset 0 1px 0 rgba(255,255,255,0.06);
  overflow: hidden;
}
.phone-screen-blackout {
  position: absolute;
  inset: 0;
  background: #000;
  opacity: 0;
  transition: opacity .12s linear;
  pointer-events: none;
  z-index: 50;
}
.phone-screen-blackout.show { opacity: 1; }

/* status bar */
.phone-status-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  box-sizing: border-box;
  color: #fff;
  font-size: 9px;
  pointer-events: none;
  z-index: 10;
}
.phone-clock { letter-spacing: 0.04em; }
.phone-status-right { display: flex; align-items: center; gap: 5px; }
.phone-signal-bars { display: inline-flex; align-items: flex-end; gap: 1.5px; height: 9px; }
.phone-signal-bars rect { width: 2px; background: #fff; }
.phone-wifi { display: inline-block; }
.phone-battery {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.phone-battery-shell {
  position: relative;
  width: 28px;
  height: 14px;
  border: 1.5px solid #cfcfcf;
  border-radius: 2px;
  box-sizing: border-box;
  overflow: visible;
  display: inline-block;
}
.phone-battery-shell::after {
  content: "";
  position: absolute;
  top: 3px;
  right: -3px;
  width: 2px;
  height: 6px;
  background: #cfcfcf;
  border-radius: 0 1.5px 1.5px 0;
}
.phone-battery-fill {
  position: absolute;
  inset: 1px;
  background: #e8e4d8;
  transform-origin: bottom;
  border-radius: 1px;
  transition: transform .12s linear, background .2s ease;
}
.phone-battery-fill.low { background: #ff4d4d; }
.phone-battery-time {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font: bold 8px ui-monospace, "SF Mono", Menlo, monospace;
  color: #ff5a5a;
  text-shadow: 0 0 5px rgba(255,80,80,0.75);
  z-index: 2;
  letter-spacing: 0.04em;
  pointer-events: none;
}
.phone-battery-pct {
  font: bold 9px sans-serif;
  color: #ff5a5a;
}

.phone-lowbatt-banner { position: absolute; top: 24px; left: 0; right: 0; height: 4px; background: linear-gradient(180deg,#ff4d4d,#c92828); border-radius: 0 0 8px 8px; transform: translateY(-110%); transition: transform .35s cubic-bezier(.22,1,.36,1); pointer-events: none; box-shadow: 0 4px 14px rgba(255,77,77,0.4); z-index: 9; }
.phone-lowbatt-banner.show { transform: translateY(0); }
.phone-lowbatt-banner.blink { animation: lb-blink 0.7s steps(2,end) infinite; }
@keyframes lb-blink {
  0%, 49%   { opacity: 1; }
  50%, 100% { opacity: 0.35; }
}

/* app area */
.phone-app-area {
  position: absolute;
  top: 24px; left: 0; right: 0; bottom: 0;
  z-index: 5;
}
.phone-home, .phone-app-view {
  position: absolute;
  inset: 0;
  display: none;
  flex-direction: column;
}
.phone-home.active, .phone-app-view.active { display: flex; }

/* home grid */
.phone-home {
  padding: 22px 14px 16px;
  align-items: center;
  justify-content: flex-start;
}
.phone-app-grid {
  display: grid;
  grid-template-columns: repeat(3, 60px);
  gap: 22px 18px;
  justify-content: center;
  width: 100%;
  margin-top: 18px;
}
.phone-app-icon {
  position: relative;
  width: 60px;
  height: 92px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.phone-app-glyph {
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px;
  box-sizing: border-box;
  background-origin: padding-box;
}
.phone-app-glyph.map     { background: linear-gradient(135deg, #2d5d8a 0%, #1a3a5e 100%); }
.phone-app-glyph.radar  { background: linear-gradient(135deg, #c97632 0%, #8a4912 100%); }
.phone-app-glyph.query  { background: linear-gradient(135deg, #2e8a4a 0%, #185f30 100%); }
.phone-app-glyph.pending {
  background: transparent;
  border: 1.5px dashed rgba(255,255,255,0.25);
}
.phone-app-label {
  font: 10px sans-serif;
  color: rgba(255,255,255,0.85);
  text-align: center;
}
.phone-app-state-tag {
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
  font: 8px sans-serif;
  color: rgba(255,255,255,0.7);
  background: rgba(0,0,0,0.5);
  padding: 1px 5px;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
}

/* install ring (SVG overlay) */
.install-ring {
  position: absolute;
  top: 0;
  left: 0;
  width: 60px;
  height: 60px;
  pointer-events: none;
}
.install-active { transition: stroke-dashoffset .05s linear; }
.phone-app-icon.installing .install-active {
  animation: install-ring 600ms linear forwards;
}
@keyframes install-ring {
  from { stroke-dashoffset: 163.42; }
  to   { stroke-dashoffset: 0; }
}
.phone-app-icon.ready .install-ring { display: none; }
.phone-app-icon.ready .phone-app-state-tag { animation: fade-state-in .45s ease-out forwards; }
@keyframes fade-state-in { from { opacity: 0; } to { opacity: 1; } }
.phone-app-icon.pending .install-active { stroke-dashoffset: 163.42; }
.phone-app-icon.pending .phone-app-glyph { filter: grayscale(0.8) brightness(0.6); }
.phone-app-icon.pending .phone-app-glyph.pending { filter: grayscale(0.4) brightness(0.85); opacity: 0.55; }

/* PR #13 §3.1 app header bar(标题+费率+返回提示) */
.phone-app-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  flex-shrink: 0;
  padding: 0 10px;
  box-sizing: border-box;
  background: rgba(0,0,0,0.55);
  border-bottom: 1.5px solid var(--app-accent);
  color: #fff;
}
.phone-app-header.map   { --app-accent: #2a6cff; }
.phone-app-header.radar { --app-accent: #ff8a3a; }
.phone-app-header.query { --app-accent: #2dff7a; }
.app-header-back  { font: 9px sans-serif; color: rgba(255,255,255,0.7); }
.app-header-title { font: bold 10px sans-serif; letter-spacing: 0.04em; }
.app-header-rate  { font: 9px sans-serif; color: var(--app-accent); }

/* PR #13 §3.1 home icon 费率标注 */
.phone-app-rate {
  font: bold 9px sans-serif;
  color: #ffd24a;
  text-align: center;
}

/* MAP / QUERY canvas container */
.phone-app-view .canvas-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  box-sizing: border-box;
}
.phone-app-view canvas {
  width: 224px;
  height: 184px;
  border-radius: 6px;
  background: #0c1018;
  box-shadow: inset 0 0 8px rgba(0,0,0,0.6);
}

/* QUERY legend bar */
.phone-query-legend {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin: 6px 10px 0;
  font: 10px ui-monospace, "SF Mono", monospace;
  color: rgba(255,255,255,0.85);
  background: rgba(0,0,0,0.4);
  border-radius: 6px;
  pointer-events: none;
}
.phone-query-legend .legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 3px;
  vertical-align: middle;
}
.phone-query-legend .sep { color: rgba(255,255,255,0.4); margin: 0 2px; }

.phone-game-over, .phone-game-win { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px 20px; text-align: center; color: #fff; background: rgba(0,0,0,0.85); z-index: 62; }
.phone-game-over.hidden, .phone-game-win.hidden { display: none; }
.phone-game-title { font: bold 22px sans-serif; color: #fff; }
.phone-game-subtitle { font: 13px sans-serif; color: rgba(255,255,255,0.7); }
.phone-restart-btn { margin-top: 6px; background: #2dff7a; color: #000; padding: 8px 24px; border: 0; border-radius: 8px; cursor: pointer; font: bold 14px sans-serif; pointer-events: auto; }
.phone-menu-btn { margin-top: 8px; background: transparent; color: rgba(255,255,255,0.7); padding: 6px 18px; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; cursor: pointer; font: 12px sans-serif; pointer-events: auto; display: block; margin-left: auto; margin-right: auto; }
`;

function injectStylesOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

function drawRadar(
  canvas: HTMLCanvasElement,
  state: SharedState,
): void {
  // master §3.7 dragon-ball radar (not reusing GTA renderer).
  // Full-frame call — sweep animation needs every RAF tick; 51 atan2 calls
  // per frame is well under 1.5ms.
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#0c0f17';
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  const readBand = 28; // bottom region reserved for reading + capacity
  const cy = (H - readBand) / 2;
  const R = Math.min(W, H - readBand) / 2 - 8;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  // background gradient inside radar circle
  const bg = ctx.createRadialGradient(cx, cy, 8, cx, cy, R);
  bg.addColorStop(0, 'rgba(20,90,50,0.45)');
  bg.addColorStop(1, 'rgba(8,30,18,0.55)');
  ctx.fillStyle = bg;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  // distance rings (5m / 15m / 25m; R represents 25m)
  for (const rM of [5, 15, 25]) {
    const rPx = (rM / 25) * R;
    const isOuter = rM === 25;
    ctx.strokeStyle = isOuter ? 'rgba(0,255,135,0.55)' : 'rgba(0,255,135,0.22)';
    ctx.lineWidth = isOuter ? 1.3 : 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
    ctx.stroke();
    if (!isOuter) {
      ctx.font = '8px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(120,230,170,0.65)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(rM + 'm', cx + 3, cy - rPx);
    }
  }

  // crosshair (N-S / E-W)
  ctx.strokeStyle = 'rgba(0,255,135,0.22)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
  ctx.stroke();

  // sweep line — visually continuous rotation
  const t = performance.now() / 1000;
  const sweep = (t * 1.6) % (Math.PI * 2); // ~2.5 turns/sec decorative
  const sx = cx + Math.cos(sweep) * R;
  const sy = cy + Math.sin(sweep) * R;
  const sg = ctx.createLinearGradient(cx, cy, sx, sy);
  sg.addColorStop(0, 'rgba(0,255,135,0.65)');
  sg.addColorStop(1, 'rgba(0,255,135,0)');
  ctx.strokeStyle = sg;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(sx, sy);
  ctx.stroke();

  // outlet blips: bearing = atan2(dz, dx); radius = dist (clipped to 25m)
  let nearest: { dist: number; angle: number } | null = null;
  for (const o of state.outlets) {
    const dx = o.x - state.player.x;
    const dz = o.z - state.player.z;
    const dist = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const rPx = Math.min(dist / 25, 1) * R;
    const bx = cx + Math.cos(angle) * rPx;
    const by = cy + Math.sin(angle) * rPx;
    ctx.fillStyle = '#2dff7a';
    ctx.beginPath();
    ctx.arc(bx, by, 2.4, 0, Math.PI * 2);
    ctx.fill();
    if (nearest === null || dist < nearest.dist) {
      nearest = { dist, angle };
    }
  }

  // player center pulse (no arrow per master §3.7)
  ctx.fillStyle = '#ffb142';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore(); // release clip

  // bottom reading: "Xm · COMPASS"
  const COMPASS_8 = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  let reading = 'NO SIGNAL';
  if (nearest !== null) {
    // angle ∈ [-π, π]; normalize to [0, 2π); bucket into 8 octants.
    const norm = ((nearest.angle + Math.PI * 2) % (Math.PI * 2));
    const idx = Math.round(norm / (Math.PI / 4)) % 8;
    reading = `${Math.round(nearest.dist)}m · ${COMPASS_8[idx]}`;
  }
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#2dff7a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(reading, W / 2, H - 18);

  // capacity count
  const emptyN = state.outlets.filter((o) => !o.occupied).length;
  const occN = state.outlets.filter((o) => o.occupied).length;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(220,220,220,0.6)';
  ctx.fillText(`${emptyN} free / ${occN} used`, W / 2, H - 4);
}

// build SVG progress ring markup string for a single app icon.
const RING_C = 2 * Math.PI * 26; // ≈ 163.42
function ringSvg(): string {
  return (
    `<svg class="install-ring" viewBox="0 0 56 56">` +
    `<circle class="install-track" cx="28" cy="28" r="26" ` +
    `fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>` +
    `<circle class="install-active" cx="28" cy="28" r="26" ` +
    `fill="none" stroke="#2dff7a" stroke-width="2.5" ` +
    `stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}" ` +
    `transform="rotate(-90, 28, 28)"/></svg>`
  );
}

export function mountPhoneHud(opts: PhoneHudOptions): void {
  injectStylesOnce();

  const root = document.createElement('div');
  root.className = 'phone-hud-root';

  // ── chassis skeleton ──────────────────────────────────────────────────────
  const chassis = document.createElement('div');
  chassis.className = 'phone-chassis';
  chassis.innerHTML = `
<div class="phone-side-btn power"></div>
<div class="phone-side-btn vol-up"></div>
<div class="phone-side-btn vol-dn"></div>
<div class="phone-side-btn silence"></div>
<div class="phone-screen">
  <div class="phone-screen-blackout"></div>
  <div class="phone-status-bar">
    <span class="phone-clock">9:41</span>
    <span class="phone-status-right">
      <svg class="phone-signal-bars" viewBox="0 0 11 9" width="11" height="9" preserveAspectRatio="none">
        <rect y="6" height="3"/>
        <rect x="3" y="4" height="5"/>
        <rect x="6" y="2" height="7"/>
        <rect x="9" height="9"/>
      </svg>
      <svg class="phone-wifi" viewBox="0 0 14 10" width="14" height="10">
        <path d="M1 3 A8 8 0 0 1 13 3" fill="none" stroke="#fff" stroke-width="1.4"/>
        <path d="M3 5.5 A5 5 0 0 1 11 5.5" fill="none" stroke="#fff" stroke-width="1.4"/>
        <circle cx="7" cy="9" r="0.8" fill="#fff"/>
      </svg>
      <span class="phone-battery">
        <span class="phone-battery-shell">
          <span class="phone-battery-fill"></span>
          <span class="phone-battery-time">3:00</span>
        </span>
        <span class="phone-battery-pct">100%</span>
      </span>
    </span>
  </div>
  <div class="phone-lowbatt-banner"></div>
  <div class="phone-app-area">
    <div class="phone-home active">
      <div class="phone-app-grid"></div>
    </div>
    <div class="phone-app-view map">
      <div class="phone-app-header map">
        <span class="app-header-back">← Back (1)</span>
        <span class="app-header-title">🗺 MAP</span>
        <span class="app-header-rate">Power ×2</span>
      </div>
      <div class="canvas-wrap"><canvas width="224" height="184"></canvas></div>
    </div>
    <div class="phone-app-view radar">
      <div class="phone-app-header radar">
        <span class="app-header-back">← Back (2)</span>
        <span class="app-header-title">📡 RADAR</span>
        <span class="app-header-rate">Power ×3</span>
      </div>
      <div class="canvas-wrap"><canvas width="220" height="220"></canvas></div>
    </div>
    <div class="phone-app-view query">
      <div class="phone-app-header query">
        <span class="app-header-back">← Back (3)</span>
        <span class="app-header-title">⚡ QUERY</span>
        <span class="app-header-rate">Power ×4</span>
      </div>
      <div class="phone-query-legend"></div>
      <div class="canvas-wrap"><canvas width="224" height="184"></canvas></div>
    </div>
  </div>
  <div class="phone-game-over hidden"><div class="phone-game-title">No Power</div><div class="phone-game-subtitle">Your phone died. You're trapped in the library.</div><button class="phone-restart-btn">Retry</button><button class="phone-menu-btn">Menu</button></div>
  <div class="phone-game-win hidden"><div class="phone-game-title">Charged!</div><div class="phone-game-subtitle">You survived.</div><button class="phone-restart-btn">Retry</button><button class="phone-menu-btn">Menu</button></div>
</div>`;

  root.appendChild(chassis);
  document.body.appendChild(root);

  // ── refs ─────────────────────────────────────────────────────────────────
  const blackoutEl = chassis.querySelector<HTMLElement>('.phone-screen-blackout')!;
  const battFillEl = chassis.querySelector<HTMLElement>('.phone-battery-fill')!;
  const battTimeEl = chassis.querySelector<HTMLElement>('.phone-battery-time')!;
  const battPctEl  = chassis.querySelector<HTMLElement>('.phone-battery-pct')!;
  const bannerEl   = chassis.querySelector<HTMLElement>('.phone-lowbatt-banner')!;
  // PR #12 §2.6.5 胜负弹窗(refs;§2.6.4 pip bar 已删,能量条移至 gtaPrompt 右上角 stamina bar)
  const gameOverEl   = chassis.querySelector<HTMLElement>('.phone-game-over')!;
  const gameWinEl    = chassis.querySelector<HTMLElement>('.phone-game-win')!;
  const restartOverBtn = chassis.querySelector<HTMLElement>('.phone-game-over .phone-restart-btn')!;
  const restartWinBtn  = chassis.querySelector<HTMLElement>('.phone-game-win .phone-restart-btn')!;
  // PR #28:retry 屏加 Menu 按钮 — 返回标题屏(清 localStorage + reload)
  const menuOverBtn = chassis.querySelector<HTMLElement>('.phone-game-over .phone-menu-btn')!;
  const menuWinBtn  = chassis.querySelector<HTMLElement>('.phone-game-win .phone-menu-btn')!;
  const homeEl     = chassis.querySelector<HTMLElement>('.phone-home')!;
  const mapEl     = chassis.querySelector<HTMLElement>('.phone-app-view.map')!;
  const radarEl   = chassis.querySelector<HTMLElement>('.phone-app-view.radar')!;
  const queryEl    = chassis.querySelector<HTMLElement>('.phone-app-view.query')!;
  const gridEl     = chassis.querySelector<HTMLElement>('.phone-app-grid')!;
  const queryLegendEl = chassis.querySelector<HTMLElement>('.phone-query-legend')!;

  const mapCanvas    = mapEl .querySelector<HTMLCanvasElement>('canvas')!;
  const radarCanvas  = radarEl.querySelector<HTMLCanvasElement>('canvas')!;
  const queryCanvas  = queryEl.querySelector<HTMLCanvasElement>('canvas')!;

  // MAP & QUERY share the GTA renderer; RADAR has its own painter.
  const mapMinimap: MinimapHandle = createMinimap(mapCanvas, {
    blipColor: () => '#2dff7a', // MAP only shows outlet positions, never occupancy (master §3.6)
  });
  const queryMinimap: MinimapHandle = createMinimap(queryCanvas, {
    blipColor: (o) => (o.occupied ? '#ff4d4d' : '#2dff7a'), // free=green / npc=red (PR #11); gold=player kept forward
  });

  // ── app icon grid + onboarding state ─────────────────────────────────────
  // PR #13 §3.1:rate 字段 = home icon 下显示的耗电倍率(isReal=false 等待安装 icon 不显示)
  type IconDef = { id: AppId; glyphClass: string; emoji: string; label: string; rate?: string; isReal: boolean };
  const ICONS: IconDef[] = [
    { id: 'map',   glyphClass: 'map',    emoji: '🗺', label: 'MAP',   rate: '×2', isReal: true },
    { id: 'radar', glyphClass: 'radar',  emoji: '📡', label: 'RADAR', rate: '×3', isReal: true },
    { id: 'query', glyphClass: 'query',  emoji: '⚡', label: 'QUERY', rate: '×4', isReal: true },
    { id: 'home',  glyphClass: 'pending', emoji: '🐾', label: 'Pending Install', isReal: false },
  ];

  const iconEls: Record<string, HTMLElement> = {};
  const installTimers: number[] = [];
  let onboardingActive = true;

  function setStateClass(icon: HTMLElement, state: 'pending' | 'installing' | 'ready'): void {
    icon.classList.remove('pending', 'installing', 'ready');
    icon.classList.add(state);
    const tag = icon.querySelector<HTMLElement>('.phone-app-state-tag');
    if (tag) {
      tag.textContent = state === 'pending' ? 'Pending' : state === 'installing' ? 'Installing' : 'Installed';
    }
  }

  function startOnboarding(): void {
    // 3 real apps stagger by 200ms; each runs 200ms pending → 600ms installing
    // (CSS keyframe drives the 0→100% ring) → ready.  4th placeholder stays
    // pending permanently.
    ICONS.forEach((icon, i) => {
      const el = iconEls[icon.id];
      if (!el) return;
      if (!icon.isReal) {
        setStateClass(el, 'pending');
        return;
      }
      setStateClass(el, 'pending');
      const tStart = i * 200;
      const t = window.setTimeout(() => {
        setStateClass(el, 'installing');
        const tEnd = window.setTimeout(() => {
          setStateClass(el, 'ready');
        }, 600);
        installTimers.push(tEnd);
      }, tStart);
      installTimers.push(t);
    });
  }

  function skipOnboarding(): void {
    if (!onboardingActive) return;
    onboardingActive = false;
    for (const t of installTimers) clearTimeout(t);
    installTimers.length = 0;
    for (const icon of ICONS) {
      if (!icon.isReal) continue;
      const el = iconEls[icon.id];
      if (el) setStateClass(el, 'ready');
    }
  }

  // build icons
  for (const icon of ICONS) {
    const cell = document.createElement('div');
    cell.className = 'phone-app-icon pending';
    cell.innerHTML = `
      ${icon.isReal ? ringSvg() : ''}
      <div class="phone-app-glyph ${icon.glyphClass}">${icon.emoji}</div>
      <div class="phone-app-label">${icon.label}</div>
      ${icon.rate ? `<div class="phone-app-rate">${icon.rate}</div>` : ''}
      <div class="phone-app-state-tag">Pending</div>`;
    iconEls[icon.id] = cell;
    gridEl.appendChild(cell);
  }
  startOnboarding();

  // ── app switching ────────────────────────────────────────────────────────
  let activeApp: AppId = 'home';

  function setActiveApp(a: AppId): void {
    activeApp = a;
    homeEl.classList.toggle('active', a === 'home');
    mapEl .classList.toggle('active', a === 'map');
    radarEl.classList.toggle('active', a === 'radar');
    queryEl.classList.toggle('active', a === 'query');
  }

  // PR #12 §2.6.1 toggleApp 改 exclusive emit 顺序(切回家 emit 旧,切到新先 emit 旧关再 emit 新开)
  // 全部用 { kind: 'toggle-app', app: 'map'|'radar'|'query' },消除 §16-S1 RADAR 缺位。
  // 入参收窄到真 app(toggleApp 永远不接受 'home' — home 只通过 setActiveApp 内部切换)
  function toggleApp(target: 'map' | 'radar' | 'query'): void {
    if (target === activeApp) {
      setActiveApp('home');
      // 切回家,emit 旧 app 关闭(home 本身不 emit)
      opts.onAppAction({ kind: 'toggle-app', app: target });
      return;
    }
    // 切到新:先 emit 旧关(home 不需要 emit),再切 active + emit 新开
    if (activeApp !== 'home') opts.onAppAction({ kind: 'toggle-app', app: activeApp });
    setActiveApp(target);
    opts.onAppAction({ kind: 'toggle-app', app: target });
  }

  // PR #13 §3.1 #5:restart 时手机回 home + emit 旧 app 关(如果有 app 开着)
  // 在 toggleApp 之后定义(依赖 activeApp / setActiveApp / opts)
  restartOverBtn.addEventListener('click', () => {
    if (activeApp !== 'home') opts.onAppAction({ kind: 'toggle-app', app: activeApp });
    setActiveApp('home');
    opts.onAppAction({ kind: 'restart' });
  });
  restartWinBtn.addEventListener('click', () => {
    if (activeApp !== 'home') opts.onAppAction({ kind: 'toggle-app', app: activeApp });
    setActiveApp('home');
    opts.onAppAction({ kind: 'restart' });
  });
  // PR #28:Menu 按钮 — 回标题屏(清 localStorage.titleLevelIndex + reload)
  function backToTitle(): void {
    try { localStorage.removeItem('titleLevelIndex'); } catch { /* ignore */ }
    location.reload();
  }
  menuOverBtn.addEventListener('click', backToTitle);
  menuWinBtn.addEventListener('click', backToTitle);

  // ── keyboard ─────────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (onboardingActive) skipOnboarding();
    switch (e.code) {
      case 'Digit1': toggleApp('map');    break;
      case 'Digit2': toggleApp('radar');  break;
      case 'Digit3': toggleApp('query');  break;
      // PR #13 §3.1:Esc 切回 home(emit 旧 app 关)
      case 'Escape':
        if (activeApp !== 'home') {
          opts.onAppAction({ kind: 'toggle-app', app: activeApp });
          setActiveApp('home');
        }
        break;
      default: break;
    }
  }
  window.addEventListener('keydown', onKey);

  // ── legend (QUERY) ─────────────────────────────────────────────────────────
  queryLegendEl.innerHTML =
    `<span class="legend-dot" style="background:#2dff7a"></span>free <span id="q-empty">0</span>` +
    `<span class="sep">·</span>` +
    `<span class="legend-dot" style="background:#ff4d4d"></span>used <span id="q-occupied">0</span>`;
  const qEmptyEl = queryLegendEl.querySelector<HTMLElement>('#q-empty')!;
  const qOccEl   = queryLegendEl.querySelector<HTMLElement>('#q-occupied')!;

  // ── RAF — realtime every-frame read of getSharedState (§10 decision 5) ────
  let rafId = 0;
  function loop(): void {
    rafId = requestAnimationFrame(loop);
    const state = opts.getSharedState(); // fresh snapshot every frame
    const battery = state.battery;

    // battery fill bar (scaleY from bottom; master §3.4)
    const fillScale = Math.max(0, Math.min(1, battery));
    battFillEl.style.transform = `scaleY(${fillScale})`;
    battFillEl.classList.toggle('low', battery <= 0.10);

    // 秒数 primary + % auxiliary(方案 B:剩余秒 = battery / baseDrain = battery × totalGameTimeS / startPercent)
    const totalSecRaw = battery * CONFIG.battery.totalGameTimeS / CONFIG.battery.startPercent;
    battTimeEl.textContent = `${Math.max(0, Math.round(totalSecRaw))}s`;
    battPctEl.textContent = `${Math.round(battery * 100)}%`;

    // thresholds: ≤10% banner show; ≤3% +blink; ≤0 blackout.
    const low = battery <= 0.10;
    bannerEl.classList.toggle('show', low);
    bannerEl.classList.toggle('blink', low && battery <= 0.03);
    // TODO ⚠ ≤3% blink: heartbeat SFX is wired by PR #10 (David) once the audio
    //      platform module lands; this UI layer only flashes.
    blackoutEl.classList.toggle('show', battery <= 0);

    // QUERY legend counts (computed each frame from current state.outlets)
    const emptyN = state.outlets.filter((o) => !o.occupied).length;
    const occN = state.outlets.length - emptyN;
    qEmptyEl.textContent = String(emptyN);
    qOccEl.textContent = String(occN);

    // PR #12 §2.6.5 胜负弹窗 toggle(hidden)-没电(state.won=false && battery<=0)→显 game over,
    // 胜利(state.won=true)→显 win。state.won / battery 都由 getSharedState()[commit 5]
    // 提供(main.ts wrap 加 won: gameWon)。
    gameOverEl.classList.toggle('hidden', !(!state.won && state.battery <= 0));
    gameWinEl.classList.toggle('hidden', !state.won);

    // app-specific paint
    if (activeApp === 'map') {
      mapMinimap.update(state);
    } else if (activeApp === 'query') {
      queryMinimap.update(state);
    } else if (activeApp === 'radar') {
      drawRadar(radarCanvas, state);
    }
  }
  rafId = requestAnimationFrame(loop);

  // No public dispose hook exported — phoneHud lives for the page lifetime.
  // The internal RAF carries `rafId` so a future teardown (D11+ multi-scene
  // stretch, where main.ts may want to swap HUDs) can do
  //   cancelAnimationFrame(rafId); root.remove();
  // in one line without re-shaping this module. Kept as a forward affordance
  // rather than an unused-variable warning today.
  void rafId;
}