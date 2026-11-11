// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { kitToRecipe, ObjectKitSchema } from '@/lib/object-kit';
import type { ObjectRecipe, PartMask, RecipePart } from '@/lib/object-shape';
import type { MaskMapGeom } from '../mask-geometry';
import {
  applyConstraints,
  buildGraph,
  checkConstraints,
  listedConcept,
  notBuilt,
  partCoverage,
  repairGraph,
} from '../object-graph';
import { cropRectForShape } from '../shape-crop';

const box = (
  at: [number, number, number],
  size: [number, number, number],
  extra?: Partial<RecipePart>
): RecipePart => ({ shape: 'box', at, size, color: '#aaaaaa', ...extra });

/** Walls + gable + window + stack (eave 0.1, ridge 0.5). */
const houseRecipe = (): ObjectRecipe => ({
  proportions: { w: 1, h: 0.6, d: 0.5 },
  parts: [
    box([0, -0.2, 0], [1, 0.6, 1], { front: true }),
    { shape: 'prism', at: [0, 0.3, 0], size: [1, 0.4, 1], color: '#bb2222', apex: 1 },
    box([-0.3, -0.2, 0.505], [0.12, 0.14, 0.02], { color: '#2222bb' }),
    box([0.3, 0.3, 0], [0.08, 0.4, 0.1]),
  ],
});

/** Photo 200×100, box 160×80 px at (20, 10): the crop is the whole photo. */
const geomA = (): MaskMapGeom => {
  const box = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  return { photoW: 200, photoH: 100, box, crop: cropRectForShape(200, 100, box) };
};

describe('buildGraph (PR-2.14)', () => {
  it('panel → wall, gable → wall, stack → roof, walls → root', () => {
    const parents = buildGraph('house', houseRecipe()).nodes.map((n) => n.parent);
    expect(parents).toEqual([null, 0, 0, 1]);
  });

  it('vehicle panels hang under the shell', () => {
    const recipe: ObjectRecipe = {
      proportions: { w: 1, h: 0.4, d: 0.45 },
      parts: [
        box([0, -0.06, 0], [1, 0.48, 0.9], { front: true }),
        box([0, 0.3, 0], [0.5, 0.3, 0.8], { color: '#cfd6dd' }),
        box([0.1, 0.3, 0.405], [0.2, 0.2, 0.02], { color: '#cfd6dd' }),
      ],
    };
    expect(buildGraph('vehicle', recipe).nodes.map((n) => n.parent)).toEqual([null, 0, 1]);
  });

  it('statuses: measured, estimated, inferred, unknown', () => {
    // On measured structure (outline), template parts are derived, not guessed.
    const plain = buildGraph('house', houseRecipe(), { outline: true });
    expect(plain.nodes.map((n) => n.status)).toEqual([
      'inferred',
      'inferred',
      'inferred',
      'inferred',
    ]);
    // Photo but nothing measured: pure priors.
    const priors = buildGraph('house', houseRecipe(), { photo: true });
    expect(priors.nodes.map((n) => n.status)).toEqual([
      'estimated',
      'estimated',
      'estimated',
      'estimated',
    ]);
    const dark = buildGraph('house', houseRecipe());
    expect(dark.nodes.map((n) => n.status)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    // Window mask on part 2 (object −0.3, −0.2 → photo 52, 66).
    const masks: PartMask[] = [{ concept: 'window', box: { x: 0.2, y: 0.6, w: 0.12, h: 0.12 } }];
    const measured = buildGraph('house', houseRecipe(), { outline: true, masks, geom: geomA() });
    expect(measured.nodes.map((n) => n.status)[2]).toBe('measured');
    // Far-side twin without its own measurement is inferred.
    const win = houseRecipe().parts[2]!;
    const twin: ObjectRecipe = {
      ...houseRecipe(),
      parts: [...houseRecipe().parts, { ...win, at: [win.at[0], win.at[1], -win.at[2]] }],
    };
    const statuses = buildGraph('house', twin, { outline: true }).nodes.map((n) => n.status);
    expect(statuses[4]).toBe('inferred');
    expect(statuses[2]).toBe('inferred');
  });

  it('outline-derived bodies read measured, template lathes estimated', () => {
    const main = box([0, 0, 0], [0.6, 1, 0.6], { front: true });
    const extruded: ObjectRecipe = {
      proportions: { w: 1, h: 1, d: 1 },
      parts: [
        {
          ...main,
          shape: 'extrude',
          points: [
            [-0.3, -0.5],
            [0.3, 0.5],
          ],
        },
      ],
    };
    expect(buildGraph('vehicle', extruded, { outline: true }).nodes[0]!.status).toBe('measured');
    const closed: ObjectRecipe = {
      proportions: { w: 1, h: 1, d: 1 },
      parts: [
        {
          ...main,
          shape: 'lathe',
          profile: [
            [0, -0.5],
            [0.2, 0],
            [0, 0.5],
          ],
        },
      ],
    };
    expect(buildGraph('tree', closed, { outline: true }).nodes[0]!.status).toBe('measured');
    const tank: ObjectRecipe = {
      proportions: { w: 1, h: 1, d: 1 },
      parts: [
        {
          ...main,
          shape: 'lathe',
          profile: [
            [0.16, -0.5],
            [0.16, -0.34],
            [0.24, -0.2],
            [0.24, 0.3],
            [0.16, 0.5],
          ],
        },
      ],
    };
    expect(buildGraph('tank', tank, { outline: true }).nodes[0]!.status).toBe('inferred');
  });
});

describe('applyConstraints + checkConstraints (PR-2.14)', () => {
  it('floating panel is pulled into the wall, then the count is 0', () => {
    const recipe = houseRecipe();
    const win = recipe.parts[2]!;
    const floating: ObjectRecipe = {
      ...recipe,
      parts: recipe.parts.map((p, i) =>
        i === 2 ? { ...p, at: [-0.7, -0.2, 0.505] as [number, number, number] } : p
      ),
    };
    expect(win).toBeDefined();
    expect(checkConstraints('house', floating)).toBe(1);
    const fixed = applyConstraints('house', floating);
    expect(fixed).not.toBe(floating);
    expect(fixed.parts[2]!.at[0]).toBeCloseTo(-0.44, 9);
    expect(fixed.parts[2]!.size[0]).toBeCloseTo(0.12, 9);
    expect(checkConstraints('house', fixed)).toBe(0);
    expect(applyConstraints('house', fixed)).toBe(fixed);
  });

  it('oversize panel shrinks to the parent span', () => {
    const recipe = houseRecipe();
    const wide: ObjectRecipe = {
      ...recipe,
      parts: recipe.parts.map((p, i) =>
        i === 2 ? { ...p, size: [1.4, 0.14, 0.02] as [number, number, number] } : p
      ),
    };
    expect(checkConstraints('house', wide)).toBe(1);
    const fixed = applyConstraints('house', wide);
    expect(fixed.parts[2]!.size[0]).toBeCloseTo(1, 9);
    expect(fixed.parts[2]!.at[0]).toBeCloseTo(0, 9);
    expect(checkConstraints('house', fixed)).toBe(0);
  });

  it('floating stack drops its feet onto the roof plane', () => {
    const recipe = houseRecipe();
    const lifted: ObjectRecipe = {
      ...recipe,
      parts: recipe.parts.map((p, i) =>
        i === 3 ? { ...p, at: [0.3, 0.75, 0] as [number, number, number] } : p
      ),
    };
    expect(checkConstraints('house', lifted)).toBe(1);
    const fixed = applyConstraints('house', lifted);
    const stack = fixed.parts[3]!;
    expect(stack.at[1] - stack.size[1] / 2).toBeCloseTo(0.5, 9);
    expect(stack.size[1]).toBeCloseTo(0.4, 9);
    expect(checkConstraints('house', fixed)).toBe(0);
  });

  it('clean recipes pass through untouched', () => {
    const recipe = houseRecipe();
    expect(checkConstraints('house', recipe)).toBe(0);
    expect(applyConstraints('house', recipe)).toBe(recipe);
  });

  it('inset leaves and side plates are placed by construction, never clamped (PR-2.17)', () => {
    // Segmented wall: largest strip keeps `front`, leaves centred in their holes.
    const recipe: ObjectRecipe = {
      proportions: { w: 1, h: 0.6, d: 0.5 },
      parts: [
        box([-0.375, -0.2, 0], [0.25, 0.6, 1], { front: true }),
        box([0.375, -0.2, 0], [0.25, 0.6, 1]),
        box([-0.1, -0.1, 0], [0.2, 0.2, 0.02], { color: '#2222bb' }),
        box([0.5, -0.1, 0], [0.02, 0.2, 0.2], { color: '#2222bb' }),
      ],
    };
    // The leaf hangs under the wall node (largest strip), like the other strip.
    expect(buildGraph('house', recipe).nodes.map((n) => n.parent)).toEqual([null, 0, 0, 0]);
    // Outside the largest strip's span, yet coherent: no clamp, no violation.
    expect(checkConstraints('house', recipe)).toBe(0);
    expect(applyConstraints('house', recipe)).toBe(recipe);
  });
});

describe('repairGraph + notBuilt (PQ-T37)', () => {
  const body = box([0, 0.05, 0], [0.9, 0.5, 0.6], { front: true, kind: 'body' });
  const wheel = (x: number, y = -0.25): RecipePart => ({
    shape: 'cylinder',
    axis: 'z',
    at: [x, y, 0.3],
    size: [0.2, 0.2, 0.1],
    color: '#1c1c1c',
    kind: 'wheel',
  });
  const car = (parts: RecipePart[]): ObjectRecipe => ({
    proportions: { w: 1, h: 0.5, d: 0.5 },
    parts,
  });

  it('a floating wheel is caught and pulled against the body', () => {
    // Wheel hanging in front of the body, 0.2 off its front face.
    const floating = { ...wheel(0.3, -0.1), at: [0.3, -0.1, 0.55] as RecipePart['at'] };
    const r = repairGraph('vehicle', car([body, wheel(-0.3), floating]));
    expect(r.pulled).toEqual([2]);
    const moved = r.recipe.parts[2]!;
    expect(moved.at[2] - moved.size[2] / 2).toBeCloseTo(0.3, 9);
  });

  it('a duplicate window at one place is merged', () => {
    const win = box([-0.2, 0.15, 0.31], [0.2, 0.15, 0.02], { kind: 'window' });
    const twin = { ...win, at: [-0.19, 0.15, 0.31] as RecipePart['at'] };
    const other = { ...win, at: [0.2, 0.15, 0.31] as RecipePart['at'] };
    const r = repairGraph('vehicle', car([body, win, twin, other]));
    expect(r.merged).toEqual([2]);
    expect(r.recipe.parts).toHaveLength(3);
  });

  it('clean recipes pass through untouched (same reference)', () => {
    const clean = car([body, wheel(-0.3), wheel(0.3)]);
    const r = repairGraph('vehicle', clean);
    expect(r.recipe).toBe(clean);
    expect(r.pulled).toEqual([]);
  });

  it('a part held by another part is not floating: stacked roof tiers stay (PR #9 review)', () => {
    // Walls, then three roof tiers each resting on the one below; only the first touches the walls.
    const walls = box([0, -0.2, 0], [1, 0.6, 1], { front: true });
    const tiers = [
      box([0, 0.16, 0], [1, 0.12, 1]),
      box([0, 0.28, 0], [0.72, 0.12, 0.74]),
      box([0, 0.4, 0], [0.42, 0.12, 0.48]),
    ];
    const stepped: ObjectRecipe = { proportions: { w: 1, h: 1, d: 0.6 }, parts: [walls, ...tiers] };
    const r = repairGraph('house', stepped);
    expect(r.pulled).toEqual([]);
    expect(r.recipe).toBe(stepped);
    // The top tier lifted off the stack is pulled back, and the tiers under it do not move.
    const lifted = { ...tiers[2]!, at: [0, 0.7, 0] as RecipePart['at'] };
    const fixed = repairGraph('house', {
      ...stepped,
      parts: [walls, tiers[0]!, tiers[1]!, lifted],
    });
    expect(fixed.pulled).toEqual([3]);
    expect(fixed.recipe.parts[2]).toBe(tiers[1]);
  });

  it('the house template keeps its roof (PR #9 review)', () => {
    const recipe = kitToRecipe(
      ObjectKitSchema.parse({
        archetype: 'house',
        proportions: { w: 1, h: 1, d: 0.6 },
        colors: { main: '#888888', secondary: '#444444', accent: '#cc2222' },
      })
    );
    expect(repairGraph('house', recipe).recipe).toBe(recipe);
  });

  it('reports what was seen but not built, and a listed mirror with no geometry', () => {
    const masks: PartMask[] = [0.1, 0.4, 0.7].map((x) => ({
      concept: 'wheel',
      box: { x, y: 0.7, w: 0.15, h: 0.25 },
    }));
    const r = car([body, wheel(-0.3), wheel(0.3)]);
    expect(notBuilt(r, masks)).toEqual(['wheel ×1']);
    expect(notBuilt(r, masks.slice(0, 2), ['mirror', 'wheel'])).toEqual(['mirror']);
    expect(notBuilt(r)).toEqual([]);
  });

  it("the kit's listed parts (evidence.visibleParts) are read in the plural and join the part list (PQ-T37)", () => {
    const r = car([body, wheel(-0.3), wheel(0.3)]);
    expect(notBuilt(r, [], ['Wheels', 'side mirrors'])).toEqual(['side mirror']);
    const cov = partCoverage(r, [], ['wheels', 'mirror']);
    expect(cov).toEqual([
      { concept: 'wheel', seen: 1, built: 1 },
      { concept: 'mirror', seen: 1, built: 0 },
    ]);
  });

  it('listed names (PR #12 review): place dropped, known parts by their head noun, real plurals only', () => {
    expect(listedConcept('Wheel, lower left')).toBe('wheel');
    expect(listedConcept('front wheels')).toBe('wheel');
    expect(listedConcept('side window (driver)')).toBe('window');
    expect(listedConcept('side mirrors')).toBe('side mirror');
    expect(listedConcept('batteries')).toBe('battery');
    expect(listedConcept('boxes')).toBe('box');
    // Before: every final « s » was cut (« glas », « bu », « chassi »).
    expect(listedConcept('glass')).toBe('glass');
    expect(listedConcept('bus')).toBe('bus');
    expect(listedConcept('chassis')).toBe('chassis');
    expect(listedConcept('  ,  ')).toBe('');
  });

  it('regression (PR #12 review): parts listed with their place are not reported « not built »', () => {
    const r = car([body, wheel(-0.3), wheel(0.3)]);
    const listed = [
      'wheel, lower left',
      'wheel, lower right',
      'front wheels',
      'mirror, right edge',
    ];
    // Before: « wheel, lower left » matched nothing, so built wheels were reported missing.
    expect(notBuilt(r, [], listed)).toEqual(['mirror']);
    expect(partCoverage(r, [], listed)).toEqual([
      { concept: 'wheel', seen: 3, built: 2 },
      { concept: 'mirror', seen: 1, built: 0 },
    ]);
    // SAM saw the wheels: its count wins, the listed ones are not added on top.
    const m = { concept: 'wheel', box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } };
    expect(partCoverage(r, [m, m], listed)[0]).toEqual({ concept: 'wheel', seen: 2, built: 2 });
  });

  it('partCoverage: seen vs built per SAM concept, for the panel (built never above seen)', () => {
    const r = car([body, wheel(-0.3), wheel(0.3)]);
    const m = (concept: string) => ({ concept, box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } });
    expect(partCoverage(r, [m('wheel'), m('window'), m('window')])).toEqual([
      { concept: 'wheel', seen: 1, built: 1 },
      { concept: 'window', seen: 2, built: 0 },
    ]);
    expect(partCoverage(r, [])).toEqual([]);
  });
});
