import * as THREE from 'three';
import { createLibraryScene, DEFAULT_DEBUG_PARAMS, getLevelNpcCount } from './scene/loadLibraryScene';
import { createThirdPersonController } from './player/thirdPersonController';
import { createSharedStateFacade } from './platform/sharedState';
import { mountPhoneHud } from './ui/phoneHud';
import { mountGtaPrompt } from './ui/gtaPrompt';
import { mountMissionToast } from './ui/missionToast';
import { mountHighScore } from './ui/highScore';
import { mountPlayerStats } from './game/playerStats';
import { hasLineOfSight, toLosBoxes } from './game/los';
import { toGrid } from './game/gridModel';
import { createNpcController } from './game/npc';
import { createNpcMeshManager } from './scene/npcMesh';
import { CONFIG } from './game/config';
import { mountAudio } from './platform/audio';
import { mountTitleScreen, shouldSkipTitleOnReload } from './ui/titleScreen';
import './style.css';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// --- Camera (第三人称越肩:第一人称视野 + 角色可见) ---
const camera = new THREE.PerspectiveCamera(
  CONFIG.camera.fov,
  window.innerWidth / window.innerHeight,
  CONFIG.camera.near,
  CONFIG.camera.far,
);

// --- Scene ---
const { scene, player, colliders, outlets, update, resetPlayerAnimation, rebuildTableZone, setColliderHelpersVisible, randomizeOccupiedOutlets, setOutletOccupied, getNpcMeshes, terrain } =
  createLibraryScene(DEFAULT_DEBUG_PARAMS);

// PR #28:刷新/回访 → 总是显标题屏(除非刚选过关的 reload 用 sessionStorage 一次性跳过);
// 标题屏选关 → reload → 跳过标题,显"点击开始" overlay(音频手势入口)。
let gameStarted = false;
const overlay = document.createElement('div');
overlay.textContent = 'WASD move (A/D turn) · Shift dash · 1/2/3 apps · E plug in';
Object.assign(overlay.style, {
  position: 'fixed',
  inset: '0',
  display: 'none',  // 默认隐藏;只有"已选关 reload"路径才显
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(20, 16, 10, 0.55)',
  color: '#ffe9c4',
  font: '16px/1.6 system-ui, sans-serif',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  zIndex: '10',
});
document.body.appendChild(overlay);

function showStartOverlay(): void {
  overlay.style.display = 'flex';
}
overlay.addEventListener('click', () => {
  overlay.style.display = 'none';
  gameStarted = true;
  audio.startBGM(); // PR #16:首次用户点击启动 BGM(AudioContext 手势内 resume)
});

if (shouldSkipTitleOnReload()) {
  showStartOverlay();          // 刚选过关的 reload:跳过标题直接进游戏
} else {
  mountTitleScreen({           // 首次/刷新/回标题:总显标题屏
    onStart: showStartOverlay, // 点已选中的关卡 → 直接开始(布局已加载)
  });
}

// PR #12 §2.5.2/§2.5.5:胜利 / 失败状态(共态,影响 main loop 早退 + getSharedState wrap)
let gameWon = false;      // 走近空桩按 E → true
let gameOver = false;     // battery=0 → true
let lowLatch = false;     // PR #16:低电警报只触发一次(restart 重置)

// --- Runtime + PlayerStats(PR #10 — 必须先于 controller 实例化,因 controller 需读 dash mult)
const runtime: {
  battery: number;
  pips: number;
  appOpen: { RADAR: boolean; MAP: boolean; QUERY: boolean };
} = {
  battery: CONFIG.battery.startPercent,
  pips: CONFIG.dash.startEnergy,
  appOpen: { RADAR: false, MAP: false, QUERY: false },
};
const playerStats = mountPlayerStats({ runtime });

// --- Controller(PR #12:Shift 持续按住由 playerStats.step 经 input.shift 消耗 energy;
// controller 仍走 getDashMult 回调读速度倍率)
const controller = createThirdPersonController({
  camera,
  dom: renderer.domElement,
  player,
  colliders,
  bounds: { w: CONFIG.world.w, d: CONFIG.world.d },
  overlay,
  getDashMult: playerStats.getDashSpeedMult,
});

// --- SharedState facade:Layer 1 stub 返回固定 battery=1.0 / pips=3;
// PR #10 在 main 包一层 wrap,用 runtime 真值覆盖 battery/pips 字段(sharedState.ts 文件 0 改,§0.3)。
const { getSharedState: getRawSharedState } = createSharedStateFacade(player, controller, outlets);

/** wrap:取 raw SharedState,覆写 battery/pips 为 runtime 真值 + PR #12 won + PR #13 terrain/nearOutlet + PR #16 npcs。 */
// PR #16 fix:nearOutlet 加视线检测 — 玩家→桩连线被 colliders 阻挡(隔墙)不算 near。
// PR #17 fix:losBoxes 用 toLosBoxes 过滤矮家具(桌/椅)——桌面电位桩在桌中心,
// 若把桌子自身 AABB 当墙,玩家站桌边→桌中心连线必被挡,桌电位永远无法充电。
// 高墙(柱/书架)保留,隔墙不算 near 语义不变。
// losBoxes 每次调用内联转换(rebuildTableZone 会改 colliders 内容,转换一次会 stale)。
// 公共判定:nearOutlet(gtaPrompt 显示)与 E 键判胜必须用同一逻辑,否则脱节(提示没显示但能充电)。
function findNearOutlet(outlets: Array<{ x: number; z: number; occupied: boolean }>, px: number, pz: number):
  { x: number; z: number } | undefined {
  const losBoxes = toLosBoxes(colliders);
  return outlets.find(o =>
    !o.occupied && Math.hypot(o.x - px, o.z - pz) < CONFIG.hud.promptRange &&
    hasLineOfSight(px, pz, o.x, o.z, losBoxes),  // PR #16 fix:隔墙不算
  );
}

function getSharedState() {
  const s = getRawSharedState();
  // PR #13 #9:近空桩标志(每帧算一次,供 gtaPrompt 显隐左上 prompt)
  const nearOutlet = !!findNearOutlet(s.outlets, s.player.x, s.player.z);
  // spec 2026-08-15 §5.3:非自习桌空桩数 = 柱电位 + 壁插中 occupied=false 的数量。
  // NPC 抢桩门控消费(≤1 时 NPC 拒绝 idle→moving,给玩家留最后 1 充点)。
  const freeMeshGreenCount = s.outlets.reduce(
    (acc, o) => acc + (!o.occupied && o.kind === 'mesh' ? 1 : 0), 0);
  return {
    ...s,
    battery: runtime.battery,
    pips: runtime.pips,
    won: gameWon,
    terrain,
    nearOutlet,
    freeMeshGreenCount,
    // PR #16 B:NPC 位置 + 状态,供箭头/UI 消费
    npcs: npcController.entities.map(e => ({ x: e.x, z: e.z, state: e.state, targetIndex: e.targetOutletIndex })),
  };
}

// --- Mount phone HUD stub(Sam 在 PR #9 替换 mountPhoneHud 实现,调用点不动)---
const audio = mountAudio(); // PR #16 §4.2:Roy 加(位于 mountPhoneHud 之前)
mountPhoneHud({
  getSharedState,
  onAppAction: (action) => {
    if (action.kind === 'toggle-app') {
      const key = action.app === 'map' ? 'MAP' : action.app === 'radar' ? 'RADAR' : 'QUERY';
      runtime.appOpen[key] = !runtime.appOpen[key];
      audio.playAppToggle(action.app); // PR #16:切 app "咔" SFX
    } else if (action.kind === 'restart') {
      gameWon = false;
      gameOver = false;
      lowLatch = false; // PR #16:低电警报 latch 复位
      audio.startBGM(); // PR #16:重开一局,恢复 BGM(若已停)
      playerStats.reset();
      player.position.set(0, 0, 8.5);
      resetPlayerAnimation();
      // PR #13 #5:新 seed,每局 NPC 占位分布不同(QTE 方案已砍,无 state 需重置)
      // spec 2026-08-15:红桩数 = 布局 meshNpcCount(缺省 CONFIG.npc.count),与 NpcSystem 实体数一致
      randomizeOccupiedOutlets(getLevelNpcCount(), (Date.now() % 100000));
      // PR #16 B:重开新局,NPC 状态重置 + 位置对齐新摆的坐姿猫
      npcController.reset(Date.now() % 100000);
      syncNpcPositionsToMeshes();
      npcMeshManager.reset();
    }
  },
});

// PR #13 §3.4:GTA 提示系统 mount(左上 prompt + 中下任务条)
// TODO PR #13-David merge 后改 CONFIG.hud.objectiveText(Sam 先硬编码)
mountGtaPrompt({ getSharedState, objectiveText: CONFIG.hud.objectiveText });  // PR #28:读 CONFIG,英文化集中管理

// PR #16 §2.3 奖励系统 mount(mountGtaPrompt 之后)
mountMissionToast({ getSharedState });
mountHighScore({ getSharedState });

// --- PR #16 B:NPC AI(状态机 + 头顶箭头)---
// spec 2026-08-15 §5.3:freeMeshGreenCount 每帧更新(非自习桌空桩数),NPC idle→moving 门控用。
const npcMeshManager = createNpcMeshManager(scene, getNpcMeshes());
const npcOpts: Parameters<typeof createNpcController>[0] = {
  getOutletCount: () => outlets.length,
  getOutletPos: (i) => ({ x: outlets[i].x, z: outlets[i].z }),
  isOutletOccupied: (i) => outlets[i].occupied,
  setOutletOccupied: setOutletOccupied,
  // PR #17 A:壁插(occupiable=false)常亮可充,NPC 不占
  isOutletOccupiable: (i) => outlets[i].occupiable !== false,
  // PR #17 B:A* 寻路网格(cellSize 0.4;inflate=NPC 半径 0.38 → path 保持 ≥0.38m 离墙,
  // 避免 NPC 圆盘边缘擦 collider 被 resolveCollision 推出卡死)
  grid: toGrid(colliders, CONFIG.world.w, CONFIG.world.d, CONFIG.world.cellSize, 0.38),
  npcCount: getLevelNpcCount(),  // spec 2026-08-15 §3.3:layout 优先,CONFIG 兜底(NpcSystem 实体数 = 红桩数)
  cfg: CONFIG.npc,
  // PR #16 fix:colliders 转轻量 AABB 给 NPC 防穿墙(与 player 同源)
  colliders: colliders.map(b => ({ minX: b.min.x, minZ: b.min.z, maxX: b.max.x, maxZ: b.max.z })),
  freeMeshGreenCount: Infinity,  // 门控默认关闭;每帧在 game loop 更新
};
const npcController = createNpcController(npcOpts);

// 实体初始位置对齐场景已就座猫(randomizeOccupiedOutlets 摆位),避免开局瞬移
function syncNpcPositionsToMeshes(): void {
  const meshes = getNpcMeshes();
  npcController.entities.forEach((e, i) => {
    const m = meshes[i];
    if (m) { e.x = m.position.x; e.z = m.position.z; }
  });

// 有解保底校验:开局即检查 at least 1 个空桩留给玩家(运行时 NPC 占桩不再释放 → 单向消耗)
// 初始预占数 + NPC 数 ≤ 总桩 - 1 保证玩家永远有可充之桩。不满足时 console.warn。
{
  let occupiedStart = 0;
  for (const o of outlets) if (o.occupied) occupiedStart++;
  const npcN = getLevelNpcCount();
  const safetyMargin = (outlets.length) - occupiedStart - npcN;
  if (safetyMargin < 1) {
    console.warn(`[layout] config warning: total outlets ${outlets.length} - initial occupied ${occupiedStart} - NPC ${npcN} = ${safetyMargin} < 1, player may have no outlet to charge. Lower NPC count or studyTableGreenRate.`);
  }
}
  npcController.resolveAll();  // PR #16 fix:初始嵌柱推出
}
syncNpcPositionsToMeshes();

// PR #12 §2.5.2:E 键近空桩判胜 — PR #16 fix:与 nearOutlet 同一判定(距离+视线),避免提示脱节
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE' || gameWon || gameOver || !gameStarted) return;
  const s = getSharedState();
  const near = findNearOutlet(s.outlets, s.player.x, s.player.z);
  if (near) {
    gameWon = true;
    audio.playWin(); // PR #16:充电成功上升音阶
    console.log('[win] 充上电了');
  }
});

// --- Debug: expose getSharedState to window for console eval ---
// __debug.noDrain = true 关闭倒计时(battery 锁 10%,调试用)
let debugNoDrain = false;
if (import.meta.env.DEV) {
  Object.assign(window, {
    __debug: {
      getSharedState,
      set noDrain(v: boolean) { debugNoDrain = v; },
      get noDrain() { return debugNoDrain; },
      // 调试:NPC 碰撞/视线用
      get colliders() { return colliders.map(b => ({ minX: b.min.x, minZ: b.min.z, maxX: b.max.x, maxZ: b.max.z })); },
    },
  });
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Debug overlay (dev only; dynamic import keeps lil-gui out of prod bundle) ---
if (import.meta.env.DEV) {
  import('./debug/overlay').then(({ attachDebugGui }) => {
    attachDebugGui({
      rebuildTableZone,
      setColliderHelpersVisible,
      defaultParams: DEFAULT_DEBUG_PARAMS,
    });
  });
}

// --- Game loop ---
// dt clamped so tab-switch won't cause physics/anim jumps.
// backlog #002:THREE.Clock 已 deprecated,改用 THREE.Timer(Timer.update()+getDelta(),v0.185 API 已实测)
const timer = new THREE.Timer();
function animate() {
  requestAnimationFrame(animate);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);

  // PR #12 §2.5.5:未点击 overlay / 已胜利 / 已没电时锁 1/2/3/E/Shift(WASD) —
  // 直接跳过 step + controller.update 即冻结玩家状态,场景呼吸脉冲 + phone HUD RAF 仍在跑。
  if (gameStarted && !gameWon && !gameOver) {
    // PR #12:每帧 const input = controller.getInput(); playerStats.step(dt, input);
    // Shift 持续消耗 energy(不再边沿触发 requestDash)。
    const input = controller.getInput();
    playerStats.step(dt, input);
    controller.update(dt);
    // PR #16 B:NPC 状态机推进 + 头顶箭头/mesh 同步
    // 视线门控:传 losInfo(玩家位置 + 遮挡盒),玩家看不到的 NPC 冻结
    // spec 2026-08-15 §5.3:先算非自习桌空桩数再喂 NPC(抢桩门控消费)
    npcOpts.freeMeshGreenCount = outlets.reduce(
      (acc, o) => acc + (!o.occupied && o.kind === 'mesh' ? 1 : 0), 0);
    npcController.update(dt, { playerX: player.position.x, playerZ: player.position.z, losBoxes: toLosBoxes(colliders) });
    npcMeshManager.update(npcController.entities, dt);
    // debug 调试模式:关闭倒计时(battery 锁 10% 不掉) — __debug.noDrain = true 启用
    if (debugNoDrain) runtime.battery = Math.max(runtime.battery, CONFIG.battery.startPercent);
    // §2.5.5 game over 检测:battery=0 且未胜 → gameOver=true
    if (runtime.battery <= 0) {
      gameOver = true;
      audio.playLose(); // PR #16:没电下降 SFX
      audio.stopBGM(); // PR #16:失败后 BGM 停
    } else if (runtime.battery <= 0.05 && !lowLatch) {
      lowLatch = true;
      audio.playLowBattery(); // PR #16:低电警报(2s 间歇哔,stopBGM 时停)
    }
  }
  update(dt);
  renderer.render(scene, camera);
}
animate();
