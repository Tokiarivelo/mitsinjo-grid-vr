import { describe, expect, it } from 'vitest';
import { localDescription } from '../vision';

describe('localDescription (VS-T17)', () => {
  const d = {
    description: 'Tall white fridge',
    descriptions: { fr: 'Grand frigo blanc' },
  };
  it('picks the page language, else English', () => {
    expect(localDescription(d, 'fr')).toBe('Grand frigo blanc');
    expect(localDescription(d, 'mg')).toBe('Tall white fridge');
    expect(localDescription(d, 'en')).toBe('Tall white fridge');
  });
  it('is undefined when the model gave none', () => {
    expect(localDescription({}, 'fr')).toBeUndefined();
  });
});
