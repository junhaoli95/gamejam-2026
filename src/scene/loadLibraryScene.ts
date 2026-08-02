import * as THREE from 'three';
import { loadGlbNormalized } from '../../snippets/loadGlb';

// ─────────────────────────────────────────────────────────────────────────────
// Library scene (拟真版 v4 — 三区制,按实拍视频重做)
//
// 实拍视频走线:走廊 → 书架区 → 窗边自习区。场景按此分三区:
//   西(x<0)   书架区:3 排沿 Z 向书架,柱网 4 柱/排,每排抽一段当豁口(错位)
//   中        走廊:x∈[-5.5, 6.4] 南北贯通,出生点在南端 (0, 8.5)
//   东(x>0)   自习区:4 人桌 2 列 × 10 行(纵向密排,横向边缘~2m)
//             + 窗边 2 人桌 ×2;每桌 4 椅(长边两侧),~92% 座位坐占位猫,
//             仅 7 个空位 —— "基本满座、一座难求"的实地氛围
//   东墙      窗墙:发光面+竖梃,冷色 DirectionalLight 模拟日光
//   四周      墙壁占位:古典深胡桃木色(碰撞由 controller 场地 clamp 承担)
//
// 电位宿主三种(视觉语言统一:"发光绿 = 可充电",全部立刻可见):
//   1. 柱电位   —— 绿方块在柱 ±x 面低位
//   2. 端板电位盒 —— 书架排北端柱面上的银灰盒 + 绿点
//   3. 4 人桌电位 —— 桌面中线 2 个绿方块
// (曾实现"走近 3.2m 才显现",按 review 意见删除——不确定性改由占用状态承载)
//
// Model loading: placeholders occupy the floor layout immediately; if
// `public/library/*.glb` exists, the GLB swaps in for the placeholder of
// that kind (preserving placement position + rotation). Drop GLBs in and
// reload the dev server — no code changes needed.
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
  studyTable:    { w: 1.2, h: 0.75, d: 1.8 }, // 4 人桌,长边沿 z
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
// 每排抽掉的书架段(段中点 z),逐排错位 → 东西穿行被迫 S 形
const ROW_GAP_MID_Z = [-3, 1, -7];
// 北端柱面挂电位盒的排
const END_BOX_ROWS = new Set([0, 2]);

interface PoweredColumn { x: number; z: number; face: 1 | -1; }
interface EndPanelBox { x: number; z: number; }

// 自习区桌阵:2 列 × 10 行(实地观察:纵向非常多、横向只有两列)
const STUDY_COL_XS = [7, 10.2];
const STUDY_ROW_ZS = [-10.6, -8.24, -5.88, -3.52, -1.16, 1.2, 3.56, 5.92, 8.28, 10.64];

function buildPlacements(): {
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

  // 自习区:4 人桌 2 列 × 10 行 —— 纵向密排(间距 0.56m,座椅肩并肩),
  // 横向相邻远(中心距 3.2m = 边缘 2.0m)
  for (const x of STUDY_COL_XS) {
    for (const z of STUDY_ROW_ZS) {
      placements.push({ kind: 'studyTable', x, z });
    }
  }
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

// 4 人桌电位:桌面中线 2 个(沿 z ±0.45)
const STUDY_OUTLET_OFFSETS = [-0.45, 0.45];
const COLUMN_OUTLET_Y = 0.35;

const SPAWN = { x: 0, z: 8.5 };

export interface LibraryScene {
  scene: THREE.Scene;
  /** Placeholder cat —— 正式 player entity 进 game/ 后移除。 */
  player: THREE.Group;
  /** 静态碰撞体(书架/柱/桌),玩家与相机共用。 */
  colliders: THREE.Box3[];
  update: (dt: number) => void;
}

/** 占位椅:座面 + 靠背(靠背在远离桌子一侧)。 */
const chairMat = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.7, metalness: 0 });
function createChair(side: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), chairMat);
  seat.position.y = 0.225;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.45), chairMat);
  back.position.set(side * 0.24, 0.7, 0);
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

export function createLibraryScene(): LibraryScene {
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
  daylight.position.set(30, 12, -3);
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

  const { placements, poweredColumns, endPanelBoxes } = buildPlacements();

  // 占位 + GLB swap 记录 + 静态碰撞体
  interface Entry { placeholder: THREE.Object3D; x: number; z: number; rotY: number; }
  const placementsByKind = new Map<ModelKind, Entry[]>();
  (Object.keys(MODEL_PATHS) as ModelKind[]).forEach(k => placementsByKind.set(k, []));

  const colliders: THREE.Box3[] = [];
  const COLLIDER_KINDS = new Set<ModelKind>(['bookshelf', 'column', 'studyTable', 'readingTable']);

  const socketMat = new THREE.MeshStandardMaterial({
    color: PLACEHOLDER_COLOR.wallSocket,
    emissive: 0x2dff7a,
    emissiveIntensity: 0.9,
    roughness: 0.4,
    metalness: 0,
  });

  for (const p of placements) {
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
      colliders.push(new THREE.Box3(
        new THREE.Vector3(p.x - ew / 2, 0, p.z - ed / 2),
        new THREE.Vector3(p.x + ew / 2, dim.h, p.z + ed / 2),
      ));
    }
  }

  // 电位绿标记共享一份呼吸材质("发光 = 可充电"统一脉冲)
  const outletMat = new THREE.MeshStandardMaterial({
    color: 0x0a3318,
    emissive: 0x2dff7a,
    emissiveIntensity: 1.2,
    roughness: 0.4,
    metalness: 0,
  });

  // 柱电位:绿方块在柱 ±x 面低位,立刻可见
  const columnOutletGeo = new THREE.BoxGeometry(0.02, 0.25, 0.25);
  for (const c of poweredColumns) {
    const m = new THREE.Mesh(columnOutletGeo, outletMat);
    m.position.set(c.x + c.face * (MODEL_DIMS.column.w / 2 + 0.01), COLUMN_OUTLET_Y, c.z);
    scene.add(m);
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
    const dot = new THREE.Mesh(endDotGeo, outletMat);
    dot.position.set(b.x, 1.2, northFaceZ - 0.06);
    scene.add(dot);
  }

  // 4 人桌电位:桌面中线 2 个绿方块(独立于桌子 mesh,GLB swap 后仍在正确位置)
  const studyOutletGeo = new THREE.BoxGeometry(0.2, 0.02, 0.2);
  const tableH = MODEL_DIMS.studyTable.h;
  for (const p of placements) {
    if (p.kind !== 'studyTable') continue;
    for (const oz of STUDY_OUTLET_OFFSETS) {
      const sq = new THREE.Mesh(studyOutletGeo, outletMat);
      sq.position.set(p.x, tableH + 0.011, p.z + oz);
      scene.add(sq);
    }
  }

  // ── 座位:4 人桌每桌 4 椅(长边 ±x 两侧)+ 窗边桌每桌 2 椅;~92% 坐占位猫 ──
  const SEAT_Z_OFFSETS = [-0.45, 0.45];
  const SEAT_SIDE_X = 0.95;
  // 空位("只有少量的几个位置"):key = col,row,si(si: 侧-1[zo-0.45=0, +0.45=1], 侧+1[2, 3])
  const FREE_SEATS = new Set(['0,1,1', '0,4,0', '1,2,3', '1,6,0', '0,7,3', '1,8,2']);
  let furIdx = 0;

  for (const p of placements) {
    if (p.kind === 'studyTable') {
      const ci = STUDY_COL_XS.indexOf(p.x);
      const ri = STUDY_ROW_ZS.indexOf(p.z);
      let si = 0;
      for (const side of [-1, 1] as const) {
        for (const zo of SEAT_Z_OFFSETS) {
          const sx = p.x + side * SEAT_SIDE_X;
          const sz = p.z + zo;
          const chair = createChair(side);
          chair.position.set(sx, 0, sz);
          scene.add(chair);
          colliders.push(new THREE.Box3(
            new THREE.Vector3(sx - 0.225, 0, sz - 0.225),
            new THREE.Vector3(sx + 0.225, 0.9, sz + 0.225),
          ));
          if (!FREE_SEATS.has(`${ci},${ri},${si}`)) {
            const cat = createSeatedCat(FUR_COLORS[furIdx++ % FUR_COLORS.length], side * Math.PI / 2);
            cat.position.set(sx, 0.45, sz);
            scene.add(cat);
          }
          si++;
        }
      }
    } else if (p.kind === 'readingTable') {
      // 窗边 2 人桌:椅在西侧面向窗(+x);再留 1 个空位
      for (const zo of SEAT_Z_OFFSETS) {
        const sx = 13.5;
        const sz = p.z + zo;
        const chair = createChair(-1);
        chair.position.set(sx, 0, sz);
        scene.add(chair);
        colliders.push(new THREE.Box3(
          new THREE.Vector3(sx - 0.225, 0, sz - 0.225),
          new THREE.Vector3(sx + 0.225, 0.9, sz + 0.225),
        ));
        const isFree = p.z === -2 && zo === 0.45;
        if (!isFree) {
          const cat = createSeatedCat(FUR_COLORS[furIdx++ % FUR_COLORS.length], -Math.PI / 2);
          cat.position.set(sx, 0.45, sz);
          scene.add(cat);
        }
      }
    }
  }

  // ── 墙壁占位:古典深胡桃木色(视觉;碰撞由 controller 场地 clamp 承担)──
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75, metalness: 0 });
  const WALL_H = 3.2;
  const WALL_T = 0.2;
  const WALL_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
    // [cx, cz, w, d]
    [0, -12 + WALL_T / 2, FLOOR_W, WALL_T],  // 北
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
  // 窗下槛 + 窗上楣
  const sill = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, 0.8, 12), wallMat);
  sill.position.set(15.9, 0.4, -3);
  scene.add(sill);
  const header = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, 0.4, 12), wallMat);
  header.position.set(15.9, 3.2, -3);
  scene.add(header);

  const player = createPlaceholderCat();
  scene.add(player);

  // Async GLB load + swap. If GLB missing (scaffolding), placeholder stays.
  (Object.keys(MODEL_PATHS) as ModelKind[]).forEach(kind => {
    loadGlbNormalized(MODEL_PATHS[kind], MODEL_DIMS[kind].h)
      .then((template: THREE.Group) => {
        // loadGlbNormalized sits feet on y=0 but leaves X/Z centered on the
        // original GLB origin. Recenter XZ so each placement is centered on (x, z).
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

  let t = 0;
  return {
    scene,
    player,
    colliders,
    update: (dt: number) => {
      // 电位呼吸脉冲 —— "发光 = 可充电"的视觉语言
      t += dt;
      outletMat.emissiveIntensity = 1.1 + 0.6 * Math.sin(t * 3.2);
    },
  };
}
