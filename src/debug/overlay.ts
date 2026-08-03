import GUI from 'lil-gui';
import type { DebugParams } from '../scene/loadLibraryScene';

// ─────────────────────────────────────────────────────────────────────────────
// Debug overlay(lil-gui + Box3Helper visibility toggle)
//
// 仅在 dev 下通过 dynamic import 加载(main.ts 里 `if (import.meta.env.DEV)`),
// prod bundle 不含 lil-gui。提供 rowSpacing / seatSideDist 滑块 → onChange 触发
// scene.rebuildTableZone(p),实时拆除并重建桌椅猫群和桌区 collider。打开
// showColliders 复选框(或按 F)—— 把所有 Box3 碰撞盒画成线框,直观看椅背是否
// 把过道封死。
//
// API 说明(lil-gui 习用):
//   gui.add(obj, 'propName', min, max, step).onChange(cb)
//     —— 通过字符串属性名绑定 obj.propName:拖 slider → 写入 obj.propName
//        + 同步 GUI 显示 + 触发 cb。属性名错 = silent fail,console 会有 hint。
//   gui.add(obj, 'propName')
//     —— 无 min/max:布尔 = 复选框;字符串 = 文本框;无 step = 自由输。
// ─────────────────────────────────────────────────────────────────────────────

export interface DebugOverlayOptions {
  rebuildTableZone: (params: DebugParams) => void;
  setColliderHelpersVisible: (visible: boolean) => void;
  defaultParams: DebugParams;
}

export function attachDebugGui(opts: DebugOverlayOptions): void {
  // params 是 GUI 直接绑定的对象:加一个 showColliders 字段(GUI 需要某个属性才行,
  // 用一个本地可变 container 较之 "传 ref 进 setColliderHelpersVisible" 更清晰)
  const params = {
    rowSpacing: opts.defaultParams.rowSpacing,
    seatSideDist: opts.defaultParams.seatSideDist,
    showColliders: false,
  };

  const gui = new GUI({ title: 'Debug' });
  const tables = gui.addFolder('Study tables');
  tables
    .add(params, 'rowSpacing', 1.8, 2.5, 0.02)
    .name('row spacing (z)')
    .onChange(() => opts.rebuildTableZone(params));
  tables
    .add(params, 'seatSideDist', 0.55, 1.15, 0.05)
    .name('seat side dist')
    .onChange(() => opts.rebuildTableZone(params));
  const collidersCtrl = gui
    .add(params, 'showColliders')
    .name('show colliders (F)')
    .onChange((v: boolean) => opts.setColliderHelpersVisible(v));

  // F 键快捷:复用同一 controller,setValue 间接触发 onChange
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code !== 'KeyF') return;
    if (e.target instanceof HTMLInputElement) return; // 不抢 GUI 输入框
    collidersCtrl.setValue(!params.showColliders);
  });
}