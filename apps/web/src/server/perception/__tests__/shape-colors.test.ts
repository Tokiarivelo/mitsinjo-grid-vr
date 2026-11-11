// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { deltaE2000, hexToLab } from '../color-measure';
import { laplacianVariance, measurePhotoConditions } from '../photo-conditions';
import {
  EDGE_COLUMNS,
  SHARPNESS_MAX_SIDE,
  sampleNativeGray,
  sampleObjectGray,
  sampleObjectPixels,
} from '../shape-colors';

/** 320 × 240 sky with a dark pole 6 px wide at x 167–173, y 40–200. */
async function pole() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
    <rect width="320" height="240" fill="#8fb8de"/><rect x="167" y="40" width="6" height="160" fill="#3a3f44"/></svg>`;
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
  return { buffer, width: 320, height: 240 };
}

describe('sampleObjectPixels (PF-T2, PF-T9)', () => {
  it('regression (golden lamp post): a thin pole keeps its dark colour, no sky halo', async () => {
    // Before: the box was squeezed to a 96 px long side (pole < 4 px) and its edge pixels mixed with
    // the sky: the pole measured pale grey #9b9c9d.
    const box = { x: 150 / 320, y: 40 / 240, w: 40 / 320, h: 160 / 240 };
    const outline = `M${167 / 320} ${40 / 240}L${173 / 320} ${40 / 240}L${173 / 320} ${200 / 240}L${167 / 320} ${200 / 240}Z`;
    const px = await sampleObjectPixels(await pole(), box, outline);
    // 40 × 160 = 6 400 px fits the 96² budget: sampled at full size, inner 4 columns kept.
    expect(px.y.length).toBeGreaterThanOrEqual(64);
    expect(px.y.length).toBeLessThan(6 * 160);
    const pole0 = hexToLab('#3a3f44');
    let worst = 0;
    for (let i = 0; i < px.y.length; i++) {
      const lab = [px.lab[i * 3]!, px.lab[i * 3 + 1]!, px.lab[i * 3 + 2]!] as const;
      worst = Math.max(worst, deltaE2000(lab, pole0));
    }
    expect(worst).toBeLessThan(10);
  });
});

/** 2000 × 1200 wall with 8 × 5 framed windows: a large object with plenty of fine edges. */
async function facade(blurSigma = 0) {
  const windows = Array.from({ length: 40 }, (_, k) => {
    const x = 120 + (k % 8) * 225;
    const y = 100 + Math.floor(k / 8) * 210;
    return `<rect x="${x}" y="${y}" width="120" height="150" fill="#2b3a4a" stroke="#f1ece0" stroke-width="6"/>
      <line x1="${x + 60}" y1="${y}" x2="${x + 60}" y2="${y + 150}" stroke="#f1ece0" stroke-width="3"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1200">
    <rect width="2000" height="1200" fill="#c8aa78"/>${windows}</svg>`;
  const img = sharp(Buffer.from(svg));
  const buffer = await (blurSigma ? img.blur(blurSigma) : img).jpeg({ quality: 90 }).toBuffer();
  return { buffer, width: 2000, height: 1200 };
}

describe('sampleNativeGray (PQ-T7 sharpness)', () => {
  const whole = { x: 0, y: 0, w: 1, h: 1 };
  const sharpnessOf = async (photo: Awaited<ReturnType<typeof facade>>, box = whole) =>
    measurePhotoConditions({
      widthPx: box.w * photo.width,
      heightPx: box.h * photo.height,
      grid: null,
      nativeGrid: await sampleNativeGray(photo, box),
      hasOutline: false,
    }).sharpness;

  it("keeps the photo's own pixels up to the cap, and never enlarges a small box", async () => {
    const big = await sampleNativeGray(await facade(), whole);
    expect([big.width, big.height]).toEqual([SHARPNESS_MAX_SIDE, Math.round(1200 * (1024 / 2000))]);
    const small = await sampleNativeGray(await pole(), {
      x: 0.5,
      y: 40 / 240,
      w: 0.125,
      h: 160 / 240,
    });
    expect([small.width, small.height]).toEqual([40, 160]);
    expect(small.mask.every((m) => m === 1)).toBe(true);
  });

  it('regression (PR #11 review): a blurred photo of a large object is classed low', async () => {
    const sharpPhoto = await facade();
    const blurredPhoto = await facade(4);
    expect(await sharpnessOf(sharpPhoto)).toBe('high');
    expect(await sharpnessOf(blurredPhoto)).toBe('low');
    // Before: sharpness was read on the 256-column grid, where the 2000 px object is shrunk 8 times and the
    // blur with it: the blurred copy still measured far above the « low » limit.
    const shrunk = await sampleObjectGray(blurredPhoto, whole, undefined, EDGE_COLUMNS);
    expect(laplacianVariance(shrunk)).toBeGreaterThan(0.003);
  });

  it('regression: a sharp small object is not called blurred (the fixed grid enlarged it 6 times)', async () => {
    const box = { x: 150 / 320, y: 40 / 240, w: 40 / 320, h: 160 / 240 };
    expect(await sharpnessOf(await pole(), box)).not.toBe('low');
  });
});
