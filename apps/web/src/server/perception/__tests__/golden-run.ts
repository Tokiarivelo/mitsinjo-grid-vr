import sharp from 'sharp';
import { vi } from 'vitest';
import { kitToRecipe } from '@/lib/object-kit';
import type { ShapeTarget } from '@/lib/object-shape';
import type { ObjectKit } from '@/lib/object-kit';
import { cpuMs } from '@/test/cpu-time';
import { runObjectShape } from '../object-shape';
import {
  remapBoxToCrop,
  remapOutlineToCrop,
  writeCapture,
  type ShapeCapture,
} from '../shape-capture';
import { cropForShape, cropRectForShape } from '../shape-crop';
import {
  GOLDEN_SHAPES,
  goldenBox,
  goldenOutline,
  goldenSvg,
  PHOTO,
  type GoldenCase,
} from '../__fixtures__/shape';

/**
 * Golden set (PF-T9): the whole 3D shape math on one synthetic street photo, Spark answering instantly
 * with the case's (wrong) prior. The calling test file mocks `server-only`.
 */
export async function runGolden(c: GoldenCase, onKit?: (kit: ObjectKit) => void) {
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
  const t0 = performance.now();
  const cpu0 = cpuMs();
  const shape = await runObjectShape(spark, photo, 'data:full', target, onKit ? { onKit } : {});
  return { shape, ms: performance.now() - t0, cpuMs: cpuMs() - cpu0, photo, target };
}

/** A golden case run and written as a capture (`<dir>/<id>.capture.json` + crop JPEG), like `make shape-capture`. */
export async function writeGoldenCapture(
  dir: string,
  id: string,
  c: GoldenCase = GOLDEN_SHAPES.find((g) => g.name === 'fridge')!
): Promise<ShapeCapture> {
  let kit: ObjectKit | undefined;
  const { shape, photo, target } = await runGolden(c, (k) => (kit = k));
  const rect = cropRectForShape(photo.width, photo.height, target.box);
  const jpeg = Buffer.from((await cropForShape(photo, target.box)).split(',')[1]!, 'base64');
  const capture: ShapeCapture = {
    version: 1,
    id,
    capturedAt: new Date().toISOString(),
    source: 'meta',
    model: shape.model,
    photo: { width: photo.width, height: photo.height },
    target,
    kit: kit!,
    ...(shape.recipe ? { recipe: shape.recipe } : {}),
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
  writeCapture(dir, capture, jpeg);
  return capture;
}
