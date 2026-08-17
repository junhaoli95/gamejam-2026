import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBookLayout, createDoubleSidedBookLayout, createProceduralBookshelf } from './proceduralLibraryProps';

const DIM = { w: 3, h: 2.4, d: 0.6 };

describe('createBookLayout', () => {
  it('returns the same placements for the same seed', () => {
    expect(createBookLayout(DIM, 17)).toEqual(createBookLayout(DIM, 17));
  });

  it('keeps every book inside the bookshelf footprint and on a shelf row', () => {
    const layout = createBookLayout(DIM, 17);

    expect(layout.length).toBeGreaterThan(20);
    for (const book of layout) {
      expect(Math.abs(book.x) + book.w / 2).toBeLessThanOrEqual(DIM.w / 2 - 0.08);
      expect(book.y).toBeGreaterThan(0.1);
      expect(book.y + book.h).toBeLessThanOrEqual(DIM.h - 0.08);
      expect(Math.abs(book.z)).toBeLessThanOrEqual(DIM.d / 2);
    }
  });
});

describe('createProceduralBookshelf', () => {
  it('builds the whole bookshelf as one colored mesh', () => {
    const group = createProceduralBookshelf(DIM, 17);
    const mesh = group.children[0];
    const geometry = (mesh as THREE.Mesh).geometry;
    const position = geometry.getAttribute('position');
    const triangles = geometry.index ? geometry.index.count / 3 : position.count / 3;

    expect(group.children).toHaveLength(1);
    expect(group.name).toBe('proceduralBookshelf');
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(geometry.getAttribute('color')).toBeDefined();
    expect(geometry.getAttribute('color').count).toBe(position.count);
    expect((mesh as THREE.Mesh).material).toMatchObject({ vertexColors: true });
    expect((mesh as THREE.Mesh).castShadow).toBe(true);
    expect((mesh as THREE.Mesh).receiveShadow).toBe(true);
    expect(triangles).toBeLessThan(5000);
  });

  it('uses a double-sided book layout without a closed back panel', () => {
    const layout = createBookLayout(DIM, 17);
    const doubleSidedLayout = createDoubleSidedBookLayout(DIM, 17);
    const front = doubleSidedLayout.filter(book => book.z < 0);
    const back = doubleSidedLayout.filter(book => book.z > 0);

    expect(doubleSidedLayout).toHaveLength(layout.length * 2);
    expect(front.map(book => book.rotationY)).toEqual(layout.map(book => -book.rotationY));
    expect(back.map(book => book.rotationY)).toEqual(layout.map(book => book.rotationY));
  });
});
