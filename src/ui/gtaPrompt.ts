import type { SharedState } from '../platform/sharedState';

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

/* PR #14 右上角 stamina bar(GTA Vice City 同款) */
.stamina-bar {
  position: fixed;
  top: 24px;
  right: 24px;
  width: 120px;
  height: 8px;
  background: rgba(0,0,0,0.65);
  border-radius: 4px;
  overflow: hidden;
  z-index: 20;
  pointer-events: none;
}
.stamina-bar-fill {
  height: 100%;
  width: 100%;
  background: #4ec3ff;
  transition: width 80ms linear;
}
.stamina-bar.low .stamina-bar-fill { background: #ff4d4d; }
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

  // PR #14 右上角 stamina bar(fill 宽度 = state.pips × 100%)
  const staminaEl = document.createElement('div');
  staminaEl.className = 'stamina-bar';
  staminaEl.innerHTML = '<div class="stamina-bar-fill"></div>';
  document.body.appendChild(staminaEl);
  const staminaFillEl = staminaEl.querySelector<HTMLElement>('.stamina-bar-fill')!;

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
    // stamina bar:fill width = pips × 100%;<0.2 变红(替代 phone HUD 内 pip bar)
    const pips = Math.max(0, Math.min(1, state.pips));
    staminaFillEl.style.width = `${pips * 100}%`;
    staminaEl.classList.toggle('low', pips < 0.2);
  }
  requestAnimationFrame(loop);
}
