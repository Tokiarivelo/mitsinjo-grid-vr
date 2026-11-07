import * as THREE from 'three';

/**
 * Art-directed sky & light palette per sun elevation (0 = horizon, 1 = zenith).
 * Golden-hour look by design (reference: Village at Sunset); night when the sun is down.
 * Pure: same input → same colors. Visual only, never data.
 */
export interface SkyPalette {
  zenith: string;
  horizon: string;
  /** Glow around the sun on the sky dome. */
  sunGlow: string;
  sun: string;
  /** Fog + far mountains blend into this. */
  fog: string;
  hemiSky: string;
  hemiGround: string;
  keyIntensity: number;
  hemiIntensity: number;
  envIntensity: number;
  /** Elevation of the key light above the horizon, in degrees (drives shadows). */
  sunAltitudeDeg: number;
  /** Where the visible sun disc / glow sits: kept low so the sunset stays in frame. */
  sunDisplayAltitudeDeg: number;
  /** Far mountain ridge colors, nearest first. */
  ridges: [string, string, string];
  /** How bright lit windows and street lamps glow (dusk/night → high). */
  lampGlow: number;
  /** Visibility of the sun disc and halo (0 hidden behind clouds – 1 clear). */
  sunDisc: number;
  /** Fog distance multiplier (< 1 = thicker haze under overcast or rain). */
  fogScale: number;
}

interface Key {
  zenith: string;
  horizon: string;
  sunGlow: string;
  sun: string;
  fog: string;
  hemiSky: string;
  hemiGround: string;
  keyIntensity: number;
  hemiIntensity: number;
  envIntensity: number;
  lampGlow: number;
}

const NIGHT: Key = {
  zenith: '#050a1a',
  horizon: '#1b2445',
  sunGlow: '#2a3260',
  sun: '#9db4ff',
  fog: '#141b36',
  hemiSky: '#3b4a8a',
  hemiGround: '#0b1210',
  keyIntensity: 0.35,
  hemiIntensity: 0.35,
  envIntensity: 0.12,
  lampGlow: 1,
};

const GOLDEN: Key = {
  zenith: '#1a2457',
  horizon: '#ff9a4d',
  sunGlow: '#ffc56b',
  sun: '#ffb46b',
  fog: '#8f6d93',
  hemiSky: '#8f88c9',
  hemiGround: '#3a2a18',
  keyIntensity: 3.0,
  hemiIntensity: 0.55,
  envIntensity: 0.55,
  lampGlow: 0.85,
};

const AFTERNOON: Key = {
  zenith: '#2a3f7a',
  horizon: '#f7ae6e',
  sunGlow: '#ffd08a',
  sun: '#ffd6a0',
  fog: '#9f8aa6',
  hemiSky: '#9fb2df',
  hemiGround: '#3f3019',
  keyIntensity: 3.4,
  hemiIntensity: 0.6,
  envIntensity: 0.55,
  lampGlow: 0.3,
};

const MIDDAY: Key = {
  zenith: '#2377d6',
  horizon: '#9ed0ff',
  sunGlow: '#fff3d1',
  sun: '#fffdf5',
  fog: '#a6d1f7',
  hemiSky: '#72b3f5',
  hemiGround: '#4d3d28',
  keyIntensity: 3.8,
  hemiIntensity: 0.75,
  envIntensity: 0.65,
  lampGlow: 0,
};

const c1 = new THREE.Color();
const c2 = new THREE.Color();
function mix(a: string, b: string, t: number): string {
  return `#${c1.set(a).lerp(c2.set(b), t).getHexString()}`;
}
function blend(a: Key, b: Key, t: number): Key {
  return {
    zenith: mix(a.zenith, b.zenith, t),
    horizon: mix(a.horizon, b.horizon, t),
    sunGlow: mix(a.sunGlow, b.sunGlow, t),
    sun: mix(a.sun, b.sun, t),
    fog: mix(a.fog, b.fog, t),
    hemiSky: mix(a.hemiSky, b.hemiSky, t),
    hemiGround: mix(a.hemiGround, b.hemiGround, t),
    keyIntensity: a.keyIntensity + (b.keyIntensity - a.keyIntensity) * t,
    hemiIntensity: a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t,
    envIntensity: a.envIntensity + (b.envIntensity - a.envIntensity) * t,
    lampGlow: a.lampGlow + (b.lampGlow - a.lampGlow) * t,
  };
}

/** Aerial perspective: near ridge dark green-blue, far ridges melt into the haze. */
function ridgeColors(k: Pick<Key, 'zenith' | 'horizon' | 'fog'>): [string, string, string] {
  const near = mix('#22302f', k.fog, 0.35);
  const mid = mix(mix('#2c3350', k.fog, 0.55), k.zenith, 0.15);
  const far = mix(k.fog, k.horizon, 0.3);
  return [near, mid, far];
}

export function skyPalette(sunElevation: number, isDaytime: boolean): SkyPalette {
  if (!isDaytime || sunElevation <= 0) {
    return {
      ...NIGHT,
      sunAltitudeDeg: 24,
      sunDisplayAltitudeDeg: 24,
      ridges: ridgeColors(NIGHT),
      sunDisc: 1,
      fogScale: 1,
    };
  }
  const e = Math.min(1, Math.max(0, sunElevation));
  // Smooth progression: Golden sunrise/sunset -> warm afternoon -> vibrant blue midday (Image 2 parity)
  let key: Key;
  if (e < 0.35) {
    const t = Math.max(0, e / 0.35);
    key = blend(GOLDEN, AFTERNOON, t);
  } else {
    const t = Math.min(1, (e - 0.35) / 0.65);
    key = blend(AFTERNOON, MIDDAY, t);
  }
  // Capped at ~36°: long, readable shadows even at noon (art direction, not astronomy).
  const sunAltitudeDeg = 6 + e * 30;
  return {
    ...key,
    sunAltitudeDeg,
    sunDisplayAltitudeDeg: Math.max(3, sunAltitudeDeg * 0.4),
    ridges: ridgeColors(key),
    sunDisc: 1,
    fogScale: 1,
  };
}

/** Overcast light: flat grey-blue by day, near-black blue-grey at night. */
const OVERCAST_DAY = { sky: '#7d8794', horizon: '#a3a9b0', fog: '#8c939b', sun: '#d7dce2' };
const OVERCAST_NIGHT = { sky: '#0b0f17', horizon: '#1a1f29', fog: '#151a22', sun: '#7d8aa3' };

/**
 * Greys out a clear-sky palette by an overcast amount (0 clear – 1 full overcast):
 * desaturated sky, dimmer key light, softer shadows, thicker haze, sun hidden behind clouds.
 * Pure and visual only.
 */
export function applyOvercast(p: SkyPalette, overcast: number, isDaytime: boolean): SkyPalette {
  const o = Math.min(1, Math.max(0, overcast));
  if (o === 0) return p;
  const g = isDaytime ? OVERCAST_DAY : OVERCAST_NIGHT;
  const out: Omit<SkyPalette, 'ridges'> = {
    ...p,
    zenith: mix(p.zenith, g.sky, o * 0.9),
    horizon: mix(p.horizon, g.horizon, o * 0.85),
    sunGlow: mix(p.sunGlow, g.horizon, o),
    sun: mix(p.sun, g.sun, o),
    fog: mix(p.fog, g.fog, o * 0.9),
    hemiSky: mix(p.hemiSky, g.sky, o * 0.6),
    // Overcast: the direct sun fades, diffuse sky light takes over (soft shadows).
    keyIntensity: p.keyIntensity * (1 - 0.8 * o),
    hemiIntensity: p.hemiIntensity * (1 + 0.4 * o),
    envIntensity: p.envIntensity * (1 - 0.5 * o),
    // Dark rainy day: lamps and windows come on earlier.
    lampGlow: Math.max(p.lampGlow, isDaytime ? 0.6 * o : p.lampGlow),
    sunDisc: Math.max(0, 1 - o * 1.6),
    fogScale: 1 - 0.45 * o,
  };
  return { ...out, ridges: ridgeColors(out) };
}
