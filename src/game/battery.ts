// ─────────────────────────────────────────────────────────────────────────────
// 电池资源系统(master spec §4.1)
//
// 本底持续掉电:开局 1.0(对应 180 秒),按 baseDrain × max(1, Σ appMult) per sec 衰减。
// app 倍率:RADAR ×3 / MAP ×2 / QUERY ×4,多开求和(不足 1 取 1,即 Home 全关=×1)。
// 0% 触发 terminal(单次,逻辑层置 isTerminal=true,UI 黑屏由消费方读 SharedState)。
//
// 本模块不含 Three/DOM 依赖(rule 1),不读 config.ts;
// 配置以 BatteryConfig 接口传入,由 playerStats.ts 从 CONFIG.battery 适配构造。
// ─────────────────────────────────────────────────────────────────────────────

export interface BatteryConfig {
  startPercent: number;
  baseDrain: number;         // fraction/sec, 本底 1× 倍率下的衰减
  totalGameTimeS: number;
  appMult: { RADAR: number; MAP: number; QUERY: number };
}

export interface AppOpenState {
  RADAR: boolean;
  MAP: boolean;
  QUERY: boolean;
}

export interface BatteryState {
  percent: number;       // 0~1
  isTerminal: boolean;   // percent ≤ 0 时单次置 true
}

/** Σ 待开 app 倍率,RADAR+MAP 且都开 => 3+2 = 5 */
export function sumAppMult(cfg: BatteryConfig, appOpen: AppOpenState): number {
  let sum = 0;
  if (appOpen.RADAR) sum += cfg.appMult.RADAR;
  if (appOpen.MAP) sum += cfg.appMult.MAP;
  if (appOpen.QUERY) sum += cfg.appMult.QUERY;
  return sum;
}

/** 综合衰减系数,Home(全关)=1,单 RADAR=3,RADAR+MAP=5 */
export function drainFactor(cfg: BatteryConfig, appOpen: AppOpenState): number {
  return Math.max(1, sumAppMult(cfg, appOpen));
}

export function createBattery(cfg: BatteryConfig): BatteryState {
  return { percent: cfg.startPercent, isTerminal: false };
}

export function updateBattery(
  state: BatteryState,
  cfg: BatteryConfig,
  appOpen: AppOpenState,
  dt: number,
): void {
  if (state.isTerminal) return;
  const factor = drainFactor(cfg, appOpen);
  const drain = cfg.baseDrain * factor * dt;
  state.percent -= drain;
  if (state.percent <= 0) {
    state.percent = 0;
    state.isTerminal = true;
  }
}

export function resetBattery(state: BatteryState, cfg: BatteryConfig): void {
  state.percent = cfg.startPercent;
  state.isTerminal = false;
}