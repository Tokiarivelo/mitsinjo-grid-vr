// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  ObjectShapeSchema,
  ShapeTimingEventSchema,
  type ObjectRecipe,
  type ShapeTarget,
} from '@/lib/object-shape';
vi.mock('server-only', () => ({}));
import { srgbToLinear } from '../color-measure';
import { runObjectShape, SHAPE_TIMEOUT_MS } from '../object-shape';
import type { ShapeResult } from '../schemas';
import type { GrayGrid } from '../repetition';
import { turned } from './fixtures/render-facade';
import { kitToRecipe, type ObjectKit } from '@/lib/object-kit';

const target: ShapeTarget = {
  id: 'det-1',
  label: 'Fridge',
  category: 'fridge',
  box: { x: 0.1, y: 0.1, w: 0.2, h: 0.6 },
};
const tall: ObjectRecipe = {
  proportions: { w: 0.5, h: 1, d: 0.5 },
  parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#eeeeee', front: true }],
};
const meta = (recipe: ObjectRecipe | null, extra: Partial<ShapeResult> = {}): ShapeResult => ({
  recipe,
  source: 'meta',
  model: 'muse-spark-1.3',
  ...extra,
});
const client = (out: ShapeResult) => ({
  describeShape: vi.fn().mockResolvedValue(out),
  // No imagination round by default: kit archetypes never call it.
  describeParts: vi.fn().mockResolvedValue({ recipe: null }),
});

async function photo() {
  const buffer = await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg()
    .toBuffer();
  return { buffer, width: 200, height: 100 };
}

describe('runObjectShape (PV-T9)', () => {
  it('Spark recipe that fits the photo → recipe mode, sent a crop with label and category', async () => {
    const p = client(meta(tall));
    // Box on a 200×100 photo: 40×60 px → aspect 2/3: the width follows the photo.
    const out = await runObjectShape(p, await photo(), 'data:full', target);
    expect(out).toEqual({
      detectionId: 'det-1',
      mode: 'recipe',
      recipe: { ...tall, proportions: { w: 2 / 3, h: 1, d: 0.5 } },
      source: 'meta',
      model: 'muse-spark-1.3',
      conditions: { widthPx: 40, heightPx: 60, sharpness: 'low', exposure: 'low' },
    });
    const [url, subject, signal] = p.describeShape.mock.calls[0]!;
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(url).not.toBe('data:full');
    expect(subject).toEqual({
      label: 'Fridge',
      category: 'fridge',
      aspect: 2 / 3,
      // PQ-T7: facts measured by code, sent as the « Measured: » line.
      facts: ['object 40 × 60 px', 'sharpness low'],
    });
    // No default budget: no signal unless the caller passes one (or an explicit timeoutMs).
    expect(signal).toBeUndefined();
  });

  it('recipe with wrong proportions is fitted to the photo box, not rejected', async () => {
    const wide = { ...tall, proportions: { w: 1, h: 0.1, d: 0.5 } };
    const p = client(meta(wide));
    const out = await runObjectShape(p, await photo(), 'data:full', target);
    expect(out.mode).toBe('recipe');
    // Box 40×60 px → width / height 2/3, sent to Spark too.
    expect(out.recipe!.proportions.w / out.recipe!.proportions.h).toBeCloseTo(2 / 3);
    expect(p.describeShape.mock.calls[0]![1]).toMatchObject({ aspect: 2 / 3 });
  });

  it('almost empty recipe → silhouette « no_body »', async () => {
    const flat: ObjectRecipe = {
      ...tall,
      parts: [
        { shape: 'box', at: [0, 0, 0], size: [1, 0.01, 0.01], color: '#888888' },
        { shape: 'box', at: [0, 0.4, 0], size: [0.01, 0.2, 1], color: '#888888' },
      ],
    };
    const out = await runObjectShape(client(meta(flat)), await photo(), 'data:full', target);
    expect(out).toMatchObject({ mode: 'silhouette', reason: 'no_body', source: 'meta' });
    expect(out.recipe).toBeUndefined();
  });

  it('a tiny object (lamp post, ~20 px wide) is sent as an upscaled crop', async () => {
    const big = await sharp({
      create: { width: 1280, height: 951, channels: 3, background: { r: 90, g: 120, b: 160 } },
    })
      .jpeg()
      .toBuffer();
    const p = client(meta(tall));
    await runObjectShape(p, { buffer: big, width: 1280, height: 951 }, 'data:full', {
      ...target,
      label: 'lamp post',
      category: 'lamp',
      box: { x: 0.443, y: 0.487, w: 0.0156, h: 0.1083 },
    });
    const url = p.describeShape.mock.calls[0]![0] as string;
    const meta2 = await sharp(Buffer.from(url.split(',')[1]!, 'base64')).metadata();
    expect(Math.max(meta2.width!, meta2.height!)).toBeGreaterThanOrEqual(640);
  });

  it('unreadable reply → silhouette « malformed »', async () => {
    const out = await runObjectShape(client(meta(null)), null, 'data:full', target);
    expect(out).toMatchObject({ mode: 'silhouette', reason: 'malformed' });
  });

  it('Meta failure or spend cap (mock answered) → silhouette, not the mock recipe', async () => {
    for (const fallback of ['provider_error', 'spend_cap'] as const) {
      const out = await runObjectShape(
        client({ recipe: tall, source: 'mock', model: 'mock-perception-v1', fallback }),
        null,
        'data:full',
        target
      );
      expect(out).toMatchObject({ mode: 'silhouette', reason: fallback, fallback });
    }
  });

  it('mock mode → its recipe, no quality check; whole photo sent without pixels', async () => {
    const wide = { ...tall, proportions: { w: 1, h: 0.1, d: 0.5 } };
    const p = client({ recipe: wide, source: 'mock', model: 'mock-perception-v1' });
    // Mock recipes are not fitted either.
    const out = await runObjectShape(p, null, 'data:full', target);
    expect(out).toMatchObject({ mode: 'recipe', recipe: wide, source: 'mock' });
    expect(p.describeShape.mock.calls[0]![0]).toBe('data:full');
  });

  it('aborts Spark after the timeout and never throws', async () => {
    let seen: AbortSignal | undefined;
    const p = {
      describeShape: vi.fn((_u: string, _t: unknown, signal?: AbortSignal) => {
        seen = signal;
        return Promise.reject(new Error('boom'));
      }),
      describeParts: vi.fn(),
    };
    const out = await runObjectShape(p, null, 'data:full', target, { timeoutMs: 5 });
    expect(out).toMatchObject({ mode: 'silhouette', reason: 'provider_error' });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen?.aborted).toBe(true);
  });

  it('an expired budget (timeoutMs ≤ 0) still builds the recipe — the signal just starts aborted', async () => {
    // Before: AbortSignal.timeout(-146) threw RangeError ("shape failed"), e.g. the critic retry
    // firing 146 ms past an explicit budget; the clamp turns it into an instantly-aborted signal.
    const p = client(meta(tall));
    const out = await runObjectShape(p, await photo(), 'data:full', target, { timeoutMs: -146 });
    expect(out).toMatchObject({ mode: 'recipe', source: 'meta' });
    expect(p.describeShape.mock.calls[0]![2]).toBeInstanceOf(AbortSignal);
  });

  it('waits for Spark with no default limit (it needs 15–40 s) and reports each step', async () => {
    expect(SHAPE_TIMEOUT_MS).toBeNull();
    const steps: string[] = [];
    await runObjectShape(client(meta(tall)), await photo(), 'data:full', target, {
      onStep: (s) => steps.push(s),
    });
    expect(steps).toEqual(['crop', 'model', 'fit']);
  });

  it('reports each run phase duration, skipped phases stay silent (PQ-T42)', async () => {
    const timings: Array<{ phase: string; ms: number }> = [];
    const onTiming = (phase: string, ms: number) => timings.push({ phase, ms });
    await runObjectShape(client(meta(tall)), await photo(), 'data:full', target, { onTiming });
    // No outline to fetch (no segmentImage), no kit details, no masks, no staged loop.
    expect(timings.map((t) => t.phase)).toEqual(['crop', 'kit', 'fit']);
    for (const t of timings) expect(ShapeTimingEventSchema.safeParse(t).success).toBe(true);
    // Mock mode without pixels: the kit call alone.
    timings.length = 0;
    await runObjectShape(
      client({ recipe: tall, source: 'mock', model: 'mock-perception-v1' }),
      null,
      'data:full',
      target,
      { onTiming }
    );
    expect(timings.map((t) => t.phase)).toEqual(['kit']);
  });

  it('a Meta timeout is reason « timeout », other Meta errors keep their cause', async () => {
    const timedOut = client({
      recipe: tall,
      source: 'mock',
      model: 'mock-perception-v1',
      fallback: 'provider_error',
      failure: 'timeout',
    });
    expect(await runObjectShape(timedOut, null, 'data:full', target)).toMatchObject({
      mode: 'silhouette',
      reason: 'timeout',
      detail: 'timeout',
    });
    const refused = client({
      recipe: tall,
      source: 'mock',
      model: 'mock-perception-v1',
      fallback: 'provider_error',
      failure: 'http_429',
    });
    expect(await runObjectShape(refused, null, 'data:full', target)).toMatchObject({
      reason: 'provider_error',
      detail: 'http_429',
    });
  });
});

/** Street photo 200×100: sky (rows 0–29), roof (30–54), stone walls with dark windows (55–99). */
async function street() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
    <rect width="200" height="30" fill="#96beef"/>
    <rect y="30" width="200" height="25" fill="#6e5f55"/>
    <rect y="55" width="200" height="45" fill="#c8aa78"/>
    ${[20, 60, 100, 140].map((x) => `<rect x="${x}" y="65" width="16" height="14" fill="#1e232d"/>`).join('')}
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buffer, width: 200, height: 100 };
}
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a: string, b: string, tol = 12) =>
  hexRgb(a).every((v, i) => Math.abs(v - hexRgb(b)[i]!) <= tol);

describe('runObjectShape measured colours (PF-T2)', () => {
  const cottage: ShapeTarget = {
    id: 'det-4',
    label: 'stone cottages row',
    category: 'other',
    scenery: 'building',
    box: { x: 0, y: 0, w: 1, h: 1 },
    // SAM outline: the cottages only, the sky above is outside.
    outline: 'M0 0.3L1 0.3L1 1L0 1Z',
  };
  const guessed: ObjectKit = {
    archetype: 'house',
    proportions: { w: 1, h: 0.5, d: 0.4 },
    colors: { main: '#202020', secondary: '#000000', accent: '#ff8800' },
    details: { windows: 4 },
  };

  it('replaces Spark colours with the photo ones, sky cut by the outline (regression: black roof)', async () => {
    const p = client(meta(kitToRecipe(guessed), { kit: guessed }));
    const out = await runObjectShape(p, await street(), 'data:full', cottage);
    expect(out.mode).toBe('recipe');
    const colors = new Set(out.recipe!.parts.map((x) => x.color));
    const walls = out.recipe!.parts.find((x) => x.front)!.color;
    expect(near(walls, '#c8aa78')).toBe(true);
    // Roof slabs = measured roof colour; no part keeps the guessed black / orange, none is sky blue.
    expect([...colors].some((c) => near(c, '#6e5f55'))).toBe(true);
    expect([...colors].some((c) => c === '#000000' || c === '#ff8800')).toBe(false);
    expect([...colors].some((c) => near(c, '#96beef', 20))).toBe(false);
    // The kit stays exposed as Spark said it (PR-0.6: the critic patches it); measurements
    // live in the recipe, never rewritten into the kit.
    expect(out).toHaveProperty('kit', guessed);
    expect(out.outline).toBe(cottage.outline);
  });

  it('no photo (crop impossible) → Spark colours kept', async () => {
    const p = client(meta(kitToRecipe(guessed), { kit: guessed }));
    const out = await runObjectShape(p, null, 'data:full', cottage);
    expect(out.recipe!.parts.some((x) => x.color === '#000000')).toBe(true);
  });

  it('missing outline is segmented on demand: full measurement restored', async () => {
    const seg = {
      source: 'meta' as const,
      model: 'sam-3.1',
      concept: 'house',
      imageWidth: 200,
      imageHeight: 100,
      instances: [
        {
          box: { x1: 0, y1: 30, x2: 199, y2: 99 },
          confidence: 0.9,
          outline: 'M0 0.3L1 0.3L1 1L0 1Z',
        },
      ],
      count: 1,
      boxCoverage: 0.7,
    };
    const segmentImage = vi.fn(async (_url: string, concept: string) =>
      concept === 'house' ? seg : { ...seg, concept, instances: [], count: 0 }
    );
    const p = {
      describeShape: client(meta(kitToRecipe(guessed), { kit: guessed })).describeShape,
      describeParts: vi.fn().mockResolvedValue({ recipe: null }),
      segmentImage,
    };
    const boxOnly = { ...cottage, outline: undefined };
    const out = await runObjectShape(p, await street(), 'data:full', boxOnly);
    expect(segmentImage).toHaveBeenCalledWith('data:full', 'house', expect.any(AbortSignal));
    // The fetched outline focuses sampling (stone walls) and enables the fit.
    expect(out.mode).toBe('recipe');
    expect(out.recipe!.parts.find((x) => x.front)!.color).toSatisfy((c: string) =>
      near(c, '#c8aa78')
    );
    expect(out.fit!.iou).toBeGreaterThan(0);
  });

  it('no outline → the guess dominates the box mix (regression: green Mini)', async () => {
    const p = client(meta(kitToRecipe(guessed), { kit: guessed }));
    const boxOnly = { ...cottage, outline: undefined };
    const out = await runObjectShape(p, await street(), 'data:full', boxOnly);
    expect(out.mode).toBe('recipe');
    const walls = out.recipe!.parts.find((x) => x.front)!.color;
    // Not the measured stone: the unfiltered box (sky included) only gets a 0.3 vote.
    expect(near(walls, '#c8aa78')).toBe(false);
    // In linear light (where the mix happens) the 0.3 vote sits near the guess.
    const lin = (h: string) => {
      const [r, g, b] = hexRgb(h);
      return srgbToLinear(r!, g!, b!);
    };
    const dist = (a: string, b: string) => lin(a).reduce((s, v, i) => s + (v - lin(b)[i]!) ** 2, 0);
    expect(dist(walls, '#202020')).toBeLessThan(dist(walls, '#c8aa78'));
  });
});

describe('runObjectShape measured roof (PF-T3)', () => {
  const kitOf = (archetype: ObjectKit['archetype']): ObjectKit => ({
    archetype,
    proportions: { w: 1, h: 0.5, d: 0.4 },
    colors: { main: '#202020', secondary: '#000000', accent: '#ff8800' },
  });
  /** Row of 3 gabled cottages: walls to y 0.55, ridges at y 0.3 (photo fractions, whole box). */
  const row = (outline?: string): ShapeTarget => ({
    id: 'det-4',
    label: 'stone cottages row',
    category: 'other',
    scenery: 'building',
    box: { x: 0, y: 0, w: 1, h: 1 },
    ...(outline ? { outline } : {}),
  });
  const gabled = 'M0 1L0 0.55L0.1667 0.3L0.3333 0.55L0.5 0.3L0.6667 0.55L0.8333 0.3L1 0.55L1 1Z';

  it('gabled outline → one prism per gable; a pitched « building » becomes a house', async () => {
    const p = client(meta(kitToRecipe(kitOf('building')), { kit: kitOf('building') }));
    const out = await runObjectShape(p, await street(), 'data:full', row(gabled));
    expect(out.mode).toBe('recipe');
    expect(out.recipe!.parts.filter((x) => x.shape === 'prism')).toHaveLength(3);
    // PF-T6: the fitted silhouette matches the outline, score sent to the panel.
    expect(out.fit!.iou).toBeGreaterThanOrEqual(0.8);
    expect(ObjectShapeSchema.safeParse(out).success).toBe(true);
  });

  it('flat outline, no outline, or not a building → no prism (template unchanged)', async () => {
    for (const [kit, t] of [
      [kitOf('house'), row('M0 0.3L1 0.3L1 1L0 1Z')],
      [kitOf('house'), row()],
      [kitOf('cabinet'), row(gabled)],
    ] as const) {
      const out = await runObjectShape(
        client(meta(kitToRecipe(kit), { kit })),
        await street(),
        'data:full',
        t
      );
      expect(out.recipe!.parts.some((x) => x.shape === 'prism')).toBe(false);
      // No outline → no fit score (nothing to compare with).
      if (!t.outline) expect(out.fit).toBeUndefined();
    }
  });
});

describe('runObjectShape repetition (PF-T4)', () => {
  const house: ObjectKit = {
    archetype: 'house',
    proportions: { w: 1, h: 0.5, d: 0.4 },
    colors: { main: '#202020', secondary: '#000000', accent: '#ff8800' },
    details: { units: 1, windows: 1 },
  };
  /** 4 cottages on 240 × 100: a dark chimney stripe at each house edge on the roof, 2 windows each on the walls. */
  async function terrace() {
    const P = 60;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100">
      <rect width="240" height="40" fill="#6e5f55"/>
      <rect y="40" width="240" height="60" fill="#c8aa78"/>
      ${[0, 1, 2, 3].map((u) => `<rect x="${u * P}" width="5" height="40" fill="#1e1e1e"/>`).join('')}
      ${[0, 1, 2, 3]
        .flatMap((u) => [u * P + 10, u * P + 40])
        .map((x) => `<rect x="${x}" y="55" width="12" height="16" fill="#1e232d"/>`)
        .join('')}
    </svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return { buffer, width: 240, height: 100 };
  }
  const target: ShapeTarget = {
    id: 'det-4',
    label: 'terrace',
    category: 'other',
    scenery: 'building',
    box: { x: 0, y: 0, w: 1, h: 1 },
  };

  it('a terrace of 4 → 4 houses (Spark said 1), 2 windows each', async () => {
    const out = await runObjectShape(
      client(meta(kitToRecipe(house), { kit: house })),
      await terrace(),
      'data:full',
      target
    );
    const parts = out.recipe!.parts;
    expect(parts.filter((p) => p.shape === 'prism')).toHaveLength(4);
    expect(parts.length).toBeLessThanOrEqual(12);
  });

  it('a cabinet is never split into units', async () => {
    const cabinet: ObjectKit = { ...house, archetype: 'cabinet' };
    const out = await runObjectShape(
      client(meta(kitToRecipe(cabinet), { kit: cabinet })),
      await terrace(),
      'data:full',
      target
    );
    expect(out.recipe!.parts.some((p) => p.shape === 'prism')).toBe(false);
  });
});

describe('runObjectShape perspective (PF-T5)', () => {
  async function photoOf(grid: GrayGrid) {
    const raw = Buffer.from(Array.from(grid.gray, (v) => Math.round(v * 255)));
    const buffer = await sharp(raw, {
      raw: { width: grid.width, height: grid.height, channels: 1 },
    })
      .png()
      .toBuffer();
    return { buffer, width: grid.width, height: grid.height };
  }
  const cabinet: ObjectKit = {
    archetype: 'cabinet',
    proportions: { w: 1, h: 0.5, d: 0.4 },
    colors: { main: '#cccccc', secondary: '#888888', accent: '#222222' },
  };
  const whole: ShapeTarget = {
    id: 'det-9',
    label: 'shop front',
    category: 'other',
    box: { x: 0, y: 0, w: 1, h: 1 },
  };

  it('a facade turned 30° → recipe turned ≈ 30°', async () => {
    const out = await runObjectShape(
      client(meta(kitToRecipe(cabinet), { kit: cabinet })),
      await photoOf(turned(30)),
      'data:full',
      whole
    );
    expect(Math.abs(((out.recipe!.yaw ?? 0) * 180) / Math.PI - 30)).toBeLessThan(8);
  });

  it('a tree is never turned, a facade facing the camera neither', async () => {
    const tree: ObjectKit = { ...cabinet, archetype: 'tree' };
    const a = await runObjectShape(
      client(meta(kitToRecipe(tree), { kit: tree })),
      await photoOf(turned(30)),
      'data:full',
      whole
    );
    expect(a.recipe).not.toHaveProperty('yaw');
    const b = await runObjectShape(
      client(meta(kitToRecipe(cabinet), { kit: cabinet })),
      await photoOf(turned(0)),
      'data:full',
      whole
    );
    expect(b.recipe).not.toHaveProperty('yaw');
  });

  it('part masks (PR-2.5): segmented on the crop when the client can, else skipped', async () => {
    const vehicle: ObjectKit = {
      archetype: 'vehicle',
      proportions: { w: 1, h: 0.4, d: 0.45 },
      colors: { main: '#a33327', secondary: '#cfd6dd', accent: '#1c1c1e' },
      materials: { main: 'metal', secondary: 'glass', accent: 'rubber' },
    };
    const car: ShapeTarget = { id: 'car', label: 'Car', category: 'other', box: target.box };
    const segmentImage = vi.fn(async (_url: string, concept: string) => ({
      source: 'meta' as const,
      model: 'sam-3.1',
      concept,
      imageWidth: 100,
      imageHeight: 100,
      instances: [{ box: { x1: 10, y1: 60, x2: 30, y2: 80 } }],
      count: 1,
      boxCoverage: 0.04,
    }));
    const withSeg = {
      describeShape: vi.fn().mockResolvedValue(meta(kitToRecipe(vehicle), { kit: vehicle })),
      describeParts: vi.fn().mockResolvedValue({ recipe: null }),
      segmentImage,
    };
    const out = await runObjectShape(withSeg, await photo(), 'data:full', car);
    expect(out.mode).toBe('recipe');
    // 'car' twice: the missing outline is segmented on demand (PR-2.20, no match here), full
    // photo then the shape crop (FIX 2 retry); then the part concepts on the crop.
    expect(segmentImage.mock.calls.map((c) => c[1]).sort()).toEqual([
      'car',
      'car',
      'wheel',
      'window',
    ]);
    expect(out.partMasks!.map((m) => m.concept).sort()).toEqual(['wheel', 'window']);
    expect(ObjectShapeSchema.safeParse(out).success).toBe(true);

    const withoutSeg = client(meta(kitToRecipe(vehicle), { kit: vehicle }));
    const out2 = await runObjectShape(withoutSeg, await photo(), 'data:full', car);
    expect(out2.mode).toBe('recipe');
    expect(out2.partMasks).toBeUndefined();
  });
});

describe('free recipe (PV-T9c)', () => {
  const personKit: ObjectKit = {
    archetype: 'person',
    proportions: { w: 0.4, h: 1, d: 0.3 },
    colors: { main: '#334455', secondary: '#c8a080', accent: '#222222' },
  };
  const animalKit: ObjectKit = {
    archetype: 'animal',
    proportions: { w: 1, h: 0.6, d: 0.4 },
    colors: { main: '#8a6f4d', secondary: '#5d4a33', accent: '#2b2b2b' },
  };
  /** What the imagination call returns for the guard: head, torso, two legs, one arm. */
  const imaginedPerson: ObjectRecipe = {
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
      { shape: 'cylinder', at: [-0.14, -0.35, 0], size: [0.16, 0.3, 0.18], color: '#222222' },
      { shape: 'cylinder', at: [0.14, -0.35, 0], size: [0.16, 0.3, 0.18], color: '#222222' },
      { shape: 'cylinder', at: [0.3, 0.05, 0], size: [0.12, 0.4, 0.14], color: '#334455' },
    ],
  };
  const imaginedAnimal: ObjectRecipe = {
    source: 'free',
    proportions: { w: 1, h: 0.6, d: 0.4 },
    parts: [
      { shape: 'box', at: [0, 0.05, 0], size: [0.75, 0.45, 0.5], color: '#8a6f4d', front: true },
      { shape: 'box', at: [0.42, 0.28, 0], size: [0.22, 0.3, 0.3], color: '#5d4a33' },
      { shape: 'cylinder', at: [-0.25, -0.32, 0], size: [0.12, 0.36, 0.14], color: '#5d4a33' },
      { shape: 'cylinder', at: [0.25, -0.32, 0], size: [0.12, 0.36, 0.14], color: '#5d4a33' },
    ],
  };
  const guard: ShapeTarget = {
    id: 'det-p',
    label: 'Guard',
    category: 'other',
    box: { x: 0.1, y: 0.1, w: 0.2, h: 0.6 },
  };

  it('adopts the imagined parts for an archetype without a real template', async () => {
    const p = client(meta(kitToRecipe(personKit), { kit: personKit }));
    p.describeParts.mockResolvedValue({ recipe: imaginedPerson });
    const out = await runObjectShape(p, await photo(), 'data:full', guard);
    expect(out.mode).toBe('recipe');
    expect(out.recipe!.parts).toHaveLength(5);
    expect(out.recipe!.source).toBe('free');
    expect(out).toHaveProperty('kit', personKit);
    expect(p.describeParts).toHaveBeenCalledTimes(1);
    const [url, subject, signal] = p.describeParts.mock.calls[0]!;
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(subject).toEqual({ label: 'Guard', archetype: 'person' });
    // No default budget: no signal unless the caller passes one (or an explicit timeoutMs).
    expect(signal).toBeUndefined();
    expect(ObjectShapeSchema.safeParse(out).success).toBe(true);
  });

  it('tells the imagination call which photo edges cut the object', async () => {
    const p = client(meta(kitToRecipe(personKit), { kit: personKit }));
    p.describeParts.mockResolvedValue({ recipe: null });
    const cut = { ...guard, box: { x: 0, y: 0.2, w: 0.3, h: 0.5 } };
    await runObjectShape(p, await photo(), 'data:full', cut);
    expect(p.describeParts.mock.calls[0]![1]).toEqual({
      label: 'Guard',
      archetype: 'person',
      coverage: 'cut off at the left',
    });
  });

  it('keeps the kit recipe when the imagination call answers nothing usable', async () => {
    const p = client(meta(kitToRecipe(personKit), { kit: personKit }));
    p.describeParts.mockResolvedValue({ recipe: null });
    const out = await runObjectShape(p, await photo(), 'data:full', guard);
    expect(out.mode).toBe('recipe');
    // The crude person placeholder: body + head.
    expect(out.recipe!.parts).toHaveLength(2);
    expect(out.recipe!.source).toBeUndefined();
  });

  it('keeps the kit recipe when the imagination call fails', async () => {
    const p = client(meta(kitToRecipe(personKit), { kit: personKit }));
    p.describeParts.mockRejectedValue(new Error('overloaded'));
    const out = await runObjectShape(p, await photo(), 'data:full', guard);
    expect(out.mode).toBe('recipe');
    expect(out.recipe!.parts).toHaveLength(2);
    expect(out.recipe!.source).toBeUndefined();
  });

  it('never imagines for an archetype with a real template', async () => {
    const vehicle: ObjectKit = {
      archetype: 'vehicle',
      proportions: { w: 1, h: 0.4, d: 0.45 },
      colors: { main: '#a33327', secondary: '#cfd6dd', accent: '#1c1c1e' },
    };
    const p = client(meta(kitToRecipe(vehicle), { kit: vehicle }));
    const car: ShapeTarget = { id: 'car', label: 'Car', category: 'other', box: guard.box };
    const out = await runObjectShape(p, await photo(), 'data:full', car);
    expect(out.mode).toBe('recipe');
    expect(p.describeParts).not.toHaveBeenCalled();
    expect(out.recipe!.source).toBeUndefined();
  });

  it('skips the outline fit over imagined parts (the optimizer only knows templates)', async () => {
    const p = client(meta(kitToRecipe(animalKit), { kit: animalKit }));
    p.describeParts.mockResolvedValue({ recipe: imaginedAnimal });
    const outlined = { ...guard, label: 'Zebu', outline: 'M0 0.3L1 0.3L1 1L0 1Z' };
    const out = await runObjectShape(p, await photo(), 'data:full', outlined);
    expect(out.mode).toBe('recipe');
    expect(out.recipe!.parts).toHaveLength(4);
    expect(out.recipe!.source).toBe('free');
    expect(out).not.toHaveProperty('fit');
  });
});

describe('runObjectShape kit samples (PQ-T18)', () => {
  const car = (n: number): ObjectKit => ({
    archetype: 'vehicle',
    subtype: 'sedan',
    proportions: { w: 1, h: 0.5, d: 0.4 },
    colors: { main: '#223344', secondary: '#223344', accent: '#445566' },
    details: { wheels: n },
  });
  const answer = (n: number) => meta(kitToRecipe(car(n)), { kit: car(n) });

  it('asks the kit once by default', async () => {
    const p = client(answer(4));
    await runObjectShape(p, await photo(), 'data:full', target);
    expect(p.describeShape).toHaveBeenCalledTimes(1);
  });

  it('two samples need the budget: under 40 s still one call', async () => {
    const p = client(answer(4));
    await runObjectShape(p, await photo(), 'data:full', target, {
      kitSamples: 2,
      timeoutMs: 30_000,
    });
    expect(p.describeShape).toHaveBeenCalledTimes(1);
  });

  it('two samples: two calls, the answer still builds', async () => {
    const p = client(answer(4));
    p.describeShape.mockResolvedValueOnce(answer(4)).mockResolvedValueOnce(answer(6));
    const out = await runObjectShape(p, await photo(), 'data:full', target, {
      kitSamples: 2,
      timeoutMs: 60_000,
    });
    expect(p.describeShape).toHaveBeenCalledTimes(2);
    expect(out.mode).toBe('recipe');
  });

  it('a failing second sample leaves the first alone', async () => {
    const p = client(answer(4));
    p.describeShape.mockResolvedValueOnce(answer(4)).mockRejectedValueOnce(new Error('x'));
    const out = await runObjectShape(p, await photo(), 'data:full', target, {
      kitSamples: 2,
      timeoutMs: 60_000,
    });
    expect(out.mode).toBe('recipe');
  });
});

describe('runObjectShape asks about the family (PQ-T41)', () => {
  const lowKit = (archetype: 'vehicle' | 'cabinet'): ObjectKit => ({
    archetype,
    proportions: { w: 1, h: 0.5, d: 0.4 },
    colors: { main: '#223344', secondary: '#223344', accent: '#445566' },
    confidence: { archetype: 0.3 },
  });
  const answer = (k: ObjectKit) => meta(kitToRecipe(k), { kit: k });

  it('a doubtful family → ask with the kit family and the detection hint', async () => {
    const p = client(answer(lowKit('vehicle')));
    const out = await runObjectShape(p, await photo(), 'data:full', target);
    // « Fridge » is a cabinet by the detection hint; Spark says vehicle with 0.3.
    expect(out.ask).toEqual({ archetypes: ['vehicle', 'cabinet'] });
  });

  it("the operator's pick is the hint, the kit family, and ends the question", async () => {
    const p = client(answer(lowKit('vehicle')));
    const out = await runObjectShape(p, await photo(), 'data:full', {
      ...target,
      archetype: 'cabinet',
    });
    expect(p.describeShape.mock.calls[0]![1]).toMatchObject({ archetype: 'cabinet' });
    expect(out.ask).toBeUndefined();
    expect(out.kit?.archetype).toBe('cabinet');
  });

  it('two samples that name different families → the kept one first, the other as second choice (PR #13 review)', async () => {
    const sure = (a: 'vehicle' | 'cabinet') => ({ ...lowKit(a), confidence: { archetype: 0.9 } });
    const p = client(answer(sure('cabinet')));
    p.describeShape
      .mockResolvedValueOnce(answer(sure('cabinet')))
      .mockResolvedValueOnce(answer(sure('vehicle')));
    const out = await runObjectShape(p, await photo(), 'data:full', target, {
      kitSamples: 2,
      timeoutMs: 60_000,
    });
    expect(p.describeShape).toHaveBeenCalledTimes(2);
    const kept = out.kit!.archetype;
    expect(out.ask).toEqual({
      archetypes: [kept, kept === 'cabinet' ? 'vehicle' : 'cabinet'],
    });
  });

  it('a confident answer asks nothing', async () => {
    const kit = { ...lowKit('cabinet'), confidence: { archetype: 0.9 } };
    const out = await runObjectShape(client(answer(kit)), await photo(), 'data:full', target);
    expect(out.ask).toBeUndefined();
  });
});

describe('runObjectShape route B (PQ-T45)', () => {
  const guessed: ObjectKit = {
    archetype: 'house',
    proportions: { w: 1, h: 0.5, d: 0.4 },
    colors: { main: '#c8aa78', secondary: '#6e5f55', accent: '#1e232d' },
    details: { windows: 2 },
  };
  const box = (x1: number, y1: number, x2: number, y2: number) => ({
    box: { x1, y1, x2, y2 },
    confidence: 0.9,
  });
  /** Facade drawing 200×100: house, roof and wall bands, 2 windows, 1 door. */
  const MASKS: Record<string, Array<ReturnType<typeof box>>> = {
    house: [box(20, 10, 180, 95)],
    roof: [box(15, 10, 185, 40)],
    wall: [box(20, 40, 180, 95)],
    window: [box(40, 55, 60, 75), box(120, 55, 140, 75)],
    door: [box(85, 60, 105, 95)],
  };
  const seg = (concept: string) => ({
    source: 'meta' as const,
    model: 'sam-3.1',
    concept,
    imageWidth: 200,
    imageHeight: 100,
    instances: MASKS[concept] ?? [],
    count: (MASKS[concept] ?? []).length,
    boxCoverage: 0.5,
  });
  const LOSING_CODE = `return [{ shape: 'box', at: [0, 0, 0], size: [0.1, 0.1, 0.1], color: '#ffffff' }];`;

  async function facadeRun(code: string | null | 'absent') {
    const buffer = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .png()
      .toBuffer();
    const facadeUrl = `data:image/png;base64,${buffer.toString('base64')}`;
    const writeBuildCode = vi.fn(async () => ({
      code: code === 'absent' ? null : code,
      source: 'meta',
      model: 'muse-wonder-1.0',
    }));
    const p = {
      ...client(meta(kitToRecipe(guessed), { kit: guessed })),
      segmentImage: vi.fn(async (url: string, concept: string) => seg(concept)),
      ...(code === 'absent' ? {} : { writeBuildCode }),
    };
    const timings: string[] = [];
    let seen: unknown;
    const out = await runObjectShape(
      p,
      await street(),
      'data:full',
      {
        id: 'det-house',
        label: 'cottage',
        category: 'other',
        scenery: 'building',
        box: { x: 0, y: 0, w: 1, h: 1 },
        facadeUrl,
      },
      {
        onTiming: (phase) => timings.push(phase),
        onCode: (c) => (seen = c),
      }
    );
    return { out, p, timings, seen };
  }

  it('runs route B on the facade path: writer called, code phase timed', async () => {
    const { out, p, timings, seen } = await facadeRun(LOSING_CODE);
    expect(out.mode).toBe('recipe');
    // Losing code: the staged facade draft stands, no code stored.
    expect(out.recipe?.source).toBe('facade');
    expect(seen).toBeUndefined();
    expect(p.writeBuildCode).toHaveBeenCalled();
    const [image, question] = p.writeBuildCode.mock.calls[0]!;
    expect(image).toMatch(/^data:image\/jpeg;base64,/);
    expect(question).toMatch(/Draft: \{/);
    expect(question).toMatch(/Measured: /);
    expect(question).toMatch(/eave /);
    expect(timings).toContain('code');
    expect(timings).toContain('views');
  });

  it('broken code never breaks the run: the draft stands', async () => {
    const { out, seen } = await facadeRun('const x = ;');
    expect(out.mode).toBe('recipe');
    expect(out.recipe?.source).toBe('facade');
    expect(seen).toBeUndefined();
  });

  it('null answers are failed rounds, still timed under `code`', async () => {
    const { out, p, timings, seen } = await facadeRun(null);
    expect(out.mode).toBe('recipe');
    expect(out.recipe?.source).toBe('facade');
    expect(p.writeBuildCode).toHaveBeenCalled();
    expect(seen).toBeUndefined();
    expect(timings).toContain('code');
  });

  it('no writer → route B skipped, no code phase', async () => {
    const { out, timings, seen } = await facadeRun('absent');
    expect(out.mode).toBe('recipe');
    expect(out.recipe?.source).toBe('facade');
    expect(seen).toBeUndefined();
    expect(timings).not.toContain('code');
  });
});
