// ─────────────────────────────────────────────────────────────────────────────
// PlayerStats:电池 + dash 资源系统装配(master spec §4 + §7.3)
//
// 本模块把 `game/battery.ts` 与 `game/dash.ts` 实例化,以 `runtime` 槽对象暴露续航 / pip 给
// `main.ts` 的 SharedState wrapper(不改 sharedState.ts 文件本身)。
//
// 步进语义(part of §7.3 主循环单向数据流):
//   1. updateDash — 推进 phaseTimer / 自动转 phase(spec §3.3 一次一档)
//   2. updateBattery — 按 appOpen 算 drainFactor,扣 percent,触 terminal 单次
//   3. 写回 runtime.battery / runtime.pips(供 SharedState wrap 读出)
//
// 端到端:
//   main.ts animate 主循环每帧 `playerStats.step(dt)` 推进状态机,
//   Shift 边沿触发 `playerStats.requestDash(dirInput)`(主循环经由 controller.getInput 喂)
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
  requestDash as dashRequest,
  getDashSpeedMult as dashGetMult,
  resetDash,
  type DashConfig,
  type DashState,
  type DirectionInput,
} from './dash';

export interface RuntimeStats {
  battery: number;     // 0~1, 镜像 BatteryState.percent
  pips: number;        // 0~3, 镜像 DashState.pips
  appOpen: AppOpenState; // 当前开哪几个 app(本 PR 默认全关,Sam 接通后由 main.ts 维护)
}

export interface PlayerStatsOptions {
  runtime: RuntimeStats;
}

export interface PlayerStatsHandle {
  /** 每帧调,推进 dash/battery 状态机 + 写 runtime 镜像(只看 dt;Shift 触发通过 requestDash 单独发) */
  step: (dt: number) => void;
  /** Shift 边沿触发,通过三道门则消费 1 pip + 进 dashing,返回是否成功 */
  requestDash: (input: DirectionInput) => boolean;
  /** 当前速度倍率:idle/cooldown=1, dashing=CONFIG.dash.dashMult */
  getDashSpeedMult: () => number;
  /** 局末重启(下局自动满) */
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
    startPips: d.startPips,
    dashDurationS: d.dashDurationS,
    dashMult: d.dashMult,
    cooldownS: d.cooldownS,
  };
}

export function mountPlayerStats(opts: PlayerStatsOptions): PlayerStatsHandle {
  const batteryCfg = batteryCfgFromConfig();
  const dashCfg = dashCfgFromConfig();
  const battery = createBattery(batteryCfg);
  const dash: DashState = createDash(dashCfg);
  let terminalWarned = false;

  // 同步初始 runtime 镜像(供 main.ts wrap 在首帧前读出非零值)
  opts.runtime.battery = battery.percent;
  opts.runtime.pips = dash.pips;

  return {
    step(dt) {
      updateDash(dash, dashCfg, dt);
      updateBattery(battery, batteryCfg, opts.runtime.appOpen, dt);
      // 写 runtime 镜像(供 SharedState wrapper 经 main.ts 读出)
      opts.runtime.battery = battery.percent;
      opts.runtime.pips = dash.pips;
      if (battery.isTerminal && !terminalWarned) {
        terminalWarned = true;
        // spec §2.4:本 PR 暂用 console.warn,不发跨 PR event bus
        console.warn('[battery] terminal: 0% reached — game over');
      }
    },
    requestDash(input) {
      return dashRequest(dash, dashCfg, input);
    },
    getDashSpeedMult() {
      return dashGetMult(dash, dashCfg);
    },
    reset() {
      resetBattery(battery, batteryCfg);
      resetDash(dash, dashCfg);
      terminalWarned = false;
      opts.runtime.battery = battery.percent;
      opts.runtime.pips = dash.pips;
    },
  };
}