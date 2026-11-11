import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { ViewMeasure } from '../object-views';
import {
  correlation,
  pickSide,
  scoreSide,
  sideCardPrompt,
  sideFamilyLine,
  topLine,
} from '../view-candidates';

/** A silhouette ring: a roofed box (peak in the middle) or a flat-topped one, object-box fractions. */
const peaked: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 0.6],
  [0.5, 1],
  [0, 0.6],
];
const flat: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const view = (aspect: number, ring: Array<[number, number]>, h = 0.8): ViewMeasure => ({
  aspect,
  ring,
  parts: [],
  box: { x: 0.1, y: 0.1, w: 0.8, h },
});
const front = view(1, peaked);

describe('view candidates (PQ-T16)', () => {
  it('a copy of the front scores as « not a side »', () => {
    expect(scoreSide(front, view(1.02, peaked))).toMatchObject({ ok: false, reason: 'not_a_side' });
  });

  it('a taller drawing is rejected', () => {
    expect(scoreSide(front, view(1.6, peaked, 0.9))).toMatchObject({ ok: false, reason: 'height' });
  });

  it('a profile that does not follow the front is rejected', () => {
    // Peaked front vs a side whose top line is high on the left, low on the right.
    const ramp: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [1, 0.2],
      [0, 1],
    ];
    expect(scoreSide(front, view(1.6, ramp))).toMatchObject({ ok: false, reason: 'top_line' });
  });

  it('a depth far from the kit is rejected', () => {
    const kit = { archetype: 'cabinet', proportions: { w: 1, h: 1, d: 0.2 } } as never;
    expect(scoreSide(front, view(5, peaked), kit)).toMatchObject({ ok: false, reason: 'depth' });
    expect(scoreSide(front, view(1.6, peaked)).ok).toBe(true);
  });

  it('the better of two kept candidates is chosen; none kept → null (both dropped)', () => {
    const good = { id: 'good', side: view(1.6, peaked, 0.8) };
    const worse = { id: 'worse', side: view(1.6, peaked, 0.82) };
    expect(pickSide([worse, good], front)?.pick.id).toBe('good');
    const bad = { id: 'bad', side: view(1.01, peaked) };
    expect(pickSide([bad], front)).toBeNull();
    expect(pickSide([], front)).toBeNull();
  });

  it('top line and correlation', () => {
    expect(topLine(flat).every((v) => v === 1)).toBe(true);
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 9);
    expect(correlation([1, 1, 1], [1, 2, 3])).toBe(0);
  });

  it('the card prompt fills the name and the family line', () => {
    const car = sideCardPrompt('red car', 'vehicle');
    expect(car).toContain('FRONT view of a red car');
    expect(car).toContain('both wheels of this side');
    expect(car).not.toContain('{');
    expect(sideCardPrompt('house', 'house', 'slope')).toContain('long sloping plane');
    expect(sideCardPrompt('house', 'house', 'end')).toContain('shows its end');
    const tree = sideCardPrompt('tree', 'tree');
    expect(tree).not.toContain('{');
    expect(sideFamilyLine('tree')).toBeNull();
  });
});
