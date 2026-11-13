import { describe, expect, it } from 'vitest';
import { blenderScript, recipeGroups } from '../blender-export';
import type { ObjectRecipe } from '@/lib/object-shape';

const recipe: ObjectRecipe = {
  proportions: { w: 1, h: 0.6, d: 0.6 },
  parts: [
    { shape: 'box', at: [0, 0, 0], size: [1, 0.5, 0.6], color: '#aa8855', material: 'wood' },
    { shape: 'prism', at: [0, 0.35, 0], size: [1, 0.2, 0.6], color: '#553322', kind: 'roof' },
  ],
} as ObjectRecipe;

describe('blender export (PQ-T56)', () => {
  it('turns a recipe into the viewer mesh, grouped by surface', () => {
    const groups = recipeGroups(recipe);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.positions.length % 9).toBe(0);
      expect(g.colors.length).toBe(g.positions.length);
    }
  });

  it('writes a runnable bpy script with the parts and the JS body', () => {
    const script = blenderScript({
      label: 'House\nA',
      notes: ['round 1'],
      groups: recipeGroups(recipe),
      recipe,
      jsCode: 'return [];',
    });
    expect(script).toContain('import bpy');
    expect(script).toContain('PARTS = [');
    expect(script).toContain('"shape": "prism"');
    expect(script).toContain('GROUPS = [');
    expect(script).toContain('# return [];');
    expect(script).not.toContain('House\nA');
    expect(script).not.toMatch(/\bnull\b|\btrue\b/);
  });
});
