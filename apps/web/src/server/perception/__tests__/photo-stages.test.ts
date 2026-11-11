// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { Component } from '@/lib/shape-script';
import { kitToRecipe } from '@/lib/object-kit';
import type { ObjectRecipe } from '@/lib/object-shape';
import { renderFlat } from '../flat-render';
import {
  builtParts,
  judgedPhotoStages,
  photoCanEdit,
  photoStageScorer,
  photoTarget,
  scorePhoto,
  tagPhotoParts,
  type PhotoTarget,
} from '../photo-stages';
import { photoStageLoop } from '../shape-stages-spark';
import { photoStages } from '../view-stages';
import { emptyMask, fitGrid } from '../silhouette-fit';
import { KIT, front, side } from '../__fixtures__/views';
import sharp from 'sharp';
import { ObjectRecipeSchema, type ShapeTarget } from '@/lib/object-shape';
import { GOLDEN_SHAPES, goldenBox, goldenOutline, goldenSvg, PHOTO } from '../__fixtures__/shape';
import { runObjectShape } from '../object-shape';
import { viewsRecipe } from '../object-views';

const car: ObjectRecipe = viewsRecipe({ front, side }, KIT);
const ASPECT = 2;
const { cols, rows } = fitGrid(ASPECT);

/** A target read off a model's own render: silhouette and part boxes the photo "shows". */
function targetOf(good: ObjectRecipe): PhotoTarget {
  const outline = renderFlat(good, ASPECT, cols, rows).mask;
  const { parts } = builtParts(good, ASPECT, emptyMask(cols, rows));
  return {
    aspect: ASPECT,
    crop: { cols, rows, rgb: new Uint8Array(cols * rows * 3).fill(200) },
    outline,
    parts: parts.filter((p) => p.kind === 'wheel' || p.kind === 'window'),
  };
}
const target = targetOf(car);
const stages = judgedPhotoStages('vehicle', target);

/** The same car with its first wheel moved far along the body. */
const moved = (r: ObjectRecipe): ObjectRecipe => {
  const i = r.parts.findIndex((p) => p.kind === 'wheel' && p.at[2] > 0);
  return {
    ...r,
    parts: r.parts.map((p, k) => (k === i ? { ...p, at: [p.at[0], p.at[1], p.at[2] + 0.3] } : p)),
  };
};

describe('photo stages (PQ-T19)', () => {
  it('stages follow what the photo drew: the body always, parts only when SAM read them', () => {
    expect(stages.map((s) => s.id)).toEqual(['body', 'glass', 'wheels']);
    expect(judgedPhotoStages('vehicle', { parts: [] }).map((s) => s.id)).toEqual(['body']);
    expect(photoStages('house')?.map((s) => s.id)).toEqual(['body', 'openings', 'chimney']);
    expect(photoStages('water')).toBeNull();
  });

  it('a model with a misplaced wheel scores lower on the wheels stage than the right one', () => {
    const good = scorePhoto(car, target, stages);
    const bad = scorePhoto(moved(car), target, stages);
    expect(good.stages.wheels).toBeGreaterThan(0.95);
    expect(bad.stages.wheels!).toBeLessThan(good.stages.wheels! - 0.1);
    expect(bad.overall).toBeLessThan(good.overall);
    const scorer = photoStageScorer(target, stages);
    expect(scorer(moved(car), 'wheels').stage).toBeLessThan(scorer(car, 'wheels').stage);
  });

  it('far-side and inferred parts are not editable, near measured ones are', () => {
    const c = (at: [number, number, number], status?: 'inferred' | 'measured'): Component => ({
      id: 'x',
      part: {
        shape: 'box',
        at,
        size: [0.1, 0.1, 0.1],
        color: '#ffffff',
        ...(status ? { status } : {}),
      },
    });
    expect(photoCanEdit(c([0, 0, 0.3]))).toBe(true);
    expect(photoCanEdit(c([0, 0, 0.3], 'measured'))).toBe(true);
    expect(photoCanEdit(c([0, 0, -0.3]))).toBe(false);
    expect(photoCanEdit(c([0, 0, 0.3], 'inferred'))).toBe(false);
  });

  it('tags the body and the wheels of a kit car, and leaves tagged parts alone', () => {
    const kit = kitToRecipe({
      archetype: 'vehicle',
      proportions: { w: 1, h: 0.45, d: 0.4 },
      colors: { main: '#a33327', secondary: '#cfd6dd', accent: '#1d1c1c' },
    } as never);
    const tagged = tagPhotoParts(kit, 'vehicle');
    expect(tagged.parts.filter((p) => p.kind === 'body')).toHaveLength(1);
    expect(tagged.parts.filter((p) => p.kind === 'wheel').length).toBeGreaterThan(0);
    expect(tagPhotoParts(tagged, 'vehicle').parts).toEqual(tagged.parts);
  });

  it('a target needs an outline and a frame', () => {
    const base = {
      crop: target.crop,
      masks: [],
      geom: {
        photoW: 100,
        photoH: 50,
        box: { x: 0, y: 0, w: 1, h: 1 },
        crop: { left: 0, top: 0, width: 100, height: 50, outWidth: 100, outHeight: 50 },
      },
    };
    expect(photoTarget({ ...base, aspect: ASPECT, outline: emptyMask(cols, rows) })).toBeNull();
    expect(photoTarget({ ...base, aspect: 0, outline: target.outline })).toBeNull();
    expect(photoTarget({ ...base, aspect: ASPECT, outline: target.outline })?.parts).toEqual([]);
  });

  it('the loop brings a misplaced wheel back and never lowers the score; far parts stay put', async () => {
    const start = tagPhotoParts(moved(car), 'vehicle');
    const wheelId = 'wheel';
    const good = car.parts.filter((p) => p.kind === 'wheel' && p.at[2] > 0)[0]!;
    const proposeShapeOps = vi.fn(async (_i: string, q: string) => ({
      result: {
        ops: q.includes('Stage: wheels (round 1)') ? [{ op: 'set', id: wheelId, at: good.at }] : [],
      },
    }));
    const before = scorePhoto(start, target, stages);
    const out = await photoStageLoop({
      recipe: start,
      archetype: 'vehicle',
      target,
      label: 'car',
      proposeShapeOps,
      firstBudgetMs: 60_000,
    })!;
    const after = scorePhoto(out.recipe, target, stages);
    expect(proposeShapeOps).toHaveBeenCalled();
    expect(after.stages.wheels!).toBeGreaterThan(before.stages.wheels!);
    expect(after.overall).toBeGreaterThanOrEqual(before.overall);
    expect(proposeShapeOps.mock.calls.every(([img]) => img.startsWith('data:image/png'))).toBe(
      true
    );
  }, 60_000);

  it('no stage list, no loop', () => {
    expect(
      photoStageLoop({
        recipe: car,
        archetype: 'water',
        target,
        label: 'pond',
        proposeShapeOps: vi.fn(),
        firstBudgetMs: 1000,
      })
    ).toBeNull();
  });

  it('runObjectShape starts the loop on the photo path with the photo sheet, and keeps a valid model', async () => {
    const c = GOLDEN_SHAPES.find((g) => g.name === 'car')!;
    const buffer = await sharp(Buffer.from(goldenSvg(c)))
      .jpeg({ quality: 85 })
      .toBuffer();
    const t: ShapeTarget = {
      id: 'car',
      label: 'car',
      category: 'other',
      box: goldenBox(c),
      outline: goldenOutline(c),
    };
    const describeShape = vi.fn().mockResolvedValue({
      recipe: kitToRecipe(c.prior),
      kit: c.prior,
      source: 'meta',
      model: 'muse-spark-1.3',
    });
    const proposeShapeOps = vi.fn().mockResolvedValue({ ops: [] });
    const out = await runObjectShape(
      {
        describeShape,
        describeParts: vi.fn().mockResolvedValue({ recipe: null }),
        proposeShapeOps,
      },
      { buffer, ...PHOTO },
      'data:full',
      t
    );
    expect(out.mode).toBe('recipe');
    expect(ObjectRecipeSchema.safeParse(out.recipe).success).toBe(true);
    // A bare car with no SAM parts judges only its body: nothing to ask, the seed model ships as is.
    expect(proposeShapeOps.mock.calls.every((call) => call[3] === 'photo')).toBe(true);
  }, 60_000);
});
