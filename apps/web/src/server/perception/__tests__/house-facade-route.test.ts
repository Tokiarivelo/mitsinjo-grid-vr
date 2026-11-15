// @vitest-environment node
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const generateFacadeImage = vi.fn();
const museImage = vi.fn();
const museImageReady = vi.fn(() => true);
vi.mock('../facade-specialist', () => ({
  generateFacadeImage: (...a: unknown[]) => generateFacadeImage(...a),
  museImage: (...a: unknown[]) => museImage(...a),
  museImageReady: () => museImageReady(),
}));

import { kitToRecipe } from '@/lib/object-kit';
import type { ShapeTarget } from '@/lib/object-shape';
import { GOLDEN_SHAPES, goldenBox, goldenOutline, goldenSvg, PHOTO } from '../__fixtures__/shape';
import { routeHouseFacade } from '../house-facade-route';
import { runObjectShape } from '../object-shape';

const W = 1000;
const H = 1000;
type Box = [number, number, number, number];
const inst = ([x0, y0, x1, y1]: Box, outline?: string) => ({
  box: { x1: x0 * W, y1: y0 * H, x2: x1 * W - 1, y2: y1 * H - 1 },
  confidence: 0.9,
  ...(outline ? { outline } : {}),
});
const answer = (boxes: Array<ReturnType<typeof inst>>) => ({
  concept: 'x',
  boxCoverage: 0.1,
  count: boxes.length,
  instances: boxes,
  imageWidth: W,
  imageHeight: H,
  source: 'meta' as const,
  model: 'sam-3.1',
});
/** Facade answers: house + peaked roof + wall + 2 windows + door. */
const FACADE = {
  house: [inst([0.1, 0.1, 0.9, 0.9])],
  roof: [inst([0.1, 0.1, 0.9, 0.4], 'M0.1 0.4L0.5 0.1L0.9 0.4Z')],
  wall: [inst([0.12, 0.4, 0.88, 0.9])],
  window: [inst([0.2, 0.5, 0.3, 0.6]), inst([0.7, 0.5, 0.8, 0.6])],
  door: [inst([0.45, 0.6, 0.55, 0.9])],
  chimney: [],
};
/** Side answers: narrower end elevation, one window. */
const SIDE = {
  house: [inst([0.3, 0.1, 0.7, 0.9])],
  roof: [inst([0.3, 0.1, 0.7, 0.4], 'M0.3 0.4L0.5 0.1L0.7 0.4Z')],
  wall: [inst([0.32, 0.4, 0.68, 0.9])],
  window: [inst([0.45, 0.5, 0.55, 0.6])],
  chimney: [],
};
const DRAWN_URL = 'https://r2.example/drawn-facade.png';
/** SAM stub: facade answers on the drawing (and side data URLs), empty on the photo. */
function segmenter(
  front: Record<string, Array<ReturnType<typeof inst>>>,
  side: Record<string, Array<ReturnType<typeof inst>>> = SIDE
) {
  return vi.fn(async (url: string, concept: string) =>
    answer(
      url === DRAWN_URL
        ? (front[concept] ?? [])
        : url.startsWith('data:')
          ? (side[concept] ?? [])
          : []
    )
  );
}

const DRAWN = {
  imageUrl: DRAWN_URL,
  fileKey: 'drawn',
  prompt: 'clean front',
  archetype: 'house' as const,
  source: 'meta' as const,
};

beforeEach(() => {
  generateFacadeImage.mockReset();
  museImage.mockReset();
  museImageReady.mockReset();
  museImageReady.mockReturnValue(true);
  generateFacadeImage.mockResolvedValue(DRAWN);
  let n = 0;
  museImage.mockImplementation(async () => Buffer.from(`side-${n++}`));
});

const target = (extra?: Partial<ShapeTarget>): ShapeTarget => ({
  id: 'cottage',
  label: 'cottage',
  category: 'other',
  box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  ...extra,
});
const photoOf = async (name: string) => {
  const golden = GOLDEN_SHAPES.find((g) => g.name === name)!;
  const buffer = await sharp(Buffer.from(goldenSvg(golden)))
    .jpeg({ quality: 85 })
    .toBuffer();
  return { photo: { buffer, ...PHOTO }, box: goldenBox(golden), outline: goldenOutline(golden) };
};

describe('routeHouseFacade (PQ-T44 remedy 1)', () => {
  it('draws a clean facade and measures it when the photo has no drawing', async () => {
    const { photo } = await photoOf('cottage row');
    const out = await routeHouseFacade({
      hint: 'house',
      target: target(),
      photo,
      segment: segmenter(FACADE),
    });
    expect(generateFacadeImage).toHaveBeenCalledTimes(1);
    expect(generateFacadeImage.mock.calls[0]![0]).toMatchObject({
      target: target(),
      cleanFront: {},
    });
    expect(out?.front.windows).toHaveLength(2);
    expect(out?.front.doors).toHaveLength(1);
    expect(out?.side).not.toBeNull();
    expect(museImage).toHaveBeenCalled();
  });

  it('drawing failure, unreadable drawing and blind drawings fall back (null)', async () => {
    const { photo } = await photoOf('cottage row');
    const seg = segmenter(FACADE);
    generateFacadeImage.mockRejectedValueOnce(new Error('http_500'));
    await expect(
      routeHouseFacade({ hint: 'house', target: target(), photo, segment: seg })
    ).resolves.toBeNull();
    await expect(
      routeHouseFacade({ hint: 'house', target: target(), photo, segment: segmenter({}) })
    ).resolves.toBeNull();
    const blind = { house: FACADE.house, roof: FACADE.roof, wall: FACADE.wall, chimney: [] };
    await expect(
      routeHouseFacade({ hint: 'house', target: target(), photo, segment: segmenter(blind) })
    ).resolves.toBeNull();
  });

  it('Muse Image down: no drawing attempted', async () => {
    museImageReady.mockReturnValueOnce(false);
    const { photo } = await photoOf('cottage row');
    const out = await routeHouseFacade({
      hint: 'house',
      target: target(),
      photo,
      segment: segmenter(FACADE),
    });
    expect(out).toBeNull();
    expect(generateFacadeImage).not.toHaveBeenCalled();
  });
});

describe('runObjectShape default facade route (PQ-T44 remedy 1)', () => {
  const sparkFor = (name: string) => {
    const c = GOLDEN_SHAPES.find((g) => g.name === name)!;
    return {
      describeShape: vi.fn().mockResolvedValue({
        recipe: kitToRecipe(c.prior),
        kit: c.prior,
        source: 'meta',
        model: 'muse-spark-1.3',
      }),
      describeParts: vi.fn().mockResolvedValue({ recipe: null }),
    };
  };

  it('house photo without a drawing takes the facade path', async () => {
    const { photo, box, outline } = await photoOf('cottage row');
    const out = await runObjectShape(
      { ...sparkFor('cottage row'), segmentImage: segmenter(FACADE) },
      photo,
      'data:full',
      { ...target(), box, outline }
    );
    expect(generateFacadeImage).toHaveBeenCalledTimes(1);
    expect(out.mode).toBe('recipe');
    expect(out.recipe!.source).toBe('facade');
    expect(out.recipe!.parts.filter((p) => p.kind === 'window').length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('vehicles and validated facades never trigger a drawing', async () => {
    const car = await photoOf('car');
    await runObjectShape(
      { ...sparkFor('car'), segmentImage: segmenter(FACADE) },
      car.photo,
      'data:full',
      { ...target({ id: 'car', label: 'car' }), box: car.box, outline: car.outline }
    );
    expect(generateFacadeImage).not.toHaveBeenCalled();
    const { photo, box, outline } = await photoOf('cottage row');
    await runObjectShape(
      { ...sparkFor('cottage row'), segmentImage: segmenter(FACADE) },
      photo,
      'data:full',
      { ...target(), box, outline, facadeUrl: 'https://r2.example/validated.png' }
    );
    expect(generateFacadeImage).not.toHaveBeenCalled();
  }, 60_000);
});
