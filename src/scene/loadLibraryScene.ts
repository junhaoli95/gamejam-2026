import * as THREE from 'three';
import { loadGlbNormalized } from '../../snippets/loadGlb';

// ─────────────────────────────────────────────────────────────────────────────
// Library scene (拟真版 v1)
//
// Floor 32m × 24m. Three bookshelf rows divide the space into 3 zones + an
// entrance. Half the tables are 4-person powered tables; half are reading
// tables. Wall sockets scattered along outer walls.
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
  bookshelf:    { w: 3.0, h: 2.5, d: 0.4 },
  poweredTable: { w: 2.0, h: 0.75, d: 1.0 },
  readingTable: { w: 2.0, h: 0.75, d: 1.0 },
  wallSocket:   { w: 0.15, h: 0.15, d: 0.05 },
};

const PLACEHOLDER_COLOR: Record<ModelKind, number> = {
  bookshelf:    0x6b4a2a,
  poweredTable: 0xa07040,
  readingTable: 0x8a6030,
  wallSocket:   0x222222,
};

interface Placement {
  kind: ModelKind;
  x: number;
  z: number;
  rotY?: number;
}

const FLOOR_W = 32;
const FLOOR_D = 24;

function shelfWallRow(z: number): Placement[] {
  const xs = [-12, -8, -4, 4, 8, 12];
  return xs.map(x => ({ kind: 'bookshelf' as ModelKind, x, z, rotY: 0 }));
}

// Three bookshelf rows → ENTRANCE (z > 7) / ZONE 1 (0 < z < 7) /
// ZONE 2 (-8 < z < 0) / ZONE 3 (z < -8). Each row has a center door gap.
const PLACEMENTS: Placement[] = [
  ...shelfWallRow(7),
  ...shelfWallRow(0),
  ...shelfWallRow(-8),
  // Zone 1 — 2 powered tables
  { kind: 'poweredTable', x: -5, z: 3 },
  { kind: 'poweredTable', x:  5, z: 3 },
  // Zone 2 — 2 powered tables
  { kind: 'poweredTable', x: -5, z: -4 },
  { kind: 'poweredTable', x:  5, z: -4 },
  // Zone 3 — 3 powered + 2 reading
  { kind: 'poweredTable', x: -8, z: -12 },
  { kind: 'poweredTable', x:  0, z: -12 },
  { kind: 'poweredTable', x:  8, z: -12 },
  { kind: 'readingTable',  x: -4, z: -14 },
  { kind: 'readingTable',  x:  4, z: -14 },
  // Wall sockets (perimeter, facing inward)
  { kind: 'wallSocket', x: -14, z: -10, rotY: Math.PI / 2 },
  { kind: 'wallSocket', x:  14, z: -10, rotY: -Math.PI / 2 },
  { kind: 'wallSocket', x: -14, z:  10, rotY: Math.PI / 2 },
  { kind: 'wallSocket', x:  14, z:  10, rotY: -Math.PI / 2 },
];

export interface LibraryScene {
  scene: THREE.Scene;
  update: (dt: number) => void;
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

  // Placeholders + entry records for GLB swap
  interface Entry { placeholder: THREE.Mesh; x: number; z: number; rotY: number; }
  const placementsByKind = new Map<ModelKind, Entry[]>();
  (Object.keys(MODEL_PATHS) as ModelKind[]).forEach(k => placementsByKind.set(k, []));

  for (const p of PLACEMENTS) {
    const dim = MODEL_DIMS[p.kind];
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(dim.w, dim.h, dim.d),
      new THREE.MeshStandardMaterial({ color: PLACEHOLDER_COLOR[p.kind], roughness: 0.6, metalness:  0 }),
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

  return {
    scene,
    update: (_dt: number) => {
      // Reserved for future juice: warm point light flicker, dust motes, etc.
    },
  };
}