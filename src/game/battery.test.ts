import { describe, it, expect } from 'vitest';
import {
  createBattery,
  updateBattery,
  resetBattery,
  sumAppMult,
  drainFactor,
  type BatteryConfig,
  type AppOpenState,
} from './battery';

const cfg: BatteryConfig = {
  startPercent: 1.0,
  baseDrain: 1.0 / 180,
  totalGameTimeS: 180,
  appMult: { RADAR: 3, MAP: 2, QUERY: 4 },
};

const closed: AppOpenState = { RADAR: false, MAP: false, QUERY: false };

describe('battery drain', () => {
  it('idle (all apps closed) drifts at baseDrain ×1 → 100s ~ 0.4444', () => {
    const b = createBattery(cfg);
    updateBattery(b, cfg, closed, 100);
    // drain = (1/180) * 1 * 100 = 100/180 ≈ 0.5556; percent = 1 - 0.5556 = 0.4444
    expect(b.percent).toBeCloseTo(1 - 100 / 180, 5);
    expect(b.isTerminal).toBe(false);
  });

  it('RADAR alone 1s drains ×3: drain = (1/180) × 3 × 1 = 1/60', () => {
    const b = createBattery(cfg);
    const before = b.percent;
    updateBattery(b, cfg, { RADAR: true, MAP: false, QUERY: false }, 1);
    expect(b.percent).toBeCloseTo(before - 3 / 180, 6);
  });

  it('RADAR + MAP 1s drains ×5: drain = (1/180) × 5 × 1 = 1/36', () => {
    const b = createBattery(cfg);
    const before = b.percent;
    updateBattery(b, cfg, { RADAR: true, MAP: true, QUERY: false }, 1);
    expect(b.percent).toBeCloseTo(before - 5 / 180, 6);
  });

  it('0% boundary: clamps to 0, sets isTerminal exactly once, no second fire', () => {
    const b = createBattery(cfg);
    // 直接把 percent 设到接近 0,再 update 一次跨过 0
    b.percent = 0.001;
    updateBattery(b, cfg, { RADAR: true, MAP: false, QUERY: false }, 1);
    expect(b.percent).toBe(0);
    expect(b.isTerminal).toBe(true);
    // terminal 后再 update 不二次触发(percent 保持 0,也不再走衰减分支)
    const loggedWarn: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => loggedWarn.push(msg);
    updateBattery(b, cfg, { RADAR: true, MAP: true, QUERY: true }, 1);
    console.warn = origWarn;
    expect(b.percent).toBe(0);
    expect(b.isTerminal).toBe(true);
  });
});

describe('battery helpers', () => {
  it('sumAppMult / drainFactor reflect spec §3.2 locked table', () => {
    expect(sumAppMult(cfg, closed)).toBe(0);
    expect(drainFactor(cfg, closed)).toBe(1);
    expect(drainFactor(cfg, { RADAR: true, MAP: false, QUERY: false })).toBe(3);
    expect(drainFactor(cfg, { RADAR: false, MAP: true, QUERY: false })).toBe(2);
    expect(drainFactor(cfg, { RADAR: false, MAP: false, QUERY: true })).toBe(4);
    expect(drainFactor(cfg, { RADAR: true, MAP: true, QUERY: false })).toBe(5);
    expect(drainFactor(cfg, { RADAR: true, MAP: true, QUERY: true })).toBe(9);
  });

  it('resetBattery restores startPercent and clears terminal', () => {
    const b = createBattery(cfg);
    b.percent = 0;
    b.isTerminal = true;
    resetBattery(b, cfg);
    expect(b.percent).toBe(1.0);
    expect(b.isTerminal).toBe(false);
  });
});