import type { SharedState } from '../platform/sharedState';

// ============================================================================
// 充电成功 toast(PR #16 §2.1)— GTA Vice City "Mission Passed" 同款样式
// ----------------------------------------------------------------------------
// 纯 DOM 层:只读 getSharedState() 的 won 字段,不发用户意图。
// 屏幕中间上方绿色 "Charge success +REP" 文字弹出,胜利后持续显示 "[R] Play Again" 提示。
// 按 R 键 → onRestart() 原地重开当前关卡。
// 触发:每帧 RAF 跟踪 state.won 从 false → true 的边沿(防同帧重复触发)。
// 彩蛋:localStorage `1percent-completions` 累计完成次数,≥5 次显示 5x badge + 感谢横幅。
// ============================================================================

export interface MissionToastOptions {
  getSharedState: () => SharedState;
  onRestart: () => void;
}

const COMPLETIONS_KEY = '1percent-completions';
const EASTER_EGG_THRESHOLD = 5;

const STYLE_ID = 'mission-toast-styles';
const CSS = `
.mission-toast {
  position: fixed;
  top: 18%;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  z-index: 25;
  color: #4eff7a;
  font: bold 42px sans-serif;
  letter-spacing: 0.12em;
  text-shadow: 0 0 16px rgba(78,255,122,0.7), 0 2px 4px rgba(0,0,0,0.8);
  opacity: 0;
  transition: opacity 200ms, transform 200ms;
  pointer-events: none;
  white-space: nowrap;
  text-align: center;
}
.mission-toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.mission-toast-badge {
  display: inline-block;
  margin-left: 10px;
  padding: 2px 12px;
  border: 2px solid #4eff7a;
  border-radius: 10px;
  font: bold 28px sans-serif;
  vertical-align: middle;
}
.mission-toast-restart {
  display: block;
  margin-top: 12px;
  font: bold 22px sans-serif;
  letter-spacing: 0.08em;
  opacity: 0;
  transition: opacity 300ms 600ms;
}
.mission-toast.show .mission-toast-restart {
  opacity: 1;
}
.mission-toast-restart .key {
  display: inline-block;
  padding: 2px 10px;
  margin: 0 4px;
  border: 2px solid #4eff7a;
  border-radius: 6px;
  font: bold 20px sans-serif;
}
.mission-toast-banner {
  position: fixed;
  bottom: 14%;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  z-index: 25;
  color: #4eff7a;
  font: bold 24px sans-serif;
  letter-spacing: 0.06em;
  text-shadow: 0 0 12px rgba(78,255,122,0.6), 0 2px 4px rgba(0,0,0,0.8);
  opacity: 0;
  transition: opacity 400ms 800ms, transform 400ms 800ms;
  pointer-events: none;
  white-space: nowrap;
  text-align: center;
}
.mission-toast-banner.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
`;

function injectStylesOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

function readCompletions(): number {
  try {
    const v = localStorage.getItem(COMPLETIONS_KEY);
    return v ? Math.max(0, parseInt(v, 10) || 0) : 0;
  } catch {
    return 0;
  }
}

function writeCompletions(n: number): void {
  try { localStorage.setItem(COMPLETIONS_KEY, String(n)); } catch { /* ignore */ }
}

export function mountMissionToast(opts: MissionToastOptions): void {
  injectStylesOnce();

  const toastEl = document.createElement('div');
  toastEl.className = 'mission-toast success';
  toastEl.innerHTML = '<span class="mission-toast-text">Charge Success +REP</span><span class="mission-toast-restart">Press <span class="key">R</span> to Play Again</span>';
  document.body.appendChild(toastEl);

  const badgeEl = document.createElement('span');
  badgeEl.className = 'mission-toast-badge';
  badgeEl.textContent = '';
  badgeEl.style.display = 'none';
  toastEl.querySelector('.mission-toast-text')!.appendChild(badgeEl);

  const bannerEl = document.createElement('div');
  bannerEl.className = 'mission-toast-banner';
  bannerEl.textContent = `Wow! ${EASTER_EGG_THRESHOLD} charges! Thank you for playing 1% Battery!`;
  document.body.appendChild(bannerEl);

  let lastWon = false;

  function showToast(completions: number): void {
    toastEl.classList.add('show');
    if (completions === EASTER_EGG_THRESHOLD) {
      badgeEl.textContent = `${completions}x`;
      badgeEl.style.display = 'inline-block';
      bannerEl.classList.add('show');
    } else {
      badgeEl.textContent = '';
      badgeEl.style.display = 'none';
      bannerEl.classList.remove('show');
    }
  }

  function hideToast(): void {
    toastEl.classList.remove('show');
    bannerEl.classList.remove('show');
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'r' || e.key === 'R') {
      const state = opts.getSharedState();
      if (state.won === true) {
        opts.onRestart();
      }
    }
  }

  window.addEventListener('keydown', onKeydown);

  function loop(): void {
    requestAnimationFrame(loop);
    const state = opts.getSharedState();
    if (state.won === true && !lastWon) {
      const completions = readCompletions() + 1;
      writeCompletions(completions);
      showToast(completions);
    }
    if (state.won === false && lastWon) hideToast();
    lastWon = state.won === true;
  }
  requestAnimationFrame(loop);
}
