// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { ObjectRecipe } from '@/lib/object-shape';
import { applyPbrRules, clampBaseColor, PBR_MAX, PBR_MIN, withPbrRules } from '../pbr-rules';

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
});
