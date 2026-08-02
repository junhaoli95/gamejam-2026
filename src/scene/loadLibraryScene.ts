import * as THREE from 'three';
import { loadGlbNormalized } from '../../snippets/loadGlb';

// ─────────────────────────────────────────────────────────────────────────────
// Library scene (拟真版 v2 — maze 化)
//
// Floor 32m × 24m,x∈[-16,16],z∈[-12,12]。入口在南(z≈+10),深处是背区。
// 三道横向书架行(z=-5.5 / 0 / 5.5)豁口错位,出生点到背区被迫走 S 形;
// 三段竖向书架造 L 型死角/壁龛(app 透视的天然理由)。
//
// 充电桌桌面有 2×2 高亮绿方块 = 电位占位(update 里呼吸脉冲);壁插同样发
// 绿光 —— 统一视觉语言:"发光 = 可充电"。占位猫(胶囊+耳+尾)站在出生点。
//
// Model loading: placeholders occupy the floor layout immediately; if
// `public/library/*.glb` exists, the GLB swaps in for the placeholder of
// that kind (preserving placement position + rotation). Drop GLBs in and
// reload the dev server — no code changes needed.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelKind = 'bookshelf' | 'poweredTable' | 'readingTable' | 'wallSocket';

const MODEL_PATHS: Record<ModelKind, string> = {
  bookshelf:    'library/bookshelf.glb',
  poweredTable: 'library/poweredTable.glb',
  // Reading table reuses powered-table mesh for now; spec upgrade later.
  readingTable: 'library/poweredTable.glb',
  wallSocket:   'library/wallSocket.glb',
};

const MODEL_DIMS: Record<ModelKind, { w: number; h: number; d: number }> = {
  bookshelf:    { w: 4.0, h: 3.0,  d: 0.6 },
  poweredTable: { w: 2.6, h: 0.75, d: 1.4 },
  readingTable: { w: 2.6, h: 0.75, d: 1.4 },
  wallSocket:   { w: 0.3, h: 0.5,  d: 0.12 },
};

const PLACEHOLDER_COLOR: Record<ModelKind, number> = {
  bookshelf:    0x6b4a2a,
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

function shelfRow(z: number, centers: number[]): Placement[] {
  return centers.map((x): Placement => ({ kind: 'bookshelf', x, z }));
}

// 豁口错位:row1/row3 豁口在 [-8,-4] 与 [4,8];row2 豁口在中央 [-2,2]
// 加两侧窄缝 [-16,-14] / [14,16]。走位被迫 S 形。
const PLACEMENTS: Placement[] = [
  ...shelfRow(-5.5, [-14, -10, -2, 2, 10, 14]),
  ...shelfRow(0,    [-12, -8, -4, 4, 8, 12]),
  ...shelfRow(5.5,  [-14, -10, -2, 2, 10, 14]),
  // 竖向书架段(L 型死角)
  { kind: 'bookshelf', x: -10, z: -2.5, rotY: Math.PI / 2 },
  { kind: 'bookshelf', x:   6, z:  2.5, rotY: Math.PI / 2 },
  { kind: 'bookshelf', x:  -6, z:  8,   rotY: Math.PI / 2 },
  // 充电桌 ×7(背区 2 / 中区 2 / 南区 3)
  { kind: 'poweredTable', x: -12, z: -8 },
  { kind: 'poweredTable', x:   2, z: -8 },
  { kind: 'poweredTable', x: -13, z: -2.75 },
  { kind: 'poweredTable', x:   5, z: -2.75 },
  { kind: 'poweredTable', x: -13, z: 2.75 },
  { kind: 'poweredTable', x:  -5, z: 2.75 },
  { kind: 'poweredTable', x:   9, z: 2.75 },
  // 阅读桌 ×2
  { kind: 'readingTable', x:  8, z: -8 },
  { kind: 'readingTable', x: 10, z: 8.5 },
  // 壁插 ×4(贴墙,发绿光)
  { kind: 'wallSocket', x: -15.55, z:  3, rotY: Math.PI / 2 },
  { kind: 'wallSocket', x:  15.55, z: -3, rotY: -Math.PI / 2 },
  { kind: 'wallSocket', x:  -4, z: -11.55 },
  { kind: 'wallSocket', x:   8, z: -11.55 },
];

// 电位占位:充电桌桌面 2×2 高亮方块。共享一份 geometry+material,update 统一脉冲。
const OUTLET_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35],
];
const OUTLET_SIZE = 0.32;

const SPAWN = { x: 0, z: 10.5 };

export interface LibraryScene {
  scene: THREE.Scene;
  /** Placeholder cat —— 正式 player entity 进 game/ 后移除。 */
  player: THREE.Group;
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
  scene.background = new THREE.Color(0xfdf6e3);

  // Floor — warm wood
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_W, FLOOR_D),
    new THREE.MeshStandardMaterial({ color: 0xb88a5a, roughness: 0.9, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Lighting — stay within perf budget (≤4 active point lights)
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x806040, 0.5));
  const warmHue = 0xffd9a0;
  for (const [x, z] of ([[-8, 4], [8, 4], [-8, -6], [8, -6]] as Array<[number, number]>)) {
    const pl = new THREE.PointLight(warmHue, 0.6, 14, 2.0);
    pl.position.set(x, 4, z);
    scene.add(pl);
  }

  // 占位 + GLB swap 记录
  interface Entry { placeholder: THREE.Mesh; x: number; z: number; rotY: number; }
  const placementsByKind = new Map<ModelKind, Entry[]>();
  (Object.keys(MODEL_PATHS) as ModelKind[]).forEach(k => placementsByKind.set(k, []));

  const socketMat = new THREE.MeshStandardMaterial({
    color: PLACEHOLDER_COLOR.wallSocket,
    emissive: 0x2dff7a,
    emissiveIntensity: 0.9,
    roughness: 0.4,
    metalness: 0,
  });

  for (const p of PLACEMENTS) {
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
  }

  // 电位高亮方块(独立于桌子 mesh,GLB swap 后仍在正确位置)
  const outletGeo = new THREE.BoxGeometry(OUTLET_SIZE, 0.02, OUTLET_SIZE);
  const outletMat = new THREE.MeshStandardMaterial({
    color: 0x0a3318,
    emissive: 0x2dff7a,
    emissiveIntensity: 1.2,
    roughness: 0.4,
    metalness: 0,
  });
  const tableH = MODEL_DIMS.poweredTable.h;
  for (const p of PLACEMENTS) {
    if (p.kind !== 'poweredTable') continue;
    for (const [ox, oz] of OUTLET_OFFSETS) {
      const sq = new THREE.Mesh(outletGeo, outletMat);
      sq.position.set(p.x + ox, tableH + 0.011, p.z + oz);
      scene.add(sq);
    }
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
  return {
    scene,
    player,
    update: (dt: number) => {
      // 电位呼吸脉冲 —— "发光 = 可充电"的视觉语言
      t += dt;
      outletMat.emissiveIntensity = 1.1 + 0.6 * Math.sin(t * 3.2);
    },
  };
}
