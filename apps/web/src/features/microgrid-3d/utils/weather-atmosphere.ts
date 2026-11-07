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
    let baseSize: number;

    if (ring === 0) {
      // Horizon & mountain ridge framing: crowns distant ridges across 360°
      radius = 145 + rand() * 115; // 145 - 260
      baseAlt = 18 + rand() * 16; // 18 - 34
      baseSize = 14 + rand() * 7; // 14 - 21
    } else if (ring === 1) {
      // Mid-sky valley clouds: floating across landscape in all directions
      radius = 65 + rand() * 85; // 65 - 150
      baseAlt = 32 + rand() * 16; // 32 - 48
      baseSize = 10 + rand() * 5; // 10 - 15
    } else if (ring === 2) {
      // High overhead canopy: fair-weather cumulus overhead at the zenith
      radius = 15 + rand() * 65; // 15 - 80
      baseAlt = 52 + rand() * 20; // 52 - 72
      baseSize = 8.5 + rand() * 4.5; // 8.5 - 13
    } else {
      // Intermediate sky fill: bridges mid and far horizons in 360°
      radius = 95 + rand() * 115; // 95 - 210
      baseAlt = 26 + rand() * 22; // 26 - 48
      baseSize = 11 + rand() * 5.5; // 11 - 16.5
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
      [0, 0, 0.45 * baseSize, 1.45, 1.35, 1.45],
      // 1: Forward crest peak
      [0.65 * baseSize, 0.18 * baseSize, 0.3 * baseSize, 1.25, 1.15, 1.25],
      // 2: Backward crest peak
      [-0.7 * baseSize, -0.15 * baseSize, 0.25 * baseSize, 1.2, 1.1, 1.2],
      // 3: Right flank major billow
      [0.15 * baseSize, 0.8 * baseSize, -0.02 * baseSize, 1.15, 1.0, 1.15],
      // 4: Left flank major billow
      [-0.15 * baseSize, -0.8 * baseSize, -0.02 * baseSize, 1.12, 0.98, 1.12],
      // 5: Forward-right diagonal billow
      [0.7 * baseSize, 0.65 * baseSize, 0.05 * baseSize, 1.0, 0.9, 1.0],
      // 6: Forward-left diagonal billow
      [0.7 * baseSize, -0.65 * baseSize, 0.05 * baseSize, 1.0, 0.9, 1.0],
      // 7: Backward-right diagonal billow
      [-0.68 * baseSize, 0.62 * baseSize, 0.05 * baseSize, 0.98, 0.88, 0.98],
      // 8: Backward-left diagonal billow
      [-0.68 * baseSize, -0.62 * baseSize, 0.05 * baseSize, 0.98, 0.88, 0.98],
      // 9: Forward snout billow
      [1.38 * baseSize, 0.08 * baseSize, -0.12 * baseSize, 0.92, 0.8, 0.92],
      // 10: Tail billow
      [-1.42 * baseSize, -0.08 * baseSize, -0.12 * baseSize, 0.88, 0.78, 0.88],
      // 11: Central condensation base (flat bottom)
      [0, 0, -0.38 * baseSize, 1.55, 0.52, 1.45],
      // 12: Forward condensation base (flat bottom)
      [0.8 * baseSize, 0.05 * baseSize, -0.38 * baseSize, 1.3, 0.48, 1.2],
      // 13: Backward condensation base (flat bottom)
      [-0.8 * baseSize, -0.05 * baseSize, -0.38 * baseSize, 1.25, 0.48, 1.15],
      // 14: High crown turret whisp
      [0.22 * baseSize, -0.22 * baseSize, 0.72 * baseSize, 0.82, 0.75, 0.82],
      // 15: Subsidiary side crest
      [0.48 * baseSize, 0.72 * baseSize, 0.25 * baseSize, 0.85, 0.8, 0.85],
    ];

    for (let p = 0; p < PUFFS_PER_BANK; p++) {
      const [f, c, v, sx, sy, sz] = bankPuffLayout[p]!;
      const jx = (rand() - 0.5) * 0.15 * baseSize;
      const jz = (rand() - 0.5) * 0.15 * baseSize;
      const jy = (rand() - 0.5) * 0.08 * baseSize;
      const sJitter = 0.94 + rand() * 0.12;

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
  cloudShadow: '#82b7eb', // Radiant sky-blue cumulus shadow (matches Image 2 reference)
  cloudRim: '#fffdf0',
  rainDay: '#c9d3de',
  rainNight: '#6f7c93',
  lightning: '#d6deff',
} as const;
