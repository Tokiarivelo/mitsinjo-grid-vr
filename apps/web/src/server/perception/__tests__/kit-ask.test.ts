import { describe, expect, it } from 'vitest';
import { askFamilies, asFamily } from '../kit-ask';

const kit = (archetype: 'house' | 'other' | 'vehicle', archetypeConf?: number) => ({
  archetype,
  ...(archetypeConf !== undefined ? { confidence: { archetype: archetypeConf } } : {}),
});

describe('askFamilies (PQ-T41)', () => {
  it('asks under 0.5 confidence, the kit family first', () => {
    expect(askFamilies(kit('house', 0.3), 'vehicle')).toEqual(['house', 'vehicle']);
  });
  it('does not ask when confident, or without confidence and no split', () => {
    expect(askFamilies(kit('house', 0.8), 'vehicle')).toBeNull();
    expect(askFamilies(kit('house'), 'vehicle')).toBeNull();
    expect(askFamilies(kit('house', 0.5), 'vehicle')).toBeNull();
  });
  it('a split between samples asks even when confident', () => {
    expect(askFamilies(kit('house', 0.9), 'vehicle', { split: true })).toEqual([
      'house',
      'vehicle',
    ]);
  });
  it('nothing to choose: same family, no alternative, or a plain box', () => {
    expect(askFamilies(kit('house', 0.1), 'house')).toBeNull();
    expect(askFamilies(kit('house', 0.1), undefined)).toBeNull();
    expect(askFamilies(kit('other', 0.1), 'house')).toBeNull();
    expect(askFamilies(kit('house', 0.1), 'other')).toBeNull();
  });
  it('the operator already chose: never asks again', () => {
    expect(askFamilies(kit('house', 0.1), 'vehicle', { chosen: true })).toBeNull();
  });
  it('asFamily only returns known families', () => {
    expect(asFamily('vehicle')).toBe('vehicle');
    expect(asFamily('spaceship')).toBeUndefined();
    expect(asFamily(undefined)).toBeUndefined();
  });
});
