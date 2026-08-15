#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../src/scene/layout.json');

const STACK_ROW_XS = [-13, -9.5, -6];
const COL_ZS = [-9, -5, -1, 3];
const ROW_GAP_MID_Z = [-3, 1, -7];
const END_BOX_ROWS = new Set([0, 2]);
const STUDY_COL_XS = [7, 10.2];
const ROW_SPACING = 2.36;
const STUDY_ROW_COUNT = 10;

function studyRowZs(rs, count = STUDY_ROW_COUNT) {
  const span = (count - 1) * rs;
  const startZ = -span / 2;
  return Array.from({ length: count }, (_, i) => startZ + i * rs);
}

const placements = [];
const columns = [];
STACK_ROW_XS.forEach((x, ri) => {
  COL_ZS.forEach((z, ci) => {
    columns.push({ x, z });
    const midZ = z + 2;
    if (ci < COL_ZS.length - 1 && midZ !== ROW_GAP_MID_Z[ri]) {
      placements.push({ kind: 'bookshelf', x, z: midZ, rotY: 90 });
    }
  });
  if (END_BOX_ROWS.has(ri)) placements.push({ kind: 'endPanelBox', x, z: COL_ZS[0] });
});
placements.push(...columns.map(c => ({ kind: 'column', x: c.x, z: c.z })));
for (const x of STUDY_COL_XS) {
  for (const z of studyRowZs(ROW_SPACING)) {
    placements.push({ kind: 'studyTable', x, z });
  }
}
placements.push(
  { kind: 'readingTable', x: 14.2, z: -6, rotY: 90 },
  { kind: 'readingTable', x: 14.2, z: -2, rotY: 90 },
  { kind: 'wallSocket', x: -8, z: 11.73 },
  { kind: 'wallSocket', x: 14, z: 11.73 },
  { kind: 'wallSocket', x: -15.73, z: 0, rotY: 90 },
);

const snap = v => Math.round(v * 2) / 2;
for (const p of placements) {
  p.x = snap(p.x);
  p.z = snap(p.z);
}

const layout = {
  room: { w: 32, h: 24 },
  outlets: {
    meshNpcCount: 3,
    meshGreenRandom: [1, 2],
    meshGreenMin: 2,
    seed: null,
  },
  placements,
};

fs.writeFileSync(OUT, JSON.stringify(layout, null, 2) + '\n');
const count = placements.length;
console.log(`baked ${count} placements → ${OUT}`);
