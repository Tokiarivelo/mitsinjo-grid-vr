import { describe, expect, it } from 'vitest';
import {
  BLINK_DURATION,
  blinkAmount,
  GAZE_MAX_PITCH,
  GAZE_MAX_YAW,
  gazeAngles,
} from '../utils/lemur-bot';

describe('maki bot gaze and blink (VS-T27)', () => {
  it('turns toward the cursor: right is +yaw, up is +pitch', () => {
    const r = gazeAngles(0.2, 0, 1);
    expect(r.yaw).toBeGreaterThan(0);
    expect(r.pitch).toBeCloseTo(0);
    expect(gazeAngles(0, 0.3, 1).pitch).toBeGreaterThan(0);
    expect(gazeAngles(0, 0, 0)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('never turns past its limits, even for a point behind it', () => {
    const behind = gazeAngles(-1, 5, -2);
    expect(Math.abs(behind.yaw)).toBeLessThanOrEqual(GAZE_MAX_YAW);
    expect(Math.abs(behind.pitch)).toBeLessThanOrEqual(GAZE_MAX_PITCH);
  });

  it('blinks briefly every few seconds, the same every run', () => {
    let shut = 0;
    let open = 0;
    for (let t = 0; t < 20; t += 0.01) {
      if (blinkAmount(t) > 0.5) shut++;
      else open++;
    }
    expect(shut).toBeGreaterThan(0);
    expect(shut / (shut + open)).toBeLessThan(0.1);
    expect(blinkAmount(3.2 - BLINK_DURATION / 2)).toBeCloseTo(1, 1);
    expect(blinkAmount(1)).toBe(0);
    for (let t = 0; t < 20; t += 0.37) expect(blinkAmount(t)).toBeGreaterThanOrEqual(0);
  });
});
