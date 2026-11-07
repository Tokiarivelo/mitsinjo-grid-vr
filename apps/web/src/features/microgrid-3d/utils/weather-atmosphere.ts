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
  sunny: { cloudCover: 0.42, overcast: 0, rain: 0, lightning: false, cloudDarkness: 0 },
  partly_cloudy: {
    cloudCover: 0.65,
    overcast: 0.22,
    rain: 0,
    lightning: false,
    cloudDarkness: 0.08,
  },
  cloudy: { cloudCover: 0.88, overcast: 0.6, rain: 0, lightning: false, cloudDarkness: 0.35 },
  rainy: { cloudCover: 1, overcast: 0.8, rain: 0.6, lightning: false, cloudDarkness: 0.55 },
  storm: { cloudCover: 1, overcast: 0.95, rain: 1, lightning: true, cloudDarkness: 0.78 },
};

/** Most cloud banks drawn across all depth layers (full cover). */
export const MAX_CLOUD_BANKS = 48;
/** Puffs per cloud bank forming a billowing cumulus formation. */
export const PUFFS_PER_BANK = 14;

export interface CloudPuff {
  position: [number, number, number];
  scale: [number, number, number];
}

/**
 * Deterministic multi-layered cumulus cloud layout for a given cover: same cover → same sky.
 * Banks are distributed across 3 depth layers:
 * - Horizon & mountain ridge framing (visible over distant ridges in default camera view)
 * - Mid-sky valley clouds
 * - High atmospheric canopy
 *
 * Each bank is composed of 14 overlapping rounded lobes with flat condensation bases,
 * towering central cauliflower domes, and cascading fluffy side billows.
 */
export function cloudPuffs(cloudCover: number, seed = 7): CloudPuff[] {
  const banks = Math.round(Math.min(1, Math.max(0, cloudCover)) * MAX_CLOUD_BANKS);
  if (banks === 0) return [];
  const rand = mulberry32(seed);
  const puffs: CloudPuff[] = [];

  for (let b = 0; b < banks; b++) {
    const ring = b % 3;
    let radius: number;
    let baseAlt: number;
    let baseSize: number;

    if (ring === 0) {
      // Horizon & mountain ridge framing: crowns distant ridges across 360° (visible from village view)
      radius = 130 + rand() * 100; // 130 - 230
      baseAlt = 22 + rand() * 14; // 22 - 36 (sits gracefully above mountain silhouettes)
      baseSize = 13 + rand() * 6; // 13 - 19
    } else if (ring === 1) {
      // Mid-sky valley clouds: floating across the landscape and surrounding hills
      radius = 65 + rand() * 70; // 65 - 135
      baseAlt = 36 + rand() * 14; // 36 - 50
      baseSize = 9 + rand() * 4.5; // 9 - 13.5
    } else {
      // High overhead canopy: fair-weather cumulus drifting across the sky
      radius = 25 + rand() * 85; // 25 - 110
      baseAlt = 52 + rand() * 18; // 52 - 70
      baseSize = 8 + rand() * 4; // 8 - 12
    }

    // Distribute angles around the circle with jitter for organic non-uniform spacing
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
      [0, 0, 0.4 * baseSize, 1.35, 1.25, 1.35],
      // 1: Forward crest dome
      [0.65 * baseSize, 0.15 * baseSize, 0.25 * baseSize, 1.15, 1.05, 1.15],
      // 2: Backward crest dome
      [-0.7 * baseSize, -0.12 * baseSize, 0.2 * baseSize, 1.1, 1.0, 1.1],
      // 3: Right flank billowing lobe
      [0.15 * baseSize, 0.75 * baseSize, -0.05 * baseSize, 1.05, 0.9, 1.05],
      // 4: Left flank billowing lobe
      [-0.18 * baseSize, -0.75 * baseSize, -0.05 * baseSize, 1.0, 0.9, 1.0],
      // 5: Forward snout lobe
      [1.35 * baseSize, 0.1 * baseSize, -0.15 * baseSize, 0.9, 0.75, 0.9],
      // 6: Tail lobe
      [-1.4 * baseSize, -0.1 * baseSize, -0.15 * baseSize, 0.85, 0.72, 0.85],
      // 7: Central base lobe (flat condensation bottom)
      [0, 0, -0.38 * baseSize, 1.45, 0.52, 1.35],
      // 8: Forward base lobe (flat condensation bottom)
      [0.75 * baseSize, 0.05 * baseSize, -0.38 * baseSize, 1.2, 0.48, 1.1],
      // 9: Backward base lobe (flat condensation bottom)
      [-0.75 * baseSize, -0.05 * baseSize, -0.38 * baseSize, 1.15, 0.48, 1.05],
      // 10: High whisp accent
      [0.2 * baseSize, -0.2 * baseSize, 0.65 * baseSize, 0.75, 0.7, 0.75],
      // 11: Side whisp accent right
      [0.45 * baseSize, 0.65 * baseSize, 0.2 * baseSize, 0.8, 0.75, 0.8],
      // 12: Side whisp accent left
      [-0.45 * baseSize, -0.65 * baseSize, 0.2 * baseSize, 0.8, 0.75, 0.8],
      // 13: Under-crest volume filler
      [0.1 * baseSize, 0.1 * baseSize, -0.1 * baseSize, 1.1, 0.85, 1.1],
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
