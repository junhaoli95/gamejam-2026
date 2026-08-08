// ─────────────────────────────────────────────────────────────────────────────
// Dash 连续能量条系统(PR #12 spec §2.2)
//
// 状态机: Shift 按住 + 有方向 + energy>0 → 持续消耗,松开 / 无方向 / 无能量 停。
// 连续 0~1 energy,无 cooldown / 无 phase 状态机;按时间消耗(drainPerSec * dt)。
// regenPerSec = 0 → 单局不补(spec §4.2 忠于原 pip 单局不补语义)。
// 方向门控(fwd/strafe 全零时)不消耗,保护 energy 不被无故消耗。
//
// 平台约束:无 three/DOM/window 依赖,纯纯函数 + 可变 state 进出;DashConfig 由
// playerStats.ts 传入(从 CONFIG.dash)。
// ─────────────────────────────────────────────────────────────────────────────

export interface DashConfig {
  startEnergy: number;      // 1.0(满)
  drainPerSec: number;      // 0.4(PR #12 spec §2.3,约 2.5 秒纯冲刺用完)
  regenPerSec: number;      // 0 单局不补
  dashMult: number;          // 3
}

export interface DashState {
  energy: number;            // 0~1 连续
  isDashing: boolean;        // 当帧是否在冲刺(Shift 持续 + 有能量 + 有方向)
}

/** 每帧调。shiftDown = 用户按住 Shift。返回当前速度倍率(以配置看:冲刺 dashMult / 否则 1)。 */
export function updateDash(
  state: DashState,
  cfg: DashConfig,
  shiftDown: boolean,
  hasDirection: boolean,
  dt: number,
): number {
  if (shiftDown && hasDirection && state.energy > 0) {
    state.isDashing = true;
    state.energy = Math.max(0, state.energy - cfg.drainPerSec * dt);
    return cfg.dashMult;
  }
  state.isDashing = false;
  if (cfg.regenPerSec > 0) {
    state.energy = Math.min(cfg.startEnergy, state.energy + cfg.regenPerSec * dt);
  }
  return 1;
}

export function createDash(cfg: DashConfig): DashState {
  return { energy: cfg.startEnergy, isDashing: false };
}

export function resetDash(state: DashState, cfg: DashConfig): void {
  state.energy = cfg.startEnergy;
  state.isDashing = false;
}