import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { profileGap, readUnderside, rowWidths } from '../car/car-underside';
import { decodeView } from '../recon/route';
import { alignTop } from '../recon/views';

/** A car seen from below on white paper: long on y, wide at the front (bottom rows), narrow behind. */
async function plan(cols: number, rows: number) {
  const rgb = new Uint8Array(cols * rows * 3).fill(255);
  const [y0, y1] = [Math.round(rows * 0.1), Math.round(rows * 0.9)];
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / (y1 - y0);
    const half = Math.round(cols * (0.15 + 0.2 * t));
    for (let x = cols / 2 - half; x < cols / 2 + half; x++)
      rgb.fill(40, (y * cols + x) * 3, (y * cols + x) * 3 + 3);
  }
  return sharp(Buffer.from(rgb), { raw: { width: cols, height: rows, channels: 3 } })
    .png()
    .toBuffer();
}

describe('vehicle underside read the way the plan is drawn (PQ-T76)', () => {
  it('measures an outline row by row', () => {
    const view = { cols: 4, rows: 2, mask: Uint8Array.from([1, 1, 0, 0, 1, 1, 1, 1]) };
    expect(rowWidths(view)).toEqual([0.5, 1]);
    expect(profileGap([0.5, 1], [0.5, 0.5])).toBeCloseTo(0.25);
  });

  it('turns an underside drawn across the sheet, or upside down, to match the plan', async () => {
    const upright = await plan(120, 300);
    const img = (await decodeView(upright))!;
    const read = alignTop(img, 40, 100)!;
    expect(read).not.toBeNull();
    for (const turn of [90, 180, 270]) {
      const drawn = await sharp(upright).rotate(turn).png().toBuffer();
      const got = await readUnderside(drawn, read.view, 40, 100, decodeView);
      expect(got).not.toBeNull();
      // Turned back upright: the outline is the plan's again.
      expect(profileGap(rowWidths(got!.read.view), rowWidths(read.view))).toBeLessThan(0.03);
    }
    // Without a plan: the first turn that reads; nothing when none agrees.
    expect((await readUnderside(upright, null, 40, 100, decodeView))!.turn).toBe(0);
    expect(await readUnderside(upright, null, 100, 10, decodeView)).toBeNull();
  });
});
