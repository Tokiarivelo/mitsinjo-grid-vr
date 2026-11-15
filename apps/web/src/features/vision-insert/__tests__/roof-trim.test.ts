import { describe, expect, it } from 'vitest';
import type { RecipePart } from '@/lib/object-shape';
import {
  CAP_WIDEN,
  EAVE_ROLL_SHARE,
  expandChimneyCaps,
  expandRoofTrim,
  FASCIA_THICK,
  roofBulge,
  trimReach,
} from '../utils/roof-trim';
import { recipeMesh } from '../utils/object-geometry';

const P = { w: 1, h: 0.6, d: 0.5 };
const roof = (over: Partial<RecipePart> = {}): RecipePart => ({
  shape: 'hip',
  ridge: 0.8,
  at: [0, 0.3, 0],
  size: [1, 0.4, 1],
  color: '#c8a060',
  material: 'thatch',
  kind: 'roof',
  ...over,
});

describe('expandRoofTrim (PG-T12)', () => {
  it('a thatched hip roof gets a roll on each of its 4 eaves, roof colour', () => {
    const parts = expandRoofTrim([roof()], P);
    const rolls = parts.filter((p) => p.shape === 'cylinder');
    expect(rolls).toHaveLength(4);
    expect(rolls.every((r) => r.color === '#c8a060' && r.material === 'thatch')).toBe(true);
    expect(rolls.filter((r) => r.axis === 'x')).toHaveLength(2);
  });

  it('rolls sit on the eave line: front roll at the roof front, near the roof foot', () => {
    const [, front] = expandRoofTrim([roof()], P);
    const roofH = 0.4 * P.h;
    const r = EAVE_ROLL_SHARE * roofH;
    expect(front!.at[2] * P.d).toBeCloseTo(0.5 * P.d, 6);
    const foot = (0.3 - 0.2) * P.h;
    expect(front!.at[1] * P.h).toBeCloseTo(foot + 0.6 * r, 6);
    expect(front!.size[1] * P.h).toBeCloseTo(2 * r, 6);
  });

  it('a gable prism gets 2 rolls along its long sides, past the overhang', () => {
    const rolls = expandRoofTrim([roof({ shape: 'prism', apex: 0.5 })], P, 0.03).filter(
      (p) => p.shape === 'cylinder'
    );
    expect(rolls).toHaveLength(2);
    expect(rolls.every((r) => r.axis === 'z')).toBe(true);
    expect(Math.abs(rolls[0]!.at[0] * P.w)).toBeCloseTo(0.5 + 0.03, 6);
  });

  it('slate and tile roofs get fascia boards instead of rolls; other parts are left alone', () => {
    const slate = expandRoofTrim([roof({ material: 'slate' })], P);
    const boards = slate.filter((p) => p.shape === 'box');
    expect(boards).toHaveLength(4);
    expect(boards.every((b) => b.color === '#c8a060' && b.material === 'slate')).toBe(true);
    expect(slate.filter((p) => p.shape === 'cylinder')).toHaveLength(0);
    expect(expandRoofTrim([{ ...roof(), shape: 'box' as const }], P)).toHaveLength(1);
  });

  it('trim adds mesh: rolls on thatch, boards on slate, both in budget', () => {
    const n = (parts: RecipePart[]) =>
      recipeMesh({ proportions: P, parts }).getAttribute('position').count;
    const bare = n([{ ...roof(), shape: 'box' }]);
    const slate = n([roof({ material: 'slate' })]);
    const thatch = n([roof()]);
    expect(slate).toBeGreaterThan(bare);
    expect(thatch).toBeGreaterThan(bare);
    expect(slate / 3).toBeLessThan(5_000);
    expect(thatch / 3).toBeLessThan(5_000);
  });
});

describe('fascia boards + trim reach (PQ-T43)', () => {
  it('a slate hip roof gets 4 boards under its eaves, none on a thatch roof', () => {
    const boards = expandRoofTrim([roof({ material: 'slate' })], P).filter(
      (p) => p.shape === 'box'
    );
    expect(boards).toHaveLength(4);
    expect(boards.every((b) => b.kind === 'roof')).toBe(true);
    const [front] = boards.filter((b) => b.at[2]! > 0);
    expect(front!.at[2] * P.d).toBeCloseTo(0.5 * P.d - FASCIA_THICK / 2, 6);
    const foot = (0.3 - 0.2) * P.h;
    expect(front!.at[1] * P.h).toBeLessThan(foot);
    expect(expandRoofTrim([roof()], P).filter((p) => p.shape === 'box')).toHaveLength(0);
  });

  it('a gable prism gets 2 boards along its long eaves, past the reach', () => {
    const boards = expandRoofTrim(
      [roof({ shape: 'prism', apex: 0.5, material: 'slate' })],
      P,
      0.03
    ).filter((p) => p.shape === 'box');
    expect(boards).toHaveLength(2);
    expect(boards.every((b) => b.size[2]! > b.size[0]!)).toBe(true);
    expect(Math.abs(boards[0]!.at[0] * P.w)).toBeCloseTo(0.5 + 0.03 - FASCIA_THICK / 2, 6);
  });

  it('no material, no boards: unidentified roofs stay bare (elevation drawings)', () => {
    const bare = roof({ shape: 'prism', apex: 0.5, material: undefined });
    expect(expandRoofTrim([bare], P).filter((p) => p.shape === 'box')).toHaveLength(0);
  });

  it('trimReach: explicit overhang wins; legacy prisms grew, hips did not', () => {
    const prism = (over: Partial<RecipePart>): RecipePart => ({
      ...roof({ shape: 'prism' }),
      ...over,
    });
    expect(trimReach(prism({ overhang: 0.05 }), 0.03)).toBe(0.05);
    expect(trimReach(prism({}), 0.03)).toBe(0.03);
    expect(trimReach(roof({ overhang: 0.05 }), 0.03)).toBe(0.05);
    expect(trimReach(roof({}), 0.03)).toBe(0);
    expect(trimReach(prism({}), 0)).toBe(0);
    expect(trimReach({ ...roof(), shape: 'box' }, 0.03)).toBe(0);
  });
});

describe('roof bulge + chimney cap (PG-T10)', () => {
  it('bulge: thatch default, explicit value wins, 0 = bare, slate gets boards', () => {
    expect(roofBulge(roof())).toBe(EAVE_ROLL_SHARE);
    expect(roofBulge(roof({ bulge: 0.2 }))).toBe(0.2);
    expect(expandRoofTrim([roof({ bulge: 0 })], P)).toHaveLength(1);
    expect(expandRoofTrim([roof({ material: 'slate' })], P)).toHaveLength(5);
    const rolled = expandRoofTrim([roof({ material: 'slate', bulge: 0.1 })], P);
    expect(rolled).toHaveLength(5);
    expect(rolled.filter((p) => p.shape === 'cylinder')).toHaveLength(4);
  });

  it('a bigger bulge makes a thicker roll', () => {
    const thin = expandRoofTrim([roof()], P)[1]!;
    const thick = expandRoofTrim([roof({ bulge: 0.2 })], P)[1]!;
    expect(thick.size[1]).toBeGreaterThan(thin.size[1]);
  });

  it('a capped chimney gets a wider slab right on its top; uncapped unchanged', () => {
    const stack: RecipePart = {
      shape: 'box',
      at: [0.3, 0.4, 0],
      size: [0.06, 0.2, 0.08],
      color: '#9a4b3a',
      material: 'brick',
      kind: 'chimney',
    };
    expect(expandChimneyCaps([stack], P)).toHaveLength(1);
    const [, cap] = expandChimneyCaps([{ ...stack, cap: true }], P);
    expect(cap!.size[0]).toBeCloseTo(CAP_WIDEN * 0.06, 6);
    const stackTop = (0.4 + 0.1) * P.h;
    expect((cap!.at[1] - cap!.size[1] / 2) * P.h).toBeCloseTo(stackTop, 6);
    expect(cap!.color).toBe(stack.color);
  });
});
