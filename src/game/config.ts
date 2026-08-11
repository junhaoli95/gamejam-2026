// PR #13 #2:起始电量 10%(1% 电主题)+ 方案 B —— baseDrain 跟 startPercent 缩放,
// 让 10% 仍玩满 totalGameTimeS(180s),百分比只是显示数字。playtest 调 START_PERCENT。
const START_PERCENT = 0.10;
const TOTAL_GAME_TIME_S = 180;

export const CONFIG = {
  world: { w: 32, d: 24, cellSize: 0.4 },
  player: {
    walkSpeed: 3.0,
    sprintSpeed: 5.6,
    radius: 0.32,
    turnLerp: 14,
    turnRate: 3.0,
  },
  camera: {
    fov: 70,
    near: 0.05,
    far: 80,
    dist: 2.7,
    side: 0.35,
    up: 1.35,
    collidePad: 0.25,
    collideSteps: 8,
    dampLambda: 12,       // 方向阻尼(快跟转向);camera tune 拆分后只管方向
    dampDistLambda: 5,    // 距离阻尼(慢跟近墙 clip 恢复,4-6 手感区);camera tune 新增
    minDist: 1.4,
  },
  dash: {
    startEnergy: 1.0,
    drainPerSec: 0.4,
    regenPerSec: 0,
    dashMult: 3,
  },
  battery: {
    startPercent: START_PERCENT,
    baseDrain: START_PERCENT / TOTAL_GAME_TIME_S,  // 方案 B:满电续航 = totalGameTimeS 不变(spec §4.1 / §10.1)
    totalGameTimeS: TOTAL_GAME_TIME_S,
    appMult: {
      RADAR: 3,
      MAP: 2,
      QUERY: 4,
    },
  },
  npc: {
    count: 3,
    walkSpeed: 2.2,        // PR #16 B:略慢于玩家 walkSpeed 3.0
    idleMinSec: 2,
    idleMaxSec: 5,
    occupyMinSec: 8,
    occupyMaxSec: 15,
    arriveDist: 0.8,       // 到桩 0.8m 内 = occupying
  },
  hud: {
    promptRange: 1.5,       // 近空桩触发左上 GTA prompt 距离(米),spec §4.1
    objectiveText: '电量耗尽之前找到充电位置',  // 中下常驻任务条文案
  },
} as const;
