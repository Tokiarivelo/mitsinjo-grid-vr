import type { WeatherId } from '@mitsinjo/engine';
import { mulberry32 } from './noise';

/**
 * How a day's weather looks in the 3D scene. Visual only: solar output always comes
 * from the engine result (the engine already scales the solar profile per weather).
 */
export interface WeatherAtmosphere {
  /** Share of the sky covered by cloud banks (0 clear – 1 full). */
  cloudCover: number;
  /** 0 = clear-sky palette, 1 = fully grey overcast light. */
  overcast: number;
  /** Rain density (0 none – 1 downpour). */
  rain: number;
  /** Storm lightning flashes (disabled under reduced motion). */
  lightning: boolean;
  /** Cloud tint: 0 white, 1 dark storm grey. */
  cloudDarkness: number;
}

export const WEATHER_ATMOSPHERE: Record<WeatherId, WeatherAtmosphere> = {
  sunny: { cloudCover: 0.25, overcast: 0, rain: 0, lightning: false, cloudDarkness: 0 },
  partly_cloudy: {
    cloudCover: 0.55,
    overcast: 0.22,
    rain: 0,
    lightning: false,
    cloudDarkness: 0.08,
  },
  cloudy: { cloudCover: 0.85, overcast: 0.6, rain: 0, lightning: false, cloudDarkness: 0.35 },
  rainy: { cloudCover: 1, overcast: 0.8, rain: 0.6, lightning: false, cloudDarkness: 0.55 },
  storm: { cloudCover: 1, overcast: 0.95, rain: 1, lightning: true, cloudDarkness: 0.78 },
};

/** Most cloud banks drawn across all depth layers (full cover). */
export const MAX_CLOUD_BANKS = 36;
/** Puffs per cloud bank forming a billowing cumulus formation. */
export const PUFFS_PER_BANK = 11;

export interface CloudPuff {
  position: [number, number, number];
  scale: [number, number, number];
}

/**
 * Deterministic multi-layered cumulus cloud layout for a given cover: same cover → same sky.
 * Banks are distributed across 3 depth layers: inner village sky, mountain horizon,
 * and high canopy. Each bank is composed of structured overlapping rounded lobes
 * with a flat base, cascading side lobes, and billowing cauliflower domes.
 */
export function cloudPuffs(cloudCover: number, seed = 7): CloudPuff[] {
  const banks = Math.round(Math.min(1, Math.max(0, cloudCover)) * MAX_CLOUD_BANKS);
  if (banks === 0) return [];
  const rand = mulberry32(seed);
  const puffs: CloudPuff[] = [];

  for (let b = 0; b < banks; b++) {
    // Distribute banks into 3 rings: inner/mid village sky, outer mountain ridge horizon, and high canopy
    const ring = b % 3;
    let radius: number;
    let baseAlt: number;
    let baseSize: number;

    if (ring === 0) {
      // Inner / Mid sky: cruising right above the village and surrounding hills
      radius = 50 + rand() * 85; // 50 - 135
      baseAlt = 38 + rand() * 12; // 38 - 50
      baseSize = 7.5 + rand() * 4.5; // 7.5 - 12
    } else if (ring === 1) {
      // Horizon / Mountain tops: dramatic distant cumulus framing the ridges
      radius = 150 + rand() * 130; // 150 - 280
      baseAlt = 46 + rand() * 18; // 46 - 64
      baseSize = 13 + rand() * 7; // 13 - 20
    } else {
      // High Atmosphere / Canopy: overhead cloud cover
      radius = 35 + rand() * 150; // 35 - 185
      baseAlt = 64 + rand() * 16; // 64 - 80
      baseSize = 9 + rand() * 6; // 9 - 15
    }

    // Distribute angles around the circle with jitter
    const angle = (b / MAX_CLOUD_BANKS) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const cy = baseAlt;

    // Orientation heading of the cumulus formation along the wind direction
    const heading = rand() * Math.PI * 2;
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const px = -fz;
    const pz = fx;

    // Organic cumulus puff offsets and scales in local formation frame:
    // [forwardOffset, crossOffset, verticalOffset, scaleX, scaleY, scaleZ]
    const bankPuffLayout: [number, number, number, number, number, number][] = [
      // 0: Center main towering dome
      [0, 0, 0.35 * baseSize, 1.35, 1.25, 1.35],
      // 1: Forward crest dome
      [0.72 * baseSize, 0.15 * baseSize, 0.2 * baseSize, 1.15, 1.05, 1.15],
      // 2: Backward crest dome
      [-0.75 * baseSize, -0.12 * baseSize, 0.15 * baseSize, 1.1, 1.0, 1.1],
      // 3: Right flank billowing lobe
      [0.2 * baseSize, 0.8 * baseSize, -0.05 * baseSize, 1.0, 0.85, 1.0],
      // 4: Left flank billowing lobe
      [-0.22 * baseSize, -0.8 * baseSize, -0.05 * baseSize, 0.95, 0.85, 0.95],
      // 5: Forward nose lobe
      [1.45 * baseSize, 0.1 * baseSize, -0.15 * baseSize, 0.85, 0.72, 0.85],
      // 6: Tail lobe
      [-1.48 * baseSize, -0.1 * baseSize, -0.15 * baseSize, 0.82, 0.7, 0.82],
      // 7: Central base lobe (flat bottom)
      [0, 0, -0.4 * baseSize, 1.45, 0.55, 1.35],
      // 8: Forward base lobe (flat bottom)
      [0.8 * baseSize, 0.05 * baseSize, -0.4 * baseSize, 1.2, 0.5, 1.1],
      // 9: Backward base lobe (flat bottom)
      [-0.8 * baseSize, -0.05 * baseSize, -0.4 * baseSize, 1.15, 0.5, 1.05],
      // 10: Fluffy accent / side whisp
      [
        (rand() - 0.5) * 0.8 * baseSize,
        (rand() - 0.5) * 0.8 * baseSize,
        0.45 * baseSize,
        0.7,
        0.65,
        0.7,
      ],
    ];

    for (let p = 0; p < PUFFS_PER_BANK; p++) {
      const [f, c, v, sx, sy, sz] = bankPuffLayout[p]!;
      // Small random jitter per puff for natural variety
      const jx = (rand() - 0.5) * 0.2 * baseSize;
      const jz = (rand() - 0.5) * 0.2 * baseSize;
      const jy = (rand() - 0.5) * 0.1 * baseSize;
      const sJitter = 0.92 + rand() * 0.16;

      const posX = cx + (f + jx) * fx + (c + jz) * px;
      const posZ = cz + (f + jx) * fz + (c + jz) * pz;
      const posY = cy + v + jy;

      puffs.push({
        position: [posX, posY, posZ],
        scale: [baseSize * sx * sJitter, baseSize * sy * sJitter, baseSize * sz * sJitter],
      });
    }
  }

  return puffs;
}

/** Rain streak count for a density and quality tier. */
export function rainDropCount(rain: number, quality: 'high' | 'low'): number {
  const max = quality === 'high' ? 4000 : 1500;
  return Math.round(Math.min(1, Math.max(0, rain)) * max);
}

/**
 * Lightning brightness (0–1) at a time, from a fixed pseudo-random schedule:
 * a double flash roughly every 5–7 s. Pure, so the scene stays deterministic.
 */
export function lightningFlash(elapsedS: number): number {
  const period = 6.1;
  const cycle = Math.floor(elapsedS / period);
  const offset = mulberry32(cycle + 11)() * (period - 1);
  const t = elapsedS - cycle * period - offset;
  if (t < 0) return 0;
  if (t < 0.08) return 1;
  if (t < 0.16) return 0.15;
  if (t < 0.24) return 0.7;
  if (t < 0.5) return 0.7 * (1 - (t - 0.24) / 0.26);
  return 0;
}

/** Scene colors of the weather effects (3D materials, not UI tokens). */
export const WEATHER_HEX = {
  cloudLight: '#ffffff',
  cloudDark: '#505a6e',
  cloudShadow: '#c5d8ed',
  cloudRim: '#fff8eb',
  rainDay: '#c9d3de',
  rainNight: '#6f7c93',
  lightning: '#d6deff',
} as const;
