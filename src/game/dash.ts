// ─────────────────────────────────────────────────────────────────────────────
// Dash pip 能量系统(master spec §4.2)
//
// 状态机: idle → (requestDash: phase==idle & pips≥1 & 方向非零) → dashing(0.4s ×3速)
//         → cooldown(0.5s) → idle
// pip 单局不补(resetDash 仅在新局调);shift 边沿触发(requestDash 而非 level-trigger)。
// 方向门控(§4.2 防误操作):fwd 与 strafe 全零时不触发,保护 pip 不被无故消耗。
//
// 本模块不含 Three/DOM 依赖(rule 1),不读 config.ts;DashConfig 由 playerStats.ts 传入。
// ─────────────────────────────────────────────────────────────────────────────

export type DashPhase = 'idle' | 'dashing' | 'cooldown';

export interface DashConfig {
  startPips: number;       // 3
  dashDurationS: number;   // 0.4
  dashMult: number;         // 3
  cooldownS: number;        // 0.5
}

export interface DashState {
  pips: number;            // 0~3
  phase: DashPhase;
  phaseTimer: number;      // 当前 phase 剩余秒
}

export interface DirectionInput {
  fwd: number;     // W=+1, S=-1, 0 = 未按
  strafe: number;  // D=+1, A=-1, 0 = 未按
}

/** 当前速度倍率,供 controller 读; dashing 时 = cfg.dashMult, 其余 1 */
export function getDashSpeedMult(state: DashState, cfg: DashConfig): number {
  return state.phase === 'dashing' ? cfg.dashMult : 1;
}

export function createDash(cfg: DashConfig): DashState {
  return { pips: cfg.startPips, phase: 'idle', phaseTimer: 0 };
}

/** 请求 dash; 返回是否真触发(消费 1 pip, 进入 dashing)。三道门: phase / pip / 方向非零 */
export function requestDash(state: DashState, cfg: DashConfig, input: DirectionInput): boolean {
  if (state.phase !== 'idle') return false;
  if (state.pips < 1) return false;
  if (input.fwd === 0 && input.strafe === 0) return false;
  state.pips -= 1;
  state.phase = 'dashing';
  state.phaseTimer = cfg.dashDurationS;
  return true;
}

/** 每帧调用,推进 phaseTimer / 自动转 phase */
export function updateDash(state: DashState, cfg: DashConfig, dt: number): void {
  if (state.phase === 'idle') return;
  state.phaseTimer -= dt;
  if (state.phaseTimer > 0) return;
  if (state.phase === 'dashing') {
    state.phase = 'cooldown';
    state.phaseTimer = cfg.cooldownS;
  } else {
    state.phase = 'idle';
    state.phaseTimer = 0;
  }
}

export function resetDash(state: DashState, cfg: DashConfig): void {
  state.pips = cfg.startPips;
  state.phase = 'idle';
  state.phaseTimer = 0;
}