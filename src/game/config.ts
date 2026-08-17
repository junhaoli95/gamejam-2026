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
    dampLambda: 12,       // 方向阻尼(快跟转向);camera tune 拆分后只管方向
    dampDistLambda: 5,    // 距离阻尼(慢跟近墙 clip 恢复,4-6 手感区);camera tune 新增
    minDist: 1.4,         // 侧滑判定阈值:摆角清距 ≥ 1.4 才算机位够远;贴墙宁绕肩不贴脸
    swingStepDeg: 10,     // 侧滑摆角步进(度);camera tune 第二轮
    swingMaxDeg: 90,      // 侧滑最大摆角(度);camera tune 第二轮
    swingHyst: 0.15,      // 摆角滞回带(米):临界清距抖动时沿用上帧摆角
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
    walkSpeed: 3.0,        // 与玩家 walkSpeed 完全一致
    idleMinSec: 2,
    idleMaxSec: 5,
    arriveDist: 0.8,       // 到桩 0.8m 内 = occupying
    wanderChance: 0.2,     // idle 结束时掷骰走 wander 的概率(低 → NPC 更积极抢桩)
    wanderRadius: 4,       // wander 目标点距离上限(m),在 NPC 附近 0~4m 找 free cell
  },
  charging: {
    studyTableGreenRate: 0.05,  // 每局绿桩总数 = round(自习桌数 × rate),60 桌 → 3,15 桌 → 1
    meshGreenRandom: [1, 2] as const,  // 非自习桌绿桩差随机范围:绿数 = max(meshGreenMin, npcCount - rand)
    meshGreenMin: 2,                   // 非自习桌绿桩数下限(每局至少保底绿桩数)
  },
  hud: {
    promptRange: 1.5,       // 近空桩触发左上 GTA prompt 距离(米),spec §4.1
    objectiveText: 'Find a charging point before the battery dies',  // 中下常驻任务条文案(PR #28 英文化)
  },
} as const;
