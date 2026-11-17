import { describe, expect, it } from 'vitest';
import { grounded, TOUR_SPECS } from '../tour-mock/specs';

describe('tour specs (VS-T46)', () => {
  it('marks the outdoor plants as growing in the ground, never the potted ones indoors', () => {
    const plant = { kind: 'plant' as const, label: 'tree', hints: { habit: 'round' as const } };
    expect(grounded('garden-tree-3', plant)).toMatchObject({ hints: { ground: true } });
    expect(grounded('loft-plant-1', plant)).toBe(plant);
    const outdoor = TOUR_SPECS['house-tree-1']!;
    expect(outdoor.kind === 'plant' && outdoor.hints.ground).toBe(true);
    const indoor = TOUR_SPECS['bath-plant']!;
    expect(indoor.kind === 'plant' && indoor.hints.ground).toBeFalsy();
  });
});
