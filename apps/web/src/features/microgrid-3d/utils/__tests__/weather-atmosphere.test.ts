import { describe, expect, it } from 'vitest';
import { WEATHER_IDS, scenarios, simulate } from '@mitsinjo/engine';
import {
  MAX_CLOUD_BANKS,
  PUFFS_PER_BANK,
  WEATHER_ATMOSPHERE,
  cloudPuffs,
  lightningFlash,
  rainDropCount,
} from '../weather-atmosphere';
import { applyOvercast, skyPalette } from '../sky-palette';
import { toSceneModel } from '../to-scene-model';

describe('weather atmosphere', () => {
  it('covers every weather, and gets wetter and greyer from sunny to storm', () => {
    const order = ['sunny', 'partly_cloudy', 'cloudy', 'rainy', 'storm'] as const;
    expect(Object.keys(WEATHER_ATMOSPHERE).sort()).toEqual([...WEATHER_IDS].sort());
    for (let i = 1; i < order.length; i++) {
      const prev = WEATHER_ATMOSPHERE[order[i - 1]!];
      const cur = WEATHER_ATMOSPHERE[order[i]!];
      expect(cur.overcast).toBeGreaterThanOrEqual(prev.overcast);
      expect(cur.cloudCover).toBeGreaterThanOrEqual(prev.cloudCover);
      expect(cur.rain).toBeGreaterThanOrEqual(prev.rain);
    }
    expect(WEATHER_ATMOSPHERE.sunny.rain).toBe(0);
    expect(WEATHER_ATMOSPHERE.rainy.rain).toBeGreaterThan(0);
    expect(WEATHER_ATMOSPHERE.storm.lightning).toBe(true);
    expect(WEATHER_ATMOSPHERE.rainy.lightning).toBe(false);
  });

  it('lays out clouds deterministically, scaled by cover', () => {
    expect(cloudPuffs(0)).toHaveLength(0);
    expect(cloudPuffs(1)).toHaveLength(MAX_CLOUD_BANKS * PUFFS_PER_BANK);
    expect(cloudPuffs(0.5)).toEqual(cloudPuffs(0.5));
    const fullPuffs = cloudPuffs(1);
    for (const p of fullPuffs) {
      expect(p.position[1]).toBeGreaterThan(15);
      expect(p.scale[0]).toBeGreaterThan(0);
      expect(p.scale[1]).toBeGreaterThan(0);
      expect(p.scale[2]).toBeGreaterThan(0);
    }
    // Verify multi-layered horizontal depth spanning near and far horizon
    const radii = fullPuffs.map((p) => Math.hypot(p.position[0], p.position[2]));
    const minRadius = Math.min(...radii);
    const maxRadius = Math.max(...radii);
    expect(minRadius).toBeLessThan(140);
    expect(maxRadius).toBeGreaterThan(160);
  });

  it('sizes rain by density and quality tier', () => {
    expect(rainDropCount(0, 'high')).toBe(0);
    expect(rainDropCount(1, 'low')).toBeLessThan(rainDropCount(1, 'high'));
    expect(rainDropCount(0.5, 'high')).toBe(rainDropCount(1, 'high') / 2);
  });

  it('flashes lightning in short bursts within [0, 1]', () => {
    let lit = 0;
    const samples = 6000;
    for (let i = 0; i < samples; i++) {
      const v = lightningFlash(i * 0.01);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v > 0) lit++;
    }
    expect(lit).toBeGreaterThan(0);
    expect(lit / samples).toBeLessThan(0.15);
  });
});

describe('applyOvercast', () => {
  const clear = skyPalette(0.8, true);

  it('is a no-op for a clear sky', () => {
    expect(applyOvercast(clear, 0, true)).toBe(clear);
  });

  it('dims the sun, hides its disc and thickens the haze', () => {
    const grey = applyOvercast(clear, WEATHER_ATMOSPHERE.storm.overcast, true);
    expect(grey.keyIntensity).toBeLessThan(clear.keyIntensity * 0.5);
    expect(grey.sunDisc).toBe(0);
    expect(grey.fogScale).toBeLessThan(1);
    expect(grey.zenith).not.toBe(clear.zenith);
    expect(grey.lampGlow).toBeGreaterThan(clear.lampGlow);
  });
});

describe('toSceneModel weather', () => {
  const input = scenarios.baseline.input;
  const result = simulate(input, 'proportional');

  it('defaults to sunny and passes the day weather through', () => {
    expect(toSceneModel({ input, result }).weather).toBe('sunny');
    expect(toSceneModel({ input, result, weather: 'rainy' }).weather).toBe('rainy');
  });

  it('keeps solar values from the engine result only', () => {
    const model = toSceneModel({ input, result, timeIndex: 12, weather: 'storm' });
    expect(model.solar.currentKw).toBe(result.steps[12]!.solarKw);
  });
});
