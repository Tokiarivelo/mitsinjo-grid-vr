import { describe, expect, it } from 'vitest';
import { bleedPaper, maskAt, shrink, trimPaper } from '../recon/texture';
import { alignViews } from '../recon/views';
import type { ViewImage } from '../recon/grid';

const WHITE = [255, 255, 255] as const;
const RED = [200, 30, 30] as const;

/** A white sheet with a coloured rectangle. */
function sheet(cols: number, rows: number, box: [number, number, number, number]): ViewImage {
  const rgb = new Uint8Array(cols * rows * 3).fill(255);
  for (let y = box[1]; y < box[3]; y++)
    for (let x = box[0]; x < box[2]; x++) rgb.set(RED, (y * cols + x) * 3);
  return { cols, rows, rgb };
}

describe('face textures', () => {
  it('bleeds the object colour over all the paper', () => {
    const { cols, rows, rgb } = sheet(16, 16, [4, 4, 12, 12]);
    const mask = new Uint8Array(cols * rows);
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) mask[y * cols + x] = 1;
    bleedPaper(rgb, mask, cols, rows, 2);
    // Next to the object (bled) and far in a corner row/column of it (filled from the nearest).
    for (const [x, y] of [
      [3, 6],
      [0, 6],
      [8, 15],
    ])
      expect([...rgb.subarray((y! * cols + x!) * 3, (y! * cols + x!) * 3 + 3)]).toEqual([...RED]);
  });

  it('takes paper out of a coarse mask but keeps enclosed pale areas', () => {
    const { cols, rows, rgb } = sheet(16, 16, [4, 4, 12, 12]);
    // A white window inside the red wall.
    for (let y = 7; y < 9; y++) for (let x = 7; x < 9; x++) rgb.set(WHITE, (y * cols + x) * 3);
    // The coarse mask is one pixel too wide all around.
    const coarse = new Uint8Array(cols * rows);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) coarse[y * cols + x] = 1;
    const fine = trimPaper(rgb, coarse, cols, rows, WHITE);
    expect(fine[3 * cols + 3]).toBe(0);
    expect(fine[4 * cols + 4]).toBe(1);
    expect(fine[7 * cols + 7]).toBe(1);
    expect(shrink(fine, cols, rows, 1)[4 * cols + 4]).toBe(0);
  });

  it('resamples a grid mask to the tile size', () => {
    const view = { cols: 2, rows: 2, rgb: new Uint8Array(12), mask: Uint8Array.from([1, 0, 0, 1]) };
    const m = maskAt(view, 4, 4);
    expect([...m]).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
  });

  it('records where each canonical view sits on its drawing', () => {
    const aligned = alignViews({
      front: sheet(80, 80, [10, 20, 70, 60]),
      right: sheet(80, 80, [20, 20, 60, 60]),
      back: sheet(80, 80, [10, 20, 70, 60]),
    })!;
    expect(aligned.frames.front).toMatchObject({ mirrored: false, cols: 80, rows: 80 });
    expect(aligned.frames.front!.box).toMatchObject({ x0: 10, x1: 69, y0: 20, y1: 59 });
    // Right and back are drawn mirrored relative to the object axes.
    expect(aligned.frames.right!.mirrored).toBe(true);
    expect(aligned.frames.back!.mirrored).toBe(true);
    expect(aligned.frames.left).toBeUndefined();
  });
});
