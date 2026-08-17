import * as THREE from 'three';
import { loadGlbNormalized } from '../../snippets/loadGlb';
import { CONFIG } from '../game/config';
import { createProceduralBookshelf } from './proceduralLibraryProps';
import layout from './layout.json';
// PR #28 标题屏选关 — 4 个布局快照(Sam PR #24 验过的 5 个布局,Islands = layout.json):
import layout1 from './layouts/layout1.json';  // Open Lobby(7桌)
import layout2 from './layouts/layout2.json';  // Compact Study(19桌)
import layout3 from './layouts/layout3.json';  // Maze(7桌)
import layout5 from './layouts/layout5.json';  // Arena(9桌)

// 标题屏已选过的布局 index(localStorage 持久,1-5;默认 4 = Islands)
function readLevelIndex(): number {
  try {
    const v = Number(localStorage.getItem('titleLevelIndex'));
    return Number.isInteger(v) && v >= 1 && v <= 5 ? v : 4;
  } catch { return 4; }  // SSR/无 localStorage 环境
}
const LEVEL_INDEX = readLevelIndex();
const LAYOUT_BY_INDEX: LayoutData[] = [layout1, layout2, layout3, layout, layout5];

// ─────────────────────────────────────────────────────────────────────────────
// Library scene (布局数据驱动 v7 — 家具坐标唯一真相源 = src/scene/layout.json)
//
// 编辑器(tools/layout-editor.html)画布局 → "保存到游戏" → save-server 写
// layout.json → Vite 检测 JSON 变更 → HMR 整页 reload,游戏秒级应用新布局。
// placements 顺序 = 编辑器元素顺序,电位模拟器(编辑器)与本模块同算法。
//
// 电位(充电桩)四类:
//   1. 自习桌   —— 每桌必带 1 个 table-level 电位(桌面 ±0.45 两绿点)
//   2. 柱电位   —— 每局随机:从 layout.placements 的 column 里按 outlets.columnCount
//                  范围洗牌选 N 根(绿方块在柱面,face 朝房间中心)
//   3. 墙壁插   —— 每局随机:从南/西墙候选点按 outlets.wallCount 洗牌选 M 个(常亮)
//   4. 摸奖桌 ★ —— studyTable-charge:同自习桌渲染 + 绿边视觉,outlet 恒空
//                  TODO: 摸奖机制 — 走近才能看绿桩,对面 2 空位必绿,1-3 空位几率
//
// Model loading: placeholders occupy the floor layout immediately; if
// `public/library/*.glb` exists, the GLB swaps in for the placeholder of
// that kind (preserving placement position + rotation). Drop GLBs in and
// reload the dev server — no code changes needed.
//
// Debug overlay (src/debug/overlay.ts):
//   - freeSeatCount / freeSeed sliders → rebuildTableZone(p)
//     tear down the study-table Group + colliders, rebuild in place; static
//     geometry (lights/floor/walls/bookcases/readingTables/player) untouched.
//     rowSpacing/seatSideDist 已移除(桌坐标来自 layout.json)。
//   - showColliders checkbox (+ F key) → Box3Helper overlay for ALL colliders,
//     including the chair AABBs that block passage between rows.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelKind = 'bookshelf' | 'column' | 'studyTable' | 'studyTable-charge' | 'readingTable' | 'wallSocket' | 'wallBlock';

const MODEL_PATHS: Record<ModelKind, string> = {
  bookshelf:     'library/bookshelf.glb',
  column:        'library/column.glb',
  studyTable:    'library/studyTable.glb',
  'studyTable-charge': 'library/studyTable.glb',
  readingTable:  'library/readingTable.glb',
  wallSocket:    'library/wallSocket.glb',
  wallBlock:     'library/wallBlock.glb',
};

const MODEL_DIMS: Record<ModelKind, { w: number; h: number; d: number }> = {
  bookshelf:     { w: 3.0, h: 2.4,  d: 0.6 },
  column:        { w: 0.9, h: 3.4,  d: 0.9 },
  studyTable:    { w: 1.8, h: 0.75, d: 1.2 }, // 4 人桌,长边沿 x
  'studyTable-charge': { w: 1.8, h: 0.75, d: 1.2 },
  readingTable:  { w: 1.8, h: 0.75, d: 0.9 },
  wallSocket:    { w: 0.3, h: 0.5,  d: 0.12 },
  wallBlock:     { w: 1.0, h: 3.2,  d: 1.0 }, // 编辑器 # 室内隔墙块(全高,带 collider)
};

const PLACEHOLDER_COLOR: Record<ModelKind, number> = {
  bookshelf:     0xf0ede6, // 实拍:白钢架身
  column:        0xa8825c, // 实拍:木饰面方柱
  studyTable:    0xb08c5e, // 实拍:浅木桌
  'studyTable-charge': 0xb08c5e,
  readingTable:  0xb08c5e,
  wallSocket:    0x1a2a1a,
  wallBlock:     0x6b4a2f, // 与边界墙同色(胡桃木)
};

interface Placement {
  kind: ModelKind;
  x: number;
  z: number;
  rotY?: number;
}

// ── 布局数据(layout.json)──
// 房间/家具坐标唯一真相源。编辑器保存 → HMR 生效。placements 顺序 = 编辑器元素顺序。
interface LayoutPlacement {
  kind: string;
  x: number;
  z: number;
  rotY?: number;
}

interface LayoutData {
  room: { w: number; h: number };
  outlets: { columnCount: number[]; wallCount: number[]; seed: number | null; studyTableGreenRate?: number };
  placements: LayoutPlacement[];
}

const LAYOUT: LayoutData = LAYOUT_BY_INDEX[LEVEL_INDEX - 1];  // PR #28:标题屏选关(LEVEL_INDEX 1-5;默认 4=Islands=layout.json)

// 房间尺寸唯一真相源 = layout.json(编辑器保存 → HMR 生效;save-server 同步 CONFIG.world)
const ROOM_W = LAYOUT.room.w;
const ROOM_H = LAYOUT.room.h;
const HALF_W = ROOM_W / 2;
const HALF_H = ROOM_H / 2;

// 桌/椅内部子布局(非布局级,保留只读常量,不可调)
const DEFAULT_SEAT_SIDE_DIST = 0.95;
const DEFAULT_FREE_SEAT_COUNT = 6;
const DEFAULT_FREE_SEED = 0;

// 4 人桌电位:桌面中线 2 个(沿 x ±0.45)
const STUDY_OUTLET_OFFSETS = [-0.45, 0.45];
const COLUMN_OUTLET_Y = 0.35;

const SPAWN = { x: 0, z: 8.5 };

/** Debug overlay 可调参数。空位用种子化 RNG 散布,确定性可复现。桌坐标来自 layout.json。 */
export interface DebugParams {
  freeSeatCount: number;
  freeSeed: number;
}

export const DEFAULT_DEBUG_PARAMS: DebugParams = {
  freeSeatCount: DEFAULT_FREE_SEAT_COUNT,
  freeSeed: DEFAULT_FREE_SEED,
};

// ── 布局派生 helpers ──
/** layout.json 的 rotY 是度数(编辑器导出),场景统一转弧度。 */
function rotRad(deg: number | undefined): number {
  return ((deg ?? 0) % 360) * (Math.PI / 180);
}

/** 自习桌 + 摸奖桌 ★(tableZone 通路,按 placements 顺序给 tableIdx 作座位 key) */
function layoutTables(): Placement[] {
  return LAYOUT.placements
    .filter(p => p.kind === 'studyTable' || p.kind === 'studyTable-charge')
    .map(p => ({ kind: p.kind as ModelKind, x: p.x, z: p.z, rotY: rotRad(p.rotY) }));
}

/** 静态家具(书架/柱/readingTable/wallBlock 室内墙);wallSocket/endPanelBox 由随机电位接管,忽略。 */
function layoutStatic(): { placements: Placement[]; ignoredKinds: string[] } {
  const placements: Placement[] = [];
  const ignored = new Set<string>();
  for (const p of LAYOUT.placements) {
    if (p.kind === 'bookshelf' || p.kind === 'column' || p.kind === 'readingTable' || p.kind === 'wallBlock') {
      placements.push({ kind: p.kind, x: p.x, z: p.z, rotY: rotRad(p.rotY) });
    } else if (p.kind === 'wallSocket' || p.kind === 'endPanelBox') {
      ignored.add(p.kind);
    }
  }
  return { placements, ignoredKinds: [...ignored] };
}

function layoutColumns(): Array<{ x: number; z: number }> {
  return LAYOUT.placements.filter(p => p.kind === 'column').map(p => ({ x: p.x, z: p.z }));
}

/** 确定性 PRNG(mulberry32):1 行 state + imul 混淆,够 jam 期散布空位用。 */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 用 seed 确定性地从全部自习座位里挑 count 个当空位。
 * Fisher-Yates 洗牌取前 count —— 同 (count, seed) 永远产同一份分布。
 * key 格式与 buildOneStudyTable 一致:`tableIdx(placements 顺序),seatIndex(0..3)`
 */
function computeFreeSeats(count: number, seed: number): Set<string> {
  const tables = layoutTables();
  const all: string[] = [];
  for (let ti = 0; ti < tables.length; ti++) {
    for (let si = 0; si < 4; si++) {
      all.push(`${ti},${si}`);
    }
  }
  const rng = mulberry32(seed);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return new Set(all.slice(0, Math.max(0, Math.min(count, all.length))));
}

// ── 每局随机电位(layout.outlets 参数 + seed)──
// 与编辑器 tools/layout-editor.html 的 drawOutlets 完全同算法/同顺序:
// columnCount → wallCount → Fisher-Yates 洗牌柱 → 洗牌墙。face 规则同编辑器(朝房间中心)。
function layoutColumnFace(x: number): 1 | -1 {
  return x < 0 ? 1 : -1;
}

function wallCandidatesFromLayout(): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const hw = LAYOUT.room.w / 2, hh = LAYOUT.room.h / 2, m = 0.27;
  for (let x = -(hw - 2); x <= hw - 2; x += 2) out.push({ x, z: hh - m });
  for (let z = -(hh - 2); z <= hh - 2; z += 2) out.push({ x: -(hw - m), z });
  return out;
}

function drawCount(rng: () => number, range: number[]): number {
  return range[0] + Math.floor(rng() * (range[1] - range[0] + 1));
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/** seed:null → 每局(页面加载)随机;数字 → 固定复现(编辑器"固定 seed"导出)。 */
function gameSeed(): number {
  if (typeof LAYOUT.outlets.seed === 'number') return LAYOUT.outlets.seed;
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

interface OutletSpot { x: number; z: number; face?: 1 | -1; }

function drawOutletSpots(): { columns: OutletSpot[]; walls: OutletSpot[]; seed: number } {
  const seed = gameSeed();
  const rng = mulberry32(seed);
  const columnCount = drawCount(rng, LAYOUT.outlets.columnCount);
  const wallCount = drawCount(rng, LAYOUT.outlets.wallCount);
  const columns = shuffle(layoutColumns(), rng).slice(0, columnCount)
    .map(c => ({ x: c.x, z: c.z, face: layoutColumnFace(c.x) }));
  const walls = shuffle(wallCandidatesFromLayout(), rng).slice(0, wallCount);
  return { columns, walls, seed };
}

export interface LibraryScene {
  scene: THREE.Scene;
  /** Placeholder cat —— 正式 player entity 进 game/ 后移除。 */
  player: THREE.Group;
  /** 静态+桌区合并碰撞体(玩家与相机共用)。rebuild 时原地刷新,引用稳定。 */
  colliders: THREE.Box3[];
  /** 所有电位位置(柱电位+端板盒+桌电位+壁插),供 SharedState/minimap 消费。 */
  outlets: Array<{ x: number; z: number; occupied: boolean; occupiable: boolean }>;
  update: (dt: number) => void;
  /** Debug overlay 用:按新 params 拆除并重建桌区(桌椅猫+电位+collider+helper)。 */
  rebuildTableZone: (params: DebugParams) => void;
  /** Debug overlay 用:显示/隐藏全部 collider 的线框。 */
  setColliderHelpersVisible: (visible: boolean) => void;
  /** PR #12 §2.5/§2.5.4 randomize NPC 占位 — 重置全部 occupied,seeded RNG 选 count 个标红,刷新 mesh 颜色 + NPC 坐姿猫。 */
  randomizeOccupiedOutlets: (count?: number, seed?: number) => void;
  /** PR #12 §2.7 单桩切 occupied 状态 + 同步 mesh material 红绿(扩展点,本 PR 仅内部用)。 */
  setOutletOccupied: (index: number, occupied: boolean) => void;
  /** PR #13 新增:静态地形 AABB 列表(书架+四人桌+柱子),供 SharedState/minimap 画地形。rebuildTableZone 不影响(引用稳定)。 */
  terrain: Array<{ x: number; z: number; w: number; d: number; kind: 'shelf' | 'table' | 'column' }>;
  /** PR #16 B:暴露 NPC mesh 数组,供 NpcMeshManager 创建头顶箭头 + 同步位置(引用稳定,restart 原地刷新)。 */
  getNpcMeshes: () => THREE.Group[];
}

/** 占位椅:座面 + 靠背(靠背在远离桌子一侧,axis=椅子朝向所在轴)。 */
const chairMat = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.7, metalness: 0 });
function createChair(side: 1 | -1, axis: 'x' | 'z'): THREE.Group {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), chairMat);
  seat.position.y = 0.225;
  g.add(seat);
  const back = new THREE.Mesh(
    axis === 'x' ? new THREE.BoxGeometry(0.08, 0.55, 0.45) : new THREE.BoxGeometry(0.45, 0.55, 0.08),
    chairMat,
  );
  if (axis === 'x') back.position.set(side * 0.24, 0.7, 0);
  else back.position.set(0, 0.7, side * 0.24);
  g.add(back);
  return g;
}

/** 坐姿占位猫(省略眼/尾,背面视角为主):身体微压扁,五色皮毛轮换。 */
const FUR_COLORS = [0xe8913a, 0x8a8a8a, 0x3a3a3a, 0xf0e6d2, 0x6b4a2a];
const furMatCache = new Map<number, THREE.MeshStandardMaterial>();
function furMat(color: number): THREE.MeshStandardMaterial {
  let m = furMatCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0 });
    furMatCache.set(color, m);
  }
  return m;
}
function createSeatedCat(furColor: number, rotY: number): THREE.Group {
  const cat = new THREE.Group();
  const fur = furMat(furColor);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.3, 4, 10), fur);
  body.scale.y = 0.8;
  body.position.y = 0.33;
  cat.add(body);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 8), fur);
    ear.position.set(0.13 * s, 0.62, 0);
    ear.rotation.z = -0.18 * s;
    cat.add(ear);
  }
  cat.rotation.y = rotY;
  return cat;
}

/** 占位猫:胶囊身 + 圆锥耳 + 球眼 + 翘尾,面向 -z(书库深处)。 */
function createPlaceholderCat(): THREE.Group {
  const cat = new THREE.Group();
  cat.name = 'placeholderPlayer';
  const fur = new THREE.MeshStandardMaterial({ color: 0xe8913a, roughness: 0.7, metalness: 0 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.45, 4, 12), fur);
  body.position.y = 0.505;
  cat.add(body);

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 8), fur);
    ear.position.set(0.16 * side, 1.08, 0);
    ear.rotation.z = -0.18 * side;
    cat.add(ear);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), black);
    eye.position.set(0.11 * side, 0.72, -0.235);
    cat.add(eye);
  }

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.5, 8), fur);
  tail.position.set(0, 0.42, 0.32);
  tail.rotation.x = -0.8;
  cat.add(tail);

  cat.traverse(obj => { obj.castShadow = true; });
  cat.position.set(SPAWN.x, 0, SPAWN.z);
  return cat;
}

/** 程序化书架视觉;保留静态占位接口,供 GLB 异步替换。 */
function buildShelfPlaceholder(dim: { w: number; h: number; d: number }): THREE.Group {
  return createProceduralBookshelf(dim, 17);
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
    else if (mat) mat.dispose();
  });
}

// ── GLB async swap-assist ─────────────────────────────────────────────────
// 占位 + GLB swap 记录 + 静态碰撞体:静态 placements 一次构完,studyTable 进 tableZone。
interface Entry { placeholder: THREE.Object3D; x: number; z: number; rotY: number; }

export function createLibraryScene(params: DebugParams = DEFAULT_DEBUG_PARAMS): LibraryScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xedeae2);

  // Floor — 实拍:浅灰米色抛光地,强反光
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_H),
    new THREE.MeshStandardMaterial({ color: 0xc9c4b4, roughness: 0.3, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Lighting — 中性白为主 + 东侧窗墙冷日光(≤4 active point lights)
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  scene.add(new THREE.HemisphereLight(0xf6f8fa, 0x8f8672, 0.5));
  const daylight = new THREE.DirectionalLight(0xdfe9ff, 0.45);
  daylight.position.set(30, 12, -3); // 东窗日光
  scene.add(daylight);
  const neutralHue = 0xfff4e2;
  for (const [x, z] of ([[0, -8], [0, 8], [10, -3]] as Array<[number, number]>)) {
    const pl = new THREE.PointLight(neutralHue, 0.55, 14, 2.0);
    pl.position.set(x, 4, z);
    scene.add(pl);
  }

  // 东墙 = 窗墙:发光面 + 竖梃(非碰撞体,场地边界已 clamp)
  const windowGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 2.2),
    new THREE.MeshBasicMaterial({ color: 0xeaf4ff }),
  );
  windowGlow.rotation.y = -Math.PI / 2;
  windowGlow.position.set(HALF_W - 0.05, 1.9, -3);
  scene.add(windowGlow);
  const mullionMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.5, metalness: 0.3 });
  for (const z of [-9, -6, -3, 0, 3]) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.1), mullionMat);
    mullion.position.set(HALF_W - 0.07, 1.9, z);
    scene.add(mullion);
  }

  // 墙壁占位:古典深胡桃木色(视觉;碰撞由 controller 场地 clamp 承担)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75, metalness: 0 });
  const WALL_H = 3.2;
  const WALL_T = 0.2;
  // 按 layout.room 生成:北/南/西整面墙,东墙留窗洞 z∈[-9,3](窗墙)
  const wallSegs: Array<[number, number, number, number]> = [
    [0, -HALF_H + WALL_T / 2, ROOM_W, WALL_T],                    // 北(实墙)
    [0, HALF_H - WALL_T / 2, ROOM_W, WALL_T],                     // 南
    [-HALF_W + WALL_T / 2, 0, WALL_T, ROOM_H],                    // 西
    [HALF_W - WALL_T / 2, (3 + HALF_H) / 2, WALL_T, Math.max(0, HALF_H - 3)],   // 东-南段(窗 z∈[-9,3] 以南)
    [HALF_W - WALL_T / 2, (-9 - HALF_H) / 2, WALL_T, Math.max(0, HALF_H - 9)],  // 东-北段
  ];
  for (const [cx, cz, w, d] of wallSegs) {
    if (d <= 0) continue;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
    // 下沉 0.01:墙底埋入地板、墙顶低于天花板,消除两处共面 z-fighting(闪烁)
    wall.position.set(cx, WALL_H / 2 - 0.01, cz);
    scene.add(wall);
  }
  // 东窗下槛 + 窗上楣(位置跟随东墙)
  const sill = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, 0.8, 12), wallMat);
  sill.position.set(HALF_W - 0.1, 0.4, -3);
  scene.add(sill);
  const header = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, 0.4, 12), wallMat);
  header.position.set(HALF_W - 0.1, 3.2, -3);
  scene.add(header);

  // PR #13 #7 天花板:米黄,顶到墙高 3.2m(朝下)。debug overlay 加 top-down 相机时需 toggle visible(留 PR #14)。
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xe6d5a8, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;  // 朝下
  ceiling.position.y = WALL_H;       // 顶到墙高
  scene.add(ceiling);

  // PR #13 #7 北/南/西三面墙各 2 个发光窗(复用东墙 pattern:发光 plane + 竖梃 3 根)。
  // 竖梃沿墙轴方向偏移:rotY=0(N/S 墙,窗宽沿 x)→ x 偏移;rotY=π/2(西墙,窗宽沿 z)→ z 偏移。
  // 发光面用 DoubleSide —— 南墙窗 rotY=0 面朝外,单面材质从室内不可见。
  const windowGlowMat = new THREE.MeshBasicMaterial({ color: 0xeaf4ff, side: THREE.DoubleSide });
  const windowConfigs: Array<{ pos: [number, number, number]; rotY: number; w: number; h: number }> = [
    { pos: [-3, 1.9, -HALF_H + 0.1], rotY: 0, w: 4, h: 2 },      // 北 1
    { pos: [3, 1.9, -HALF_H + 0.1], rotY: 0, w: 4, h: 2 },       // 北 2
    { pos: [-3, 1.9, HALF_H - 0.1], rotY: 0, w: 4, h: 2 },       // 南 1
    { pos: [3, 1.9, HALF_H - 0.1], rotY: 0, w: 4, h: 2 },        // 南 2
    { pos: [-HALF_W + 0.1, 1.9, -3], rotY: Math.PI / 2, w: 4, h: 2 },  // 西 1
    { pos: [-HALF_W + 0.1, 1.9, 3], rotY: Math.PI / 2, w: 4, h: 2 },   // 西 2
  ];
  for (const cfg of windowConfigs) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(cfg.w, cfg.h), windowGlowMat);
    glow.position.set(...cfg.pos);
    glow.rotation.y = cfg.rotY;
    scene.add(glow);
    for (let i = -1; i <= 1; i++) {
      const localOffset = i * (cfg.w / 3);
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.06, cfg.h, 0.1), mullionMat);
      if (cfg.rotY === 0) mullion.position.set(cfg.pos[0] + localOffset, cfg.pos[1], cfg.pos[2]);
      else mullion.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2] + localOffset);
      scene.add(mullion);
    }
  }

  // ── 静态 placements:书架/柱/窗边桌(只构一次;壁插/端板盒由随机电位接管)──────────
  const staticPlacements = layoutStatic().placements;
  if (layoutStatic().ignoredKinds.length) {
    console.log(`[Layout] 忽略 legacy placements(kind 由 outlets 随机参数接管): ${layoutStatic().ignoredKinds.join(', ')}`);
  }

  const placementsByKind = new Map<ModelKind, Entry[]>();
  (Object.keys(MODEL_PATHS) as ModelKind[]).forEach(k => {
    // studyTable / studyTable-charge 走 tableZone 通路,不进静态 placementsByKind(GLB swap 同样走 tableZone)
    if (k === 'studyTable' || k === 'studyTable-charge') { placementsByKind.set(k, []); return; }
    placementsByKind.set(k, []);
  });

  // colliders:controller 持引用,通过 .length=0 + push 原地刷新
  const colliders: THREE.Box3[] = [];
  const staticColliders: THREE.Box3[] = [];   // 永驻;rebuild 不动
  const tableColliders: THREE.Box3[] = [];     // 每次 rebuild 清空重建
  const COLLIDER_KINDS = new Set<ModelKind>(['bookshelf', 'column', 'studyTable', 'studyTable-charge', 'readingTable', 'wallBlock']);

  // Box3Helper:静态 + 桌区各自维护,scene.add 通常 visible=false
  let showHelpers = false;
  const staticHelpers: THREE.Box3Helper[] = [];
  const tableHelpers: THREE.Box3Helper[] = [];
  const HELPER_COLOR_STATIC = 0x00aaff;
  const HELPER_COLOR_TABLE = 0x00ff44;

  for (const p of staticPlacements) {
    const dim = MODEL_DIMS[p.kind];
    const placeholder = p.kind === 'bookshelf'
      ? buildShelfPlaceholder(dim)
      : new THREE.Mesh(
          new THREE.BoxGeometry(dim.w, dim.h, dim.d),
          new THREE.MeshStandardMaterial({ color: PLACEHOLDER_COLOR[p.kind], roughness: 0.6, metalness: 0 }),
        );
    if (placeholder instanceof THREE.Mesh) placeholder.position.set(p.x, dim.h / 2, p.z);
    else placeholder.position.set(p.x, 0, p.z);
    placeholder.rotation.y = p.rotY ?? 0;
    scene.add(placeholder);
    placementsByKind.get(p.kind)!.push({
      placeholder,
      x: p.x,
      z: p.z,
      rotY: p.rotY ?? 0,
    });

    if (COLLIDER_KINDS.has(p.kind)) {
      const rotated = Math.abs(Math.abs(p.rotY ?? 0) - Math.PI / 2) < 0.01;
      const ew = rotated ? dim.d : dim.w;
      const ed = rotated ? dim.w : dim.d;
      const b = new THREE.Box3(
        new THREE.Vector3(p.x - ew / 2, 0, p.z - ed / 2),
        new THREE.Vector3(p.x + ew / 2, dim.h, p.z + ed / 2),
      );
      staticColliders.push(b);
      const h = new THREE.Box3Helper(b, HELPER_COLOR_STATIC);
      h.visible = false;
      scene.add(h);
      staticHelpers.push(h);
    }
  }

  // PR #12 §2.7 电位材质:空=绿/占=红,被 NPC 占位时切换 mesh.material
  const outletMatEmpty = new THREE.MeshStandardMaterial({
    color: 0x0a3318,
    emissive: 0x2dff7a,
    emissiveIntensity: 1.2,
    roughness: 0.4,
    metalness: 0,
  });
  const outletMatOccupied = new THREE.MeshStandardMaterial({
    color: 0x33100a,
    emissive: 0xff4d4d,
    emissiveIntensity: 1.2,
    roughness: 0.4,
    metalness: 0,
  });

  // PR #13 #4:每个 outlet 对应一个 mesh 数组(柱电位/端板/壁插 = 单元素,桌电位 = 双元素)。
  // 与 outletPositions 同序;setOutletOccupied / randomizeOccupiedOutlets 遍历 group 全切色。
  const outletMeshGroups: THREE.Mesh[][] = [];
  // PR #13 #4:table-level outlet 的 4 个座位 key(非桌 outlet 为 null)。
  // occupied 由 freeSeats 推导:4 椅都坐猫 = 占(红),1-3 空 = 空(绿)。
  const tableOutletSeatKeys: (string[] | null)[] = [];
  // ★ 摸奖桌 outlet:恒空(不参与座位推导 / NPC 随机占用)。TODO: 摸奖机制 — 走近才能看绿桩,
  // 对面 2 空位必绿,1-3 空位几率。
  const chargeOutletIndexes = new Set<number>();

  // 每局随机电位 draw(seed:null → 每局随机;数字 → 复现;与编辑器模拟器同算法)
  const outletDraw = drawOutletSpots();
  console.log(`[Layout] outlets seed=${outletDraw.seed} · 柱 ${outletDraw.columns.length}/${layoutColumns().length} · 墙 ${outletDraw.walls.length} · 总桩 ${layoutTables().length + outletDraw.columns.length + outletDraw.walls.length}`);

  // 柱电位:绿方块在柱面低位(face 朝房间中心,与编辑器模拟一致),mesh 常驻 scene
  const columnOutletGeo = new THREE.BoxGeometry(0.02, 0.25, 0.25);
  const columnOutletMeshes: THREE.Mesh[] = [];
  for (const c of outletDraw.columns) {
    const m = new THREE.Mesh(columnOutletGeo, outletMatEmpty);
    m.position.set(c.x + c.face! * (MODEL_DIMS.column.w / 2 + 0.01), COLUMN_OUTLET_Y, c.z);
    scene.add(m);
    columnOutletMeshes.push(m);
  }

  // 墙壁插:与柱/桌桩同样参与 NPC 占用,材质用 outletMatEmpty(初始绿),
  // NPC 占用时由 setOutletOccupied 切到 outletMatOccupied(红)。
  const wallSocketGeo = new THREE.BoxGeometry(MODEL_DIMS.wallSocket.w, MODEL_DIMS.wallSocket.h, MODEL_DIMS.wallSocket.d);
  const wallSocketMeshes: THREE.Mesh[] = [];
  for (const w of outletDraw.walls) {
    const m = new THREE.Mesh(wallSocketGeo, outletMatEmpty);
    m.position.set(w.x, MODEL_DIMS.wallSocket.h / 2, w.z);
    scene.add(m);
    wallSocketMeshes.push(m);
  }

  // PR #12 §2.5.4 / PR #13 #3:NPC 占位坐姿猫(createSeatedCat,随机毛色+朝向),
  // 放在选中桩的 (x, 0.45, z+0.6)。换 GLB 时只改 createSeatedCat 函数体。
  const npcMeshes: THREE.Group[] = [];
  const NPC_SEED = Math.floor(Math.random() * 0x7fffffff) | 0;  // 每局不同

  // ── 窗边 readingTable 座位:静态(2 人桌,西侧椅)──
  const SEAT_OFFSETS = [-0.45, 0.45];
  {
    const readingTablePlacements = staticPlacements.filter(p => p.kind === 'readingTable');
    let furIdx = 0;
    for (const p of readingTablePlacements) {
      for (const zo of SEAT_OFFSETS) {
        const sx = 13.5;
        const sz = p.z + zo;
        const chair = createChair(-1, 'x');
        chair.position.set(sx, 0, sz);
        scene.add(chair);
        const cb = new THREE.Box3(
          new THREE.Vector3(sx - 0.225, 0, sz - 0.225),
          new THREE.Vector3(sx + 0.225, 0.9, sz + 0.225),
        );
        staticColliders.push(cb);
        const h = new THREE.Box3Helper(cb, HELPER_COLOR_STATIC);
        h.visible = false;
        scene.add(h);
        staticHelpers.push(h);
        const isFree = p.z === -2 && zo === 0.45;
        if (!isFree) {
          const cat = createSeatedCat(FUR_COLORS[furIdx++ % FUR_COLORS.length], -Math.PI / 2);
          cat.position.set(sx, 0.45, sz);
          scene.add(cat);
        }
      }
    }
  }

  // ── 玩家 + tableZone Group(桌椅猫重建时不碰玩家)──
  const player = createPlaceholderCat();
  scene.add(player);

  const tableZone = new THREE.Group();
  tableZone.name = 'tableZone';
  scene.add(tableZone);

  // 记 studyTable 的 GLB swap entries(每次 rebuild 也清空重建;若有 GLB 已加载,
  // 复用已加载的 template Group 来 clone —— 此处简化:每次新 loader.loadAsync)。
  // 当前 jam 期 GLB 还没落盘,studyTable placeholder 重建走"拿同一份 dim 做 Mesh"即可。
  // 将来若启用 studyTable GLB,把 template 缓存于 closure 外,rebuild 时 clone 复用。
  let studyTableGlbTemplate: THREE.Group | null = null;
  // studyTable 的 GLB 也得能 swap:这里把它单独拎出来异步加载,与静态 GLB 解耦。
  {
    const kind: ModelKind = 'studyTable';
    loadGlbNormalized(MODEL_PATHS[kind], MODEL_DIMS[kind].h)
      .then((template: THREE.Group) => {
        const box = new THREE.Box3().setFromObject(template);
        const cx = (box.min.x + box.max.x) / 2;
        const cz = (box.min.z + box.max.z) / 2;
        template.position.x -= cx;
        template.position.z -= cz;
        studyTableGlbTemplate = template;
        // 加载到的那刻,把桌区当前 placeholder 全替成 GLB clone
        rebuildTableZone(currentParams);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[LibraryScene] ${MODEL_PATHS[kind]} not loaded; placeholder kept (${msg})`);
      });
  }

  // ── 桌区构建器(静态部分构完后调用一次,rebuild 时再调用)──
  // 空位 key = tableIdx(placements 顺序),si(侧-1[xo-0.45=0, +0.45=1], 侧+1[2, 3])
  // 空位集合由 seed 化 RNG 散布 —— 拖 GUI slider 时确定性重算。
  let freeSeats: Set<string> = computeFreeSeats(params.freeSeatCount, params.freeSeed);
  let currentParams: DebugParams = params;
  let furIdx = 0;
  const outletPositions: Array<{ x: number; z: number; occupied: boolean; occupiable: boolean }> = [];

  function buildOneStudyTable(p: Placement, tableIdx: number): void {
    const isCharge = p.kind === 'studyTable-charge';
    const dim = MODEL_DIMS.studyTable;

    // 桌 mesh
    const tableMesh: THREE.Object3D = studyTableGlbTemplate
      ? (() => {
          const m = studyTableGlbTemplate!.clone(true);
          m.position.set(p.x, 0, p.z);
          m.rotation.y = p.rotY ?? 0;
          return m;
        })()
      : (() => {
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(dim.w, dim.h, dim.d),
            new THREE.MeshStandardMaterial({
              color: PLACEHOLDER_COLOR.studyTable,
              roughness: 0.6,
              metalness: 0,
              // ★ 摸奖桌:桌面微绿光,肉眼可辨
              ...(isCharge ? { emissive: 0x0d3a1e, emissiveIntensity: 0.55 } : {}),
            }),
          );
          mesh.position.set(p.x, dim.h / 2, p.z);
          mesh.rotation.y = p.rotY ?? 0;
          return mesh;
        })();
    tableZone.add(tableMesh);

    // ★ 摸奖桌:桌面四周绿色轮廓线
    if (isCharge) {
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(dim.w + 0.05, dim.h + 0.02, dim.d + 0.05)),
        new THREE.LineBasicMaterial({ color: 0x2dff7a }),
      );
      edge.position.copy(tableMesh.position);
      edge.rotation.y = tableMesh.rotation.y;
      tableZone.add(edge);
    }

    // 桌 collider(桌本身)
    const rotated = Math.abs(Math.abs(p.rotY ?? 0) - Math.PI / 2) < 0.01;
    const ew = rotated ? dim.d : dim.w;
    const ed = rotated ? dim.w : dim.d;
    const tableBox = new THREE.Box3(
      new THREE.Vector3(p.x - ew / 2, 0, p.z - ed / 2),
      new THREE.Vector3(p.x + ew / 2, dim.h, p.z + ed / 2),
    );
    tableColliders.push(tableBox);
    pushTableHelper(tableBox);

    // 桌面中线 2 电位相互独立(左半/右半各 2 把椅子)
    // outletA: xo=-0.45 → 对应 si=0,1;outletB: xo=+0.45 → 对应 si=2,3
    // 桌整体朝向:rotY=90° 时桌+电位+椅+猫整体旋转(长边沿 z)
    const tableRot = p.rotY ?? 0;
    const cosR = Math.cos(tableRot);
    const sinR = Math.sin(tableRot);
    const tableH = dim.h;
    const studyOutletIdxs: number[] = [];
    for (let oi = 0; oi < STUDY_OUTLET_OFFSETS.length; oi++) {
      const ox = STUDY_OUTLET_OFFSETS[oi];
      const sq = new THREE.Mesh(studyOutletGeo, outletMatEmpty);
      sq.position.set(p.x + ox * cosR, tableH + 0.011, p.z + ox * sinR);
      tableZone.add(sq);
      outletPositions.push({ x: p.x + ox * cosR, z: p.z + ox * sinR, occupied: false, occupiable: true });
      outletMeshGroups.push([sq]);
      const outletIdx = outletPositions.length - 1;
      studyOutletIdxs.push(outletIdx);
      if (isCharge) chargeOutletIndexes.add(outletIdx);
      // push 顺序:side=-1: xo=-0.45(si0),xo=+0.45(si1);side=+1: xo=-0.45(si2),xo=+0.45(si3)
      // 本 outlet 对应同 xo 的 2 把椅子:oi=0(xo=-0.45)→ si0,si2;oi=1(xo=+0.45)→ si1,si3
      const keysForOutlet = [`${tableIdx},${oi}`, `${tableIdx},${oi + 2}`];
      tableOutletSeatKeys.push(keysForOutlet);
    }

    // 4 椅 + 4 座位猫(椅位局部偏移 (xo, side*seatSideDist) 随桌整体旋转)
    let si = 0;
    const seatKeys: string[] = [];
    for (const side of [-1, 1] as const) {
      for (const xo of SEAT_OFFSETS) {
        const key = `${tableIdx},${si}`;
        seatKeys.push(key);
        const lx = xo;
        const lz = side * DEFAULT_SEAT_SIDE_DIST;
        const sx = p.x + lx * cosR - lz * sinR;
        const sz = p.z + lx * sinR + lz * cosR;
        // 靠背方向 = 旋转后的"远离桌子"向量:局部 (0, side) 旋转 rot →
        // x 分量 -side·sin,z 分量 side·cos;sideEff 取该分量符号,靠背朝外
        const chairAxis: 'x' | 'z' = Math.abs(sinR) > 0.5 ? 'x' : 'z';
        const sideEff: 1 | -1 = chairAxis === 'x'
          ? (sinR > 0 ? -side as 1 | -1 : side)
          : (cosR >= 0 ? side : -side as 1 | -1);
        const chair = createChair(sideEff, chairAxis);
        chair.position.set(sx, 0, sz);
        tableZone.add(chair);
        const cb = new THREE.Box3(
          new THREE.Vector3(sx - 0.225, 0, sz - 0.225),
          new THREE.Vector3(sx + 0.225, 0.9, sz + 0.225),
        );
        tableColliders.push(cb);
        pushTableHelper(cb);
        if (!freeSeats.has(key)) {
          const cat = createSeatedCat(FUR_COLORS[furIdx++ % FUR_COLORS.length], tableRot + (side === 1 ? 0 : Math.PI));
          cat.position.set(sx, 0.45, sz);
          tableZone.add(cat);
        }
        si++;
      }
    }
    // 每桌 2 独立 outlet,每个对应桌半边 2 把椅子;occupied 由 randomizeOccupiedOutlets 决定
    // ★ 摸奖桌 2 个 outlet 都恒空(绿)— 在 randomizeOccupiedOutlets 中跳过
  }

  const studyOutletGeo = new THREE.BoxGeometry(0.2, 0.02, 0.2);

  function pushTableHelper(b: THREE.Box3): void {
    const h = new THREE.Box3Helper(b, HELPER_COLOR_TABLE);
    h.visible = showHelpers;
    scene.add(h);
    tableHelpers.push(h);
  }

  function rebuildTableZone(p: DebugParams): void {
    currentParams = p;
    // 拆桌区:remove 全部 child + dispose + 清 tableColliders + 清 tableHelpers
    while (tableZone.children.length) {
      const c = tableZone.children[0];
      tableZone.remove(c);
      disposeObject(c);
    }
    tableColliders.length = 0;
    for (const h of tableHelpers) scene.remove(h);
    tableHelpers.length = 0;
    furIdx = 0; // 重建时毛色从头排起,前后排布稳定
    freeSeats = computeFreeSeats(p.freeSeatCount, p.freeSeed);

    const tablePlacements = layoutTables();

    // 重算 outlets(原地刷新,facade 持同一引用)+ 同步 outletMeshGroups / tableOutletSeatKeys。
    // 顺序:随机柱 → 随机壁插 先推,studyTable 由 buildOneStudyTable 接着推(保持同序)。
    // 注意:清空必须先于桌构建循环 —— 否则桌 outlet 会被 length=0 清掉(PR #12 遗留,PR #13 #4 修复)。
    outletPositions.length = 0;
    outletMeshGroups.length = 0;
    tableOutletSeatKeys.length = 0;
    chargeOutletIndexes.clear();
    let ciMesh = 0;
    for (const c of outletDraw.columns) {
      outletPositions.push({ x: c.x + c.face! * (MODEL_DIMS.column.w / 2 + 0.01), z: c.z, occupied: false, occupiable: true });
      outletMeshGroups.push([columnOutletMeshes[ciMesh++]]);
      tableOutletSeatKeys.push(null);
    }
    let wiMesh = 0;
    for (const w of outletDraw.walls) {
      outletPositions.push({ x: w.x, z: w.z, occupied: false, occupiable: true });
      // 壁插现在也参与 NPC 占用(mesh-backed),与柱/桌桩同套 setOutletOccupied 切色
      outletMeshGroups.push([wallSocketMeshes[wiMesh++]]);
      tableOutletSeatKeys.push(null);
    }
    // study table outlets 由 buildOneStudyTable 内 push(在柱/壁插之后)

    for (const [ti, tp] of tablePlacements.entries()) buildOneStudyTable(tp, ti);

    // 合并到 controller 持引用的 colliders
    colliders.length = 0;
    colliders.push(...staticColliders, ...tableColliders);

    console.log(`[debug] rebuild table zone: tables=${tablePlacements.length}, outlets=${outletPositions.length}`);
  }

  // 异步 GLB swap:静态 kinds(非 studyTable)
  (Object.keys(MODEL_PATHS) as ModelKind[]).forEach(kind => {
    if (kind === 'studyTable' || kind === 'studyTable-charge') return; // 走 tableZone 通路(上面已单独 loader)
    loadGlbNormalized(MODEL_PATHS[kind], MODEL_DIMS[kind].h)
      .then((template: THREE.Group) => {
        const box = new THREE.Box3().setFromObject(template);
        const cx = (box.min.x + box.max.x) / 2;
        const cz = (box.min.z + box.max.z) / 2;
        template.position.x -= cx;
        template.position.z -= cz;

        for (const entry of placementsByKind.get(kind)!) {
          const model = template.clone(true);
          model.position.set(entry.x, 0, entry.z);
          model.rotation.y = entry.rotY;
          scene.add(model);
          scene.remove(entry.placeholder);
          disposeObject(entry.placeholder);
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[LibraryScene] ${MODEL_PATHS[kind]} not loaded; placeholder kept (${msg})`);
      });
  });

  // 首次构建桌区
  rebuildTableZone(params);

  function setColliderHelpersVisible(visible: boolean): void {
    showHelpers = visible;
    for (const h of staticHelpers) h.visible = visible;
    for (const h of tableHelpers) h.visible = visible;
  }

  /** PR #12 §2.7 / PR #13 #4:单桩切 occupied + 遍历 mesh group 全切色(桌桩 2 个 mesh 同步)。 */
  function setOutletOccupied(index: number, occupied: boolean): void {
    if (index < 0 || index >= outletPositions.length) return;
    outletPositions[index].occupied = occupied;
    for (const m of outletMeshGroups[index]) {
      m.material = occupied ? outletMatOccupied : outletMatEmpty;
    }
  }

  /**
   * PR #12 §2.5/§2.5.4 / PR #13 #3+#4 seeded RNG NPC 占位。
   * 重置全部 outlets.occupied=false + 回绿;table-level outlet 的 occupied 由 4 座位推导
   * (4 椅都坐猫 = 红,1-3 空 = 绿,不参与随机);再从非桌 mesh-backed 桩里用 mulberry32 +
   * Fisher-Yates 挑 count 个标红;清旧 NPC 猫,新坐姿猫放 (o.x, 0.45, o.z + 0.6)。
   * 壁插自 NPC-也-抢 改为也参与随机占位(已 mesh-backed)。
   */
  function randomizeOccupiedOutlets(count: number = CONFIG.npc.count, seed: number = NPC_SEED): void {
    // 重置 occupied + 回绿 + 清旧 NPC 猫
    for (let i = 0; i < outletPositions.length; i++) {
      outletPositions[i].occupied = false;
      for (const m of outletMeshGroups[i]) m.material = outletMatEmpty;
    }
    // table-level outlet:绿桩总数 = round(自习桌数 × rate),绿桩优先落在有空椅那一侧
    // 一张桌 2 个 outlet(左/右半)— 有空椅的 outlet 才有资格变绿,无空椅的必红
    // ★ 摸奖桌 2 outlet 都恒绿跳过
    const studyOutletIdxs: number[] = [];
    for (let i = 0; i < outletPositions.length; i++) {
      if (tableOutletSeatKeys[i] && !chargeOutletIndexes.has(i)) {
        studyOutletIdxs.push(i);
      }
    }
    const tableN = Math.ceil(studyOutletIdxs.length / 2);
    const greenCount = Math.min(
      studyOutletIdxs.length,
      Math.max(0, Math.round(tableN * (LAYOUT.outlets.studyTableGreenRate ?? CONFIG.charging.studyTableGreenRate))),
    );
    if (studyOutletIdxs.length > 0 && greenCount > 0) {
      const rng = mulberry32(seed ^ 0x5eed);
      // 候选只取有空椅的 outlet:2 椅任一空就 qualify
      const candidates = studyOutletIdxs.filter(i => {
        const keys = tableOutletSeatKeys[i]!;
        return keys.some(k => freeSeats.has(k));
      });
      if (candidates.length === 0) {
        for (const i of studyOutletIdxs) {
          outletPositions[i].occupied = true;
          for (const m of outletMeshGroups[i]) m.material = outletMatOccupied;
        }
      } else {
        // 无权重(等概率)随机选 greenCount 个,但自然偏向有空椅的 outlet
        const indices = candidates.map((_, k) => k);
        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        const chosen = new Set<number>();
        for (let k = 0; k < Math.min(greenCount, indices.length); k++) chosen.add(candidates[indices[k]]);
        for (const i of studyOutletIdxs) {
          if (!chosen.has(i)) {
            outletPositions[i].occupied = true;  // 红
            for (const m of outletMeshGroups[i]) m.material = outletMatOccupied;
          }
        }
      }
    } else {
      for (const i of studyOutletIdxs) {
        outletPositions[i].occupied = true;
        for (const m of outletMeshGroups[i]) m.material = outletMatOccupied;
      }
    }
    npcMeshes.forEach(m => scene.remove(m));
    npcMeshes.length = 0;

    // 非桌 mesh-backed 桩(柱 + 壁插)可被随机占位;桌桩由 greenCount 总数锁定
    const meshBacked: number[] = [];
    for (let i = 0; i < outletMeshGroups.length; i++) {
      if (outletMeshGroups[i].length > 0 && !tableOutletSeatKeys[i]) meshBacked.push(i);
    }
    if (meshBacked.length === 0) return;

    // Fisher-Yates 洗牌取前 count 个 — 同 (count, seed) 永远产同一份分布
    const rng = mulberry32(seed);
    for (let i = meshBacked.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [meshBacked[i], meshBacked[j]] = [meshBacked[j], meshBacked[i]];
    }
    const chosenN = Math.min(count, meshBacked.length);
    for (let k = 0; k < chosenN; k++) {
      const idx = meshBacked[k];
      outletPositions[idx].occupied = true;
      for (const m of outletMeshGroups[idx]) m.material = outletMatOccupied;
      const o = outletPositions[idx];
      const npc = createSeatedCat(FUR_COLORS[Math.floor(rng() * FUR_COLORS.length)], rng() * Math.PI * 2);
      // 桩旁偏前:端板盒/柱电位贴柱面,偏移 0.8(柱半宽 0.45 + 猫半宽 0.3 + margin)避免视觉贴柱
      npc.position.set(o.x, 0.45, o.z + 0.8);
      scene.add(npc);
      npcMeshes.push(npc);
    }
  }
  // 启动调用一次,确保每局可复现
  randomizeOccupiedOutlets();

  // PR #13 暴露 terrain:静态地形 AABB(书架 + 柱子 + 四人桌),供 minimap 画地形(迷宫感)。
  // 静态数组,rebuildTableZone 不改 studyTable 数量与中心位置 → 引用稳定。readingTable 本 PR 不进 terrain。
  const terrain: LibraryScene['terrain'] = [];
  for (const p of staticPlacements) {
    if (p.kind === 'bookshelf') {
      const dim = MODEL_DIMS.bookshelf;
      const rotated = Math.abs(Math.abs(p.rotY ?? 0) - Math.PI / 2) < 0.01;  // 与 collider 同规则
      terrain.push({ x: p.x, z: p.z, w: rotated ? dim.d : dim.w, d: rotated ? dim.w : dim.d, kind: 'shelf' });
    } else if (p.kind === 'column') {
      const dim = MODEL_DIMS.column;
      terrain.push({ x: p.x, z: p.z, w: dim.w, d: dim.d, kind: 'column' });
    }
  }
  for (const tp of layoutTables()) {
    const dim = MODEL_DIMS.studyTable;
    terrain.push({ x: tp.x, z: tp.z, w: dim.w, d: dim.d, kind: 'table' });
  }

  let t = 0;

  return {
    scene,
    player,
    colliders,
    outlets: outletPositions,
    update: (dt: number) => {
      // 电位呼吸脉冲 —— "发光 = 可充电"的视觉语言(空绿 / 占红 同步脉冲)
      t += dt;
      const pulse = 1.1 + 0.6 * Math.sin(t * 3.2);
      outletMatEmpty.emissiveIntensity = pulse;
      outletMatOccupied.emissiveIntensity = pulse;
    },
    rebuildTableZone,
    setColliderHelpersVisible,
    randomizeOccupiedOutlets,
    setOutletOccupied,
    terrain,
    getNpcMeshes: () => npcMeshes,
  };
}
