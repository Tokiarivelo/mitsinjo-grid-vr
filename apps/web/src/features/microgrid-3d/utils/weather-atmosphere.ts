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
  sunny: { cloudCover: 0.55, overcast: 0, rain: 0, lightning: false, cloudDarkness: 0 },
  partly_cloudy: {
    cloudCover: 0.75,
    overcast: 0.22,
    rain: 0,
    lightning: false,
    cloudDarkness: 0.08,
  },
  cloudy: { cloudCover: 0.92, overcast: 0.6, rain: 0, lightning: false, cloudDarkness: 0.35 },
  rainy: { cloudCover: 1, overcast: 0.8, rain: 0.6, lightning: false, cloudDarkness: 0.55 },
  storm: { cloudCover: 1, overcast: 0.95, rain: 1, lightning: true, cloudDarkness: 0.78 },
};

/** Most cloud banks drawn across all depth layers (full cover). */
export const MAX_CLOUD_BANKS = 60;
/** Puffs per cloud bank forming a billowing cumulus formation. */
export const PUFFS_PER_BANK = 16;

export interface CloudPuff {
  position: [number, number, number];
  scale: [number, number, number];
}

/**
 * Deterministic multi-layered cumulus cloud layout for a given cover: same cover → same sky.
 * Banks are distributed uniformly across the ENTIRE 360° sky dome in 4 concentric shells:
 * - Horizon & mountain ridge framing (visible over distant ridges across full 360°)
 * - Mid-sky valley clouds
 * - High atmospheric canopy directly overhead
 * - Intermediate sky fill
 *
 * Each bank is composed of 16 overlapping rounded lobes with flat condensation bases,
 * towering central cauliflower domes, and cascading fluffy side billows.
 */
export function cloudPuffs(cloudCover: number, seed = 7): CloudPuff[] {
  const banks = Math.round(Math.min(1, Math.max(0, cloudCover)) * MAX_CLOUD_BANKS);
  if (banks === 0) return [];
  const rand = mulberry32(seed);
  const puffs: CloudPuff[] = [];

  for (let b = 0; b < banks; b++) {
    const ring = b % 4;
    let radius: number;
    let baseAlt: number;

    if (ring === 0) {
      // Horizon & mountain ridge framing: crowns distant ridges across 360°
      radius = 150 + rand() * 110; // 150 - 260
      baseAlt = 18 + rand() * 14; // 18 - 32
    } else if (ring === 1) {
      // Mid-sky valley clouds: floating across landscape in all directions
      radius = 65 + rand() * 80; // 65 - 145
      baseAlt = 28 + rand() * 16; // 28 - 44
    } else if (ring === 2) {
      // High overhead canopy: fair-weather cumulus overhead at the zenith
      radius = 15 + rand() * 60; // 15 - 75
      baseAlt = 48 + rand() * 20; // 48 - 68
    } else {
      // Intermediate sky fill: bridges mid and far horizons in 360°
      radius = 90 + rand() * 105; // 90 - 195
      baseAlt = 24 + rand() * 20; // 24 - 44
    }

    // Varied cloud sizes & archetypes (tiny cotton puffs to grand billowing cumulus):
    // Prevents clouds from all looking uniformly giant, creating depth and natural scale.
    const sizeRoll = rand();
    let baseSize: number;
    let spread = 1.0;
    let verticalScale = 1.0;
    let horizontalScale = 1.0;

    if (ring === 2) {
      // Overhead canopy: prioritize light, airy puffs so the sky stays open
      if (sizeRoll < 0.55) {
        // Tiny fair-weather cotton puffs
        baseSize = 2.4 + rand() * 2.2; // 2.4 - 4.6
        spread = 0.65;
        verticalScale = 0.9 + rand() * 0.2;
      } else if (sizeRoll < 0.88) {
        // Small compact cumulus
        baseSize = 4.8 + rand() * 2.4; // 4.8 - 7.2
        spread = 0.8;
      } else {
        // Medium cumulus
        baseSize = 7.2 + rand() * 2.2; // 7.2 - 9.4
        spread = 0.95;
      }
    } else {
      // Horizon, mid-sky, and intermediate: rich natural variety
      if (sizeRoll < 0.38) {
        // 38% Tiny / small fair-weather puffs (cotton candy puffs)
        baseSize = 2.6 + rand() * 2.8; // 2.6 - 5.4
        spread = 0.68;
        verticalScale = 0.9 + rand() * 0.25;
        horizontalScale = 0.9 + rand() * 0.3;
      } else if (sizeRoll < 0.72) {
        // 34% Medium standard cumulus
        baseSize = 5.6 + rand() * 3.4; // 5.6 - 9.0
        spread = 0.88;
        verticalScale = 0.95 + rand() * 0.3;
        horizontalScale = 0.95 + rand() * 0.3;
      } else if (sizeRoll < 0.9 || radius < 120) {
        // 18% Large billowing cumulus
        baseSize = 9.2 + rand() * 3.4; // 9.2 - 12.6
        spread = 1.0;
        verticalScale = 1.1 + rand() * 0.3;
      } else {
        // 10% Grand towering cumulus formation (distant ridges only)
        baseSize = 13.0 + rand() * 3.5; // 13.0 - 16.5
        spread = 1.12;
        verticalScale = 1.2 + rand() * 0.3;
        horizontalScale = 1.05 + rand() * 0.25;
      }
    }

    // Full 360° azimuth distribution around the entire sky hemisphere without gaps
    const angle = (b / banks) * Math.PI * 2 + (rand() - 0.5) * (Math.PI / banks);
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const cy = baseAlt;

    // Orientation heading of the cumulus formation along the wind direction
    const heading = rand() * Math.PI * 2;
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const px = -fz;
    const pz = fx;

    // Organic cumulus puff offsets and scales in local formation frame (16 puffs):
    // [forwardOffset, crossOffset, verticalOffset, scaleX, scaleY, scaleZ]
    const bankPuffLayout: [number, number, number, number, number, number][] = [
      // 0: Center main towering peak
      [0, 0, 0.45 * baseSize * verticalScale, 1.45, 1.35 * verticalScale, 1.45],
      // 1: Forward crest peak
      [
        0.65 * baseSize,
        0.18 * baseSize,
        0.3 * baseSize * verticalScale,
        1.25,
        1.15 * verticalScale,
        1.25,
      ],
      // 2: Backward crest peak
      [
        -0.7 * baseSize,
        -0.15 * baseSize,
        0.25 * baseSize * verticalScale,
        1.2,
        1.1 * verticalScale,
        1.2,
      ],
      // 3: Right flank major billow
      [0.15 * baseSize, 0.8 * baseSize, -0.02 * baseSize, 1.15, 1.0 * verticalScale, 1.15],
      // 4: Left flank major billow
      [-0.15 * baseSize, -0.8 * baseSize, -0.02 * baseSize, 1.12, 0.98 * verticalScale, 1.12],
      // 5: Forward-right diagonal billow
      [0.7 * baseSize, 0.65 * baseSize, 0.05 * baseSize, 1.0, 0.9 * verticalScale, 1.0],
      // 6: Forward-left diagonal billow
      [0.7 * baseSize, -0.65 * baseSize, 0.05 * baseSize, 1.0, 0.9 * verticalScale, 1.0],
      // 7: Backward-right diagonal billow
      [-0.68 * baseSize, 0.62 * baseSize, 0.05 * baseSize, 0.98, 0.88 * verticalScale, 0.98],
      // 8: Backward-left diagonal billow
      [-0.68 * baseSize, -0.62 * baseSize, 0.05 * baseSize, 0.98, 0.88 * verticalScale, 0.98],
      // 9: Forward snout billow
      [1.38 * baseSize, 0.08 * baseSize, -0.12 * baseSize, 0.92, 0.8 * verticalScale, 0.92],
      // 10: Tail billow
      [-1.42 * baseSize, -0.08 * baseSize, -0.12 * baseSize, 0.88, 0.78 * verticalScale, 0.88],
      // 11: Central condensation base (flat bottom)
      [0, 0, -0.38 * baseSize, 1.55, 0.52 * verticalScale, 1.45],
      // 12: Forward condensation base (flat bottom)
      [0.8 * baseSize, 0.05 * baseSize, -0.38 * baseSize, 1.3, 0.48 * verticalScale, 1.2],
      // 13: Backward condensation base (flat bottom)
      [-0.8 * baseSize, -0.05 * baseSize, -0.38 * baseSize, 1.25, 0.48 * verticalScale, 1.15],
      // 14: High crown turret whisp
      [
        0.22 * baseSize,
        -0.22 * baseSize,
        0.72 * baseSize * verticalScale,
        0.82,
        0.75 * verticalScale,
        0.82,
      ],
      // 15: Subsidiary side crest
      [0.48 * baseSize, 0.72 * baseSize, 0.25 * baseSize, 0.85, 0.8 * verticalScale, 0.85],
    ];

    for (let p = 0; p < PUFFS_PER_BANK; p++) {
      const [f, c, v, sx, sy, sz] = bankPuffLayout[p]!;
      const jx = (rand() - 0.5) * 0.12 * baseSize * spread;
      const jz = (rand() - 0.5) * 0.12 * baseSize * spread;
      const jy = (rand() - 0.5) * 0.06 * baseSize;
      const sJitter = 0.94 + rand() * 0.12;

      const posX = cx + (f * spread + jx) * fx + (c * spread + jz) * px;
      const posZ = cz + (f * spread + jx) * fz + (c * spread + jz) * pz;
      const posY = cy + v * spread + jy;

      puffs.push({
        position: [posX, posY, posZ],
        scale: [
          baseSize * sx * sJitter * horizontalScale,
          baseSize * sy * sJitter,
          baseSize * sz * sJitter * horizontalScale,
        ],
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
  cloudShadow: '#82b7eb', // Radiant sky-blue cumulus shadow (matches Image 2 reference)
  cloudRim: '#fffdf0',
  rainDay: '#c9d3de',
  rainNight: '#6f7c93',
  lightning: '#d6deff',
} as const;
