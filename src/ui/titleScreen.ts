// 标题屏 + 选关(两阶段 CSS overlay,纯 DOM。
// Stage 1 标题 CHARGE → Start Game → Stage 2 选关(2 个卡片:图书馆 + 机场)。
//
// 流程:
// - 首次/刷新(无 session 标记)→ 总是显示标题(Stage 2 高亮已选关卡,默认图书馆)
// - 点图书馆 → localStorage.titleLevelIndex = 1 + sessionStorage 标记 → location.reload()
// - reload 后检测 session 标记(读后即删)→ 跳过标题,直接走"点击开始" overlay
// - 点已选中的关卡 → 无需 reload → 直接 onStart 开始
// - Menu/再来一局:回标题 = 清 localStorage + reload

import libraryThumb from '../../assets/微信图片_20260817211725_131_2.png';

const LS_KEY = 'titleLevelIndex';
const SS_KEY = 'titleJustSelected';  // sessionStorage 一次性标记:刚选完关的 reload 跳过标题

interface TitleScreenOptions {
  /** 开始游戏(布局已加载时直接进)— 由 main.ts 提供,显示"点击开始" overlay(音频手势入口)。 */
  onStart: () => void;
}

/** 是否跳过标题直接进游戏:仅当刚选过关(sessionStorage 一次性标记)。读后即删。 */
export function shouldSkipTitleOnReload(): boolean {
  try {
    if (sessionStorage.getItem(SS_KEY)) {
      sessionStorage.removeItem(SS_KEY);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** 当前已选关卡 index(1=图书馆;无/非法 → 默认 1)。 */
function currentSelected(): number {
  try {
    const v = Number(localStorage.getItem(LS_KEY));
    if (Number.isInteger(v) && v >= 1) return v;
  } catch { /* ignore */ }
  return 1;
}

interface LevelDef { index: number; name: string; sub: string; thumb?: string; locked?: boolean; }

const LEVELS: LevelDef[] = [
  { index: 1, name: 'Library',  sub: 'Survive the blackout', thumb: libraryThumb },
  { index: 2, name: 'Airport',  sub: 'Coming soon',          locked: true },
];

const CSS = `
.title-root{position:fixed;inset:0;z-index:50;background:rgba(15,12,9,0.96);
  color:#ffe9c4;font:16px/1.6 system-ui,-apple-system,sans-serif;letter-spacing:0.04em;
  display:flex;flex-direction:column;align-items:center;justify-content:center;}
.title-root button{font:inherit;color:inherit;background:transparent;border:1px solid rgba(255,233,196,0.35);
  padding:10px 18px;cursor:pointer;border-radius:3px;transition:background 0.15s,border-color 0.15s,transform 0.15s;}
.title-root button:hover{background:rgba(255,233,196,0.08);border-color:#ffe9c4;}

/* Stage 1 */
.title-stage1{display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;}
.title-headline{font-size:8vw;font-weight:800;letter-spacing:0.18em;color:#ffe9c4;line-height:1;}
.title-tagline{font-size:max(16px,2vw);color:rgba(255,233,196,0.72);}
.title-hint{font-size:max(12px,1.4vw);color:rgba(255,233,196,0.5);margin-top:8px;}
.title-start{margin-top:18px;padding:14px 44px;font-size:18px;font-weight:600;}

/* Stage 2 — card grid */
.title-stage2{display:none;flex-direction:column;align-items:center;gap:20px;}
.title-stage2.visible{display:flex;}
.title-select-heading{font-size:max(22px,3vw);font-weight:600;letter-spacing:0.1em;margin-bottom:6px;}
.title-level-grid{display:flex;gap:24px;flex-wrap:wrap;justify-content:center;max-width:90vw;}
.title-level-card{
  position:relative;width:280px;height:200px;border-radius:12px;overflow:hidden;cursor:pointer;
  border:2px solid rgba(255,233,196,0.25);background:#1a1a1c;
  transition:border-color 0.2s,transform 0.2s,box-shadow 0.2s;padding:0;text-align:left;
}
.title-level-card:hover{border-color:#ffe9c4;transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,0,0,0.6);}
.title-level-card.selected{border-color:#2dff7a;box-shadow:0 0 16px rgba(45,255,122,0.3);}
.title-level-card.locked{cursor:not-allowed;opacity:0.55;}
.title-level-card.locked:hover{transform:none;border-color:rgba(255,233,196,0.25);box-shadow:none;}
.title-card-img{width:100%;height:140px;object-fit:cover;display:block;}
.title-card-body{padding:12px 16px;}
.title-card-name{font-weight:700;font-size:18px;color:#ffe9c4;}
.title-card-sub{font-size:13px;color:rgba(255,233,196,0.55);margin-top:2px;}
.title-card-lock{position:absolute;top:10px;right:12px;font-size:22px;opacity:0.9;}
.title-back{margin-top:8px;font-size:14px;padding:8px 22px;opacity:0.8;}
`;

export function mountTitleScreen(opts: TitleScreenOptions): void {
  const root = document.createElement('div');
  root.className = 'title-root';

  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  // Stage 1
  const stage1 = document.createElement('div');
  stage1.className = 'title-stage1';
  stage1.innerHTML = `
    <div class="title-headline">CHARGE</div>
    <div class="title-tagline">Survive the blackout. Find a charge.</div>
    <div class="title-hint">WASD move (A/D turn) · Shift dash · 1/2/3 apps · E plug in</div>
  `;
  const startBtn = document.createElement('button');
  startBtn.className = 'title-start';
  startBtn.textContent = 'Start Game';
  stage1.appendChild(startBtn);
  root.appendChild(stage1);

  // Stage 2
  const stage2 = document.createElement('div');
  stage2.className = 'title-stage2';
  const heading = document.createElement('div');
  heading.className = 'title-select-heading';
  heading.textContent = 'Select Level';
  stage2.appendChild(heading);

  const selected = currentSelected();  // 高亮已选关卡(刷新回标题时记住)
  const grid = document.createElement('div');
  grid.className = 'title-level-grid';
  for (const lv of LEVELS) {
    const card = document.createElement('button');
    card.className = 'title-level-card';
    if (lv.index === selected) card.classList.add('selected');
    if (lv.locked) card.classList.add('locked');

    if (lv.thumb) {
      const img = document.createElement('img');
      img.className = 'title-card-img';
      img.src = lv.thumb;
      img.alt = lv.name;
      card.appendChild(img);
    } else {
      // 待开发关卡:占位渐变
      const placeholder = document.createElement('div');
      placeholder.className = 'title-card-img';
      placeholder.style.background = 'linear-gradient(135deg, #2a2a2e 0%, #1a1a1c 100%)';
      placeholder.style.display = 'flex';
      placeholder.style.alignItems = 'center';
      placeholder.style.justifyContent = 'center';
      placeholder.textContent = '🚧';
      placeholder.style.fontSize = '40px';
      placeholder.style.opacity = '0.5';
      card.appendChild(placeholder);
    }

    if (lv.locked) {
      const lock = document.createElement('div');
      lock.className = 'title-card-lock';
      lock.textContent = '🔒';
      card.appendChild(lock);
    }

    const body = document.createElement('div');
    body.className = 'title-card-body';
    const nameEl = document.createElement('div');
    nameEl.className = 'title-card-name';
    nameEl.textContent = lv.name;
    const subEl = document.createElement('div');
    subEl.className = 'title-card-sub';
    subEl.textContent = lv.sub;
    body.appendChild(nameEl);
    body.appendChild(subEl);
    card.appendChild(body);

    card.addEventListener('click', () => {
      if (lv.locked) return;  // 待开发关卡不可选
      if (lv.index === selected) {
        // 点已选中的关卡:布局已加载,无需 reload → 直接开始
        root.style.display = 'none';
        opts.onStart();
        return;
      }
      try { localStorage.setItem(LS_KEY, String(lv.index)); } catch { /* ignore */ }
      try { sessionStorage.setItem(SS_KEY, '1'); } catch { /* ignore */ }
      location.reload();
    });
    grid.appendChild(card);
  }
  stage2.appendChild(grid);

  const back = document.createElement('button');
  back.className = 'title-back';
  back.textContent = '← Back';
  back.addEventListener('click', () => {
    stage2.classList.remove('visible');
  });
  stage2.appendChild(back);
  root.appendChild(stage2);

  startBtn.addEventListener('click', () => {
    stage2.classList.add('visible');
  });

  document.body.appendChild(root);
}
