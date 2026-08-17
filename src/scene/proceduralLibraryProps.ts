import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export interface ShelfDimensions {
  w: number;
  h: number;
  d: number;
}

export interface BookPlacement {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  rotationY: number;
  color: number;
}

const BOOK_COLORS = [0x9f5546, 0x4d668f, 0x73865d, 0xb08c5e, 0xf0ede6];
const SHELF_COUNT = 5;
const SHELF_THICKNESS = 0.06;

function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}

export function createBookLayout(dim: ShelfDimensions, seed = 17): BookPlacement[] {
  const random = seededRandom(seed);
  const shelfSurface = 0.12;
  const rowGap = (dim.h - 0.26) / SHELF_COUNT;
  const usableWidth = dim.w - 0.26;
  const left = -usableWidth / 2;
  const right = usableWidth / 2;
  const bookDepth = Math.min(dim.d * 0.42, 0.24);
  const books: BookPlacement[] = [];

  for (let row = 0; row < SHELF_COUNT; row++) {
    let cursor = left;
    const y = shelfSurface + row * rowGap + SHELF_THICKNESS;
    const maxHeight = rowGap * 0.78;

    while (cursor < right - 0.07) {
      const w = between(random, 0.07, 0.16);
      if (cursor + w > right) break;

      books.push({
        x: cursor + w / 2,
        y,
        z: -dim.d / 2 + bookDepth / 2 + 0.04,
        w,
        h: between(random, maxHeight * 0.62, maxHeight),
        d: bookDepth,
        rotationY: between(random, -0.055, 0.055),
        color: BOOK_COLORS[Math.floor(random() * BOOK_COLORS.length)],
      });

      cursor += w + between(random, 0.015, 0.035);
      if (random() < 0.1) cursor += between(random, 0.08, 0.18);
    }
  }

  return books;
}

export function createDoubleSidedBookLayout(dim: ShelfDimensions, seed = 17): BookPlacement[] {
  return createBookLayout(dim, seed).flatMap(book => [
    { ...book, rotationY: -book.rotationY },
    { ...book, z: -book.z },
  ]);
}

function appendBoxGeometry(
  geometries: THREE.BufferGeometry[],
  size: { x: number; y: number; z: number },
  position: { x: number; y: number; z: number },
  color: number,
  rotationY = 0,
): void {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  geometry.rotateY(rotationY);
  geometry.translate(position.x, position.y, position.z);

  const vertexColor = new THREE.Color(color);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    vertexColor.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometries.push(geometry);
}

export function createProceduralBookshelf(dim: ShelfDimensions, seed = 17): THREE.Group {
  const group = new THREE.Group();
  group.name = 'proceduralBookshelf';

  const geometries: THREE.BufferGeometry[] = [];

  const postWidth = 0.12;
  appendBoxGeometry(geometries, { x: postWidth, y: dim.h, z: dim.d }, { x: -dim.w / 2 + postWidth / 2, y: dim.h / 2, z: 0 }, 0xb08c5e);
  appendBoxGeometry(geometries, { x: postWidth, y: dim.h, z: dim.d }, { x: dim.w / 2 - postWidth / 2, y: dim.h / 2, z: 0 }, 0xb08c5e);
  appendBoxGeometry(geometries, { x: dim.w + 0.04, y: 0.1, z: dim.d + 0.04 }, { x: 0, y: dim.h - 0.05, z: 0 }, 0xb08c5e);
  appendBoxGeometry(geometries, { x: dim.w + 0.04, y: 0.1, z: dim.d + 0.04 }, { x: 0, y: 0.05, z: 0 }, 0xb08c5e);

  const shelfSurface = 0.12;
  const rowGap = (dim.h - 0.26) / SHELF_COUNT;
  for (let row = 0; row < SHELF_COUNT; row++) {
    appendBoxGeometry(
      geometries,
      { x: dim.w - postWidth * 2 - 0.04, y: SHELF_THICKNESS, z: dim.d - 0.04 },
      { x: 0, y: shelfSurface + row * rowGap, z: 0 },
      0x4a4a45,
    );
  }

  for (const book of createDoubleSidedBookLayout(dim, seed)) {
    appendBoxGeometry(
      geometries,
      { x: book.w, y: book.h, z: book.d },
      { x: book.x, y: book.y + book.h / 2, z: book.z },
      book.color,
      book.rotationY,
    );
  }

  let merged: THREE.BufferGeometry | null;
  try {
    merged = BufferGeometryUtils.mergeGeometries(geometries, false);
  } finally {
    geometries.forEach(geometry => geometry.dispose());
  }
  if (!merged) throw new Error('Failed to merge procedural bookshelf geometry');

  const mesh = new THREE.Mesh(
    merged,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, flatShading: true }),
  );
  mesh.name = 'bookshelfMesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  return group;
}
