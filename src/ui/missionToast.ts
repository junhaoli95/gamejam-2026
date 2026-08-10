import type { SharedState } from '../platform/sharedState';

// ============================================================================
// 充电成功 toast(PR #16 §2.1)— GTA Vice City "Mission Passed" 同款样式
// ----------------------------------------------------------------------------
// 纯 DOM 层:只读 getSharedState() 的 won 字段,不发用户意图。
// 右下角绿色 "Charge success +REP" 文字弹出,显示 1.5s 后自动淡出。
// 触发:每帧 RAF 跟踪 state.won 从 false → true 的边沿(防同帧重复触发)。
// ============================================================================

export interface MissionToastOptions {
  getSharedState: () => SharedState;
}

const STYLE_ID = 'mission-toast-styles';
const CSS = `
.mission-toast {
  position: fixed;
  bottom: 120px;
  right: 24px;
  z-index: 25;
  color: #4eff7a;
  font: bold 20px sans-serif;
  letter-spacing: 0.08em;
  text-shadow: 0 0 12px rgba(78,255,122,0.6);
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 200ms, transform 200ms;
  pointer-events: none;
}
.mission-toast.show {
  opacity: 1;
  transform: translateY(0);
}
`;

const SHOW_DURATION_MS = 1500;

function injectStylesOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function mountMissionToast(opts: MissionToastOptions): void {
  injectStylesOnce();

  const toastEl = document.createElement('div');
  toastEl.className = 'mission-toast success';
  toastEl.innerHTML = '<span class="mission-toast-text">Charge success +REP</span>';
  document.body.appendChild(toastEl);

  let hideTimer = 0;
  let lastWon = false;

  function showToast(): void {
    toastEl.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => toastEl.classList.remove('show'), SHOW_DURATION_MS);
  }

  function loop(): void {
    requestAnimationFrame(loop);
    const state = opts.getSharedState();
    // won 边沿触发:false → true 才弹 toast,胜利持续期间不再重复
    if (state.won === true && !lastWon) showToast();
    lastWon = state.won === true;
  }
  requestAnimationFrame(loop);
}
