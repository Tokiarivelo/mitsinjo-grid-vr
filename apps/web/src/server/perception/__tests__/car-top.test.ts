import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { colorGap, readCarTop, spineColors, topEdgeColors } from '../car/car-top';
import { decodeView } from '../recon/route';

const BLUE = [20, 90, 200] as const;
const CREAM = [230, 225, 200] as const;

/** A pick-up from above on white paper: cream canopy over the rear 60 %, blue cab and bonnet in front. */
async function plan(cols: number, rows: number) {
  const rgb = new Uint8Array(cols * rows * 3).fill(255);
  const [y0, y1] = [Math.round(rows * 0.1), Math.round(rows * 0.9)];
  for (let y = y0; y < y1; y++) {
    const c = (y - y0) / (y1 - y0) < 0.6 ? CREAM : BLUE;
    for (let x = Math.round(cols * 0.2); x < Math.round(cols * 0.8); x++)
      rgb.set(c, (y * cols + x) * 3);
  }
  return sharp(Buffer.from(rgb), { raw: { width: cols, height: rows, channels: 3 } })
    .png()
    .toBuffer();
}

/** Its canonical profile (columns back → front): the canopy high behind, the bonnet low in front. */
function profile(cols: number, rows: number) {
  const rgb = new Uint8Array(cols * rows * 3);
  const mask = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    const back = c / cols < 0.6;
    for (let r = back ? 2 : Math.round(rows / 2); r < rows; r++) {
      mask[r * cols + c] = 1;
      rgb.set(back ? CREAM : BLUE, (r * cols + c) * 3);
    }
  }
  return { cols, rows, rgb, mask };
}

describe("a vehicle's view from above turned the way its profile runs (PQ-T78)", () => {
  it('reads the colours under the top edge and down the centre line', () => {
    const side = profile(10, 8);
    expect(topEdgeColors(side)[0]).toEqual([...CREAM]);
    expect(topEdgeColors(side)[9]).toEqual([...BLUE]);
    expect(
      spineColors({ cols: 2, rows: 1, rgb: new Uint8Array(6), mask: new Uint8Array(2) })
    ).toEqual([null]);
    expect(colorGap([[0, 0, 0]], [[255, 255, 255]])).toBeCloseTo(1, 2);
    expect(colorGap([null], [[1, 2, 3]])).toBe(1);
  });

  it('turns a plan laid across the sheet or drawn front up; keeps an upright one', async () => {
    const upright = await plan(120, 300);
    const side = profile(100, 40);
    expect((await readCarTop(upright, side, 40, 100, decodeView))!.turn).toBe(0);
    for (const turn of [90, 180, 270]) {
      const drawn = await sharp(upright).rotate(turn).png().toBuffer();
      const got = (await readCarTop(drawn, side, 40, 100, decodeView))!;
      // Turned back: the canopy (cream) at the back rows, the bonnet (blue) at the front.
      const spine = spineColors(got.read.view);
      expect(spine[10]![2]).toBeGreaterThan(150);
      expect(spine[90]![0]).toBeLessThan(80);
      expect(colorGap(spine, topEdgeColors(side))).toBeLessThan(0.1);
    }
    // Without a profile: the first turn that reads; nothing when none agrees.
    expect((await readCarTop(upright, null, 40, 100, decodeView))!.turn).toBe(0);
    expect(await readCarTop(upright, side, 60, 60, decodeView)).toBeNull();
  });
});
