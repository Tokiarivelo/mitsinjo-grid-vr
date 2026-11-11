// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { ObjectRecipe } from '@/lib/object-shape';
import {
  applyPbrRules,
  BARE_METAL_MIN,
  clampBaseColor,
  coatedMetal,
  PBR_MAX,
  PBR_MIN,
  withPbrRules,
} from '../pbr-rules';

const recipe = (
  ...parts: Array<[string, ObjectRecipe['parts'][number]['material']?]>
): ObjectRecipe => ({
  proportions: { w: 1, h: 0.5, d: 0.5 },
  parts: parts.map(([color, material], i) => ({
    shape: 'box' as const,
    at: [i * 0.1, 0, 0] as [number, number, number],
    size: [0.1, 0.1, 0.1] as [number, number, number],
    color,
    ...(material ? { material } : {}),
  })),
});

describe('pbr-rules (PQ-T39)', () => {
  it('black goes to 30, white to 240, a fitting colour stays the same string', () => {
    expect(clampBaseColor('#000000')).toBe('#1e1e1e');
    expect(clampBaseColor('#ffffff')).toBe('#f0f0f0');
    expect(PBR_MIN).toBe(30);
    expect(PBR_MAX).toBe(240);
    expect(clampBaseColor('#a33327')).toBe('#a33327');
  });

  it('clamps non-metal parts (no material = painted), leaves bare metal, reports each clamp', () => {
    const { recipe: out, clamps } = applyPbrRules(
      recipe(['#000000', 'rubber'], ['#ffffff'], ['#ffffff', 'metal'], ['#a33327', 'painted'])
    );
    expect(out.parts.map((p) => p.color)).toEqual(['#1e1e1e', '#f0f0f0', '#ffffff', '#a33327']);
    expect(clamps).toHaveLength(2);
    expect(clamps[0]).toContain('rubber');
    expect(clamps[1]).toContain('painted');
  });

  it('returns the same recipe when nothing moves, and logs the clamps otherwise', () => {
    const fine = recipe(['#a33327', 'painted']);
    expect(applyPbrRules(fine).recipe).toBe(fine);
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(withPbrRules(fine, 'car')).toBe(fine);
    expect(spy).not.toHaveBeenCalled();
    withPbrRules(recipe(['#000000', 'rubber']), 'tyre');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('tyre'));
    spy.mockRestore();
  });
  it('a dark part named metal is coated metal: it becomes painted and keeps its measured colour', () => {
    // Black lamp post pole (was lifted to pale silver in the viewer), next to a galvanised cap.
    const { recipe: out, clamps } = applyPbrRules(
      recipe(['#394047', 'metal'], ['#c8ccd0', 'metal'])
    );
    expect(out.parts[0]).toMatchObject({ material: 'painted', color: '#394047' });
    expect(out.parts[1]).toMatchObject({ material: 'metal', color: '#c8ccd0' });
    expect(clamps).toEqual(['part 0 metal → painted (#394047)']);
    expect(coatedMetal('#0a0a0a')).toBe(true);
    expect(coatedMetal(`#${BARE_METAL_MIN.toString(16)}0000`)).toBe(false);
    // A black one is repainted, then clamped like any paint.
    expect(applyPbrRules(recipe(['#000000', 'metal'])).recipe.parts[0]).toMatchObject({
      material: 'painted',
      color: '#1e1e1e',
    });
  });
});
