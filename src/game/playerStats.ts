// ─────────────────────────────────────────────────────────────────────────────
// PlayerStats:电池 + dash 资源系统装配(master spec §4 + §7.3)
//
// 本模块把 `game/battery.ts` 与 `game/dash.ts` 实例化,以 `runtime` 槽对象暴露续航 / 能量给
// `main.ts` 的 SharedState wrapper(不改 sharedState.ts 文件本身)。
//
// PR #12 改造:dash 从 3 颗离散 pip + 状态机 → 0~1 连续能量条。step 签名变
// `(dt, input)`:Shift 持续按住即持续消耗(不再边沿触发)。
//
// 步进语义(part of §7.3 主循环单向数据流):
//   1. updateDash — 按 input.shift + 方向门控消耗 energy,得 mult;存 currentDashMult
//   2. updateBattery — 按 appOpen 算 drainFactor,扣 percent,触 terminal 单次
//   3. 写回 runtime.battery / runtime.pips(供 SharedState wrap 读出)
//
// 平台约束:无 three/DOM/window 依赖(rule 1),测试处纯 TS。
// ─────────────────────────────────────────────────────────────────────────────

import { CONFIG } from './config';
import {
  createBattery,
  updateBattery,
  resetBattery,
  type BatteryConfig,
  type AppOpenState,
} from './battery';
import {
  createDash,
  updateDash,
  resetDash,
  type DashConfig,
  type DashState,
} from './dash';

export interface RuntimeStats {
  battery: number;     // 0~1, 镜像 BatteryState.percent
  pips: number;        // 0~1 energy(PR #12 语义从 0~3 离散 pip 改为 0~1 连续能量)
  appOpen: AppOpenState; // 当前开哪几个 app(本 PR 默认全关,Sam 接通后由 main.ts 维护)
}

/** 玩家输入 PR #12:持续按住的 Shift 状态(非边沿)。 */
export interface PlayerInput {
  fwd: number;     // W=+1, S=-1, 0 = 未按
  strafe: number;  // D=+1, A=-1, 0 = 未按
  shift: boolean;  // 持续按住状态
}

export interface PlayerStatsOptions {
  runtime: RuntimeStats;
}

export interface PlayerStatsHandle {
  /** 每帧调:推进 dash(按 input 持续消耗能量) + battery 状态机 + 写 runtime 镜像。 */
  step: (dt: number, input: PlayerInput) => void;
  /** 当前速度倍率:冲刺=CONFIG.dash.dashMult, 否则 1。供 controller.update 读 */
  getDashSpeedMult: () => number;
  /** 局末重启(battery/dash 全满) */
  reset: () => void;
}

function batteryCfgFromConfig(): BatteryConfig {
  const b = CONFIG.battery;
  return {
    startPercent: b.startPercent,
    baseDrain: b.baseDrain,
    totalGameTimeS: b.totalGameTimeS,
    appMult: { ...b.appMult },
  };
}

function dashCfgFromConfig(): DashConfig {
  const d = CONFIG.dash;
  return {
    startEnergy: d.startEnergy,
    drainPerSec: d.drainPerSec,
    regenPerSec: d.regenPerSec,
    dashMult: d.dashMult,
  };
}

export function mountPlayerStats(opts: PlayerStatsOptions): PlayerStatsHandle {
  const batteryCfg = batteryCfgFromConfig();
  const dashCfg = dashCfgFromConfig();
  const battery = createBattery(batteryCfg);
  const dash: DashState = createDash(dashCfg);
  let terminalWarned = false;
  let currentDashMult = 1;

  // 同步初始 runtime 镜像(供 main.ts wrap 在首帧前读出非零值)
  opts.runtime.battery = battery.percent;
  opts.runtime.pips = dash.energy;

  return {
    step(dt, input) {
      const mult = updateDash(
        dash,
        dashCfg,
        input.shift,
        input.fwd !== 0 || input.strafe !== 0,
        dt,
      );
      updateBattery(battery, batteryCfg, opts.runtime.appOpen, dt);
      opts.runtime.battery = battery.percent;
      opts.runtime.pips = dash.energy;
      currentDashMult = mult;
      if (battery.isTerminal && !terminalWarned) {
        terminalWarned = true;
        console.warn('[battery] terminal: 0% reached — game over');
      }
    },
    getDashSpeedMult() {
      return currentDashMult;
    },
    reset() {
      resetBattery(battery, batteryCfg);
      resetDash(dash, dashCfg);
      terminalWarned = false;
      currentDashMult = 1;
      opts.runtime.battery = battery.percent;
      opts.runtime.pips = dash.energy;
    },
  };
}