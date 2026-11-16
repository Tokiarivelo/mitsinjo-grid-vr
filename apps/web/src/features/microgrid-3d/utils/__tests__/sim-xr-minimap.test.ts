import { describe, expect, it } from 'vitest';
import {
  BIG_MAP_CENTER,
  BIG_MAP_RADIUS,
  bigMapPoint,
  headingAngle,
  horizontalHeading,
  MAP_PINS,
  MINI_MAP_RADIUS,
  MINI_MAP_RANGE,
  miniMapPoint,
  pinTone,
} from '../sim-xr-minimap';

const out = (): [number, number] => [0, 0];

describe('sim VR map (VS-T37)', () => {
  it('mini map is heading-up: what is ahead is up, what is right is right', () => {
    // Looking −Z: a point 10 ahead is up, a point 10 to the right (+X) is right.
    const ahead = miniMapPoint(0, 0, 0, -1, 0, -10, out());
    expect(ahead[0]).toBeCloseTo(0);
    expect(ahead[1]).toBeGreaterThan(0);
    const right = miniMapPoint(0, 0, 0, -1, 10, 0, out());
    expect(right[0]).toBeGreaterThan(0);
    expect(right[1]).toBeCloseTo(0);
    // Turned to look +X: that same right point is now ahead.
    const turned = miniMapPoint(0, 0, 1, 0, 10, 0, out());
    expect(turned[0]).toBeCloseTo(0);
    expect(turned[1]).toBeGreaterThan(0);
  });

  it('mini map is centred on the walker and puts far blips on its rim', () => {
    const here = miniMapPoint(5, 5, 0, -1, 5, 5, out());
    expect(here).toEqual([0, 0]);
    const far = miniMapPoint(0, 0, 0, -1, 0, -MINI_MAP_RANGE * 3, out());
    expect(Math.hypot(...far)).toBeCloseTo(MINI_MAP_RADIUS);
  });

  it('big map is north-up around the village core, every pin inside the disc', () => {
    const c = bigMapPoint(BIG_MAP_CENTER[0], BIG_MAP_CENTER[1], out());
    expect(c[0]).toBeCloseTo(0);
    expect(c[1]).toBeCloseTo(0);
    const north = bigMapPoint(BIG_MAP_CENTER[0], BIG_MAP_CENTER[1] - 5, out());
    expect(north[1]).toBeGreaterThan(0);
    for (const p of MAP_PINS) {
      expect(Math.hypot(...bigMapPoint(p.x, p.z, out()))).toBeLessThan(BIG_MAP_RADIUS * 0.95);
    }
    expect(MAP_PINS.map((p) => p.id)).toContain('dispatcher');
    expect(MAP_PINS).toHaveLength(7);
  });

  it('walker arrow: up when looking north (−Z), counter-clockwise when looking west', () => {
    expect(headingAngle(0, -1)).toBeCloseTo(0);
    expect(headingAngle(-1, 0)).toBeCloseTo(Math.PI / 2);
    expect(headingAngle(1, 0)).toBeCloseTo(-Math.PI / 2);
  });

  it('horizontal heading normalises and falls back to −Z', () => {
    expect(horizontalHeading(3, 4, out())).toEqual([0.6, 0.8]);
    expect(horizontalHeading(0, 0, out())).toEqual([0, -1]);
  });

  it('pin tones follow the engine status', () => {
    expect(pinTone('battery-green')).toBe('green');
    expect(pinTone('critical-red')).toBe('red');
    expect(pinTone('dispatcher')).toBe('violet');
  });
});
