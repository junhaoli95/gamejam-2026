import * as THREE from 'three';
import { loadGlbNormalized } from '../../snippets/loadGlb';

// ─────────────────────────────────────────────────────────────────────────────
// Library scene (拟真版 v3 — 按实拍图重做)
//
// 实拍结构:长排平行书架沿 X 向排列,结构柱(木饰面方柱,高于书架、直通
// 天花)以 6m 柱网嵌在排内,柱间跨 5.1m 放书架段,过道约 3m。
//
// 布局:x∈[-16,16],z∈[-12,12];入口在南(z≈+10)。
//   - 5 排书架(z=-9 / -5.4 / -1.8 / 1.8 / 5.4),柱网 x=-12..12 step 6
//   - 每排抽掉一跨当过道豁口,豁口位置逐排错位 → 南北穿行被迫 S 形
//   - 两侧(x>12.45 / x<-12.45)为沿墙边通道(实拍同款)
//   - 柱子 0.9×0.9×3.4,约半数带电位:绿色方块装在柱子 ±z 面低位,
//     默认隐藏,玩家走近 3.2m 内才显现 —— "必须走过去才知道" 的核心玩法
//   - 南区摆 2 充电桌(桌面 2×2 常亮绿方块)+ 2 阅读桌;壁插 4 个常亮
//     —— 视觉语言:"发光 = 可充电";柱电位=不确定,桌/壁电位=已知
//
// Model loading: placeholders occupy the floor layout immediately; if
// `public/library/*.glb` exists, the GLB swaps in for the placeholder of
// that kind (preserving placement position + rotation). Drop GLBs in and
// reload the dev server — no code changes needed.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelKind = 'bookshelf' | 'column' | 'poweredTable' | 'readingTable' | 'wallSocket';

const MODEL_PATHS: Record<ModelKind, string> = {
  bookshelf:    'library/bookshelf.glb',
  column:       'library/column.glb',
  poweredTable: 'library/poweredTable.glb',
  // Reading table reuses powered-table mesh for now; spec upgrade later.
  readingTable: 'library/poweredTable.glb',
  wallSocket:   'library/wallSocket.glb',
};

const MODEL_DIMS: Record<ModelKind, { w: number; h: number; d: number }> = {
  bookshelf:    { w: 5.0, h: 2.4,  d: 0.6 },
  column:       { w: 0.9, h: 3.4,  d: 0.9 },
  poweredTable: { w: 2.6, h: 0.75, d: 1.4 },
  readingTable: { w: 2.6, h: 0.75, d: 1.4 },
  wallSocket:   { w: 0.3, h: 0.5,  d: 0.12 },
};

const PLACEHOLDER_COLOR: Record<ModelKind, number> = {
  bookshelf:    0xe8e4da, // 实拍:白钢架
  column:       0xa8825c, // 实拍:木饰面方柱
  poweredTable: 0xa07040,
  readingTable: 0x8a6030,
  wallSocket:   0x1a2a1a,
};

interface Placement {
  kind: ModelKind;
  x: number;
  z: number;
  rotY?: number;
}

const FLOOR_W = 32;
const FLOOR_D = 24;

// 实拍同款柱网 + 长排书架
const COLUMN_XS = [-12, -6, 0, 6, 12];
const ROW_ZS = [-9, -5.4, -1.8, 1.8, 5.4];
// 每排抽掉的跨(跨中点 x),逐排错位 → 南北穿行被迫 S 形
const ROW_GAP_MID_X = [-3, 9, -9, 3, -3];

interface PoweredColumn { x: number; z: number; face: 1 | -1; }

function buildPlacements(): { placements: Placement[]; poweredColumns: PoweredColumn[] } {
  const placements: Placement[] = [];
  const poweredColumns: PoweredColumn[] = [];

  ROW_ZS.forEach((z, ri) => {
    COLUMN_XS.forEach((x, ci) => {
      placements.push({ kind: 'column', x, z });
      // 约半数柱子带电位(棋盘分布),face=电位面朝向(±z)
      if ((ci + ri) % 2 === 0) {
        poweredColumns.push({ x, z, face: ri % 2 === 0 ? 1 : -1 });
      }
      // 柱间跨放书架段;被抽掉的跨 = 过道豁口
      const midX = x + 3;
      if (ci < COLUMN_XS.length - 1 && midX !== ROW_GAP_MID_X[ri]) {
        placements.push({ kind: 'bookshelf', x: midX, z });
      }
    });
  });

  // 南区:充电桌 ×2 + 阅读角 ×2
  placements.push(
    { kind: 'poweredTable', x: -9, z: 9.5 },
    { kind: 'poweredTable', x:  9, z: 9.5 },
    { kind: 'readingTable', x: -14.2, z: 8.8 },
    { kind: 'readingTable', x:  14.2, z: 8.8 },
    // 壁插 ×4(沿墙,常亮)
    { kind: 'wallSocket', x: -15.55, z:  3, rotY: Math.PI / 2 },
    { kind: 'wallSocket', x:  15.55, z: -3, rotY: -Math.PI / 2 },
    { kind: 'wallSocket', x: -13.5, z: -11.55 },
    { kind: 'wallSocket', x:  13.5, z: -11.55 },
  );

  return { placements, poweredColumns };
}

// 充电桌桌面 2×2 高亮方块(常亮);柱电位 0.25m 绿方块低位装柱面(走近才亮)
const TABLE_OUTLET_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35],
];
const COLUMN_OUTLET_Y = 0.35;
const OUTLET_REVEAL_DIST = 3.2;

const SPAWN = { x: 0, z: 8.5 };

export interface LibraryScene {
  scene: THREE.Scene;
  /** Placeholder cat —— 正式 player entity 进 game/ 后移除。 */
  player: THREE.Group;
  /** 静态碰撞体(书架/柱/桌),玩家与相机共用。 */
  colliders: THREE.Box3[];
  update: (dt: number) => void;
}

/** 占位猫:胶囊身 + 圆锥耳 + 球眼 + 翘尾,面向 -z(迷宫深处)。 */
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

export function createLibraryScene(): LibraryScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2efe8);

  // Floor — 实拍:浅米光滑地面
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_W, FLOOR_D),
    new THREE.MeshStandardMaterial({ color: 0xcdc6b4, roughness: 0.5, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Lighting — stay within perf budget (≤4 active point lights)
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  scene.add(new THREE.HemisphereLight(0xfff8ec, 0x9a8a70, 0.55));
  const warmHue = 0xfff0d8;
  for (const [x, z] of ([[-8, 4], [8, 4], [-8, -6], [8, -6]] as Array<[number, number]>)) {
    const pl = new THREE.PointLight(warmHue, 0.6, 14, 2.0);
    pl.position.set(x, 4, z);
    scene.add(pl);
  }

  const { placements, poweredColumns } = buildPlacements();

  // 占位 + GLB swap 记录 + 静态碰撞体
  interface Entry { placeholder: THREE.Mesh; x: number; z: number; rotY: number; }
  const placementsByKind = new Map<ModelKind, Entry[]>();
  (Object.keys(MODEL_PATHS) as ModelKind[]).forEach(k => placementsByKind.set(k, []));

  const colliders: THREE.Box3[] = [];
  const COLLIDER_KINDS = new Set<ModelKind>(['bookshelf', 'column', 'poweredTable', 'readingTable']);

  const socketMat = new THREE.MeshStandardMaterial({
    color: PLACEHOLDER_COLOR.wallSocket,
    emissive: 0x2dff7a,
    emissiveIntensity: 0.9,
    roughness: 0.4,
    metalness: 0,
  });

  for (const p of placements) {
    const dim = MODEL_DIMS[p.kind];
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(dim.w, dim.h, dim.d),
      p.kind === 'wallSocket'
        ? socketMat
        : new THREE.MeshStandardMaterial({ color: PLACEHOLDER_COLOR[p.kind], roughness: 0.6, metalness: 0 }),
    );
    box.position.set(p.x, dim.h / 2, p.z);
    box.rotation.y = p.rotY ?? 0;
    scene.add(box);
    placementsByKind.get(p.kind)!.push({
      placeholder: box,
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

  // 电位方块共享一份呼吸材质(所有"发光=可充电"语言统一脉冲)
  const outletMat = new THREE.MeshStandardMaterial({
    color: 0x0a3318,
    emissive: 0x2dff7a,
    emissiveIntensity: 1.2,
    roughness: 0.4,
    metalness: 0,
  });

  // 充电桌桌面 2×2 常亮方块(独立于桌子 mesh,GLB swap 后仍在正确位置)
  const tableOutletGeo = new THREE.BoxGeometry(0.32, 0.02, 0.32);
  const tableH = MODEL_DIMS.poweredTable.h;
  for (const p of placements) {
    if (p.kind !== 'poweredTable') continue;
    for (const [ox, oz] of TABLE_OUTLET_OFFSETS) {
      const sq = new THREE.Mesh(tableOutletGeo, outletMat);
      sq.position.set(p.x + ox, tableH + 0.011, p.z + oz);
      scene.add(sq);
    }
  }

  // 柱电位:低位装柱面,默认隐藏,走近 OUTLET_REVEAL_DIST 内显现
  const columnOutletGeo = new THREE.BoxGeometry(0.25, 0.25, 0.02);
  interface ColumnOutlet { mesh: THREE.Mesh; x: number; z: number; }
  const columnOutlets: ColumnOutlet[] = [];
  for (const c of poweredColumns) {
    const m = new THREE.Mesh(columnOutletGeo, outletMat);
    m.position.set(c.x, COLUMN_OUTLET_Y, c.z + c.face * (MODEL_DIMS.column.d / 2 + 0.01));
    m.visible = false;
    scene.add(m);
    columnOutlets.push({ mesh: m, x: c.x, z: c.z });
  }

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
          entry.placeholder.geometry.dispose();
          (entry.placeholder.material as THREE.Material).dispose();
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[LibraryScene] ${MODEL_PATHS[kind]} not loaded; placeholder kept (${msg})`);
      });
  });

  let t = 0;
  const revealDistSq = OUTLET_REVEAL_DIST * OUTLET_REVEAL_DIST;
  return {
    scene,
    player,
    colliders,
    update: (dt: number) => {
      t += dt;
      outletMat.emissiveIntensity = 1.1 + 0.6 * Math.sin(t * 3.2);
      // 柱电位走近揭示 —— 核心玩法:远距离无法判断柱子是否有电位
      for (const o of columnOutlets) {
        const dx = player.position.x - o.x;
        const dz = player.position.z - o.z;
        o.mesh.visible = dx * dx + dz * dz < revealDistSq;
      }
    },
  };
}
