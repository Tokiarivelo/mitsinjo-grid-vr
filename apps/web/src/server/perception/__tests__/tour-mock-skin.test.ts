// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FACE_ATLAS_COLS, faceSlot } from '@/lib/face-atlas';
import { ObjectRecipeSchema } from '@/lib/object-shape';
import type { FlatRender } from '../flat-render';
import { gateSkin } from '../tour-mock/generate';
import {
  erodeMask,
  fillOutside,
  mirrorTile,
  outlineFrame,
  recipeBox,
  rowExtents,
  sideTile,
  skinAtlas,
  skinPaint,
} from '../tour-mock/skin';

const mask = (cols: number, rows: number, on: (x: number, y: number) => boolean) => ({
  cols,
  rows,
  data: Uint8Array.from({ length: cols * rows }, (_, i) =>
    on(i % cols, Math.floor(i / cols)) ? 1 : 0
  ),
});

describe('tour mock skin (VS-T43)', () => {
  it('frames an outline across the panorama seam straight ahead', () => {
    const f = outlineFrame([
      [
        [0.98, 0.4],
        [1.02, 0.4],
        [1.02, 0.6],
        [0.98, 0.6],
      ],
    ]);
    expect(f.box.x).toBeCloseTo(0.48);
    expect(f.box.w).toBeCloseTo(0.04);
    expect(f.elevation).toBeCloseTo(0);
  });

  it('boxes the parts of a recipe in the camera frame', () => {
    const recipe = ObjectRecipeSchema.parse({
      proportions: { w: 1, h: 0.5, d: 0.5 },
      parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#888888' }],
    });
    expect(recipeBox(recipe)).toEqual([-0.5, -0.25, -0.25, 0.5, 0.25, 0.25]);
    const turned = recipeBox(recipe, { yaw: Math.PI / 2, pitch: 0 });
    expect(turned[3] - turned[0]).toBeCloseTo(0.5);
  });

  it('erodes a mask and keeps a thin one whole', () => {
    const square = mask(6, 6, (x, y) => x > 0 && x < 5 && y > 0 && y < 5);
    expect(erodeMask(square, 1).data.reduce((a, b) => a + b, 0)).toBe(4);
    const line = mask(6, 1, () => true);
    expect(erodeMask(line, 2).data).toEqual(line.data);
  });

  it('fills the paper with the nearest object colours', () => {
    const m = mask(4, 1, (x) => x === 0);
    const rgb = Uint8Array.from([200, 10, 10, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    fillOutside(rgb, m);
    expect([...rgb]).toEqual([200, 10, 10, 200, 10, 10, 200, 10, 10, 200, 10, 10]);
  });

  it('reads row extents, borrowing the nearest row where a row is empty', () => {
    const m = mask(5, 3, (x, y) => y === 1 && x >= 1 && x <= 3);
    expect(rowExtents(m)).toEqual([
      [1, 3],
      [1, 3],
      [1, 3],
    ]);
  });

  it('folds or wraps the front round the sides, meeting the front and back tiles', () => {
    const size = 4;
    // Front: column index as the red channel.
    const front = Uint8Array.from({ length: size * size * 3 }, (_, i) =>
      i % 3 === 0 ? (Math.floor(i / 3) % size) * 50 : 0
    );
    const ext = [[0, 3] as const];
    const fold = sideTile(front, ext, size, 'right', 1, 'fold');
    // Both ends of the folded right side sit at the front's right edge.
    expect(fold[0]).toBeGreaterThanOrEqual(100);
    expect(fold[(size - 1) * 3]).toBeGreaterThanOrEqual(100);
    const wrap = sideTile(front, ext, size, 'right', 1, 'wrap');
    expect(wrap[0]).toBe(0);
    expect(wrap[(size - 1) * 3]).toBe(150);
    expect(mirrorTile(front, size)[0]).toBe(150);
  });

  it('lays out an atlas and paints a model point from its tile', () => {
    const size = 8;
    const front = new Uint8Array(size * size * 3).fill(100);
    const m = mask(size, size, () => true);
    const box = [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5] as const;
    const atlas = skinAtlas(front, m, box);
    expect(atlas.width).toBe(size * FACE_ATLAS_COLS);
    expect(faceSlot('front')).toBe(0);
    const paint = skinPaint(atlas, box, { yaw: 0, pitch: 0 });
    expect(paint([0, 0, 0.5], [0, 0, 1], 0)).toEqual([100, 100, 100]);
  });

  it('drops what shows through a plain part, keeps a patterned one', () => {
    const n = 10;
    const render = {
      part: new Int16Array(n).fill(0),
      rgb: new Uint8ClampedArray(n * 3).fill(60),
    } as unknown as FlatRender;
    const photo = new Uint8Array(n * 3).fill(60);
    // Two pixels of red drape between dark legs.
    photo.set([220, 20, 20, 220, 20, 20], 0);
    const outline = { cols: n, rows: 1, data: new Uint8Array(n).fill(1) };
    const gated = gateSkin(photo, render, outline);
    expect([...gated.data]).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    // Half the pixels far off: a pattern, all kept.
    for (let i = 0; i < 5; i++) photo.set([220, 20, 20], i * 3);
    expect(gateSkin(photo, render, outline).data.every((v) => v === 1)).toBe(true);
  });
});
