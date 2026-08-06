import { describe, it, expect } from 'vitest';
import {
  createDash,
  requestDash,
  updateDash,
  resetDash,
  getDashSpeedMult,
  type DashConfig,
  type DirectionInput,
} from './dash';

const cfg: DashConfig = {
  startPips: 3,
  dashDurationS: 0.4,
  dashMult: 3,
  cooldownS: 0.5,
};

const forward: DirectionInput = { fwd: 1, strafe: 0 };
const neutral: DirectionInput = { fwd: 0, strafe: 0 };

/** 一次性推过 dashing + cooldown 两个 phase,
 *  按 spec §3.3 updateDash 每次只转一档,所以分两次 tick(真实主循环 dt ≤ 0.1s,永不会一次跨两档)。 */
function advanceToIdle(d: ReturnType<typeof createDash>): void {
  updateDash(d, cfg, cfg.dashDurationS + 0.01);
  expect(d.phase).toBe('cooldown');
  updateDash(d, cfg, cfg.cooldownS + 0.01);
  expect(d.phase).toBe('idle');
}

describe('dash pip consumption', () => {
  it('pips 3 → 2 → 1 → 0 over 3 forward dashes; 4th dash refused', () => {
    const d = createDash(cfg);
    expect(d.pips).toBe(3);
    expect(requestDash(d, cfg, forward)).toBe(true);
    expect(d.pips).toBe(2);
    advanceToIdle(d);

    expect(requestDash(d, cfg, forward)).toBe(true);
    expect(d.pips).toBe(1);
    advanceToIdle(d);

    expect(requestDash(d, cfg, forward)).toBe(true);
    expect(d.pips).toBe(0);
    advanceToIdle(d);

    // 第 4 次:pips 已 0,拒绝触发
    expect(requestDash(d, cfg, forward)).toBe(false);
    expect(d.pips).toBe(0);
  });

  it('direction gating: neutral input does not trigger dash, pip preserved', () => {
    const d = createDash(cfg);
    expect(requestDash(d, cfg, neutral)).toBe(false);
    expect(d.phase).toBe('idle');
    expect(d.pips).toBe(3);
  });

  it('dashing phase refuses new dash (phase gate); cooldown also blocks', () => {
    const d = createDash(cfg);
    expect(requestDash(d, cfg, forward)).toBe(true);
    expect(d.phase).toBe('dashing');
    // dashing 中再来一次 → 拒
    expect(requestDash(d, cfg, forward)).toBe(false);
    expect(d.pips).toBe(2);
    // 推 0.2s 仍在 dashing
    updateDash(d, cfg, 0.2);
    expect(d.phase).toBe('dashing');
    expect(requestDash(d, cfg, forward)).toBe(false);
    // 推完剩余 dashing 进 cooldown
    updateDash(d, cfg, 0.21);
    expect(d.phase).toBe('cooldown');
    expect(requestDash(d, cfg, forward)).toBe(false);
  });

  it('full state cycle: dash 0.4s → cooldown 0.5s → idle, speed mult reflects phase', () => {
    const d = createDash(cfg);
    expect(getDashSpeedMult(d, cfg)).toBe(1);
    expect(requestDash(d, cfg, forward)).toBe(true);
    expect(getDashSpeedMult(d, cfg)).toBe(3);
    // 0.39s 仍是 dashing
    updateDash(d, cfg, 0.39);
    expect(d.phase).toBe('dashing');
    expect(getDashSpeedMult(d, cfg)).toBe(3);
    // 推到 0.41s 进 cooldown
    updateDash(d, cfg, 0.02);
    expect(d.phase).toBe('cooldown');
    expect(getDashSpeedMult(d, cfg)).toBe(1);
    // cooldown 0.49s 仍未结束
    updateDash(d, cfg, 0.49);
    expect(d.phase).toBe('cooldown');
    expect(requestDash(d, cfg, forward)).toBe(false);
    // 再推 0.02s 进 idle,可触发新 dash
    updateDash(d, cfg, 0.02);
    expect(d.phase).toBe('idle');
    expect(requestDash(d, cfg, forward)).toBe(true);
    expect(d.pips).toBe(1);
  });

  it('resetDash restores full pips and idle phase (single-run no replenish invariant)', () => {
    const d = createDash(cfg);
    requestDash(d, cfg, forward);
    advanceToIdle(d);
    requestDash(d, cfg, forward);
    advanceToIdle(d);
    requestDash(d, cfg, forward);
    advanceToIdle(d);
    expect(d.pips).toBe(0);
    // 局内 idle 状态下持续 update pips 不再补给(单局不补 锁定)
    updateDash(d, cfg, 100);
    expect(d.pips).toBe(0);
    // 重开新局才补满
    resetDash(d, cfg);
    expect(d.pips).toBe(3);
    expect(d.phase).toBe('idle');
    expect(d.phaseTimer).toBe(0);
  });
});