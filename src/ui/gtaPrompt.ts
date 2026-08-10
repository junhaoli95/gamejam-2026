import type { SharedState } from '../platform/sharedState';

// ============================================================================
// GTA 提示系统(PR #13 §3.3)— 左上 contextual prompt + 中下常驻任务条
// + PR #14 右上角 stamina bar(GTA Vice City 同款)
// ----------------------------------------------------------------------------
// 纯 DOM 层:只读 getSharedState(),不发用户意图,无 state machine。
// - .gta-prompt:玩家近空桩(state.nearOutlet === true)时左上淡入 "⚡ 按 [E] 充电",
//   走开淡出。display 由 JS 管理(先显形再切 opacity,保证 transition 生效)。
// - .gta-objective:中下常驻任务条;胜利/失败弹窗出现时隐藏。
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
}
.gta-prompt.show {
  display: inline-block;
  opacity: 1;
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
.gta-objective {
  position: fixed;
  top: 56px; /* 在 .gta-prompt(top:24px)下方垂直堆叠 */
  left: 24px;
  z-index: 20;
  background: rgba(0,0,0,0.55);
  border-radius: 4px;
  padding: 6px 14px;
  color: rgba(255,255,255,0.85);
  font: 12px sans-serif;
  letter-spacing: 0.06em;
  pointer-events: none;
  white-space: nowrap;
}
.gta-objective.hidden { display: none; }

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

  const promptEl = document.createElement('div');
  promptEl.className = 'gta-prompt';
  promptEl.innerHTML =
    `<span class="gta-prompt-icon">⚡</span>` +
    `<span class="gta-prompt-text">按 [E] 充电</span>`;
  document.body.appendChild(promptEl);

  const objectiveEl = document.createElement('div');
  objectiveEl.className = 'gta-objective';
  objectiveEl.textContent = opts.objectiveText;
  document.body.appendChild(objectiveEl);

  // PR #14 右上角 stamina bar(fill 宽度 = state.pips × 100%)
  const staminaEl = document.createElement('div');
  staminaEl.className = 'stamina-bar';
  staminaEl.innerHTML = '<div class="stamina-bar-fill"></div>';
  document.body.appendChild(staminaEl);
  const staminaFillEl = staminaEl.querySelector<HTMLElement>('.stamina-bar-fill')!;

  let promptShown = false;
  let hideTimer = 0;

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

  function loop(): void {
    requestAnimationFrame(loop);
    const state = opts.getSharedState();
    setPromptVisible(state.nearOutlet === true);
    objectiveEl.classList.toggle('hidden', state.won === true || state.battery <= 0);
    // stamina bar:fill width = pips × 100%;<0.2 变红(替代 phone HUD 内 pip bar)
    const pips = Math.max(0, Math.min(1, state.pips));
    staminaFillEl.style.width = `${pips * 100}%`;
    staminaEl.classList.toggle('low', pips < 0.2);
  }
  requestAnimationFrame(loop);
}
