import type { SharedState } from '../platform/sharedState';
import { CONFIG } from '../game/config';

// ============================================================================
// GTA 提示系统(PR #13 §3.3 + PR #15 迭代)— 左上单槽位提示 + 右上 stamina bar
// ----------------------------------------------------------------------------
// 纯 DOM 层:只读 getSharedState(),不发用户意图,无 state machine。
// - .gta-prompt:左上角单提示槽位(top:24px),内容按优先级替换:
//   近空桩 → "⚡ 按 [E] 充电";否则 → "📍 {objectiveText}";
//   胜利/失败弹窗时整个隐藏(淡出)。display 由 JS 管理保证 transition 生效。
// - .stamina-bar:右上角冲刺能量条(state.pips 0~1 连续值驱动宽度;<0.2 变红)。
// ============================================================================

export interface GtaPromptOptions {
  getSharedState: () => SharedState;
  /** 任务条文案(PR #13-David merge 前由 main.ts 硬编码,之后改 CONFIG.hud.objectiveText) */
  objectiveText: string;
  /** 当前活跃 app 的耗电倍率(home=1, map=2, radar=3, query=4),用于底部指南显示 */
  getActiveAppRate: () => number;
}

const STYLE_ID = 'gta-prompt-styles';
const CSS = `
.gta-prompt {
  position: fixed;
  top: 24px;
  left: 24px;
  z-index: 20;
  display: none;
  opacity: 0;
  transition: opacity 120ms ease-out;
  background: rgba(0,0,0,0.78);
  border-radius: 6px;
  padding: 10px 16px;
  pointer-events: none;
  white-space: nowrap;
}
.gta-prompt.show {
  display: inline-block;
  opacity: 1;
}
.gta-prompt.fading {
  opacity: 0.2;
  transition: opacity 80ms ease-out;
}
.gta-prompt-icon {
  color: #ffd24a;
  font-size: 18px;
  margin-right: 8px;
}
.gta-prompt-text {
  color: #fff;
  font: 14px sans-serif;
}

/* 底部中间 stamina bar + 游戏指南(GTA Vice City 绿色字体) */
.gta-bottom {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.gta-dash-hint {
  font: bold 12px "Courier New", monospace;
  color: #4ec3ff;
  text-shadow: 0 0 4px rgba(78,195,255,0.5);
  letter-spacing: 0.06em;
  opacity: 0.8;
}
.stamina-bar {
  width: 180px;
  height: 8px;
  background: rgba(0,0,0,0.65);
  border-radius: 4px;
  overflow: hidden;
}
.stamina-bar-fill {
  height: 100%;
  width: 100%;
  background: #4ec3ff;
  transition: width 80ms linear;
}
.stamina-bar.low .stamina-bar-fill { background: #ff4d4d; }
.gta-guide {
  font: bold 14px "Courier New", monospace;
  color: #2dff7a;
  text-shadow: 0 0 4px rgba(45,255,122,0.5);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
`;

function injectStylesOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function mountGtaPrompt(opts: GtaPromptOptions): void {
  injectStylesOnce();

  // 左上角单提示槽位:默认任务条文案,近桩时替换为充电提示(共用同一 DOM + CSS)
  const promptEl = document.createElement('div');
  promptEl.className = 'gta-prompt';
  promptEl.innerHTML =
    `<span class="gta-prompt-icon">📍</span>` +
    `<span class="gta-prompt-text">${opts.objectiveText}</span>`;
  document.body.appendChild(promptEl);
  const promptIconEl = promptEl.querySelector<HTMLElement>('.gta-prompt-icon')!;
  const promptTextEl = promptEl.querySelector<HTMLElement>('.gta-prompt-text')!;

  // 底部中间:stamina bar + 游戏指南(GTA 绿色字体)
  const bottomEl = document.createElement('div');
  bottomEl.className = 'gta-bottom';
  bottomEl.innerHTML =
    '<div class="gta-dash-hint">[Shift] dash</div>' +
    '<div class="stamina-bar"><div class="stamina-bar-fill"></div></div>' +
    '<div class="gta-guide"></div>';
  document.body.appendChild(bottomEl);
  const staminaFillEl = bottomEl.querySelector<HTMLElement>('.stamina-bar-fill')!;
  const guideEl = bottomEl.querySelector<HTMLElement>('.gta-guide')!;

  let promptShown = false;
  let hideTimer = 0;
  let currentMode: 'objective' | 'charge' | null = null;
  let fadeTimer = 0;

  function setPromptVisible(show: boolean): void {
    if (show === promptShown) return;
    promptShown = show;
    clearTimeout(hideTimer);
    if (show) {
      // display:none → 先显形 + 强制 reflow,再切 .show 让 opacity 过渡生效(淡入)
      promptEl.style.display = 'inline-block';
      void promptEl.offsetWidth;
      promptEl.classList.add('show');
    } else {
      promptEl.classList.remove('show');
      // 淡出 120ms 后再 display:none(display 立刻置 none 会杀死过渡)
      hideTimer = window.setTimeout(() => {
        if (!promptShown) promptEl.style.display = 'none';
      }, 120);
    }
  }

  /** GTA VC 风格内容切换:淡出 80ms → 换文字 → 淡入 120ms(有过渡感但不拖沓) */
  function switchPromptMode(mode: 'objective' | 'charge'): void {
    if (mode === currentMode) return;
    currentMode = mode;
    clearTimeout(fadeTimer);
    // 淡出
    promptEl.classList.add('fading');
    fadeTimer = window.setTimeout(() => {
      // 换内容
      promptIconEl.textContent = mode === 'charge' ? '⚡' : '📍';
      promptTextEl.textContent = mode === 'charge' ? 'Press [E] to charge' : opts.objectiveText;
      // 淡入
      promptEl.classList.remove('fading');
    }, 80);
  }

  function loop(): void {
    requestAnimationFrame(loop);
    const state = opts.getSharedState();
    // 左上槽位:胜利/失败时整个隐藏,否则按优先级切换内容(近桩 → 充电提示,否则任务条)
    const gameEnd = state.won === true || state.battery <= 0;
    setPromptVisible(!gameEnd);
    if (!gameEnd) {
      switchPromptMode(state.nearOutlet === true ? 'charge' : 'objective');
    } else {
      currentMode = null; // game end 后重置,下局开始时重新触发过渡
    }
    // stamina bar:fill width = pips × 100%;<0.2 变红
    const pips = Math.max(0, Math.min(1, state.pips));
    staminaFillEl.style.width = `${pips * 100}%`;
    const staminaBar = bottomEl.querySelector<HTMLElement>('.stamina-bar')!;
    staminaBar.classList.toggle('low', pips < 0.2);
    // GTA 绿色指南:数字键切换 app + 当前费率 + 剩余时间
    const rate = opts.getActiveAppRate();
    const totalSecRaw = state.battery * CONFIG.battery.totalGameTimeS / CONFIG.battery.startPercent;
    const sec = Math.max(0, Math.round(totalSecRaw));
    guideEl.textContent = `[1/2/3] switch apps  ·  ×${rate} drain  ·  ${sec}s left`;
  }
  requestAnimationFrame(loop);
}
