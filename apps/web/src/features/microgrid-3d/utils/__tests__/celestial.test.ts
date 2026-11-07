import { describe, it, expect } from 'vitest';
import {
  moonCoordinates,
  nightFactor,
  shortestHourDelta,
  sideToOverheadToBehindDirection,
  sunCoordinates,
} from '../celestial';

describe('celestial mechanics', () => {
  it('sideToOverheadToBehindDirection normalizes to unit vectors across all angles', () => {
    for (let deg = 0; deg <= 180; deg += 15) {
      const { direction } = sideToOverheadToBehindDirection(deg);
      const len = Math.hypot(direction[0], direction[1], direction[2]);
      expect(len).toBeCloseTo(1.0, 5);
    }
  });

  describe('sunCoordinates', () => {
    it('starts on the side (+X) at sunrise (06:00)', () => {
      const sun = sunCoordinates(6);
      expect(sun.progress).toBeCloseTo(0, 4);
      expect(sun.angleDeg).toBeCloseTo(0, 4);
      // Side: X is strongly positive (+1), Z is near 0, Y is near horizon
      expect(sun.direction[0]).toBeGreaterThan(0.98);
      expect(sun.direction[1]).toBeCloseTo(Math.sin((3.5 * Math.PI) / 180), 2);
      expect(Math.abs(sun.direction[2])).toBeLessThan(0.05);
    });

    it('passes directly above the camera (+Y high, +Z overhead) at noon (12:00)', () => {
      const sun = sunCoordinates(12);
      expect(sun.progress).toBeCloseTo(0.5, 4);
      expect(sun.angleDeg).toBeCloseTo(90, 4);
      // Above camera: Y is at peak (>0.94), Z is positive (aligned with camera at +Z)
      expect(sun.direction[1]).toBeGreaterThan(0.94);
      expect(sun.direction[2]).toBeGreaterThan(0.15);
      expect(sun.direction[0]).toBeGreaterThan(0.15);
    });

    it('descends behind the camera (+Z) at sunset (18:00)', () => {
      const sun = sunCoordinates(18);
      expect(sun.progress).toBeCloseTo(1, 4);
      expect(sun.angleDeg).toBeCloseTo(180, 4);
      // Behind: Z is strongly positive (>0.98), X is near 0, Y is near horizon
      expect(sun.direction[2]).toBeGreaterThan(0.98);
      expect(sun.direction[1]).toBeCloseTo(Math.sin((3.5 * Math.PI) / 180), 2);
      expect(Math.abs(sun.direction[0])).toBeLessThan(0.05);
    });

    it('has identical displayDirection and keyDirection for 100% shadow parity', () => {
      const sun = sunCoordinates(10);
      expect(sun.displayDirection).toEqual(sun.keyDirection);
      expect(sun.direction).toEqual(sun.keyDirection);
    });
  });

  describe('moonCoordinates', () => {
    it('rises behind at dusk (18:00)', () => {
      const moon = moonCoordinates(18);
      expect(moon.progress).toBeCloseTo(0, 4);
      expect(moon.angleDeg).toBeCloseTo(0, 4);
      expect(moon.direction[2]).toBeGreaterThan(0.98);
      expect(moon.direction[1]).toBeCloseTo(Math.sin((3.5 * Math.PI) / 180), 2);
    });

    it('passes above the camera (+Y high) at midnight (00:00)', () => {
      const moon = moonCoordinates(0);
      expect(moon.progress).toBeCloseTo(0.5, 4);
      expect(moon.angleDeg).toBeCloseTo(90, 4);
      expect(moon.direction[1]).toBeGreaterThan(0.93);
    });

    it('sets on the western horizon (-X) at dawn (06:00)', () => {
      const moon = moonCoordinates(6);
      expect(moon.progress).toBeCloseTo(1, 4);
      expect(moon.angleDeg).toBeCloseTo(180, 4);
      expect(moon.direction[0]).toBeLessThan(-0.98);
    });
  });

  describe('shortestHourDelta', () => {
    it('calculates direct hour steps', () => {
      expect(shortestHourDelta(12, 13)).toBeCloseTo(1, 4);
      expect(shortestHourDelta(14, 12)).toBeCloseTo(-2, 4);
    });

    it('smoothly wraps around midnight (24h -> 0h)', () => {
      expect(shortestHourDelta(23.5, 0.5)).toBeCloseTo(1, 4);
      expect(shortestHourDelta(0.5, 23.5)).toBeCloseTo(-1, 4);
    });
  });

  describe('nightFactor', () => {
    it('is 0 during full day and 1 during deep night', () => {
      expect(nightFactor(12)).toBe(0);
      expect(nightFactor(14)).toBe(0);
      expect(nightFactor(0)).toBe(1);
      expect(nightFactor(2)).toBe(1);
      expect(nightFactor(22)).toBe(1);
    });

    it('smoothly blends during dusk and dawn', () => {
      const dusk = nightFactor(18.5);
      expect(dusk).toBeGreaterThan(0);
      expect(dusk).toBeLessThan(1);

      const dawn = nightFactor(5.5);
      expect(dawn).toBeGreaterThan(0);
      expect(dawn).toBeLessThan(1);
    });
  });
});
