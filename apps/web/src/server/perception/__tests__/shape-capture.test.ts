// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { ObjectKit } from '@/lib/object-kit';
import { kitToRecipe } from '@/lib/object-kit';
import { ShapeTargetSchema, type ShapeTarget } from '@/lib/object-shape';
import type { ApplianceDetection } from '@/lib/vision';
import { getPerceptionClient } from '../client';
import { pathToRings } from '../mask-outline';
import { runObjectShape } from '../object-shape';
import { prepareVisionImage } from '../prepare-image';
import { runVisionPipeline } from '../vision-pipeline';
import { photoSize } from '../vision-request';
import { GOLDEN_SHAPES, goldenBox, goldenOutline, goldenSvg, PHOTO } from '../__fixtures__/shape';
import { cropForShape, cropRectForShape } from '../shape-crop';
import {
  criticReplay,
  pickDetection,
  remapBoxToCrop,
  remapOutlineToCrop,
  readCapture,
  rescoreCapture,
  writeCapture,
  type ShapeCapture,
  captureMasks,
} from '../shape-capture';
import { KIT_PROMPT_VERSION } from '../shape';
import { writeGoldenCapture } from './golden-run';

/** Golden fridge as a photo + target, Spark stubbed with the case prior. */
async function goldenRun(onKit?: (kit: ObjectKit) => void) {
  const c = GOLDEN_SHAPES.find((g) => g.name === 'fridge')!;
  const buffer = await sharp(Buffer.from(goldenSvg(c)))
    .jpeg({ quality: 85 })
    .toBuffer();
  const photo = { buffer, ...PHOTO };
  const target: ShapeTarget = {
    id: c.name,
    label: c.name,
    category: 'other',
    box: goldenBox(c),
    outline: goldenOutline(c),
  };
  const spark = {
    describeShape: vi.fn().mockResolvedValue({
      recipe: kitToRecipe(c.prior),
      kit: c.prior,
      source: 'meta',
      model: 'muse-spark-1.3',
    }),
    describeParts: vi.fn().mockResolvedValue({ recipe: null }),
  };
  const shape = await runObjectShape(spark, photo, 'data:full', target, { onKit });
  return { photo, target, shape, prior: c.prior };
}

describe('shape capture (PR-0.4)', () => {
  it('observes the kit and remaps the target into crop space', async () => {
    const kits: ObjectKit[] = [];
    const { photo, target, shape } = await goldenRun((k) => kits.push(k));
    expect(kits).toHaveLength(1);
    expect(shape.mode).toBe('recipe');

    const rect = cropRectForShape(photo.width, photo.height, target.box);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.left + rect.width).toBeLessThanOrEqual(photo.width);
    expect(rect.top + rect.height).toBeLessThanOrEqual(photo.height);

    const box = remapBoxToCrop(target.box, photo.width, photo.height, rect);
    for (const v of [box.x, box.y, box.w, box.h]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const outline = remapOutlineToCrop(target.outline!, photo.width, photo.height, rect);
    expect(pathToRings(outline).length).toBe(pathToRings(target.outline!).length);

    // The rect matches the actual crop bytes sent to Spark.
    const jpeg = Buffer.from((await cropForShape(photo, target.box)).split(',')[1]!, 'base64');
    const size = await photoSize(jpeg);
    expect(size?.width).toBe(rect.outWidth);
    expect(size?.height).toBe(rect.outHeight);
  });

  it('writes, reads and re-scores a capture offline (no API)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shape-capture-'));
    const capture = await writeGoldenCapture(dir, 'fridge');
    expect(existsSync(join(dir, 'fridge.capture.json'))).toBe(true);
    expect(existsSync(join(dir, 'fridge.crop.jpg'))).toBe(true);

    const { capture: back } = await readCapture(dir, 'fridge');
    expect(back).toEqual(capture);

    const replay = await rescoreCapture(dir, 'fridge');
    expect(replay).not.toBeNull();
    expect(replay!.score.iou).toBeGreaterThan(0.6);
    expect(replay!.score.score).toBeGreaterThan(0);
  });

  it('keeps the kit prompt version; captures without one still load (PQ-T5)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shape-capture-'));
    const capture = await writeGoldenCapture(dir, 'fridge');
    expect(capture.promptVersion).toBeUndefined();
    expect((await readCapture(dir, 'fridge')).capture.promptVersion).toBeUndefined();
    writeCapture(dir, { ...capture, promptVersion: 2 }, readFileSync(join(dir, 'fridge.crop.jpg')));
    expect((await readCapture(dir, 'fridge')).capture.promptVersion).toBe(2);
  });

  it('replays captured part masks on the whole crop (PQ-T1)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shape-capture-'));
    const car = GOLDEN_SHAPES.find((g) => g.name === 'car')!;
    const capture = await writeGoldenCapture(dir, 'car', car);
    const plain = (await rescoreCapture(dir, 'car'))!;
    expect(plain.score.detail?.partRecall).toBeUndefined();
    // The two wheels of the drawing, in fractions of the captured crop.
    const { box } = capture.cropTarget;
    const wheel = (x0: number, x1: number) => ({
      concept: 'wheel',
      box: {
        x: box.x + x0 * box.w,
        y: box.y + 0.82 * box.h,
        w: (x1 - x0) * box.w,
        h: 0.18 * box.h,
      },
    });
    writeCapture(
      dir,
      { ...capture, partMasks: [wheel(0.12, 0.38), wheel(0.62, 0.88)] },
      readFileSync(join(dir, 'car.crop.jpg'))
    );
    const withMasks = (await rescoreCapture(dir, 'car'))!;
    expect(withMasks.score.detail?.partRecall).toBeGreaterThan(0);
  });
});

describe('criticReplay (PR-0.6)', () => {
  /** Capture of a wrong kit (lamp over the fridge crop, low score) in a tmp dir. */
  async function degradedCapture() {
    const fridge = GOLDEN_SHAPES.find((g) => g.name === 'fridge')!;
    const lampPrior = GOLDEN_SHAPES.find((g) => g.name === 'lamp post')!.prior;
    const buffer = await sharp(Buffer.from(goldenSvg(fridge)))
      .jpeg({ quality: 85 })
      .toBuffer();
    const photo = { buffer, ...PHOTO };
    const target: ShapeTarget = {
      id: fridge.name,
      label: fridge.name,
      category: 'other',
      box: goldenBox(fridge),
      outline: goldenOutline(fridge),
    };
    const spark = {
      describeShape: vi.fn().mockResolvedValue({
        recipe: kitToRecipe(lampPrior),
        kit: lampPrior,
        source: 'meta',
        model: 'muse-spark-1.3',
      }),
      describeParts: vi.fn().mockResolvedValue({ recipe: null }),
    };
    const shape = await runObjectShape(spark, photo, 'data:full', target);
    if (shape.mode !== 'recipe' || !shape.recipe) throw new Error('no recipe');
    const rect = cropRectForShape(photo.width, photo.height, target.box);
    const jpeg = Buffer.from((await cropForShape(photo, target.box)).split(',')[1]!, 'base64');
    const capture: ShapeCapture = {
      version: 1,
      id: 'wrong-fridge',
      capturedAt: new Date().toISOString(),
      source: 'meta',
      model: shape.model,
      photo: { width: photo.width, height: photo.height },
      target,
      kit: lampPrior,
      recipe: shape.recipe,
      ...(shape.fit ? { fit: shape.fit } : {}),
      seconds: 0.1,
      crop: rect,
      cropTarget: {
        box: remapBoxToCrop(target.box, photo.width, photo.height, rect),
        outline: target.outline
          ? remapOutlineToCrop(target.outline, photo.width, photo.height, rect)
          : undefined,
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'shape-critic-'));
    writeCapture(dir, capture, jpeg);
    return dir;
  }

  it('keeps a fixing patch across rounds', async () => {
    const dir = await degradedCapture();
    const start = (await rescoreCapture(dir, 'wrong-fridge'))!.score.score;
    expect(start).toBeLessThan(70);
    const critic = {
      criticizeShape: vi.fn().mockResolvedValue({ patch: { archetype: 'cabinet' } }),
    };
    const out = await criticReplay(critic, dir, 'wrong-fridge', 3);
    expect(out.roundsRun).toHaveLength(3);
    expect(out.roundsRun[0]).toMatchObject({ kept: true });
    expect(out.score).toBeGreaterThan(start);
    expect(out.kit.archetype).toBe('cabinet');
    // Later rounds re-fire (the stub always patches) but cannot beat the fix.
    expect(out.roundsRun.slice(1).every((r) => !r.kept)).toBe(true);
  }, 120_000);

  it('drops a useless patch and stops on a null one', async () => {
    const dir = await degradedCapture();
    const critic = { criticizeShape: vi.fn().mockResolvedValue({ patch: { subtype: 'tall' } }) };
    const out = await criticReplay(critic, dir, 'wrong-fridge', 3);
    expect(out.roundsRun).toHaveLength(3);
    expect(out.roundsRun.every((r) => !r.kept)).toBe(true);
    const { capture } = await readCapture(dir, 'wrong-fridge');
    expect(out.recipe).toEqual(capture.recipe);

    const quiet = { criticizeShape: vi.fn().mockResolvedValue({ patch: null }) };
    const still = await criticReplay(quiet, dir, 'wrong-fridge', 3);
    expect(still.roundsRun).toHaveLength(0);
    expect(still.recipe).toEqual(capture.recipe);
    expect(quiet.criticizeShape).toHaveBeenCalledTimes(1);
  }, 120_000);
});

const LIVE = process.env.SHAPE_CAPTURE === '1';

describe('captureMasks (PR #9 review)', () => {
  it('keeps the valid part masks, drops malformed ones, empty without any', () => {
    const good = { concept: 'wheel', box: { x: 0.1, y: 0.6, w: 0.2, h: 0.3 } };
    expect(captureMasks({ partMasks: [good, { concept: 'wheel' }, null, 'x'] })).toEqual([good]);
    expect(captureMasks({})).toEqual([]);
  });
});

describe('pickDetection (PQ-T1)', () => {
  const det = (id: string, label: string, w: number) => ({ id, label, box: { w, h: w } });
  const ds = [
    det('det-1', 'police car', 0.6),
    det('det-2', 'dark grey car', 0.2),
    det('det-3', 'stone building', 0.9),
  ];

  it('takes a detection id first, then the biggest box whose label contains the pick', () => {
    expect(pickDetection(ds, 'det-2')!.id).toBe('det-2');
    expect(pickDetection(ds, 'car')!.id).toBe('det-1');
    expect(pickDetection(ds, 'GREY')!.id).toBe('det-2');
  });

  it('falls back to the first word of an id like car-side (the bug: no match, capture refused)', () => {
    expect(pickDetection(ds, 'car-side')!.id).toBe('det-1');
    expect(pickDetection(ds, 'water-tank')).toBeNull();
    expect(pickDetection([], 'car')).toBeNull();
  });
});

describe.skipIf(!LIVE)('make shape-capture', () => {
  it('captures one live run (detect → outline → Spark kit → recipe) as fixtures', async () => {
    const photoPath = process.env.SHAPE_CAPTURE_PHOTO;
    const id = process.env.SHAPE_CAPTURE_ID;
    const dir = process.env.SHAPE_CAPTURE_DIR;
    if (!photoPath || !id || !dir)
      throw new Error('Usage: make shape-capture PHOTO=path/to/photo.jpg ID=car1 [LABEL=car]');
    // PQ-T1: what to pick on the photo (detection id or label part); default = the ID.
    const pick = process.env.SHAPE_CAPTURE_LABEL || id;
    if (!/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(id))
      throw new Error(`ID must be a safe file name, got ${JSON.stringify(id)}`);

    const perception = getPerceptionClient('shape-capture');
    if (!perception.callsMeta)
      throw new Error('Refusing to capture mock: set LLM_PROVIDER=meta and META_API_KEY');

    const mime = /\.png$/i.test(photoPath)
      ? 'image/png'
      : /\.webp$/i.test(photoPath)
        ? 'image/webp'
        : 'image/jpeg';
    const prepared = await prepareVisionImage(readFileSync(photoPath), mime);
    const size = await photoSize(prepared.buffer);
    if (!size) throw new Error(`photo not readable: ${photoPath}`);
    const dataUrl = `data:${prepared.contentType};base64,${prepared.buffer.toString('base64')}`;

    let boxes: ApplianceDetection[] = [];
    let outlined: ApplianceDetection[] = [];
    await runVisionPipeline(perception, dataUrl, (event, data) => {
      if (event !== 'vision_detections') return;
      const ds = (data.detections ?? []) as ApplianceDetection[];
      if (data.phase === 'outlines') outlined = ds;
      else boxes = ds;
    });
    const detections = outlined.length > 0 ? outlined : boxes;
    if (detections.length === 0) throw new Error('no detections on this photo');
    const found = pickDetection(detections, pick);
    if (!found)
      throw new Error(
        `no detection matching ${JSON.stringify(pick)} (rerun with LABEL=…); candidates: ${detections.map((d) => `${d.id} (${d.label})`).join(', ')}`
      );
    console.info(`[vision] capture ${id} picks ${found.id} (${found.label})`);
    const target = ShapeTargetSchema.parse({
      id: found.id,
      label: found.label,
      category: found.category,
      ...(found.scenery ? { scenery: found.scenery } : {}),
      box: found.box,
      ...(found.outline ? { outline: found.outline } : {}),
    });

    let kit: ObjectKit | undefined;
    const started = Date.now();
    // Offline tooling, not the live path: give Spark room (the 60 s budget stays for routes).
    const shape = await runObjectShape(perception, size, dataUrl, target, {
      timeoutMs: 150_000,
      onKit: (k) => (kit = k),
    });
    const seconds = (Date.now() - started) / 1000;
    if (shape.mode !== 'recipe' || !shape.recipe || !kit)
      throw new Error(
        `capture needs a recipe, got ${shape.mode}${shape.mode === 'silhouette' ? ` (${shape.reason})` : ''}`
      );
    // The pipeline may segment the outline on demand: keep the one the recipe was fitted to.
    const outline = target.outline ?? shape.outline;
    const fitted = outline ? { ...target, outline } : target;
    const rect = cropRectForShape(size.width, size.height, target.box);
    const jpeg = Buffer.from((await cropForShape(size, target.box)).split(',')[1]!, 'base64');
    const capture: ShapeCapture = {
      version: 1,
      id,
      capturedAt: new Date().toISOString(),
      source: 'meta',
      model: shape.model,
      photo: { width: size.width, height: size.height },
      target: fitted,
      kit,
      promptVersion: KIT_PROMPT_VERSION,
      recipe: shape.recipe,
      ...(shape.fit ? { fit: shape.fit } : {}),
      // PQ-T1: SAM part masks (crop fractions) so the replay scores parts too.
      ...(shape.partMasks?.length ? { partMasks: shape.partMasks } : {}),
      seconds,
      crop: rect,
      cropTarget: {
        box: remapBoxToCrop(target.box, size.width, size.height, rect),
        outline: outline ? remapOutlineToCrop(outline, size.width, size.height, rect) : undefined,
      },
    };
    const [json, jpg] = writeCapture(dir, capture, jpeg);
    const replay = await rescoreCapture(dir, id);
    console.info(
      `[vision] captured ${id}: ${shape.recipe.parts.length} parts in ${seconds.toFixed(1)} s` +
        (replay
          ? `, offline rescore iou=${replay.score.iou} score=${replay.score.score}`
          : ', no outline: rescore skipped') +
        `\n  ${json}\n  ${jpg}`
    );
  }, 300_000);
});
