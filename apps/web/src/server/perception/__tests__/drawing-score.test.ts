// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { ObjectRecipe } from '@/lib/object-shape';
import {
  drawingPalette,
  drawingSheet,
  drawingTarget,
  scoreDrawing,
  scoreDrawingSide,
  skylineText,
  stackSheets,
} from '../drawing-score';
import type { Elevation } from '../facade-house';

/** Two volumes of different heights on white paper: tall block left, low block right. */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
  <rect width="600" height="400" fill="#f4f4f2"/>
  <rect x="60" y="60" width="240" height="300" fill="#a0522d"/>
  <rect x="300" y="220" width="240" height="140" fill="#a0522d"/>
</svg>`;

const front: Elevation = {
  aspect: 1.5,
  left: 0.1,
  right: 0.9,
  wallLeft: 0.1,
  wallRight: 0.9,
  top: 0.15,
  eave: 0.15,
  bottom: 0.9,
  ridge: null,
  windows: [],
  doors: [],
  chimneys: [],
  plinth: null,
  steps: [],
  panes: [],
  beams: [],
};
const proportions = { w: 1, h: 0.625, d: 0.5 };
const wall = (at: [number, number, number], size: [number, number, number]) => ({
  shape: 'box' as const,
  at,
  size,
  color: '#a0522d',
  kind: 'wall' as const,
});
/** What the template gives: one block the size of the whole box. */
const oneBox = { proportions, parts: [wall([0, 0, 0], [1, 1, 1])] } as ObjectRecipe;
/** What a modeller builds: the two volumes. */
const twoVolumes = {
  proportions,
  parts: [wall([-0.25, 0, 0], [0.5, 1, 1]), wall([0.25, -0.267, 0], [0.5, 0.467, 1])],
} as ObjectRecipe;

describe('drawing score (PQ-T59)', () => {
  it('reads the inked object from the drawing, not the paper', async () => {
    const png = await sharp(Buffer.from(SVG)).png().toBuffer();
    const target = (await drawingTarget(png, front))!;
    const share = target.ink.reduce((n, v) => n + v, 0) / target.ink.length;
    // Drawn area = (240·300 + 240·140) / (600·400) = 0.44.
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.48);
  });

  it('before: a stepped house scored like its bounding box; now the two volumes win', async () => {
    const png = await sharp(Buffer.from(SVG)).png().toBuffer();
    const target = (await drawingTarget(png, front))!;
    const box = scoreDrawing(oneBox, front, target);
    const built = scoreDrawing(twoVolumes, front, target);
    expect(built.iou).toBeGreaterThan(0.9);
    expect(box.iou).toBeLessThan(0.8);
    expect(built.score).toBeGreaterThan(box.score + 5);
    const sheet = await drawingSheet(png, target, built);
    expect(sheet).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('gives the writer the skyline: tall on the left, low on the right', async () => {
    const png = await sharp(Buffer.from(SVG)).png().toBuffer();
    const target = (await drawingTarget(png, front))!;
    const text = skylineText(target, front);
    expect(text).toContain('-0.48:0.50');
    expect(text).toMatch(/0\.48:-0\.0[1-5]/);
  });

  it('reads the palette on the drawing and scores the side view (PQ-T63)', async () => {
    const png = await sharp(Buffer.from(SVG)).png().toBuffer();
    const target = (await drawingTarget(png, front))!;
    const palette = drawingPalette(target);
    // The drawn wood tone, not the paper.
    expect(palette[0]).toMatch(/^#(9|a)[0-9a-f]5[0-9a-f]2[0-9a-f]$/);
    // The same drawing used as a side view: a full-depth block matches its bounding box only.
    const asSide = scoreDrawingSide(oneBox, front, target);
    expect(asSide.iou).toBeGreaterThan(0.3);
    expect(asSide.iou).toBeLessThan(0.85);
    const a = (await drawingSheet(png, target, scoreDrawing(twoVolumes, front, target)))!;
    const b = (await drawingSheet(png, target, asSide))!;
    expect(await stackSheets(a, b)).toMatch(/^data:image\/jpeg;base64,/);
    expect(skylineText(target, front, 'side')).toContain('z:top y');
  });

  it('answers null on an unreadable or blank drawing', async () => {
    expect(await drawingTarget(Buffer.from('nope'), front)).toBeNull();
    const blank = await sharp({
      create: { width: 60, height: 40, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    expect(await drawingTarget(blank, front)).toBeNull();
  });
});
