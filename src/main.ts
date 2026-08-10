import * as THREE from 'three';
import { createLibraryScene, DEFAULT_DEBUG_PARAMS } from './scene/loadLibraryScene';
import { createThirdPersonController } from './player/thirdPersonController';
import { createSharedStateFacade } from './platform/sharedState';
import { mountPhoneHud } from './ui/phoneHud';
import { mountGtaPrompt } from './ui/gtaPrompt';
import { mountPlayerStats } from './game/playerStats';
import { CONFIG } from './game/config';
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
const { scene, player, colliders, outlets, update, rebuildTableZone, setColliderHelpersVisible, randomizeOccupiedOutlets } =
  createLibraryScene(DEFAULT_DEBUG_PARAMS);

// --- 点击进入指针锁的提示遮罩 ---
const overlay = document.createElement('div');
overlay.textContent = 'WASD 移动(AD 转向)· Shift 冲刺 · 1/2/3 切 app · E 插枪';
Object.assign(overlay.style, {
  position: 'fixed',
  inset: '0',
  display: 'flex',
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

// PR #12 §2.5.2:点击 overlay 直接开始(无 pointer lock);commit 5 加 gameStarted 标志主循环门控
let gameStarted = false;
overlay.addEventListener('click', () => {
  overlay.style.display = 'none';
  gameStarted = true;
});

// PR #12 §2.5.2/§2.5.5:胜利 / 失败状态(共态,影响 main loop 早退 + getSharedState wrap)
let gameWon = false;      // 走近空桩按 E → true
let gameOver = false;     // battery=0 → true

// --- Runtime + PlayerStats(PR #10 — 必须先于 controller 实例化,因 controller 需读 dash mult)
const runtime = {
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

/** wrap:取 raw SharedState,覆写 battery/pips 为 runtime 真值 + PR #12 加 won:gameWon(给 phone HUD / minimap / __debug 读)。 */
function getSharedState() {
  const s = getRawSharedState();
  return { ...s, battery: runtime.battery, pips: runtime.pips, won: gameWon };
}

// --- Mount phone HUD stub(Sam 在 PR #9 替换 mountPhoneHud 实现,调用点不动)---
mountPhoneHud({
  getSharedState,
  onAppAction: (action) => {
    if (action.kind === 'toggle-app') {
      const key = action.app === 'map' ? 'MAP' : action.app === 'radar' ? 'RADAR' : 'QUERY';
      runtime.appOpen[key] = !runtime.appOpen[key];
    } else if (action.kind === 'restart') {
      gameWon = false;
      gameOver = false;
      playerStats.reset();
      player.position.set(0, 0, 8.5);
      randomizeOccupiedOutlets();
    }
  },
});

// PR #13 §3.4:GTA 提示系统 mount(左上 prompt + 中下任务条)
// TODO PR #13-David merge 后改 CONFIG.hud.objectiveText(Sam 先硬编码)
mountGtaPrompt({ getSharedState, objectiveText: '电量耗尽之前找到充电位置' });

// PR #12 §2.5.2:E 键近空桩(≤1.5m)判胜
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE' || gameWon || gameOver || !gameStarted) return;
  const s = getSharedState();
  const near = s.outlets.find(o =>
    !o.occupied && Math.hypot(o.x - s.player.x, o.z - s.player.z) < 1.5,
  );
  if (near) {
    gameWon = true;
    console.log('[win] 充上电了');
  }
});

// --- Debug: expose getSharedState to window for console eval ---
if (import.meta.env.DEV) {
  Object.assign(window, { __debug: { getSharedState } });
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
    // §2.5.5 game over 检测:battery=0 且未胜 → gameOver=true
    if (runtime.battery <= 0) gameOver = true;
  }
  update(dt);
  renderer.render(scene, camera);
}
animate();
