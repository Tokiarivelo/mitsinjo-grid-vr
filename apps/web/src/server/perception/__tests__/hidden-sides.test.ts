// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { ObjectKit } from '@/lib/object-kit';
import type { ObjectRecipe, RecipePart } from '@/lib/object-shape';
import { GOLDEN_SHAPES } from '../__fixtures__/shape';
import { checkConstraints } from '../object-graph';
import { deduceHiddenSides } from '../hidden-sides';
import { runGolden } from './golden-run';

const part = (p: Partial<RecipePart> & { shape: RecipePart['shape'] }): RecipePart => ({
  at: [0, 0, 0],
  size: [1, 1, 1],
  color: '#ffffff',
  ...p,
});
const recipe = (parts: RecipePart[]): ObjectRecipe => ({
  proportions: { w: 1, h: 1, d: 1 },
  parts,
  yaw: 0,
});

const COLORS: ObjectKit['colors'] = { main: '#b0302f', secondary: '#90a3b4', accent: '#1d1c1c' };

/** Single house: walls + one window + one taller door on the front. */
function houseRecipe(): ObjectRecipe {
  return recipe([
    part({ shape: 'box', at: [0, 0, 0], size: [1, 0.6, 1], color: '#c8aa78', front: true }),
    part({ shape: 'box', at: [-0.2, 0.1, 0.505], size: [0.1, 0.12, 0.02], color: '#222222' }),
    part({ shape: 'box', at: [0.25, -0.16, 0.505], size: [0.09, 0.28, 0.02], color: '#444444' }),
  ]);
}

function sedanRecipe(): ObjectRecipe {
  return recipe([
    part({ shape: 'box', at: [0, 0, 0], size: [1, 0.5, 0.9], color: COLORS.main, front: true }),
    part({ shape: 'box', at: [0, 0.3, 0], size: [0.5, 0.3, 0.8], color: COLORS.secondary }),
  ]);
}

describe('deduceHiddenSides (PR-2.16)', () => {
  it('deduces nothing past the mirror gate', () => {
    expect(
      deduceHiddenSides('house', houseRecipe(), { yaw: 0.5, colors: COLORS, room: 12 })
    ).toEqual([]);
    expect(deduceHiddenSides('house', houseRecipe(), { yaw: 0, colors: COLORS, room: 0 })).toEqual(
      []
    );
  });

  it('mirrors the front facade onto the back face', () => {
    // Room for the end pair only: ends ship, the back set waits (atomicity).
    const ends = deduceHiddenSides('house', houseRecipe(), { yaw: 0, colors: COLORS, room: 2 });
    expect(ends).toHaveLength(2);
    const all = deduceHiddenSides('house', houseRecipe(), { yaw: 0, colors: COLORS, room: 12 });
    expect(all).toHaveLength(4);
    const twins = all.slice(2);
    // Rear door opposite the front door, back windows: same x/y/size/colour, back face.
    expect(twins.map((t) => t.at[2])).toEqual([-0.491, -0.491]);
    expect(twins[0]).toMatchObject({ shape: 'box', color: '#222222', size: [0.1, 0.12, 0.02] });
    expect(twins[0]!.at.slice(0, 2)).toEqual([-0.2, 0.1]);
    expect(twins[1]).toMatchObject({ color: '#444444', size: [0.09, 0.28, 0.02] });
  });

  it('puts a window on each gable end, copied from the shortest front plate', () => {
    const all = deduceHiddenSides('house', houseRecipe(), { yaw: 0, colors: COLORS, room: 12 });
    const wins = all.slice(0, 2);
    expect(wins.map((w) => w.at[0])).toEqual([0.491, -0.491]);
    // Window (h 0.12), not the taller door: thin in x, front-window size and colour.
    for (const w of wins) {
      expect(w).toMatchObject({ shape: 'box', color: '#222222', size: [0.02, 0.12, 0.1] });
      expect(w.at[1]).toBe(0.1);
      expect(w.at[2]).toBe(0);
    }
  });

  it('skips plates whose twin already exists', () => {
    const r = houseRecipe();
    r.parts.push(
      part({ shape: 'box', at: [-0.2, 0.1, -0.491], size: [0.1, 0.12, 0.02], color: '#222222' })
    );
    const all = deduceHiddenSides('house', r, { yaw: 0, colors: COLORS, room: 12 });
    // Ends + the door twin only; the window twin is not duplicated.
    expect(all).toHaveLength(3);
    expect(all.filter((p) => p.at[2] < 0)).toHaveLength(1);
  });

  it('gives the sedan an inferred rear door on the rear face', () => {
    const doors = deduceHiddenSides('vehicle', sedanRecipe(), { yaw: 0, colors: COLORS, room: 12 });
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({
      shape: 'box',
      color: COLORS.secondary,
      size: [0.02, 0.03, 0.54],
    });
    expect(doors[0]!.at[0]).toBeCloseTo(-0.491, 5);
    expect(doors[0]!.at[1]).toBeCloseTo(0.15, 5);
  });

  it('gives bikes no rear door and holds the budget when full', () => {
    const bike = sedanRecipe();
    bike.parts[0]!.size = [1, 0.5, 0.22];
    expect(deduceHiddenSides('vehicle', bike, { yaw: 0, colors: COLORS, room: 12 })).toEqual([]);
    const full = sedanRecipe();
    while (full.parts.length < 12) full.parts.push(part({ shape: 'box' }));
    expect(deduceHiddenSides('vehicle', full, { yaw: 0, colors: COLORS, room: 0 })).toEqual([]);
  });

  describe('far side by symmetry (PQ-T22)', () => {
    const car = () => {
      const r = sedanRecipe();
      r.parts.push(
        part({
          shape: 'cylinder',
          axis: 'z',
          kind: 'wheel',
          at: [0.3, -0.25, 0.46],
          size: [0.2, 0.2, 0.08],
        }),
        part({ shape: 'box', kind: 'window', at: [0, 0.3, 0.41], size: [0.4, 0.2, 0.02] }),
        part({ shape: 'box', at: [0.4, 0.1, 0.5], size: [0.04, 0.04, 0.04] }), // mirror
        part({ shape: 'box', kind: 'door', at: [-0.1, 0, 0.455], size: [0.3, 0.4, 0.02] }),
        part({ shape: 'box', kind: 'handle', at: [-0.1, 0.1, 0.47], size: [0.05, 0.02, 0.02] })
      );
      return r;
    };
    const far = (parts: RecipePart[]) => parts.filter((p) => p.at[2] < 0);

    it('car: far-side wheel, window and mirror appear, the door and handle do not', () => {
      const out = far(deduceHiddenSides('vehicle', car(), { yaw: 0, colors: COLORS, room: 12 }));
      expect(out.map((p) => p.kind ?? 'trim').sort()).toEqual(['trim', 'wheel', 'window']);
      const wheel = out.find((p) => p.kind === 'wheel')!;
      expect(wheel.at).toEqual([0.3, -0.25, -0.46]);
      expect(wheel.axis).toBe('z');
      expect(wheel.status).toBeUndefined();
    });

    it('fridge: the handle and the display never cross over, trim does', () => {
      const fridge = recipe([
        part({ shape: 'box', at: [0, 0, 0], size: [0.5, 1, 0.5], front: true }),
        part({ shape: 'box', kind: 'handle', at: [0.2, 0.1, 0.26], size: [0.03, 0.25, 0.02] }),
        part({ shape: 'box', kind: 'display', at: [0, 0.3, 0.26], size: [0.1, 0.05, 0.02] }),
        part({ shape: 'box', kind: 'frame', at: [0, -0.45, 0.26], size: [0.4, 0.04, 0.02] }),
      ]);
      const out = deduceHiddenSides('cabinet', fridge, { yaw: 0, colors: COLORS, room: 12 });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ kind: 'frame', at: [0, -0.45, -0.26] });
    });

    it('a far twin that already stands is not doubled; a set that does not fit is withheld whole', () => {
      const r = car();
      const twin = far(deduceHiddenSides('vehicle', r, { yaw: 0, colors: COLORS, room: 12 }));
      const again = deduceHiddenSides(
        'vehicle',
        { ...r, parts: [...r.parts, ...twin] },
        {
          yaw: 0,
          colors: COLORS,
          room: 12,
        }
      );
      expect(far(again)).toHaveLength(0);
      expect(
        far(deduceHiddenSides('vehicle', r, { yaw: 0, colors: COLORS, room: 2 }))
      ).toHaveLength(0);
    });

    it('a handle detail is not copied to the far side, other details are', () => {
      const r = car();
      r.parts[2] = { ...r.parts[2]!, details: ['handle', 'arch'] };
      const out = far(deduceHiddenSides('vehicle', r, { yaw: 0, colors: COLORS, room: 12 }));
      expect(out.find((p) => p.kind === 'wheel')!.details).toEqual(['arch']);
    });
  });

  it('cottage e2e: end windows ship as inferred, constraints clean, car gated', async () => {
    const cottage = GOLDEN_SHAPES.find((c) => c.name === 'cottage row')!;
    const { shape } = await runGolden(cottage);
    expect(shape.mode).toBe('recipe');
    // Room for the end pair (9 → 11); the 4-window back set waits.
    expect(shape.recipe!.parts).toHaveLength(11);
    const ends = shape.recipe!.parts.slice(-2);
    expect(ends.map((p) => p.shape)).toEqual(['box', 'box']);
    expect(ends.every((p) => p.status === 'inferred')).toBe(true);
    expect(checkConstraints('house', shape.recipe!)).toBe(0);
    // Side-view car: past the gate, the recipe is untouched.
    const car = GOLDEN_SHAPES.find((c) => c.name === 'car')!;
    const driven = await runGolden(car);
    expect(driven.shape.recipe!.parts).toHaveLength(12);
  }, 60_000);
});
