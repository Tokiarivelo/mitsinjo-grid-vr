import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { tightCropForShape, tightRect } from '../shape-crop';

async function redPhoto() {
  const buffer = await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  return { buffer, width: 200, height: 100 };
}
const decode = async (url: string) =>
  sharp(Buffer.from(url.split(',')[1]!, 'base64'))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

describe('tight crop (PQ-T8)', () => {
  const box = { x: 0.25, y: 0.2, w: 0.5, h: 0.6 };

  it('bounds: the box plus a small margin, inside the photo', () => {
    const r = tightRect(200, 100, box);
    expect(r.left).toBeLessThan(50);
    expect(r.left).toBeGreaterThanOrEqual(40);
    expect(r.width).toBeGreaterThan(100);
    expect(r.left + r.width).toBeLessThanOrEqual(200);
    const edge = tightRect(200, 100, { x: 0, y: 0, w: 1, h: 1 });
    expect(edge).toEqual({ left: 0, top: 0, width: 200, height: 100 });
  });

  it('outside the outline is grey, inside keeps the photo colour', async () => {
    // Outline = left half of the box only (photo fractions).
    const outline = 'M0.25 0.2 L0.5 0.2 L0.5 0.8 L0.25 0.8 Z';
    const url = await tightCropForShape(await redPhoto(), box, outline);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    const { data, info } = await decode(url);
    const px = (fx: number, fy: number) => {
      const i = (Math.floor(fy * info.height) * info.width + Math.floor(fx * info.width)) * 3;
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    };
    const inside = px(0.2, 0.5);
    const outside = px(0.9, 0.5);
    expect(inside[0]).toBeGreaterThan(200);
    expect(inside[1]).toBeLessThan(60);
    expect(Math.abs(outside[0]! - 128)).toBeLessThan(25);
    expect(Math.abs(outside[1]! - 128)).toBeLessThan(25);
  });

  it('no outline: the plain box, no grey', async () => {
    const { data } = await decode(await tightCropForShape(await redPhoto(), box));
    expect(data[0]).toBeGreaterThan(200);
    expect(data[1]).toBeLessThan(60);
  });
});

describe('kit question with the tight crop (PQ-T8)', () => {
  it('says which image is which; without it nothing changes', async () => {
    const { shapeQuestion } = await import('../shape');
    expect(shapeQuestion('Fridge', 0.7, 'cabinet')).not.toContain('second image');
    const q = shapeQuestion('Fridge', 0.7, 'cabinet', true, [], true);
    expect(q).toContain('second image is the object alone');
    expect(q).toContain('The third image is the validated front elevation');
  });
});
