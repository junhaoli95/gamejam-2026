// PR #28:标题屏 + 选关(两阶段 CSS overlay,纯 DOM,不跑 3D。
// Stage 1 标题 CHARGE → Start Game → Stage 2 选关(6 按钮含 Random)。
//
// 流程:
// - 首次/刷新(无 session 标记)→ 总是显示标题(Stage 2 高亮已选关卡,默认 Islands)
// - 点任一关 → localStorage.titleLevelIndex = N + sessionStorage 标记 → location.reload()
// - reload 后检测 session 标记(读后即删)→ 跳过标题,直接走"点击开始" overlay
// - 点"已选中的关卡"→ 无需 reload(布局已加载)→ 直接 onStart 开始
// - Menu/再来一局:回标题 = 清 localStorage + reload(无 session 标记 → 标题出现)

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

/** 当前已选关卡 index(1-5;无/非法 → 默认 4=Islands)。 */
function currentSelected(): number {
  try {
    const v = Number(localStorage.getItem(LS_KEY));
    if (Number.isInteger(v) && v >= 1 && v <= 5) return v;
  } catch { /* ignore */ }
  return 4;
}

interface LevelDef { index: number; name: string; sub: string; }

// index 0 = Random(特殊 — click 时在 1-5 里随机);1-5 对应布局快照/mapped in loadLibraryScene.ts
const LEVELS: LevelDef[] = [
  { index: 0, name: 'Random',       sub: '5 pick 1 at random' },
  { index: 1, name: 'Open Lobby',    sub: '7 tables' },
  { index: 2, name: 'Compact Study', sub: '19 tables' },
  { index: 3, name: 'Maze',          sub: '7 tables' },
  { index: 4, name: 'Islands',       sub: '17 tables  ·  default' },
  { index: 5, name: 'Arena',         sub: '9 tables' },
];

const CSS = `
.title-root{position:fixed;inset:0;z-index:50;background:rgba(15,12,9,0.96);
  color:#ffe9c4;font:16px/1.6 system-ui,-apple-system,sans-serif;letter-spacing:0.04em;
  display:flex;flex-direction:column;align-items:center;justify-content:center;}
.title-root button{font:inherit;color:inherit;background:transparent;border:1px solid rgba(255,233,196,0.35);
  padding:10px 18px;cursor:pointer;border-radius:3px;transition:background 0.15s,border-color 0.15s;}
.title-root button:hover{background:rgba(255,233,196,0.08);border-color:#ffe9c4;}

/* Stage 1 */
.title-stage1{display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;}
.title-headline{font-size:8vw;font-weight:800;letter-spacing:0.18em;color:#ffe9c4;line-height:1;}
.title-tagline{font-size:max(16px,2vw);color:rgba(255,233,196,0.72);}
.title-hint{font-size:max(12px,1.4vw);color:rgba(255,233,196,0.5);margin-top:8px;}
.title-start{margin-top:18px;padding:14px 44px;font-size:18px;font-weight:600;}

/* Stage 2 */
.title-stage2{display:none;flex-direction:column;align-items:center;gap:10px;}
.title-stage2.visible{display:flex;}
.title-select-heading{font-size:max(22px,3vw);font-weight:600;letter-spacing:0.1em;margin-bottom:14px;}
.title-level-row{display:grid;grid-template-columns:auto auto;gap:8px 16px;align-items:center;width:min(420px,80vw);}
.title-level-btn{display:flex;justify-content:space-between;align-items:baseline;gap:14px;
  padding:11px 18px;width:100%;grid-column:1/3;text-align:left;}
.title-level-btn .lvl-name{font-weight:600;font-size:16px;}
.title-level-btn .lvl-sub{font-size:13px;color:rgba(255,233,196,0.55);}
.title-level-btn.selected{border-color:#ffe9c4;background:rgba(255,233,196,0.05);}
.title-back{margin-top:18px;font-size:14px;padding:8px 22px;opacity:0.8;}
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
  const rowWrap = document.createElement('div');
  rowWrap.className = 'title-level-row';
  for (const lv of LEVELS) {
    const b = document.createElement('button');
    b.className = 'title-level-btn';
    if (lv.index !== 0 && lv.index === selected) b.classList.add('selected');
    const nameEl = document.createElement('span');
    nameEl.className = 'lvl-name';
    nameEl.textContent = lv.name;
    const subEl = document.createElement('span');
    subEl.className = 'lvl-sub';
    subEl.textContent = lv.sub;
    b.appendChild(nameEl);
    b.appendChild(subEl);
    b.addEventListener('click', () => {
      const idx = lv.index === 0
        ? 1 + Math.floor(Math.random() * 5)  // Random:5 pick 1
        : lv.index;
      if (lv.index !== 0 && idx === selected) {
        // 点已选中的关卡:布局已加载,无需 reload → 直接开始
        root.style.display = 'none';
        opts.onStart();
        return;
      }
      try { localStorage.setItem(LS_KEY, String(idx)); } catch { /* ignore */ }
      try { sessionStorage.setItem(SS_KEY, '1'); } catch { /* ignore */ }
      location.reload();
    });
    rowWrap.appendChild(b);
  }
  stage2.appendChild(rowWrap);

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
