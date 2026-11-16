import { describe, expect, it } from 'vitest';
import { readXrKeys, xrWorldScale, XR_VILLAGE_SCALE } from '../xr-walk';

describe('xrWorldScale', () => {
  it('shrinks the viewer in the half-scale village, 1:1 inside a room', () => {
    expect(xrWorldScale(false)).toBe(XR_VILLAGE_SCALE);
    expect(XR_VILLAGE_SCALE).toBeLessThan(1);
    expect(xrWorldScale(true)).toBe(1);
  });

  it('puts the eyes below a 1.3 m house wall', () => {
    expect(1.6 * xrWorldScale(false)).toBeLessThan(1.3);
  });
});

describe('readXrKeys', () => {
  const keys = (...codes: string[]) => readXrKeys(new Set(codes));

  it('walks forward with W, Z or ↑ and back with S or ↓', () => {
    expect(keys('KeyW').moveZ).toBe(-1);
    expect(keys('KeyZ').moveZ).toBe(-1);
    expect(keys('ArrowUp').moveZ).toBe(-1);
    expect(keys('KeyS').moveZ).toBe(1);
    expect(keys('ArrowDown').moveZ).toBe(1);
  });

  it('strafes with A / Q / D, and ← / → turn instead of strafing', () => {
    expect(keys('KeyA').moveX).toBe(-1);
    expect(keys('KeyQ').moveX).toBe(-1);
    expect(keys('KeyD').moveX).toBe(1);
    // VS-T36: the turn was felt inverted; ← and → swapped.
    expect(keys('ArrowLeft')).toMatchObject({ moveX: 0, turn: -1 });
    expect(keys('ArrowRight')).toMatchObject({ moveX: 0, turn: 1 });
  });

  it('turns while walking forward (regression: no head turn during a walk)', () => {
    expect(keys('KeyW', 'ArrowLeft')).toEqual({ moveX: 0, moveZ: -1, turn: -1, run: false });
  });

  it('runs with Shift, nothing held = still', () => {
    expect(keys('KeyW', 'ShiftLeft').run).toBe(true);
    expect(keys()).toEqual({ moveX: 0, moveZ: 0, turn: 0, run: false });
  });
});
