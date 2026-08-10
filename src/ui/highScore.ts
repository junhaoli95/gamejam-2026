import type { SharedState } from '../platform/sharedState';

// ============================================================================
// 最高分 HI 显示(PR #16 §2.2)— localStorage 持久化
// ----------------------------------------------------------------------------
// 纯 DOM 层:只读 getSharedState(),不发用户意图。
// 分数 = 胜利时剩余电量 × 100(剩得越多分越高)。右上角小字 "HI: N"。
// 每局记一次(wonLatch 防重复写),restart 后(state.won 回 false)重置 latch。
// ============================================================================

export interface HighScoreOptions {
  getSharedState: () => SharedState;
}

const STYLE_ID = 'high-score-styles';
const CSS = `
.high-score {
  position: fixed;
  top: 56px;
  right: 24px;
  color: rgba(255,255,255,0.6);
  font: bold 11px sans-serif;
  z-index: 20;
  pointer-events: none;
}
`;

const KEY = '1percent-battery-highscore';

function injectStylesOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function mountHighScore(opts: HighScoreOptions): void {
  injectStylesOnce();

  const scoreEl = document.createElement('div');
  scoreEl.className = 'high-score';
  scoreEl.textContent = 'HI: 0';
  document.body.appendChild(scoreEl);

  let wonLatch = false;

  function loop(): void {
    requestAnimationFrame(loop);
    const state = opts.getSharedState();
    if (state.won === true) {
      // 胜利且本局未记分 → 写入最高分(剩余电量 × 100)
      if (!wonLatch) {
        const score = Math.round(state.battery * 100);
        const prev = Number(localStorage.getItem(KEY) ?? 0);
        if (score > prev) localStorage.setItem(KEY, String(score));
        scoreEl.textContent = `HI: ${Math.max(prev, score)}`;
        wonLatch = true;
      }
    } else {
      // restart 后重置 latch,下局可再次记分
      wonLatch = false;
    }
  }
  requestAnimationFrame(loop);
}
