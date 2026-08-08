import { describe, it, expect } from 'vitest';
import {
  createDash,
  updateDash,
  resetDash,
  type DashConfig,
} from './dash';

// PR #12 spec §2.3 base config — drainPerSec=0.4 → 2.5 秒纯冲刺用完
const cfg: DashConfig = {
  startEnergy: 1.0,
  drainPerSec: 0.4,
  regenPerSec: 0,
  dashMult: 3,
};

describe('dash continuous energy bar (PR #12)', () => {
  it('满能量 shift+方向 0.5 秒后 energy=0.8 (drainPerSec=0.4: 1-0.4*0.5)=0.8 且速度倍率=dashMult', () => {
    const d = createDash(cfg);
    expect(d.energy).toBe(1.0);
    const mult = updateDash(d, cfg, true, true, 0.5);
    expect(mult).toBe(3);
    expect(d.isDashing).toBe(true);
    // 1 - 0.4 * 0.5 = 0.8
    expect(d.energy).toBeCloseTo(0.8, 6);
  });

  it('energy=0 时 shift+方向 → 不消耗,速度倍率=1', () => {
    const d = createDash(cfg);
    d.energy = 0;
    const mult = updateDash(d, cfg, true, true, 0.5);
    expect(mult).toBe(1);
    expect(d.isDashing).toBe(false);
    expect(d.energy).toBe(0);
  });

  it('方向门控:无方向 shift → 不消耗(energy 保留满),速度=1', () => {
    const d = createDash(cfg);
    const mult = updateDash(d, cfg, true, false, 0.5);
    expect(mult).toBe(1);
    expect(d.isDashing).toBe(false);
    expect(d.energy).toBe(1.0);
  });

  it('松开 shift → energy 不回补(regenPerSec=0)', () => {
    const d = createDash(cfg);
    // 先冲 0.2s 耗 0.08 → energy = 0.92
    updateDash(d, cfg, true, true, 0.2);
    expect(d.energy).toBeCloseTo(0.92, 6);
    // 松开 shift,即便再 update 100 秒,energy 仍保持(regenPerSec=0)
    const mult = updateDash(d, cfg, false, false, 100);
    expect(mult).toBe(1);
    expect(d.isDashing).toBe(false);
    expect(d.energy).toBeCloseTo(0.92, 6);
  });

  it('resetDash → energy 回 1.0, isDashing=false', () => {
    const d = createDash(cfg);
    updateDash(d, cfg, true, true, 1.5);
    expect(d.energy).toBeCloseTo(0.4, 6);
    resetDash(d, cfg);
    expect(d.energy).toBe(1.0);
    expect(d.isDashing).toBe(false);
  });
});