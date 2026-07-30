import * as THREE from 'three';

/**
 * Procedural animation toolkit — code-driven juice without any
 * skeletal animation or external tween library.
 *
 * These cover 90% of "cozy idle game" motion needs:
 * breathing, bobbing, swaying, attention-pulse, pop-in.
 * All are dt-safe when driven from the update loop with `elapsed`.
 */

// --- Easing functions ---
export const ease = {
  linear: (t: number) => t,
  outQuad: (t: number) => t * (2 - t),
  inQuad: (t: number) => t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  /** Overshoot then settle — the classic "pop" feel. */
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  /** Bouncy landing. */
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

/** Gentle vertical bobbing — idle characters, floating items. */
export function bob(
  obj: THREE.Object3D,
  elapsed: number,
  baseY: number,
  amplitude = 0.05,
  speed = 2,
): void {
  obj.position.y = baseY + Math.sin(elapsed * speed) * amplitude;
}

/** Gentle side-to-side rotation — plants, tails, hanging signs. */
export function sway(
  obj: THREE.Object3D,
  elapsed: number,
  amplitude = 0.08,
  speed = 1.5,
): void {
  obj.rotation.z = Math.sin(elapsed * speed) * amplitude;
}

/** Rhythmic scale pulse — "click me" affordance, reward ready. */
export function pulse(
  obj: THREE.Object3D,
  elapsed: number,
  amplitude = 0.06,
  speed = 3,
): void {
  const s = 1 + Math.sin(elapsed * speed) * amplitude;
  obj.scale.setScalar(s);
}

/**
 * Spawn pop-in: call with `age` = seconds since spawn.
 * Returns true while the pop is still animating (< duration).
 */
export function popIn(
  obj: THREE.Object3D,
  age: number,
  duration = 0.35,
): boolean {
  const t = Math.min(age / duration, 1);
  obj.scale.setScalar(Math.max(ease.outBack(t), 0.001));
  return t < 1;
}

/** Lerp a value toward target with framerate-independent smoothing. */
export function damp(current: number, target: number, smoothing: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-smoothing * dt));
}
