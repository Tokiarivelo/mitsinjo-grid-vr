// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { kitToRecipe } from '@/lib/object-kit';
import type { ShapeTarget } from '@/lib/object-shape';
import { GOLDEN_SHAPES, goldenBox, goldenOutline, goldenSvg, PHOTO } from '../__fixtures__/shape';
import type { RgbGrid } from '../model-score';
import { runObjectShape } from '../object-shape';
import { scoreRecipe } from '../score-shape';
import {
  CRITIC_ROUNDS,
  CRITIC_TILE,
  CRITIC_WIDTH,
  criticFires,
  criticImage,
  criticSheet,
  differenceTile,
  requestPatch,
  shapeWithCritic,
} from '../spark-critic';
import { renderFlat } from '../flat-render';
import { capPatchFields, criticPrompt, parseKitReasons } from '../shape';

const car = () => kitToRecipe(GOLDEN_SHAPES.find((c) => c.name === 'car')!.prior);

describe('spark critic image + patch (PR-0.6)', () => {
  it('lays the crop left and the flat render right at critic width', async () => {
    const crop: RgbGrid = { cols: 64, rows: 48, rgb: new Uint8ClampedArray(64 * 48 * 3).fill(200) };
    const url = await criticImage(crop, car(), 4 / 3);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const meta = await sharp(Buffer.from(url.split(',')[1]!, 'base64')).metadata();
    // Height follows the aspect (256 / (4/3) = 192); width = scaled crop + 256.
    expect(meta.height).toBe(192);
    expect(meta.width).toBe(256 + CRITIC_WIDTH);
  });

  it('passes the patch through, swallows failures', async () => {
    const kit = GOLDEN_SHAPES.find((c) => c.name === 'car')!.prior;
    const score = { iou: 0.7, edgeF1: 0.5, deltaE: 9, score: 62 };
    const patch = { subtype: 'sedan' };
    const ok = { criticizeShape: vi.fn().mockResolvedValue({ patch }) };
    await expect(requestPatch(ok, 'data:img', kit, score)).resolves.toEqual(patch);
    expect(ok.criticizeShape.mock.calls[0]![1]).toContain('62/100');
    const bad = { criticizeShape: vi.fn().mockRejectedValue(new Error('boom')) };
    await expect(requestPatch(bad, 'data:img', kit, score)).resolves.toBeNull();
  });
});

describe('live critic round (PR-0.6)', () => {
  const fridge = GOLDEN_SHAPES.find((c) => c.name === 'fridge')!;
  const lampPrior = GOLDEN_SHAPES.find((c) => c.name === 'lamp post')!.prior;

  async function fridgePhoto() {
    const buffer = await sharp(Buffer.from(goldenSvg(fridge)))
      .jpeg({ quality: 85 })
      .toBuffer();
    return { buffer, ...PHOTO };
  }

  function fridgeTarget(): ShapeTarget {
    return {
      id: 'fridge',
      label: 'fridge',
      category: 'other',
      box: goldenBox(fridge),
      outline: goldenOutline(fridge),
    };
  }

  const sparkFor = (prior: typeof fridge.prior, critic: unknown) => ({
    describeShape: vi.fn().mockResolvedValue({
      recipe: kitToRecipe(prior),
      kit: prior,
      source: 'meta',
      model: 'muse-spark-1.3',
    }),
    describeParts: vi.fn().mockResolvedValue({ recipe: null }),
    criticizeShape: vi.fn().mockResolvedValue(critic),
  });

  it('skips the round when the score holds', async () => {
    const photo = await fridgePhoto();
    const spark = sparkFor(fridge.prior, { patch: { subtype: 'x' } });
    const shape = await shapeWithCritic(spark, photo, 'data:full', fridgeTarget());
    expect(shape.mode).toBe('recipe');
    expect(spark.criticizeShape).not.toHaveBeenCalled();
    expect(spark.describeShape).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('a fixing patch re-fits and is kept', async () => {
    const photo = await fridgePhoto();
    // Wrong kit on purpose (lamp over a fridge, score 47): the critic fires.
    const spark = sparkFor(lampPrior, { patch: { archetype: 'cabinet' } });
    const shape = await shapeWithCritic(spark, photo, 'data:full', fridgeTarget());
    expect(shape.mode).toBe('recipe');
    expect(spark.criticizeShape).toHaveBeenCalledTimes(1);
    expect(spark.describeShape).toHaveBeenCalledTimes(1);
    // Kept: the retry (cabinet kit) replaced the lamp recipe.
    expect(shape.kit?.archetype).toBe('cabinet');
    expect(shape.recipe).not.toEqual(
      (
        await runObjectShape(
          { describeShape: spark.describeShape, describeParts: spark.describeParts },
          photo,
          'data:full',
          fridgeTarget()
        )
      ).recipe
    );
  }, 60_000);

  it('times the critic phase, nothing when the round is skipped (PQ-T42)', async () => {
    const photo = await fridgePhoto();
    const timings: Array<{ phase: string; ms: number }> = [];
    const onTiming = (phase: string, ms: number) => timings.push({ phase, ms });
    // Score holds: no patch asked, but the scoring pass ran — the phase is timed.
    const held = sparkFor(fridge.prior, { patch: { subtype: 'x' } });
    await shapeWithCritic(held, photo, 'data:full', fridgeTarget(), { onTiming });
    expect(held.criticizeShape).not.toHaveBeenCalled();
    expect(timings.filter((t) => t.phase === 'critic')).toHaveLength(1);
    // Wrong kit on purpose (lamp over a fridge, score 47): patch, retry and rescore timed.
    timings.length = 0;
    await shapeWithCritic(
      sparkFor(lampPrior, { patch: { archetype: 'cabinet' } }),
      photo,
      'data:full',
      fridgeTarget(),
      {
        onTiming,
      }
    );
    const critic = timings.filter((t) => t.phase === 'critic');
    expect(critic).toHaveLength(1);
    expect(critic[0]!.ms).toBeGreaterThanOrEqual(0);
    // Truly skipped (mock, no outline to score against): no `critic` timing.
    timings.length = 0;
    const mock = {
      describeShape: vi.fn().mockResolvedValue({
        recipe: kitToRecipe(fridge.prior),
        source: 'mock',
        model: 'mock-perception-v1',
      }),
      describeParts: vi.fn().mockResolvedValue({ recipe: null }),
      criticizeShape: vi.fn(),
    };
    await shapeWithCritic(mock, null, 'data:full', fridgeTarget(), { onTiming });
    expect(timings.map((t) => t.phase)).not.toContain('critic');
  }, 120_000);

  it('version 2 (PQ-T14): a round that gains nothing ends the rounds, the original stands (PR #13 review)', async () => {
    const photo = await fridgePhoto();
    const spark = sparkFor(lampPrior, { patch: { subtype: 'x' } });
    const shape = await shapeWithCritic(spark, photo, 'data:full', fridgeTarget(), {
      criticPromptVersion: 2,
    });
    // Not kept → no second round is paid for.
    expect(spark.criticizeShape).toHaveBeenCalledTimes(1);
    expect(shape.kit?.archetype).toBe('lamp_post');
    // The call carries version 2 and the family, and the 2 × 2 sheet as a PNG.
    const [image, question, , opts] = spark.criticizeShape.mock.calls[0]!;
    expect(String(image).startsWith('data:image/png;base64,')).toBe(true);
    expect(String(question)).toContain('"reasons"');
    expect(opts).toEqual({ promptVersion: 2, archetype: 'lamp_post' });
  }, 60_000);

  it('version 2 (PQ-T14): a kept round is followed by another, at most 3 in all, kept only on gain', async () => {
    const photo = await fridgePhoto();
    const spark = sparkFor(lampPrior, { patch: { archetype: 'cabinet' } });
    const shape = await shapeWithCritic(spark, photo, 'data:full', fridgeTarget(), {
      criticPromptVersion: 2,
    });
    expect(shape.kit?.archetype).toBe('cabinet');
    const calls = spark.criticizeShape.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(CRITIC_ROUNDS);
    // The same patch again changes nothing: the later rounds never replace the kept model.
    expect(spark.describeShape).toHaveBeenCalledTimes(1);
  }, 90_000);

  it('the paid-for round completes even when the patch arrives past the budget', async () => {
    const photo = await fridgePhoto();
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow());
    try {
      // Wrong kit on purpose (lamp over a fridge, score 47): the critic fires.
      const spark = sparkFor(lampPrior, { patch: { archetype: 'cabinet' } });
      // Live: 60 s budget, the patch came back 146 ms over; the clock jump simulates it.
      spark.criticizeShape.mockImplementationOnce(async () => {
        clock.mockImplementation(() => realNow() + 120_000);
        return { patch: { archetype: 'cabinet' } };
      });
      const shape = await shapeWithCritic(spark, photo, 'data:full', fridgeTarget());
      expect(shape.mode).toBe('recipe');
      // Before: the retry crashed on AbortSignal.timeout(negative) ("shape failed") and the
      // patch was lost; the stub-kit retry carries no LLM call, so it always runs.
      expect(shape.kit?.archetype).toBe('cabinet');
    } finally {
      clock.mockRestore();
    }
  }, 60_000);

  it('a useless patch is dropped, the original stands', async () => {
    const photo = await fridgePhoto();
    const spark = sparkFor(lampPrior, { patch: { subtype: 'tall' } });
    const shape = await shapeWithCritic(spark, photo, 'data:full', fridgeTarget());
    expect(shape.mode).toBe('recipe');
    expect(spark.criticizeShape).toHaveBeenCalledTimes(1);
    const plain = await runObjectShape(
      { describeShape: spark.describeShape, describeParts: spark.describeParts },
      photo,
      'data:full',
      fridgeTarget()
    );
    expect(shape.recipe).toEqual(plain.recipe);
  }, 60_000);

  it('no patch means no re-fit', async () => {
    const photo = await fridgePhoto();
    const spark = sparkFor(lampPrior, { patch: null });
    const shape = await shapeWithCritic(spark, photo, 'data:full', fridgeTarget());
    expect(shape.mode).toBe('recipe');
    expect(spark.criticizeShape).toHaveBeenCalledTimes(1);
    expect(spark.describeShape).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('skips the round for an imagined recipe (no template to patch)', async () => {
    const photo = await fridgePhoto();
    // Person parts over a fridge photo: the score is low, but patching the person kit would
    // rebuild the crude placeholder, so the round must not fire.
    const personKit = {
      archetype: 'person',
      proportions: { w: 0.4, h: 1, d: 0.3 },
      colors: { main: '#334455', secondary: '#c8a080', accent: '#222222' },
    } as const;
    const spark = {
      describeShape: vi.fn().mockResolvedValue({
        recipe: kitToRecipe(personKit),
        kit: personKit,
        source: 'meta',
        model: 'muse-spark-1.3',
      }),
      describeParts: vi.fn().mockResolvedValue({
        recipe: {
          source: 'free',
          proportions: { w: 0.4, h: 1, d: 0.3 },
          parts: [
            {
              shape: 'cylinder',
              at: [0, -0.05, 0],
              size: [0.5, 0.6, 0.35],
              color: '#334455',
              front: true,
            },
            { shape: 'sphere', at: [0, 0.38, 0], size: [0.3, 0.28, 0.3], color: '#c8a080' },
          ],
        },
      }),
      criticizeShape: vi.fn().mockResolvedValue({ patch: { subtype: 'x' } }),
    };
    const shape = await shapeWithCritic(spark, photo, 'data:full', fridgeTarget());
    expect(shape.mode).toBe('recipe');
    expect(shape.recipe!.source).toBe('free');
    // Non-vacuous: the score IS low enough to round.
    const target = fridgeTarget();
    const scored = await scoreRecipe(
      photo,
      { box: target.box, outline: shape.outline! },
      shape.recipe!
    );
    expect(scored!.score.score).toBeLessThan(70);
    expect(spark.criticizeShape).not.toHaveBeenCalled();
  }, 60_000);
});

describe('critic v2 (PQ-T14)', () => {
  const ones = (cols: number, rows: number) => ({
    cols,
    rows,
    data: new Uint8Array(cols * rows).fill(1),
  });

  it('the 2 × 2 sheet has four tiles of at least 512 px', async () => {
    const crop: RgbGrid = { cols: 64, rows: 48, rgb: new Uint8ClampedArray(64 * 48 * 3).fill(200) };
    const url = await criticSheet(crop, car(), 4 / 3, ones(64, 48));
    const meta = await sharp(Buffer.from(url.split(',')[1]!, 'base64')).metadata();
    expect(CRITIC_TILE).toBeGreaterThanOrEqual(512);
    expect(meta.width).toBe(CRITIC_TILE * 2);
    expect(meta.height).toBe(Math.round(CRITIC_TILE / (4 / 3)) * 2);
  });

  it('the difference tile: red = photo only, blue = model only, grey = same', () => {
    const model = renderFlat(car(), 4 / 3, 16, 12);
    const none = { cols: 16, rows: 12, data: new Uint8Array(16 * 12) };
    const tile = differenceTile(model, none);
    const i = model.mask.data.findIndex((v) => v === 1);
    expect([...tile.subarray(i * 3, i * 3 + 3)]).toEqual([40, 80, 220]);
    const full = differenceTile(model, ones(16, 12));
    const j = model.mask.data.findIndex((v) => v === 0);
    expect([...full.subarray(j * 3, j * 3 + 3)]).toEqual([220, 40, 40]);
    expect([...full.subarray(i * 3, i * 3 + 3)]).toEqual([160, 160, 160]);
  });

  it('fires under 70 or on a missed detail gate', () => {
    expect(criticFires(60)).toBe(true);
    expect(criticFires(85)).toBe(false);
    expect(criticFires(85, { partRecall: 0.5 })).toBe(true);
    expect(criticFires(85, { partRecall: 0.9, partPrecision: 0.9 })).toBe(false);
    expect(criticFires(85, { blankBands: 1 })).toBe(true);
  });

  it('a patch with 6 fields is cut to 4, family first', () => {
    const six = {
      archetype: 'vehicle',
      subtype: 'van',
      proportions: { w: 1, h: 0.5, d: 0.4 },
      details: { wheels: 4 },
      colors: { main: '#112233', secondary: '#223344', accent: '#334455' },
      materials: { main: 'metal' },
    } as never;
    expect(Object.keys(capPatchFields(six))).toEqual([
      'archetype',
      'subtype',
      'proportions',
      'details',
    ]);
  });

  it('reasons parsed, capped; version 2 prompt carries the Critic card', () => {
    expect(parseKitReasons('{"reasons":["a wheel is missing"," "]}')).toEqual([
      'a wheel is missing',
    ]);
    expect(parseKitReasons('nope')).toEqual([]);
    expect(criticPrompt(2, 'vehicle')).toContain('PHOTO of one object');
    expect(criticPrompt(2)).toContain('no change');
    expect(() => criticPrompt(9)).toThrow();
  });

  it('requestPatch sends the version and the family to the call', async () => {
    const kit = GOLDEN_SHAPES.find((c) => c.name === 'car')!.prior;
    const client = { criticizeShape: vi.fn().mockResolvedValue({ patch: null }) };
    await requestPatch(
      client,
      'data:img',
      kit,
      { iou: 1, edgeF1: 1, deltaE: 1, score: 50 },
      undefined,
      2
    );
    expect(client.criticizeShape.mock.calls[0]![3]).toEqual({
      promptVersion: 2,
      archetype: kit.archetype,
    });
  });
});
