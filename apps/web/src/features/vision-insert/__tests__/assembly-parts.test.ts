import { describe, expect, it } from 'vitest';
import type { ObjectRecipe, RecipePart } from '@/lib/object-shape';
import { expandAssemblies } from '../utils/assembly-parts';
import { layoutOpenings } from '../utils/openings';
import { RIM_COLOR } from '../utils/view-assemblies';

const wall: RecipePart = {
  shape: 'box',
  at: [0, 0, 0],
  size: [1, 0.6, 0.6],
  color: '#e6dccb',
  material: 'plaster',
  kind: 'wall',
  timber: { posts: [0.2, 0.8], rails: [0.5] },
};
const window: RecipePart = {
  shape: 'box',
  at: [-0.2, 0.05, 0.31],
  size: [0.2, 0.2, 0.02],
  color: '#8fa3b5',
  kind: 'window',
};
const chimney: RecipePart = {
  shape: 'box',
  at: [0.3, 0.4, 0],
  size: [0.1, 0.2, 0.1],
  color: '#8a4a3a',
  kind: 'chimney',
  cap: true,
};
const wheel: RecipePart = {
  shape: 'cylinder',
  axis: 'z',
  at: [0.3, -0.25, 0.3],
  size: [0.2, 0.2, 0.05],
  color: '#1c1c1c',
  kind: 'wheel',
  rim: true,
};
const recipe: ObjectRecipe = {
  proportions: { w: 1, h: 1, d: 1 },
  parts: [wall, window, chimney, wheel],
};

describe('expandAssemblies (PQ-T3)', () => {
  it('names the recipe part every detail comes from', () => {
    const { parts, origin } = expandAssemblies(recipe);
    expect(origin).toHaveLength(parts.length);
    const of = (k: number) => parts.filter((_, i) => origin[i] === k);
    // Window → glass + frame pieces; never the window box itself.
    expect(of(1).length).toBeGreaterThan(3);
    expect(of(1)).not.toContain(window);
    expect(of(1).some((p) => p.kind === 'frame')).toBe(true);
    // Chimney → itself + its cap; wheel → itself + its rim; wall → itself + its timber beams.
    expect(of(2)).toHaveLength(2);
    expect(of(3).some((p) => p.color === RIM_COLOR)).toBe(true);
    expect(of(0)[0]).toBe(wall);
    expect(of(0).filter((p) => p.material === 'wood').length).toBeGreaterThan(2);
  });

  it('expands openings exactly as the whole layout does (same parts, same holes)', () => {
    const whole = layoutOpenings(recipe);
    const { parts, holes, origin } = expandAssemblies(recipe);
    expect(holes.get(wall)).toEqual(whole.holes.get(wall));
    expect(whole.parts.filter((p) => p !== wall && p !== chimney && p !== wheel)).toEqual(
      parts.filter((_, i) => origin[i] === 1)
    );
  });
});
