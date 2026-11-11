import type { PhotoConditions, PhotoLevel, PhotoView } from '@/lib/object-shape';
import type { KitArchetype } from '@/lib/object-kit';
import type { GrayGrid } from './repetition';

/**
 * Photo conditions (PQ-T7): facts about how good the pixels of one object are. Pure, deterministic, no AI.
 * Feeds the « Measured: » line of the kit question, the fusion confidences and the panel hint.
 */

/**
 * Variance of the Laplacian (grey 0–1, photo's own pixels) under / from these values: low / medium / high
 * sharpness. Calibrated on the 13 real photos and their Gaussian-blurred copies (σ in photo pixels): untouched
 * 0.0096–0.84 (all high), σ 1 → 0.0009–0.029 (never low), σ 2 → 0.00015–0.0012, σ 3 → ≤ 0.0003 (all low).
 */
export const SHARP_LOW_VAR = 0.0008;
export const SHARP_HIGH_VAR = 0.005;
/** A pixel this close to black or white counts as clipped. */
export const CLIP_EDGE = 0.02;
/** Clipped share from this value is « medium », from the next « high ». */
export const EXPOSURE_MEDIUM = 0.08;
export const EXPOSURE_HIGH = 0.25;
/** Hidden share from which the object counts as partly hidden (hint, « clean front » PQ-T23). */
export const HIDDEN_MIN = 0.3;

/** Share of the box an unhidden outline of each archetype usually fills. */
const USUAL_FILL: Record<KitArchetype, number> = {
  cabinet: 0.9,
  screen: 0.85,
  fan: 0.55,
  machine: 0.6,
  lamp_post: 0.25,
  pole: 0.2,
  tank: 0.85,
  panel: 0.8,
  house: 0.75,
  building: 0.9,
  tree: 0.65,
  bush: 0.7,
  vehicle: 0.75,
  person: 0.45,
  animal: 0.55,
  water: 0.9,
  other: 0.8,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Variance of the 4-neighbour Laplacian of the grey grid, inside the mask. 0 when too few pixels. */
export function laplacianVariance(grid: GrayGrid): number {
  const { width: w, height: h, gray, mask } = grid;
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      if (!mask[k]) continue;
      const lap = gray[k - 1]! + gray[k + 1]! + gray[k - w]! + gray[k + w]! - 4 * gray[k]!;
      n++;
      sum += lap;
      sumSq += lap * lap;
    }
  }
  if (n < 16) return 0;
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

/** Share of masked pixels that are clipped to black or white. */
export function clippedShare(grid: GrayGrid): number {
  let n = 0;
  let clipped = 0;
  for (let k = 0; k < grid.gray.length; k++) {
    if (!grid.mask[k]) continue;
    n++;
    const g = grid.gray[k]!;
    if (g <= CLIP_EDGE || g >= 1 - CLIP_EDGE) clipped++;
  }
  return n ? clipped / n : 0;
}

/** Outline area over the box (0–1); 1 when there is no outline (every pixel counts). */
export function outlineFill(grid: GrayGrid): number {
  let on = 0;
  for (let k = 0; k < grid.mask.length; k++) on += grid.mask[k] ? 1 : 0;
  return grid.mask.length ? on / grid.mask.length : 0;
}

/** How much of the object is missing: 1 − fill / usual fill of its archetype, 0–1. */
export function hiddenShare(fill: number, archetype: KitArchetype): number {
  return clamp01(1 - fill / USUAL_FILL[archetype]);
}

/** Yaw (radians, 0 = facing the camera) → view class. */
export function viewClass(yaw: number): PhotoView {
  const a = Math.abs(yaw);
  return a < 0.26 ? 'front' : a < 0.9 ? 'three_quarter' : 'side';
}

const level = (v: number, medium: number, high: number): PhotoLevel =>
  v >= high ? 'high' : v >= medium ? 'medium' : 'low';

export interface PhotoConditionsInput {
  /** Object box in photo pixels. */
  widthPx: number;
  heightPx: number;
  /** Grey grid of the box, mask = SAM outline (all ones without): exposure and hidden share. */
  grid: GrayGrid | null;
  /** Grey grid of the box at the photo's own resolution (`sampleNativeGray`): sharpness. */
  nativeGrid?: GrayGrid | null;
  /** Needs an outline: without one the hidden share is unknown. */
  hasOutline: boolean;
  archetype?: KitArchetype;
  /** Measured yaw in radians, when known. */
  yaw?: number | null;
}

/** Conditions of the photo for one object; fields without a measurement behind them are left out. */
export function measurePhotoConditions(input: PhotoConditionsInput): PhotoConditions {
  const { widthPx, heightPx, grid, nativeGrid, hasOutline, archetype, yaw } = input;
  const out: PhotoConditions = { widthPx: Math.round(widthPx), heightPx: Math.round(heightPx) };
  // Sharpness only on the photo's own pixels: a resized grid hides the blur of a large object.
  if (nativeGrid)
    out.sharpness = level(laplacianVariance(nativeGrid), SHARP_LOW_VAR, SHARP_HIGH_VAR);
  if (grid) {
    // Exposure is a problem level: low = fine, high = mostly clipped.
    out.exposure = level(clippedShare(grid), EXPOSURE_MEDIUM, EXPOSURE_HIGH);
    if (hasOutline && archetype)
      out.hidden = Math.round(hiddenShare(outlineFill(grid), archetype) * 100) / 100;
  }
  if (yaw !== undefined && yaw !== null) out.view = viewClass(yaw);
  return out;
}

/** The « Measured: » facts for the kit question (skills §14); only what was measured. */
export function conditionsFacts(c: PhotoConditions): string[] {
  return [
    `object ${c.widthPx} × ${c.heightPx} px`,
    ...(c.sharpness ? [`sharpness ${c.sharpness}`] : []),
    ...(c.exposure && c.exposure !== 'low' ? [`exposure problems ${c.exposure}`] : []),
    ...(c.hidden !== undefined && c.hidden >= 0.1
      ? [`${Math.round(c.hidden * 100)} % hidden`]
      : []),
    ...(c.view ? [`facing: ${c.view.replace('_', ' ')}`] : []),
  ];
}

/**
 * Colour confidence factor from the conditions: clipped pixels (blown highlights, crushed shadows) hide the
 * real colour. Blur is not used: it does not move the median colour, and the goldens showed it only hurts.
 */
export function conditionsTrust(c: PhotoConditions | undefined): number {
  if (!c) return 1;
  return c.exposure === 'high' ? 0.7 : c.exposure === 'medium' ? 0.9 : 1;
}
