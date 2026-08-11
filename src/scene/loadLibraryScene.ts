import * as THREE from 'three';
import { loadGlbNormalized } from '../../snippets/loadGlb';
import { CONFIG } from '../game/config';

// ─────────────────────────────────────────────────────────────────────────────
// Library scene (拟真版 v6 — 每张桌各自逆时针旋转 90°;debug overlay 可调)
//
// 实拍视频走线:走廊 → 书架区 → 窗边自习区。场景分三区:
//   东(x>0)   自习区:4 人桌 2 列 × 10 行(横向 2 列、纵向密排);
//             每张桌单独逆时针旋 90° → 长边沿 x、椅在 ±z 两侧
//             84 席坐 77 只占位猫,仅 7 空位 —— "一座难求"的实地氛围
//   西(x<-4)  书架区:3 排沿 Z 向书架,柱网 4 柱/排,豁口错位
//   中        走廊+大堂:x∈[-5.5, 5.8] 南北贯通,出生点在南端 (0, 8.5)
//   东墙      窗墙:发光面+竖梃,冷色 DirectionalLight 模拟日光
//   四周      墙壁占位:古典深胡桃木色(碰撞由 controller 场地 clamp 承担)
//
// 通路设计(玩家直径 0.64m):两列桌间过道 1.4m、桌阵周围走道、桌阵南缘椅间
// ~1.0m —— 主路全部可走;桌间纵向端距 0.56m 故意密排(椅子贴近,非通道)。
//
// 电位宿主三种(视觉语言统一:"发光绿 = 可充电",全部立刻可见):
//   1. 柱电位   —— 绿方块在柱 ±x 面低位
//   2. 端板电位盒 —— 书架排北端柱面上的银灰盒 + 绿点
//   3. 4 人桌电位 —— 桌面中线 2 个绿方块(沿 x ±0.45)
//
// Model loading: placeholders occupy the floor layout immediately; if
// `public/library/*.glb` exists, the GLB swaps in for the placeholder of
// that kind (preserving placement position + rotation). Drop GLBs in and
// reload the dev server — no code changes needed.
//
// Debug overlay (src/debug/overlay.ts):
//   - rowSpacing / seatSideDist sliders → createLibraryScene().rebuildTableZone(p)
//     tear down the study-table Group + colliders, rebuild in place; static
//     geometry (lights/floor/walls/bookcases/readingTables/player) untouched.
//   - showColliders checkbox (+ F key) → Box3Helper overlay for ALL colliders,
//     including the chair AABBs that block passage between rows.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelKind = 'bookshelf' | 'column' | 'studyTable' | 'readingTable' | 'wallSocket';

const MODEL_PATHS: Record<ModelKind, string> = {
  bookshelf:     'library/bookshelf.glb',
  column:        'library/column.glb',
  studyTable:    'library/studyTable.glb',
  readingTable:  'library/readingTable.glb',
  wallSocket:    'library/wallSocket.glb',
};

const MODEL_DIMS: Record<ModelKind, { w: number; h: number; d: number }> = {
  bookshelf:     { w: 3.0, h: 2.4,  d: 0.6 },
  column:        { w: 0.9, h: 3.4,  d: 0.9 },
  studyTable:    { w: 1.8, h: 0.75, d: 1.2 }, // 4 人桌,长边沿 x
  readingTable:  { w: 1.8, h: 0.75, d: 0.9 },
  wallSocket:    { w: 0.3, h: 0.5,  d: 0.12 },
};

const PLACEHOLDER_COLOR: Record<ModelKind, number> = {
  bookshelf:     0xf0ede6, // 实拍:白钢架身
  column:        0xa8825c, // 实拍:木饰面方柱
  studyTable:    0xb08c5e, // 实拍:浅木桌
  readingTable:  0xb08c5e,
  wallSocket:    0x1a2a1a,
};

interface Placement {
  kind: ModelKind;
  x: number;
  z: number;
  rotY?: number;
}

const FLOOR_W = 32;
const FLOOR_D = 24;

// 书架区:3 排 × 4 柱
const STACK_ROW_XS = [-13, -9.5, -6];
const COL_ZS = [-9, -5, -1, 3];
// 每排抽掉的书架段(段中点 z),逐排错位 → 南北穿行被迫 S 形
const ROW_GAP_MID_Z = [-3, 1, -7];
// 北端柱面挂电位盒的排
const END_BOX_ROWS = new Set([0, 2]);

interface PoweredColumn { x: number; z: number; face: 1 | -1; }
interface EndPanelBox { x: number; z: number; }

// 自习区桌阵:2 列(x)× 10 行(z),每张桌单独逆时针旋 90°(长边沿 x)。
// 列距固定(过道已够宽),行距通过 debug overlay 实时调。
const STUDY_COL_XS = [7, 10.2];
const STUDY_ROW_COUNT = 10;
const DEFAULT_ROW_SPACING = 2.36;
const DEFAULT_SEAT_SIDE_DIST = 0.95;
const DEFAULT_FREE_SEAT_COUNT = 6;
const DEFAULT_FREE_SEED = 0;

// 4 人桌电位:桌面中线 2 个(沿 x ±0.45)
const STUDY_OUTLET_OFFSETS = [-0.45, 0.45];
const COLUMN_OUTLET_Y = 0.35;

const SPAWN = { x: 0, z: 8.5 };

/** Debug overlay 可调参数。空位用种子化 RNG 散布,确定性可复现。 */
export interface DebugParams {
  rowSpacing: number;
  seatSideDist: number;
  freeSeatCount: number;
  freeSeed: number;
}

export const DEFAULT_DEBUG_PARAMS: DebugParams = {
  rowSpacing: DEFAULT_ROW_SPACING,
  seatSideDist: DEFAULT_SEAT_SIDE_DIST,
  freeSeatCount: DEFAULT_FREE_SEAT_COUNT,
  freeSeed: DEFAULT_FREE_SEED,
};

/** 由 rowSpacing + rowCount 动态生成 z 坐标,居中以避免越过地板边界。 */
function studyRowZs(rowSpacing: number, rowCount = STUDY_ROW_COUNT): number[] {
  const span = (rowCount - 1) * rowSpacing;
  const startZ = -span / 2;
  return Array.from({ length: rowCount }, (_, i) => startZ + i * rowSpacing);
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
 * 用 seed 确定性地从 80 个自习座位里挑 count 个当空位。
 * Fisher-Yates 洗牌取前 count —— 同 (count, seed) 永远产同一份分布。
 * key 格式与 buildOneStudyTable 一致:`col(0..1),row(0..9),seatIndex(0..3)`
 */
function computeFreeSeats(count: number, seed: number): Set<string> {
  const all: string[] = [];
  for (let ci = 0; ci < STUDY_COL_XS.length; ci++) {
    for (let ri = 0; ri < STUDY_ROW_COUNT; ri++) {
      for (let si = 0; si < 4; si++) {
        all.push(`${ci},${ri},${si}`);
      }
    }
  }
  const rng = mulberry32(seed);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return new Set(all.slice(0, Math.max(0, Math.min(count, all.length))));
}

/** 书架/柱/端板盒/壁插/窗边桌 —— 静态布局,debug rebuild 不动。 */
function buildStaticPlacements(): {
  placements: Placement[];
  poweredColumns: PoweredColumn[];
  endPanelBoxes: EndPanelBox[];
} {
  const placements: Placement[] = [];
  const poweredColumns: PoweredColumn[] = [];
  const endPanelBoxes: EndPanelBox[] = [];

  STACK_ROW_XS.forEach((x, ri) => {
    COL_ZS.forEach((z, ci) => {
      placements.push({ kind: 'column', x, z });
      // 约半数柱子带电位(棋盘分布),face=电位面朝向(±x,指向排间过道)
      if ((ri + ci) % 2 === 0) {
        poweredColumns.push({ x, z, face: ri % 2 === 0 ? 1 : -1 });
      }
      // 柱间放书架段;被抽掉的段 = 东西向豁口
      const midZ = z + 2;
      if (ci < COL_ZS.length - 1 && midZ !== ROW_GAP_MID_Z[ri]) {
        placements.push({ kind: 'bookshelf', x, z: midZ, rotY: Math.PI / 2 });
      }
    });
    if (END_BOX_ROWS.has(ri)) endPanelBoxes.push({ x, z: COL_ZS[0] });
  });

  placements.push(
    { kind: 'readingTable', x: 14.2, z: -6, rotY: Math.PI / 2 },
    { kind: 'readingTable', x: 14.2, z: -2, rotY: Math.PI / 2 },
    // 壁插 ×3(贴墙面,南墙 2 + 西墙 1,常亮)
    { kind: 'wallSocket', x: -8, z: 11.73 },
    { kind: 'wallSocket', x: 14, z: 11.73 },
    { kind: 'wallSocket', x: -15.73, z: 0, rotY: Math.PI / 2 },
  );

  return { placements, poweredColumns, endPanelBoxes };
}

/** 4 人自习桌布局 —— rowSpacing 实时调;静态几何体不动这里。 */
function buildStudyTablePlacements(rowSpacing: number): Placement[] {
  const rows = studyRowZs(rowSpacing);
  const out: Placement[] = [];
  for (const x of STUDY_COL_XS) {
    for (const z of rows) {
      out.push({ kind: 'studyTable', x, z });
    }
  }
  return out;
}

export interface LibraryScene {
  scene: THREE.Scene;
  /** Placeholder cat —— 正式 player entity 进 game/ 后移除。 */
  player: THREE.Group;
  /** 静态+桌区合并碰撞体(玩家与相机共用)。rebuild 时原地刷新,引用稳定。 */
  colliders: THREE.Box3[];
  /** 所有电位位置(柱电位+端板盒+桌电位+壁插),供 SharedState/minimap 消费。 */
  outlets: Array<{ x: number; z: number; occupied: boolean }>;
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

/** 实拍书架两色:白钢架身 + 浅木端板(端板略宽出架身)。 */
function buildShelfPlaceholder(dim: { w: number; h: number; d: number }): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(dim.w, dim.h, dim.d),
    new THREE.MeshStandardMaterial({ color: PLACEHOLDER_COLOR.bookshelf, roughness: 0.55, metalness: 0.1 }),
  );
  body.position.y = dim.h / 2;
  g.add(body);
  const capMat = new THREE.MeshStandardMaterial({ color: 0xb08c5e, roughness: 0.6, metalness: 0 });
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.1, dim.h, dim.d + 0.06), capMat);
    cap.position.set(side * (dim.w / 2 - 0.05), dim.h / 2, 0);
    g.add(cap);
  }
  return g;
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
    new THREE.PlaneGeometry(FLOOR_W, FLOOR_D),
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
  windowGlow.position.set(15.95, 1.9, -3);
  scene.add(windowGlow);
  const mullionMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.5, metalness: 0.3 });
  for (const z of [-9, -6, -3, 0, 3]) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.1), mullionMat);
    mullion.position.set(15.93, 1.9, z);
    scene.add(mullion);
  }

  // 墙壁占位:古典深胡桃木色(视觉;碰撞由 controller 场地 clamp 承担)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75, metalness: 0 });
  const WALL_H = 3.2;
  const WALL_T = 0.2;
  const WALL_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
    // [cx, cz, w, d]
    [0, -12 + WALL_T / 2, FLOOR_W, WALL_T],  // 北(实墙)
    [0, 12 - WALL_T / 2, FLOOR_W, WALL_T],   // 南
    [-16 + WALL_T / 2, 0, WALL_T, FLOOR_D],  // 西
    [16 - WALL_T / 2, 7.5, WALL_T, 9],       // 东-南段(窗 z∈[-9,3] 以南)
    [16 - WALL_T / 2, -10.5, WALL_T, 3],     // 东-北段
  ];
  for (const [cx, cz, w, d] of WALL_SEGMENTS) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
    wall.position.set(cx, WALL_H / 2, cz);
    scene.add(wall);
  }
  // 东窗下槛 + 窗上楣
  const sill = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, 0.8, 12), wallMat);
  sill.position.set(15.9, 0.4, -3);
  scene.add(sill);
  const header = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, 0.4, 12), wallMat);
  header.position.set(15.9, 3.2, -3);
  scene.add(header);

  // PR #13 #7 天花板:米黄,顶到墙高 3.2m(朝下)。debug overlay 加 top-down 相机时需 toggle visible(留 PR #14)。
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xe6d5a8, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, FLOOR_D), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;  // 朝下
  ceiling.position.y = WALL_H;       // 顶到墙高
  scene.add(ceiling);

  // PR #13 #7 北/南/西三面墙各 2 个发光窗(复用东墙 pattern:发光 plane + 竖梃 3 根)。
  // 竖梃沿墙轴方向偏移:rotY=0(N/S 墙,窗宽沿 x)→ x 偏移;rotY=π/2(西墙,窗宽沿 z)→ z 偏移。
  // 发光面用 DoubleSide —— 南墙窗 rotY=0 面朝外,单面材质从室内不可见。
  const windowGlowMat = new THREE.MeshBasicMaterial({ color: 0xeaf4ff, side: THREE.DoubleSide });
  const windowConfigs: Array<{ pos: [number, number, number]; rotY: number; w: number; h: number }> = [
    { pos: [-3, 1.9, -11.9], rotY: 0, w: 4, h: 2 },      // 北 1
    { pos: [3, 1.9, -11.9], rotY: 0, w: 4, h: 2 },       // 北 2
    { pos: [-3, 1.9, 11.9], rotY: 0, w: 4, h: 2 },       // 南 1
    { pos: [3, 1.9, 11.9], rotY: 0, w: 4, h: 2 },        // 南 2
    { pos: [-15.9, 1.9, -3], rotY: Math.PI / 2, w: 4, h: 2 },  // 西 1
    { pos: [-15.9, 1.9, 3], rotY: Math.PI / 2, w: 4, h: 2 },   // 西 2
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

  // ── 静态 placements:书架/柱/端板盒/壁插/窗边桌(只构一次)──────────
  const { placements: staticPlacements, poweredColumns, endPanelBoxes } = buildStaticPlacements();

  const placementsByKind = new Map<ModelKind, Entry[]>();
  (Object.keys(MODEL_PATHS) as ModelKind[]).forEach(k => {
    // studyTable 走 tableZone 通路,不进静态 placementsByKind(GLB swap 同样走 tableZone)
    if (k === 'studyTable') { placementsByKind.set(k, []); return; }
    placementsByKind.set(k, []);
  });

  // colliders:controller 持引用,通过 .length=0 + push 原地刷新
  const colliders: THREE.Box3[] = [];
  const staticColliders: THREE.Box3[] = [];   // 永驻;rebuild 不动
  const tableColliders: THREE.Box3[] = [];     // 每次 rebuild 清空重建
  const COLLIDER_KINDS = new Set<ModelKind>(['bookshelf', 'column', 'studyTable', 'readingTable']);

  // Box3Helper:静态 + 桌区各自维护,scene.add 通常 visible=false
  let showHelpers = false;
  const staticHelpers: THREE.Box3Helper[] = [];
  const tableHelpers: THREE.Box3Helper[] = [];
  const HELPER_COLOR_STATIC = 0x00aaff;
  const HELPER_COLOR_TABLE = 0x00ff44;

  const socketMat = new THREE.MeshStandardMaterial({
    color: PLACEHOLDER_COLOR.wallSocket,
    emissive: 0x2dff7a,
    emissiveIntensity: 0.9,
    roughness: 0.4,
    metalness: 0,
  });

  for (const p of staticPlacements) {
    const dim = MODEL_DIMS[p.kind];
    const placeholder = p.kind === 'bookshelf'
      ? buildShelfPlaceholder(dim)
      : new THREE.Mesh(
          new THREE.BoxGeometry(dim.w, dim.h, dim.d),
          p.kind === 'wallSocket'
            ? socketMat
            : new THREE.MeshStandardMaterial({ color: PLACEHOLDER_COLOR[p.kind], roughness: 0.6, metalness: 0 }),
        );
    if (placeholder instanceof THREE.Mesh) placeholder.position.set(p.x, dim.h / 2, p.z);
    else placeholder.position.set(p.x, 0, p.z);
    placeholder.rotation.y = p.rotY ?? 0;
    scene.add(placeholder);
    if (p.kind !== 'studyTable') {
      placementsByKind.get(p.kind)!.push({
        placeholder,
        x: p.x,
        z: p.z,
        rotY: p.rotY ?? 0,
      });
    }

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

  // PR #13 #4:每个 outlet 对应一个 mesh 数组(柱电位/端板绿点 = 单元素,桌电位 = 双元素,壁插无 mesh = 空数组)。
  // 与 outletPositions 同序;setOutletOccupied / randomizeOccupiedOutlets 遍历 group 全切色。
  const outletMeshGroups: THREE.Mesh[][] = [];
  // PR #13 #4:table-level outlet 的 4 个座位 key(非桌 outlet 为 null)。
  // occupied 由 freeSeats 推导:4 椅都坐猫 = 占(红),1-3 空 = 空(绿)。
  const tableOutletSeatKeys: (string[] | null)[] = [];
  const columnOutletMeshes: THREE.Mesh[] = [];
  const endDotMeshes: THREE.Mesh[] = [];

  // 柱电位:绿方块在柱 ±x 面低位,立刻可见
  const columnOutletGeo = new THREE.BoxGeometry(0.02, 0.25, 0.25);
  for (const c of poweredColumns) {
    const m = new THREE.Mesh(columnOutletGeo, outletMatEmpty);
    m.position.set(c.x + c.face * (MODEL_DIMS.column.w / 2 + 0.01), COLUMN_OUTLET_Y, c.z);
    scene.add(m);
    columnOutletMeshes.push(m);
  }

  // 端板电位盒:银灰盒 + 绿点,立刻可见
  const endBoxGeo = new THREE.BoxGeometry(0.3, 0.4, 0.06);
  const endBoxMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.6 });
  const endDotGeo = new THREE.BoxGeometry(0.15, 0.15, 0.02);
  for (const b of endPanelBoxes) {
    const northFaceZ = b.z - MODEL_DIMS.column.d / 2;
    const boxMesh = new THREE.Mesh(endBoxGeo, endBoxMat);
    boxMesh.position.set(b.x, 1.2, northFaceZ - 0.02);
    scene.add(boxMesh);
    const dot = new THREE.Mesh(endDotGeo, outletMatEmpty);
    dot.position.set(b.x, 1.2, northFaceZ - 0.06);
    scene.add(dot);
    endDotMeshes.push(dot);
  }

  // PR #12 §2.5.4 / PR #13 #3:NPC 占位坐姿猫(createSeatedCat,随机毛色+朝向),
  // 放在选中桩的 (x, 0.45, z+0.6)。换 GLB 时只改 createSeatedCat 函数体。
  const npcMeshes: THREE.Group[] = [];
  const NPC_SEED = 1;

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
  // 空位 key = col(0..1),row(0..9),si(侧-1[xo-0.45=0, +0.45=1], 侧+1[2, 3])
  // 空位集合由 seed 化 RNG 散布 —— 拖 GUI slider 时确定性重算。
  let freeSeats: Set<string> = computeFreeSeats(params.freeSeatCount, params.freeSeed);
  let currentParams: DebugParams = params;
  let furIdx = 0;
  const outletPositions: Array<{ x: number; z: number; occupied: boolean }> = [];

  function buildOneStudyTable(p: Placement, rows: number[]): void {
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
            new THREE.MeshStandardMaterial({ color: PLACEHOLDER_COLOR.studyTable, roughness: 0.6, metalness: 0 }),
          );
          mesh.position.set(p.x, dim.h / 2, p.z);
          mesh.rotation.y = p.rotY ?? 0;
          return mesh;
        })();
    tableZone.add(tableMesh);

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

    // PR #13 #4:桌面中线 2 电位 → 合并成 1 个 table-level outlet(中心 = 桌中心)。
    // 视觉 2 个 mesh 共享同一 occupied 状态;4 座位都坐猫 = 占(红),1-3 空 = 空(绿)。
    const tableH = dim.h;
    outletPositions.push({ x: p.x, z: p.z, occupied: false });
    const outletGroup: THREE.Mesh[] = [];
    for (const ox of STUDY_OUTLET_OFFSETS) {
      const sq = new THREE.Mesh(studyOutletGeo, outletMatEmpty);
      sq.position.set(p.x + ox, tableH + 0.011, p.z);
      tableZone.add(sq);
      outletGroup.push(sq);
    }
    outletMeshGroups.push(outletGroup);
    const outletIdx = outletPositions.length - 1;

    // 4 椅 + 4 座位猫
    const ci = STUDY_COL_XS.indexOf(p.x);
    const ri = rows.indexOf(p.z);
    let si = 0;
    const seatKeys: string[] = [];
    for (const side of [-1, 1] as const) {
      for (const xo of SEAT_OFFSETS) {
        const key = `${ci},${ri},${si}`;
        seatKeys.push(key);
        const sx = p.x + xo;
        const sz = p.z + side * currentParams.seatSideDist;
        const chair = createChair(side, 'z');
        chair.position.set(sx, 0, sz);
        tableZone.add(chair);
        const cb = new THREE.Box3(
          new THREE.Vector3(sx - 0.225, 0, sz - 0.225),
          new THREE.Vector3(sx + 0.225, 0.9, sz + 0.225),
        );
        tableColliders.push(cb);
        pushTableHelper(cb);
        if (!freeSeats.has(key)) {
          const cat = createSeatedCat(FUR_COLORS[furIdx++ % FUR_COLORS.length], side === 1 ? 0 : Math.PI);
          cat.position.set(sx, 0.45, sz);
          tableZone.add(cat);
        }
        si++;
      }
    }
    // 4 座位都坐猫 = 桌桩占(红);任意空椅 = 空(绿)
    const tableOccupied = seatKeys.every(k => !freeSeats.has(k));
    outletPositions[outletIdx].occupied = tableOccupied;
    tableOutletSeatKeys.push(seatKeys);
    if (tableOccupied) {
      for (const m of outletGroup) m.material = outletMatOccupied;
    }
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

    const rows = studyRowZs(p.rowSpacing);
    const tablePlacements = buildStudyTablePlacements(p.rowSpacing);

    // 重算 outlets(原地刷新,facade 持同一引用)+ 同步 outletMeshGroups / tableOutletSeatKeys。
    // 顺序:column/endPanel/壁插 先推,studyTable 由 buildOneStudyTable 接着推(保持同序)。
    // 注意:清空必须先于桌构建循环 —— 否则桌 outlet 会被 length=0 清掉(PR #12 遗留,PR #13 #4 修复)。
    outletPositions.length = 0;
    outletMeshGroups.length = 0;
    tableOutletSeatKeys.length = 0;
    let ciMesh = 0;
    for (const c of poweredColumns) {
      outletPositions.push({ x: c.x + c.face * (MODEL_DIMS.column.w / 2), z: c.z, occupied: false });
      outletMeshGroups.push([columnOutletMeshes[ciMesh++]]);
      tableOutletSeatKeys.push(null);
    }
    let eiMesh = 0;
    for (const b of endPanelBoxes) {
      outletPositions.push({ x: b.x, z: b.z - MODEL_DIMS.column.d / 2, occupied: false });
      outletMeshGroups.push([endDotMeshes[eiMesh++]]);
      tableOutletSeatKeys.push(null);
    }
    for (const p of staticPlacements) {
      if (p.kind === 'wallSocket') {
        outletPositions.push({ x: p.x, z: p.z, occupied: false });
        // 壁插常亮(spec §6.2):无切换 mesh 视图(空数组)
        outletMeshGroups.push([]);
        tableOutletSeatKeys.push(null);
      }
    }
    // study table outlets 由 buildOneStudyTable 内 push(在 column/endPanel/壁插 之后)

    for (const tp of tablePlacements) buildOneStudyTable(tp, rows);

    // 合并到 controller 持引用的 colliders
    colliders.length = 0;
    colliders.push(...staticColliders, ...tableColliders);

    console.log(`[debug] rebuild table zone: rowSpacing=${p.rowSpacing}, seatSideDist=${p.seatSideDist}, tables=${tablePlacements.length}, outlets=${outletPositions.length}`);
  }

  // 异步 GLB swap:静态 kinds(非 studyTable)
  (Object.keys(MODEL_PATHS) as ModelKind[]).forEach(kind => {
    if (kind === 'studyTable') return; // studyTable 走 tableZone 通路(上面已单独 loader)
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
   * 壁插(无切换 mesh)排除在外。
   */
  function randomizeOccupiedOutlets(count: number = CONFIG.npc.count, seed: number = NPC_SEED): void {
    // 重置 occupied + 回绿 + 清旧 NPC 猫
    for (let i = 0; i < outletPositions.length; i++) {
      outletPositions[i].occupied = false;
      for (const m of outletMeshGroups[i]) m.material = outletMatEmpty;
    }
    // table-level outlet:occupied 由 freeSeats 推导(4 椅都坐猫 = 占)
    for (let i = 0; i < outletPositions.length; i++) {
      const keys = tableOutletSeatKeys[i];
      if (keys) {
        const occ = keys.every(k => !freeSeats.has(k));
        outletPositions[i].occupied = occ;
        if (occ) {
          for (const m of outletMeshGroups[i]) m.material = outletMatOccupied;
        }
      }
    }
    npcMeshes.forEach(m => scene.remove(m));
    npcMeshes.length = 0;

    // 仅非桌 mesh-backed 桩可被随机占位(排除壁插无 mesh + table 座位推导)
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
  // 静态数组,rebuildTableZone 不改 studyTable 数量与中心位置 → 引用稳定(debug 调 rowSpacing
  // 时 terrain 与视觉可能脱节,jam 期仅开发用,留 PR #14 backlog)。readingTable 本 PR 不进 terrain。
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
  for (const tp of buildStudyTablePlacements(DEFAULT_DEBUG_PARAMS.rowSpacing)) {
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