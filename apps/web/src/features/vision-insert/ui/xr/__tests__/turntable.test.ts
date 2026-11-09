import { describe, expect, it } from 'vitest';
import {
  createTurntable,
  grabTurntable,
  MAX_PITCH,
  releaseTurntable,
  rotateTurntable,
  SPIN_RESUME_MS,
  SPIN_SPEED,
  spinTurntable,
} from '../turntable';
import { MINIATURE_SIZE, miniatureDimensions, miniatureSlot } from '../xr-layout';

describe('turntable', () => {
  it('spins on its own when nobody holds it', () => {
    const t = createTurntable();
    spinTurntable(t, 1, 0);
    expect(t.yaw).toBeCloseTo(SPIN_SPEED);
  });

  it('stops spinning while held and right after release, then resumes', () => {
    const t = createTurntable();
    grabTurntable(t, 0, 0);
    spinTurntable(t, 1, 100);
    expect(t.yaw).toBe(0);
    releaseTurntable(t, 1000);
    spinTurntable(t, 1, 1000 + SPIN_RESUME_MS - 1);
    expect(t.yaw).toBe(0);
    spinTurntable(t, 1, 1000 + SPIN_RESUME_MS);
    expect(t.yaw).toBeCloseTo(SPIN_SPEED);
  });

  it('rotates with the drag and clamps the tilt', () => {
    const t = createTurntable();
    grabTurntable(t, 'mouse', 0);
    rotateTurntable(t, 1, 5);
    expect(t.yaw).toBeCloseTo(1);
    expect(t.pitch).toBe(MAX_PITCH);
  });

  it('tells a tap (connect) from a drag (rotate)', () => {
    const tap = createTurntable();
    grabTurntable(tap, 1, 0);
    expect(releaseTurntable(tap, 900)).toBe(true);

    const drag = createTurntable();
    grabTurntable(drag, 1, 0);
    rotateTurntable(drag, 0.8, 0);
    expect(releaseTurntable(drag, 200)).toBe(false);

    const slow = createTurntable();
    grabTurntable(slow, 1, 0);
    expect(releaseTurntable(slow, 2000)).toBe(false);
    expect(releaseTurntable(slow, 2100)).toBe(false); // not held any more
  });
});

describe('miniature layout', () => {
  it('places miniatures within reach, below the eyes, off the video centre', () => {
    for (let i = 0; i < 6; i++) {
      const [x, y, z] = miniatureSlot(i);
      expect(Math.hypot(x, z)).toBeCloseTo(0.55, 2);
      expect(y).toBeLessThan(1.6);
      expect(Math.abs(x)).toBeGreaterThan(0.1);
      expect(z).toBeLessThan(0);
    }
    expect(miniatureSlot(0)[0]).toBeGreaterThan(0); // first one on the right
    expect(miniatureSlot(6)[1]).toBeGreaterThan(miniatureSlot(0)[1]); // second row
  });

  it('scales a model to the miniature size, keeping proportions', () => {
    const [w, h, d] = miniatureDimensions([0.4, 0.9, 0.3]);
    expect(h).toBeCloseTo(MINIATURE_SIZE);
    expect(w / h).toBeCloseTo(0.4 / 0.9, 2);
    expect(d / h).toBeCloseTo(0.3 / 0.9, 2);
  });
});
