export const CONFIG = {
  world: { w: 32, d: 24, cellSize: 0.4 },
  player: {
    walkSpeed: 3.0,
    sprintSpeed: 5.6,
    radius: 0.32,
    turnLerp: 14,
  },
  camera: {
    fov: 70,
    near: 0.05,
    far: 80,
    dist: 2.7,
    side: 0.35,
    up: 1.35,
    pitchMin: -0.12,
    pitchMax: 0.4,
    mouseSens: 0.0023,
    collidePad: 0.25,
    collideSteps: 8,
    dampLambda: 12,
    minDist: 1.4,
  },
  dash: {
    startPips: 3,
    dashDurationS: 0.4,
    dashMult: 3,
    cooldownS: 0.5,
  },
  battery: {
    startPercent: 1.0,
    baseDrain: 1.0 / 180,
    totalGameTimeS: 180,
    appMult: {
      RADAR: 3,
      MAP: 2,
      QUERY: 4,
    },
  },
  npc: {
    count: 3,
  },
} as const;
