import { describe, expect, it } from 'vitest';
import {
  BARK_RGB,
  cleanPlantFront,
  isSky,
  fromHsv,
  trunkStart,
  type CleanFrame,
} from '../tour-mock/plant-clean';
import { hsv, isFoliage } from '../tree/tree-fit';

/** A 40×50 tree: a round crown (rows 0–34) with a sky hole, a 6-wide trunk below, grass beside it. */
function tree(crown: [number, number, number] = [60, 120, 40]): CleanFrame {
  const [W, H] = [40, 50];
  const rgb = new Uint8Array(W * H * 3);
  const mask = new Uint8Array(W * H);
  const put = (x: number, y: number, c: readonly number[]) => rgb.set(c, (y * W + x) * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (y < 35 && Math.hypot(x - 20, y - 17) <= 17) {
        mask[i] = 1;
        put(x, y, Math.hypot(x - 14, y - 12) <= 3 ? [170, 200, 240] : crown);
      } else if (y >= 35 && x >= 17 && x < 23) {
        mask[i] = 1;
        put(x, y, x === 22 && y > 45 ? [70, 150, 50] : [90, 70, 50]);
      }
    }
  return { rgb, mask, width: W, height: H };
}
const at = (f: CleanFrame, out: Uint8Array, x: number, y: number) =>
  Array.from(out.subarray((y * f.width + x) * 3, (y * f.width + x) * 3 + 3));

describe('tour plant cleaning (VS-T46)', () => {
  it('finds the trunk under the crown', () => {
    const f = tree();
    // The crown's narrow last rows count as trunk too (under a third of the widest row).
    const start = trunkStart(f.mask, f.width, f.height);
    expect(start).toBeGreaterThanOrEqual(32);
    expect(start).toBeLessThanOrEqual(35);
    expect(
      trunkStart(
        f.mask.map((v, i) => (i >= 30 * 40 ? 0 : v)),
        40,
        50
      )
    ).toBe(50);
  });

  it('fills the sky seen through the crown with a darker leaf green', () => {
    const f = tree();
    const out = cleanPlantFront(f, { habit: 'round', leaf: 'broad' })!;
    const [r, g, b] = at(f, out, 14, 12);
    expect(isFoliage(r!, g!, b!)).toBe(true);
    expect(g).toBeLessThan(120);
    // Leaves stay as photographed.
    expect(at(f, out, 25, 20)).toEqual([60, 120, 40]);
  });

  it('turns a trunk stray into bark, never into leaves', () => {
    const f = tree();
    const out = cleanPlantFront(f, { habit: 'round', leaf: 'broad' })!;
    const [r, g, b] = at(f, out, 22, 47);
    expect(Math.hypot(r! - 90, g! - 70, b! - 50)).toBeLessThanOrEqual(BARK_RGB);
    expect(isFoliage(r!, g!, b!)).toBe(false);
  });

  it('keeps a cypress leafy to the ground: no trunk cut under it', () => {
    const f = tree();
    const out = cleanPlantFront(f, { habit: 'columnar', leaf: 'scale' })!;
    const [r, g, b] = at(f, out, 20, 45);
    expect(at(f, out, 20, 45)).not.toEqual([90, 70, 50]);
    expect(isFoliage(r!, g!, b!)).toBe(true);
  });

  it('tints a backlit crown green at its own brightness', () => {
    const f = tree([40, 42, 40]);
    const out = cleanPlantFront(f, { habit: 'round', leaf: 'needle' })!;
    const [r, g, b] = at(f, out, 25, 20);
    expect(isFoliage(r!, g!, b!)).toBe(true);
    expect(hsv(r!, g!, b!)[2]).toBeCloseTo(hsv(40, 42, 40)[2], 1);
  });

  it('leaves palms, bare trees and photos outside the outline alone', () => {
    const f = tree();
    expect(cleanPlantFront(f, { habit: 'palm', leaf: 'frond' })).toBeNull();
    expect(cleanPlantFront(f, { habit: 'round', leaf: 'none' })).toBeNull();
    const out = cleanPlantFront(f, { habit: 'round', leaf: 'broad' })!;
    expect(at(f, out, 0, 49)).toEqual([0, 0, 0]);
  });

  it('tells the sky and clouds from leaves', () => {
    expect(isSky(150, 190, 235)).toBe(true);
    expect(isSky(225, 228, 230)).toBe(true);
    expect(isSky(60, 120, 40)).toBe(false);
    expect(isSky(200, 220, 90)).toBe(false);
    expect(isSky(90, 70, 50)).toBe(false);
  });

  it('converts hsv back to rgb', () => {
    const [r, g, b] = fromHsv(120, 1, 1);
    expect([r, g, b]).toEqual([0, 255, 0]);
    const back = hsv(...fromHsv(100, 0.4, 0.5));
    expect(back[0]).toBeCloseTo(100, 0);
  });
});
