import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ObjectRecipeSchema } from '@/lib/object-shape';
import {
  clipBand,
  dropSpikes,
  resampleRing,
  resolveSilhouettes,
  ROUND_SECTION,
  SILHOUETTE_POINTS,
  silhouettePlant,
  silhouetteRing,
} from '../tour-mock/silhouette';
import { box, compileSpec } from '../tour-mock/spec';

// A triangle (apex up) in photo fractions, in a 0.2 × 0.4 box; pixels are square (aspect 1).
const TRI = [
  [0.5, 0.3],
  [0.6, 0.7],
  [0.4, 0.7],
] as const;
const BOX = { x: 0.4, y: 0.3, w: 0.2, h: 0.4 };

describe('tour mock silhouette parts (VS-T42)', () => {
  it('cuts a ring to a horizontal band', () => {
    const cut = clipBand(TRI, 0.5, 0.7);
    expect(Math.min(...cut.map(([, y]) => y))).toBeCloseTo(0.5);
    expect(Math.max(...cut.map(([, y]) => y))).toBeCloseTo(0.7);
    // The cut at mid-height is half the base wide.
    const top = cut.filter(([, y]) => Math.abs(y - 0.5) < 1e-9).map(([x]) => x);
    expect(Math.max(...top) - Math.min(...top)).toBeCloseTo(0.1);
  });

  it('drops zero-area spikes and repeats left by a cut along an edge', () => {
    const spiky = [
      [0.6, 0.5],
      [0.6, 0.5],
      [0.45, 0.5],
      [0.45, 0.7],
      [0.4, 0.7],
      [0.4, 0.5],
    ] as const;
    // (0.4, 0.5) → (0.6, 0.5) → (0.45, 0.5) doubles back: the 0.6 spike goes.
    expect(dropSpikes(spiky)).toEqual([
      [0.45, 0.5],
      [0.45, 0.7],
      [0.4, 0.7],
      [0.4, 0.5],
    ]);
  });

  it('resamples a long ring to at most n points along its perimeter', () => {
    const circle = Array.from({ length: 200 }, (_, i) => {
      const t = (i / 200) * Math.PI * 2;
      return [Math.cos(t), Math.sin(t)] as const;
    });
    const r = resampleRing(circle, 40);
    expect(r).toHaveLength(40);
    for (const [x, y] of r) expect(Math.hypot(x, y)).toBeCloseTo(1, 2);
    expect(resampleRing(TRI, 40)).toHaveLength(3);
  });

  it('gives the outline as a unit ring (y up), its pixel proportions and its band shift', () => {
    const s = silhouetteRing([TRI], BOX, 1)!;
    expect(s.aspect).toBeCloseTo(0.5);
    expect(s.offset).toBeCloseTo(0);
    const ys = s.ring.map(([, y]) => y);
    // The apex is the top (y = +0.5), the base the bottom.
    expect(s.ring.find(([, y]) => y === Math.max(...ys))![0]).toBeCloseTo(0);
    expect(Math.min(...ys)).toBeCloseTo(-0.5);
    // A wider-pixel photo widens the part.
    expect(silhouetteRing([TRI], BOX, 2)!.aspect).toBeCloseTo(1);
  });

  it('keeps an off-centre band where it sits under the object', () => {
    const lShape = [
      [0.4, 0.3],
      [0.6, 0.3],
      [0.6, 0.5],
      [0.45, 0.5],
      [0.45, 0.7],
      [0.4, 0.7],
    ] as const;
    const foot = silhouetteRing([lShape], BOX, 1, [0.5, 1])!;
    // The foot (x 0.40–0.45) sits 0.075 left of the box centre, the band is 0.2 high.
    expect(foot.offset).toBeCloseTo(-0.375);
  });

  it('turns a silhouette part into a valid hull on the outline, other parts untouched', () => {
    const spec = {
      kind: 'parts' as const,
      parts: [
        box([0, 0.5, 0], [1, 1, 0.4], '#808080', { silhouette: {} }),
        box([0, 1.1, 0], [0.2, 0.2, 0.2], '#202020'),
      ],
    };
    const out = resolveSilhouettes(spec, [TRI], BOX, 1);
    expect(out.parts[0]!.shape).toBe('hull');
    expect(out.parts[0]!.size[0]).toBeCloseTo(0.5);
    expect(out.parts[0]!.section).toEqual(ROUND_SECTION);
    expect(out.parts[1]).toBe(spec.parts[1]);
    const { recipe } = compileSpec(out);
    expect(ObjectRecipeSchema.safeParse(recipe).success).toBe(true);
    expect('silhouette' in recipe.parts[0]!).toBe(false);
  });

  it('builds the plant fallback as a crown over a trunk, both on the outline', () => {
    const tree = [
      [0.4, 0.3],
      [0.6, 0.3],
      [0.6, 0.6],
      [0.52, 0.6],
      [0.52, 0.7],
      [0.48, 0.7],
      [0.48, 0.6],
      [0.4, 0.6],
    ] as const;
    const plant = silhouettePlant([tree], BOX, 1, 0.75)!;
    expect(plant.parts.map((p) => p.kind)).toEqual(['crown', 'trunk']);
    expect(plant.parts.every((p) => p.shape === 'hull')).toBe(true);
    const points = plant.parts[0]!.points!;
    expect(points.length).toBeLessThanOrEqual(SILHOUETTE_POINTS);
    expect(ObjectRecipeSchema.safeParse(compileSpec(plant).recipe).success).toBe(true);
  });
});
