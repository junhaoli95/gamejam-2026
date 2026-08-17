import { describe, expect, it } from 'vitest';
import { createBookLayout, createProceduralBookshelf } from './proceduralLibraryProps';

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
  it('builds a visible frame, shelves, and book meshes', () => {
    const group = createProceduralBookshelf(DIM, 17);

    expect(group.children.length).toBeGreaterThan(30);
    expect(group.name).toBe('proceduralBookshelf');
  });

  it('places books on both faces without a closed back panel', () => {
    const group = createProceduralBookshelf(DIM, 17);
    const books = group.children.filter(child => child.name.startsWith('book'));
    const layout = createBookLayout(DIM, 17);

    expect(books).toHaveLength(layout.length * 2);
    expect(books.some(book => book.position.z < 0)).toBe(true);
    expect(books.some(book => book.position.z > 0)).toBe(true);
    expect(group.getObjectByName('darkBackPanel')).toBeUndefined();
  });
});
