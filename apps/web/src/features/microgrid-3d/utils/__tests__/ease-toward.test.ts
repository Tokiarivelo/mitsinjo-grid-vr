import { describe, expect, it } from 'vitest';
import { EASE_EPS, easeToward, LIGHT_EASE_TAU_S, settled } from '../ease-toward';
import { buildingLightLevel } from '../light-level';
import type { BuildingSceneModel } from '../../types';

describe('easeToward', () => {
  it('moves part of the way, the same after one big step or many small ones', () => {
    const one = easeToward(1, 0, 0.3);
    let many = 1;
    for (let i = 0; i < 30; i++) many = easeToward(many, 0, 0.01);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(1);
    expect(many).toBeCloseTo(one, 6);
  });

  it('reaches the target in about a second (3 τ) and then snaps', () => {
    let v = 1;
    let t = 0;
    while (v !== 0.5 && t < 5) {
      v = easeToward(v, 0.5, 1 / 60);
      t += 1 / 60;
    }
    expect(v).toBe(0.5);
    expect(t).toBeGreaterThan(2 * LIGHT_EASE_TAU_S);
    expect(t).toBeLessThan(5 * LIGHT_EASE_TAU_S);
  });

  it('snaps within EASE_EPS, keeps the value at dt 0, and repairs a non-finite current', () => {
    expect(easeToward(0.5 + EASE_EPS / 2, 0.5, 1 / 60)).toBe(0.5);
    expect(easeToward(0.8, 0.2, 0)).toBe(0.8);
    expect(easeToward(Number.NaN, 0.2, 0.016)).toBe(0.2);
  });

  it('settled is true only when every key reached its target', () => {
    expect(settled({ a: 1, b: 0 }, { a: 1, b: 0 })).toBe(true);
    expect(settled({ a: 0.9, b: 0 }, { a: 1, b: 0 })).toBe(false);
  });
});

const house = (over: Partial<BuildingSceneModel> = {}): BuildingSceneModel =>
  ({
    id: 'households',
    nameKey: 'households',
    position: [0, 0, 0],
    priority: 'P3',
    demandKw: 2,
    servedKw: 2,
    unservedKw: 0,
    coveragePct: 100,
    status: 'served',
    statusColor: 'green',
    isCritical: false,
    connected: true,
    loadMultiplier: 1,
    intensity: 1,
    mode: 'normal',
    onFire: false,
    ...over,
  }) as BuildingSceneModel;

describe('buildingLightLevel', () => {
  it('follows the coverage: half the demand served → half as bright', () => {
    expect(buildingLightLevel(house())).toBe(1);
    expect(buildingLightLevel(house({ servedKw: 1, coveragePct: 50 }))).toBe(0.5);
    expect(buildingLightLevel(house({ servedKw: 0.5, coveragePct: 25 }))).toBe(0.25);
  });

  it('is dark when cut, unserved, on fire or not connected', () => {
    expect(buildingLightLevel(house({ servedKw: 0, coveragePct: 0 }))).toBe(0);
    expect(buildingLightLevel(house({ status: 'unserved' }))).toBe(0);
    expect(buildingLightLevel(house({ onFire: true }))).toBe(0);
    expect(buildingLightLevel(house({ connected: false }))).toBe(0);
  });

  it('without a coverage figure, keeps a lit house readable (≥ 0.65)', () => {
    expect(buildingLightLevel(house({ coveragePct: null, intensity: 0.1 }))).toBe(0.65);
  });
});
