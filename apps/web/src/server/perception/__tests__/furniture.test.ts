import { describe, expect, it } from 'vitest';
import { ObjectRecipeSchema } from '@/lib/object-shape';
import {
  bed,
  cabinet,
  chair,
  curtain,
  door,
  fence,
  furnitureRecipe,
  glazing,
  ironRailing,
  latticeTower,
  railing,
  sCurve,
  sofa,
  stool,
  table,
  type PartSpec,
} from '../furniture';

const concepts = (parts: PartSpec[]) => new Set(parts.map((p) => p.concept).filter(Boolean));

/** A builder's parts give a valid recipe holding the named pieces expected of it. */
function check(parts: PartSpec[], expected: string[]) {
  const recipe = furnitureRecipe(parts);
  expect(ObjectRecipeSchema.safeParse(recipe).success).toBe(true);
  expect(Math.max(recipe.proportions.w, recipe.proportions.h, recipe.proportions.d)).toBe(1);
  for (const c of expected) expect(concepts(parts), c).toContain(c);
  return recipe;
}

describe('furniture builders (PQ-T88)', () => {
  it('sofa: seat, backrest, cushions, arms, four legs', () => {
    const parts = sofa({
      w: 2,
      d: 0.9,
      seat: 0.45,
      back: 0.85,
      arm: 0.62,
      leg: 0.12,
      color: '#777777',
      cushions: 3,
    });
    check(parts, ['seat', 'backrest', 'cushion', 'arm', 'leg']);
    expect(parts.filter((p) => p.concept === 'leg')).toHaveLength(4);
    expect(parts.filter((p) => p.concept === 'cushion')).toHaveLength(3);
    // No arms asked: none built.
    const bare = sofa({ w: 1.6, d: 0.8, seat: 0.4, back: 0.8, arm: 0, leg: 0.1, color: '#777777' });
    expect(concepts(bare)).not.toContain('arm');
  });

  it('chair: seat, backrest and legs in every style, a frame for a director chair', () => {
    for (const style of ['shell', 'director', 'upholstered', 'wire'] as const)
      check(
        chair({
          w: 0.5,
          d: 0.5,
          seat: 0.45,
          back: 0.9,
          color: '#dddddd',
          legColor: '#333333',
          style,
        }),
        ['seat', 'backrest', 'leg']
      );
    const director = chair({
      w: 0.55,
      d: 0.5,
      seat: 0.45,
      back: 0.95,
      color: '#dddddd',
      legColor: '#333333',
      style: 'director',
      arms: true,
    });
    check(director, ['frame', 'arm']);
  });

  it('stool: seat, legs, foot ring', () => {
    check(stool(0.75, 0.35, '#8a6a48', '#2b2b2d', true), ['seat', 'leg', 'frame']);
    const round = stool(0.75, 0.35, '#8a6a48', '#2b2b2d', true);
    expect(round[0]!.shape).toBe('cylinder');
    expect(stool(0.5, 0.3, '#8a6a48', '#8a6a48', false)[0]!.shape).toBe('box');
  });

  it('bed: frame, mattress, blanket and one cushion per pillow', () => {
    const parts = bed(1.6, 2, 0.3, '#8a6a48', '#ffffff', '#335577', ['#eeeeee', '#eeeeee']);
    check(parts, ['frame', 'mattress', 'cushion']);
    expect(parts.filter((p) => p.concept === 'cushion')).toHaveLength(3);
  });

  it('table: top on four legs, or on a pedestal with feet', () => {
    check(table(0.75, 1.6, 0.9, '#8a6a48', '#2b2b2d'), ['table', 'leg']);
    const pedestal = table(0.7, 0.8, 0.8, '#8a6a48', '#2b2b2d', { round: true, pedestal: true });
    check(pedestal, ['table', 'stand', 'foot']);
    expect(concepts(pedestal)).not.toContain('leg');
  });

  it('cabinet: carcass, a door and a handle per door, glazed doors and a worktop', () => {
    const parts = cabinet(1.8, 0.9, 0.6, '#ffffff', 3, { top: '#444444' });
    check(parts, ['frame', 'door', 'handle', 'table']);
    expect(parts.filter((p) => p.concept === 'handle')).toHaveLength(3);
    check(cabinet(1, 2, 0.4, '#ffffff', 2, { glass: true }), ['window_pane', 'handle']);
  });

  it('glazing: frame, pane, a bar between each column and row; arched', () => {
    const parts = glazing(1.2, 1.4, 3, 2, '#ffffff', '#334455');
    check(parts, ['window', 'window_pane']);
    // Frame + glass + 2 mullions + 1 transom.
    expect(parts).toHaveLength(5);
    const arched = glazing(1, 2, 1, 1, '#ffffff', '#334455', { arch: true });
    expect(arched[0]!.points!.length).toBeGreaterThan(4);
  });

  it('door: frame, leaf, handle; glazed leaves carry panes', () => {
    check(door(0.9, 2.1, '#5a3a22'), ['frame', 'door', 'handle']);
    check(door(1.6, 2.2, '#ffffff', { leaves: 2, glass: [2, 4] }), [
      'frame',
      'window_pane',
      'handle',
    ]);
  });

  it('curtain: one sheet cut to its traced outline', () => {
    const [sheet] = curtain(1.4, 2.4, '#e8e7e3', { band: [0.1, 1] });
    check([sheet!], ['curtain']);
    expect(sheet!.silhouette?.band).toEqual([0.1, 1]);
    expect(sheet!.silhouette?.section?.length).toBeGreaterThan(3);
  });

  it('railing: two rails, end posts and n balusters', () => {
    const parts = railing(4, 1, 12);
    check(parts, ['rail', 'pole']);
    expect(parts).toHaveLength(2 + 2 + 12);
  });

  it('iron railing (VS-T46): three rails, posts where asked, S balusters and scrolls, under the part cap', () => {
    const parts = ironRailing(7, 1, 30, [0.01, 0.42, 0.72, 0.99]);
    check(parts, ['rail', 'pole']);
    expect(parts.filter((p) => p.concept === 'pole')).toHaveLength(4);
    // Balusters are curved ribbons (extrudes), never rods; none sits on a post.
    const ribbons = parts.filter((p) => p.shape === 'extrude');
    expect(ribbons.length).toBeGreaterThan(20);
    expect(parts.length).toBeLessThanOrEqual(96);
  });

  it('sCurve swings out one way low and the other way high', () => {
    const pts = sCurve(0, 0, 1, 0.05);
    const low = pts[Math.round(pts.length * 0.25)]![0];
    const high = pts[Math.round(pts.length * 0.75)]![0];
    expect(Math.sign(low)).toBe(-Math.sign(high));
    expect(pts[0]![1]).toBe(0);
    expect(pts[pts.length - 1]![1]).toBe(1);
  });

  it('lattice tower (VS-T46): four legs, braced panels front and back, cross arms, tapering', () => {
    const parts = latticeTower(30, 6, 1.4, 9, [
      [0.68, 3.4],
      [0.88, 2.4],
    ]);
    const recipe = check(parts, ['pole', 'rail']);
    expect(parts.length).toBe(2 * (2 + 9 * 3) + 2 * 3);
    expect(parts.length).toBeLessThanOrEqual(96);
    // Tall and slender, wider at the arms than at the head.
    expect(recipe.proportions.h).toBe(1);
    expect(recipe.proportions.w).toBeLessThan(0.35);
  });

  it('fence: boards on a rail, pillars and a base wall when asked', () => {
    const parts = fence(6, 1.3, '#6a5545', 2, '#9a8b78');
    check(parts, ['rail', 'timber_beam', 'stone_foundation']);
    expect(fence(6, 1.3, '#6a5545', 0).some((p) => p.concept === 'stone_foundation')).toBe(false);
  });
});
