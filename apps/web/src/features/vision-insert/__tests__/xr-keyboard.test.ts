import { describe, expect, it } from 'vitest';
import { keyAtUv, keyboardRows, keyRects, pressKey } from '../utils/xr-keyboard';

describe('VR chat keyboard (VS-T27)', () => {
  it('French gets AZERTY with accents, English and Malagasy QWERTY', () => {
    expect(
      keyboardRows('fr')[1]!
        .map((k) => k.value)
        .join('')
    ).toBe('azertyuiop');
    expect(keyboardRows('fr')[3]!.some((k) => k.value === 'é')).toBe(true);
    expect(
      keyboardRows('en')[1]!
        .map((k) => k.value)
        .join('')
    ).toBe('qwertyuiop');
    expect(
      keyboardRows('mg')[1]!
        .map((k) => k.value)
        .join('')
    ).toBe('qwertyuiop');
  });

  it('keys tile each row inside the plane', () => {
    const rects = keyRects(keyboardRows('en'));
    for (const k of rects) {
      expect(k.x).toBeGreaterThanOrEqual(0);
      expect(k.x + k.width).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('finds the key under a UV hit (bottom-left origin)', () => {
    const rects = keyRects(keyboardRows('en'));
    // Top row, first key: u near 0, v near 1.
    expect(keyAtUv(rects, 0.02, 0.98)?.value).toBe('1');
    // Bottom row, middle: space.
    expect(keyAtUv(rects, 0.5, 0.05)?.action).toBe('space');
    expect(keyAtUv(rects, 1.2, 0.5)).toBeNull();
  });

  it('types, shifts once, erases, clears and stops at the limit', () => {
    const [q] = keyboardRows('en')[1]!;
    const shift = { value: 'shift', action: 'shift' as const, w: 1 };
    let s = pressKey({ draft: '', shift: false }, shift, 10);
    s = pressKey(s, q!, 10);
    s = pressKey(s, q!, 10);
    expect(s).toEqual({ draft: 'Qq', shift: false });
    s = pressKey(s, { value: ' ', action: 'space', w: 5 }, 10);
    s = pressKey(s, { value: 'back', action: 'back', w: 2 }, 10);
    expect(s.draft).toBe('Qq');
    expect(pressKey(s, q!, 2)).toBe(s);
    expect(pressKey(s, { value: 'clear', action: 'clear', w: 1 }, 10).draft).toBe('');
  });
});
