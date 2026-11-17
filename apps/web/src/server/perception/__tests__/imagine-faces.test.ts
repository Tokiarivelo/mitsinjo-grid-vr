import { describe, expect, it } from 'vitest';
import { FACE_TILE, atlasUv, faceSlot, type AtlasTile } from '@/lib/face-atlas';
import { skinSample } from '@/lib/face-skin';
import { ObjectRecipeSchema, type ObjectRecipe } from '@/lib/object-shape';
import { recipeBox } from '../recipe-box';
import { renderFlat } from '../flat-render';
import { imagineFaces, imaginedDrawing, imaginedTile } from '../tour-mock/imagine-faces';
import { fbm, imaginedPaint, inkEdges, partSeams } from '../tour-mock/imagined-shader';
import sharp from 'sharp';

// Red on the right (+x), blue on the left, a green slab on top at the back (−z).
const RECIPE = {
  proportions: { w: 1, h: 0.6, d: 0.6 },
  parts: [
    {
      shape: 'box',
      at: [0.25, 0, 0],
      size: [0.5, 0.5, 0.6],
      color: '#d02020',
      material: 'plastic',
    },
    {
      shape: 'box',
      at: [-0.25, 0, 0],
      size: [0.5, 0.5, 0.6],
      color: '#2030d0',
      material: 'plastic',
    },
    {
      shape: 'box',
      at: [0, 0.27, -0.2],
      size: [1, 0.04, 0.2],
      color: '#20b020',
      material: 'plastic',
    },
  ],
} as ObjectRecipe;

const SIZE = 64;
/** Mean colour of a tile's region (fractions of its side). */
function mean(tile: Uint8Array, x0: number, x1: number, y0: number, y1: number) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = Math.floor(y0 * SIZE); y < y1 * SIZE; y++)
    for (let x = Math.floor(x0 * SIZE); x < x1 * SIZE; x++) {
      for (let c = 0; c < 3; c++) sum[c] = sum[c]! + tile[(y * SIZE + x) * 3 + c]!;
      n++;
    }
  return sum.map((v) => v / n);
}
const dominant = (rgb: number[]) => ['red', 'green', 'blue'][rgb.indexOf(Math.max(...rgb))];

describe('imagined faces (VS-T44)', () => {
  const box = recipeBox(RECIPE);
  const tile = (t: AtlasTile) => imaginedTile(RECIPE, box, t, SIZE);

  it('lays each face out as its canonical atlas tile', () => {
    // Front: x along the tile, blue left, red right.
    expect(dominant(mean(tile('front'), 0.1, 0.4, 0.5, 0.9))).toBe('blue');
    expect(dominant(mean(tile('front'), 0.6, 0.9, 0.5, 0.9))).toBe('red');
    // Back: mirrored, x still along the tile.
    expect(dominant(mean(tile('back'), 0.6, 0.9, 0.5, 0.9))).toBe('red');
    // The sides are their own colour.
    expect(dominant(mean(tile('right'), 0.3, 0.7, 0.5, 0.9))).toBe('red');
    expect(dominant(mean(tile('left'), 0.3, 0.7, 0.5, 0.9))).toBe('blue');
    // Sides along z, back first: the green slab at the top of their first third.
    expect(dominant(mean(tile('right'), 0.05, 0.3, 0.0, 0.12))).toBe('green');
    expect(dominant(mean(tile('left'), 0.05, 0.3, 0.0, 0.12))).toBe('green');
    // Top: rows back → front, x along: the slab at the top rows.
    expect(dominant(mean(tile('top'), 0.3, 0.7, 0.05, 0.25))).toBe('green');
    expect(dominant(mean(tile('top'), 0.6, 0.9, 0.6, 0.95))).toBe('red');
    // Bottom: x along, no slab.
    expect(dominant(mean(tile('bottom'), 0.6, 0.9, 0.3, 0.7))).toBe('red');
  });

  it('reads back each face where the box skin samples it', () => {
    // The box skin (lib/face-skin, `box` mode) finds the right tile at the right place.
    const hit = skinSample([0.5, 0, 0.2], [1, 0, 0], box, { yaw: 0, pitch: 0 }, 'box');
    expect(hit.tile).toBe('right');
    const top = skinSample([0, 0.29, -0.25], [0, 1, 0], box, { yaw: 0, pitch: 0 }, 'box');
    expect(top.tile).toBe('top');
    // Back row of the top tile: near t = 0.
    expect(top.t).toBeLessThan(0.3);
    const [u] = atlasUv(faceSlot('right'), hit.s, hit.t);
    expect(u).toBeGreaterThan(0);
  });

  it(
    'wears the six faces on its pieces, the model left as built',
    { timeout: 60_000 },
    async () => {
      const faces = await imagineFaces({ ...RECIPE, yaw: 0.4 }, ['body', 'body', null]);
      expect(ObjectRecipeSchema.safeParse(faces.recipe).success).toBe(true);
      expect(faces.recipe.yaw).toBeUndefined();
      expect(faces.recipe.parts).toEqual(RECIPE.parts);
      expect(faces.recipe.skin).toMatchObject({ mode: 'box', pieces: ['body', 'body', 'plastic'] });
      const atlas = faces.recipe.skin!.atlas;
      const meta = await sharp(
        Buffer.from(atlas.slice(atlas.indexOf(',') + 1), 'base64')
      ).metadata();
      expect([meta.width, meta.height]).toEqual([FACE_TILE * 3, FACE_TILE * 2]);
    }
  );

  it('draws a face on white paper, the same every time', async () => {
    const faces = { base: RECIPE, box };
    const a = await imaginedDrawing(faces, { yaw: 0.6, pitch: 0.3 }, 96);
    const b = await imaginedDrawing(faces, { yaw: 0.6, pitch: 0.3 }, 96);
    expect(a.equals(b)).toBe(true);
    const { data } = await sharp(a).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255]);
  });

  it('shades with its light and inks the outline, foliage blobs stay one crown', () => {
    expect(fbm(1.3, 2.1, 0.7)).toBeGreaterThanOrEqual(0);
    expect(fbm(1.3, 2.1, 0.7)).toBeLessThanOrEqual(1);
    const paint = imaginedPaint(RECIPE, { yaw: 0, pitch: 0 }, box);
    expect(paint.lit).toBe(true);
    const r = renderFlat(RECIPE, 1, SIZE, SIZE, { yaw: 0, pitch: 0 }, undefined, paint);
    const before = Uint8Array.from(r.rgb);
    inkEdges(r, SIZE, SIZE, 0.5);
    let inked = 0;
    for (let i = 0; i < SIZE * SIZE; i++) if (r.rgb[i * 3] !== before[i * 3]) inked++;
    expect(inked).toBeGreaterThan(SIZE);
    const leaves = {
      ...RECIPE,
      parts: RECIPE.parts.map((p) => ({ ...p, material: 'foliage' as const })),
    };
    expect(partSeams(leaves)(0, 1)).toBe(false);
    expect(partSeams(RECIPE)(0, 1)).toBe(true);
  });
});
