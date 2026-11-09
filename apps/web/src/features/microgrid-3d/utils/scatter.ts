import { fbm2d, mulberry32 } from './noise';
import { CANOPY_VARIANTS } from './canopy-tree';
import {
  FLAT_RADIUS,
  isBlocked,
  terrainHeight,
  TERRAIN_RADIUS,
  type KeepOutZone,
} from './landscape';

/** Broadleaf trees are procedural (utils/canopy-tree); the rest are `/3d/nature.glb` node names. */
export const BROADLEAF_MODELS = CANOPY_VARIANTS;
export const PALM_MODELS = ['tree_palmTall', 'tree_palmBend', 'tree_palmShort'] as const;
export const BUSH_MODELS = ['plant_bushLarge', 'plant_bushDetailed', 'plant_bushSmall'] as const;
export const ROCK_MODELS = ['rock_largeA', 'rock_largeB', 'stone_largeD'] as const;

export type NatureModel =
  | (typeof BROADLEAF_MODELS)[number]
  | (typeof PALM_MODELS)[number]
  | (typeof BUSH_MODELS)[number]
  | (typeof ROCK_MODELS)[number];

export type NatureKind = 'broadleaf' | 'palm' | 'bush' | 'rock';

export interface ScatterItem {
  model: NatureModel;
  kind: NatureKind;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  /** 0..1, picks a palette tint so neighbouring trees differ. */
  tint: number;
}

export interface ScatterOptions {
  seed?: number;
  /** Trees on the hills around the village. */
  forestCount?: number;
  /** Palms, bushes and rocks between the buildings. */
  villageCount?: number;
}

function pick<T>(list: readonly [T, ...T[]], r: number): T {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))] ?? list[0];
}

/**
 * Deterministic vegetation layout. Dense forest on the hills, sparse palms and bushes
 * inside the village, nothing on paths, pads, buildings or water.
 */
export function scatterVegetation({
  seed = 42,
  forestCount = 2000,
  villageCount = 170,
}: ScatterOptions = {}): ScatterItem[] {
  const rand = mulberry32(seed);
  const items: ScatterItem[] = [];

  // Forest: rejection sampling, denser where the noise says "woodland".
  let attempts = 0;
  let placed = 0;
  while (placed < forestCount && attempts < forestCount * 12) {
    attempts++;
    const angle = rand() * Math.PI * 2;
    // sqrt → uniform over the ring area.
    const r = Math.sqrt(
      rand() * (TERRAIN_RADIUS ** 2 - (FLAT_RADIUS - 3) ** 2) + (FLAT_RADIUS - 3) ** 2
    );
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const density = fbm2d(x * 0.06, z * 0.06, 11);
    // Thin the forest in the camera foreground (south of the village) so it never hides it.
    const foreground = z > 6 && Math.abs(x) < 28 ? 0.08 : z > 10 && Math.abs(x) < 34 ? 0.35 : 1;
    if (rand() > (0.15 + density * 1.1) * foreground) continue;
    if (isBlocked(x, z, 0.4)) continue;
    const isPalm = z > 6 && Math.abs(x) < 28 ? false : rand() < 0.14;
    const model = isPalm ? pick(PALM_MODELS, rand()) : pick(BROADLEAF_MODELS, rand());
    items.push({
      model,
      kind: isPalm ? 'palm' : 'broadleaf',
      position: [x, terrainHeight(x, z), z],
      rotationY: rand() * Math.PI * 2,
      scale: (isPalm ? 1.7 : 2.6) + rand() * (isPalm ? 0.9 : 1.3) + Math.min(0.8, r / 90),
      tint: rand(),
    });
    placed++;
  }

  // Village: palms, bushes, a few trees and rocks between the buildings.
  attempts = 0;
  placed = 0;
  while (placed < villageCount && attempts < villageCount * 30) {
    attempts++;
    const x = (rand() * 2 - 1) * (FLAT_RADIUS + 2);
    const z = (rand() * 2 - 1) * (FLAT_RADIUS + 2);
    if (Math.hypot(x, z) > FLAT_RADIUS + 2) continue;
    if (isBlocked(x, z, 0.3)) continue;
    const roll = rand();
    // Relieve camera foreground corridor (z > 2.0 && Math.abs(x) < 18): keep open with low bushes/rocks
    const isForegroundViewCorridor = z > 2.0 && Math.abs(x) < 18;
    const kind: NatureKind = isForegroundViewCorridor
      ? roll < 0.65
        ? 'bush'
        : 'rock'
      : roll < 0.3
        ? 'palm'
        : roll < 0.72
          ? 'bush'
          : roll < 0.92
            ? 'broadleaf'
            : 'rock';
    const model =
      kind === 'palm'
        ? pick(PALM_MODELS, rand())
        : kind === 'bush'
          ? pick(BUSH_MODELS, rand())
          : kind === 'rock'
            ? pick(ROCK_MODELS, rand())
            : pick(BROADLEAF_MODELS, rand());
    const baseScale = kind === 'palm' ? 1.5 : kind === 'bush' ? 2.2 : kind === 'rock' ? 0.9 : 2.3;
    items.push({
      model,
      kind,
      position: [x, terrainHeight(x, z), z],
      rotationY: rand() * Math.PI * 2,
      scale: baseScale + rand() * 0.6,
      tint: rand(),
    });
    placed++;
  }

  return items;
}

/**
 * Returns true if a position (x, z) falls inside any dynamic clearing zone (PI-T4).
 */
export function isPositionInClearing(
  x: number,
  z: number,
  clearings?: readonly KeepOutZone[] | null
): boolean {
  if (!clearings || clearings.length === 0) return false;
  for (const k of clearings) {
    if (Math.hypot(x - k.x, z - k.z) < k.r) return true;
  }
  return false;
}

/**
 * Computes the instance scale for a vegetation item given active clearing zones (PI-T4).
 * Returns 0 if inside a clearing, preserving the item's original scale otherwise.
 */
export function clearingItemScale(
  item: ScatterItem,
  clearings?: readonly KeepOutZone[] | null
): number {
  if (!clearings || clearings.length === 0) return item.scale;
  return isPositionInClearing(item.position[0], item.position[2], clearings) ? 0 : item.scale;
}

/**
 * Pure evaluation of instance scales for a collection of scatter items (PI-T4).
 */
export function applyClearingScales(
  items: readonly ScatterItem[],
  clearings?: readonly KeepOutZone[] | null
): number[] {
  return items.map((it) => clearingItemScale(it, clearings));
}
