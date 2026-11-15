import { describe, expect, it } from 'vitest';
import {
  anchorAhead,
  CAROUSEL_RADIUS,
  EXTRACT_DISTANCE,
  EXTRACT_DROP,
  slidePose,
} from '../xr-layout';

describe('anchorAhead (VS-T19)', () => {
  it('sits ahead along the horizontal heading, below the eyes, level', () => {
    const a = anchorAhead([0, 1.6, 0], [0, -0.5, -1]);
    expect(a.yaw).toBeCloseTo(0);
    expect(a.position).toEqual([0, Number((1.6 - EXTRACT_DROP).toFixed(3)), -EXTRACT_DISTANCE]);
  });
  it('follows a turned head (right = +X)', () => {
    const a = anchorAhead([1, 1.6, 2], [1, 0, 0]);
    expect(a.yaw).toBeCloseTo(Math.PI / 2);
    expect(a.position[0]).toBeCloseTo(1 + EXTRACT_DISTANCE);
    expect(a.position[2]).toBeCloseTo(2);
  });
  it('keeps the last heading looking straight down (no NaN)', () => {
    expect(anchorAhead([0, 1.6, 0], [0, -1, 0]).yaw).toBe(0);
  });
});

describe('slidePose (VS-T20)', () => {
  it('puts the focused slide straight ahead, the others on the arc round the eye', () => {
    expect(slidePose(0)).toEqual({
      position: [0, 0, Number((EXTRACT_DISTANCE - CAROUSEL_RADIUS).toFixed(3))],
      yaw: -0,
      focus: 1,
    });
    const right = slidePose(1);
    expect(right.position[0]).toBeGreaterThan(0);
    expect(right.focus).toBe(0);
    // Every slide is the same distance from the eye (at +EXTRACT_DISTANCE in panel space).
    for (const rel of [-2, -0.5, 0, 1.3]) {
      const p = slidePose(rel).position;
      expect(Math.hypot(p[0], p[2] - EXTRACT_DISTANCE)).toBeCloseTo(CAROUSEL_RADIUS, 2);
    }
  });
});
