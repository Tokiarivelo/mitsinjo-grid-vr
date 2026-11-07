import { describe, it, expect } from 'vitest';
import {
  celestialArcDirection,
  moonCoordinates,
  nightFactor,
  sphericalToDirection,
  sunCoordinates,
} from '../celestial';

describe('celestial mechanics', () => {
  it('normalizes spherical directions to unit vectors', () => {
    const dir = sphericalToDirection(30, 0.5);
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    expect(len).toBeCloseTo(1.0, 5);
  });

  it('calculates direction along an arbitrary celestial arc', () => {
    const arc0 = celestialArcDirection(0, 30, 2);
    expect(arc0.altitudeDeg).toBeCloseTo(2, 2);
    expect(arc0.azimuthRad).toBeGreaterThan(0);

    const arc90 = celestialArcDirection(90, 30, 2);
    expect(arc90.altitudeDeg).toBeCloseTo(30, 2);
    expect(arc90.azimuthRad).toBeCloseTo(0, 4);

    const arc180 = celestialArcDirection(180, 30, 2);
    expect(arc180.altitudeDeg).toBeCloseTo(2, 2);
    expect(arc180.azimuthRad).toBeLessThan(0);
  });

  describe('sunCoordinates', () => {
    it('starts at 0° at sunrise (06:00)', () => {
      const sun = sunCoordinates(6);
      expect(sun.progress).toBeCloseTo(0, 4);
      expect(sun.angleDeg).toBeCloseTo(0, 4);
      expect(sun.azimuthRad).toBeGreaterThan(0); // East
      expect(sun.displayAltitudeDeg).toBeCloseTo(2.5, 2);
      expect(sun.displayDirection[0]).toBeGreaterThan(0); // Right side
      expect(sun.displayDirection[1]).toBeGreaterThan(0); // Above horizon
      expect(sun.displayDirection[2]).toBeLessThan(0); // Front (north)
    });

    it('peaks at 90° at solar noon (12:00)', () => {
      const sun = sunCoordinates(12);
      expect(sun.progress).toBeCloseTo(0.5, 4);
      expect(sun.angleDeg).toBeCloseTo(90, 4);
      expect(sun.azimuthRad).toBeCloseTo(0, 4); // Meridian
      expect(sun.displayAltitudeDeg).toBeCloseTo(7.5, 2);
      expect(sun.displayDirection[0]).toBeCloseTo(0, 2); // Centered
      expect(sun.displayDirection[1]).toBeCloseTo(Math.sin((7.5 * Math.PI) / 180), 2);
    });

    it('sets at 180° at sunset (18:00)', () => {
      const sun = sunCoordinates(18);
      expect(sun.progress).toBeCloseTo(1, 4);
      expect(sun.angleDeg).toBeCloseTo(180, 4);
      expect(sun.azimuthRad).toBeLessThan(0); // West
      expect(sun.displayAltitudeDeg).toBeCloseTo(2.5, 2);
      expect(sun.displayDirection[0]).toBeLessThan(0); // Left side
      expect(sun.displayDirection[1]).toBeGreaterThan(0); // Above horizon
      expect(sun.displayDirection[2]).toBeLessThan(0); // Front (north)
    });

    it('produces valid unit vectors across the day', () => {
      for (let h = 6; h <= 18; h += 0.5) {
        const sun = sunCoordinates(h);
        const len = Math.hypot(
          sun.displayDirection[0],
          sun.displayDirection[1],
          sun.displayDirection[2]
        );
        expect(len).toBeCloseTo(1.0, 5);
      }
    });
  });

  describe('moonCoordinates', () => {
    it('rises at 0° at dusk (18:00)', () => {
      const moon = moonCoordinates(18);
      expect(moon.progress).toBeCloseTo(0, 4);
      expect(moon.angleDeg).toBeCloseTo(0, 4);
      expect(moon.azimuthRad).toBeGreaterThan(0); // East
      expect(moon.displayAltitudeDeg).toBeCloseTo(2.5, 2);
      expect(moon.displayDirection[0]).toBeGreaterThan(0); // Right side
      expect(moon.displayDirection[1]).toBeGreaterThan(0); // Above horizon
    });

    it('peaks at 90° at midnight (00:00)', () => {
      const moon = moonCoordinates(0);
      expect(moon.progress).toBeCloseTo(0.5, 4);
      expect(moon.angleDeg).toBeCloseTo(90, 4);
      expect(moon.azimuthRad).toBeCloseTo(0, 4); // Meridian
      expect(moon.displayAltitudeDeg).toBeCloseTo(7.0, 2);
      expect(moon.displayDirection[0]).toBeCloseTo(0, 2); // Centered
    });

    it('sets at 180° at dawn (06:00)', () => {
      const moon = moonCoordinates(6);
      expect(moon.progress).toBeCloseTo(1, 4);
      expect(moon.angleDeg).toBeCloseTo(180, 4);
      expect(moon.azimuthRad).toBeLessThan(0); // West
      expect(moon.displayAltitudeDeg).toBeCloseTo(2.5, 2);
      expect(moon.displayDirection[0]).toBeLessThan(0); // Left side
    });

    it('handles hours across midnight seamlessly', () => {
      const lateEvening = moonCoordinates(21);
      const earlyMorning = moonCoordinates(3);
      expect(lateEvening.angleDeg).toBeCloseTo(45, 1);
      expect(earlyMorning.angleDeg).toBeCloseTo(135, 1);
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
