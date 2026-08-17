import * as THREE from 'three';

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

function addBox(
  group: THREE.Group,
  name: string,
  size: { x: number; y: number; z: number },
  position: { x: number; y: number; z: number },
  material: THREE.MeshStandardMaterial,
  rotationY = 0,
): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.name = name;
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotation.y = rotationY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

export function createProceduralBookshelf(dim: ShelfDimensions, seed = 17): THREE.Group {
  const group = new THREE.Group();
  group.name = 'proceduralBookshelf';

  const wood = new THREE.MeshStandardMaterial({ color: 0xb08c5e, roughness: 0.78, metalness: 0, flatShading: true });
  const rail = new THREE.MeshStandardMaterial({ color: 0x4a4a45, roughness: 0.72, metalness: 0.12, flatShading: true });
  const bookMaterials = new Map<number, THREE.MeshStandardMaterial>();
  const materialForBook = (color: number): THREE.MeshStandardMaterial => {
    let material = bookMaterials.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, flatShading: true });
      bookMaterials.set(color, material);
    }
    return material;
  };

  const postWidth = 0.12;
  addBox(group, 'leftWoodPost', { x: postWidth, y: dim.h, z: dim.d }, { x: -dim.w / 2 + postWidth / 2, y: dim.h / 2, z: 0 }, wood);
  addBox(group, 'rightWoodPost', { x: postWidth, y: dim.h, z: dim.d }, { x: dim.w / 2 - postWidth / 2, y: dim.h / 2, z: 0 }, wood);
  addBox(group, 'topWoodCap', { x: dim.w + 0.04, y: 0.1, z: dim.d + 0.04 }, { x: 0, y: dim.h - 0.05, z: 0 }, wood);
  addBox(group, 'bottomWoodPlinth', { x: dim.w + 0.04, y: 0.1, z: dim.d + 0.04 }, { x: 0, y: 0.05, z: 0 }, wood);

  const shelfSurface = 0.12;
  const rowGap = (dim.h - 0.26) / SHELF_COUNT;
  for (let row = 0; row < SHELF_COUNT; row++) {
    addBox(
      group,
      `shelfRail${row}`,
      { x: dim.w - postWidth * 2 - 0.04, y: SHELF_THICKNESS, z: dim.d - 0.04 },
      { x: 0, y: shelfSurface + row * rowGap, z: 0 },
      rail,
    );
  }

  for (const [index, book] of createBookLayout(dim, seed).entries()) {
    for (const side of [-1, 1] as const) {
      addBox(
        group,
        `book${index}${side === -1 ? 'Front' : 'Back'}`,
        { x: book.w, y: book.h, z: book.d },
        { x: book.x, y: book.y + book.h / 2, z: book.z * (side === -1 ? 1 : -1) },
        materialForBook(book.color),
        book.rotationY * side,
      );
    }
  }

  return group;
}
