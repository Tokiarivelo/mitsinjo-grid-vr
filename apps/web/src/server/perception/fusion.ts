/**
 * Fusion of measurements and Spark priors (PF-T7). Every measured value carries a confidence in [0, 1];
 * the final value = prior + c·(measured − prior). Counts are discrete: the measurement wins at c ≥ ½.
 * Pure and deterministic.
 */
import type { ObjectKit } from '@/lib/object-kit';
import type { ObjectRecipe } from '@/lib/object-shape';
import { linearToHex, MIN_MEASURED_PIXELS, srgbToLinear } from './color-measure';

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Pixels from which measured colours are fully trusted. */
export const FULL_COLOR_PIXELS = 1000;

/**
 * Without a SAM outline the box mixes the object with its background, so the measured colours only
 * nudge Spark's (the green Mini, 2026-11-01: hedge pixels outvoted the car at confidence 1).
 */
export const BOX_COLOR_CONFIDENCE_MAX = 0.3;

/** Confidence of each measurement, from what it saw. */
export const confidence = {
  /** Colours: ≥ ½ once measured (enough pixels to cluster), 1 from `FULL_COLOR_PIXELS` (mask coverage). */
  colors: (pixels: number, hasOutline = true) =>
    pixels < MIN_MEASURED_PIXELS
      ? 0
      : round2(
          Math.min(
            hasOutline ? 1 : BOX_COLOR_CONFIDENCE_MAX,
            0.5 +
              0.5 *
                clamp01((pixels - MIN_MEASURED_PIXELS) / (FULL_COLOR_PIXELS - MIN_MEASURED_PIXELS))
          )
        ),
  /**
   * Repetition: autocorrelation peak `R(P)`. A peak only counts above 0.35 (already a significance test),
   * so a found period starts at ½ and is fully trusted from 0.65; no peak → 0.
   */
  repetition: (strength: number) =>
    strength < 0.35 ? 0 : round2(0.5 + 0.5 * clamp01((strength - 0.35) / 0.3)),
  /** Perspective: ½ at the 8-line minimum, 1 from 24 lines meeting at the vanishing point. */
  perspective: (inliers: number) => (inliers < 8 ? 0 : round2(clamp01(0.5 + (inliers - 8) / 32))),
  /** Fit: 0 at IoU 0.4 (the fit lost the object), 1 from 0.8. */
  fit: (iou: number) => round2(clamp01((iou - 0.4) / 0.4)),
};

/** Share of the way to full trust a doubted field is moved when a measurement exists (PQ-T12). */
export const UNSURE_LEAD = 0.5;

type KitDoubts = Pick<ObjectKit, 'evidence' | 'confidence'>;

/**
 * How `evidence.unsure` names each group: the field path the cards ask for (`proportions.d`, `colors.main`,
 * `details.windows`), and the plain words a model writes instead (« depth », « color », « wheels »).
 */
const DOUBT_WORDS = {
  archetype: /^(archetype|subtype|family)/,
  proportions: /^(proportions?|depth|width|height|size)/,
  colors: /^(colou?rs?|main|secondary|accent)/,
  counts: /^(details?|counts?|windows?|doors?|wheels?|legs?|floors?|units?|chimneys?)/,
} as const;

/**
 * True when the kit says it guessed this group of fields: it listed it (or one of its fields, `colors.main`)
 * under `evidence.unsure`, or gave it a confidence under ½ (PQ-T12). Kits of the first prompt never doubt.
 */
export function modelDoubts(
  kit: KitDoubts | undefined,
  group: 'archetype' | 'proportions' | 'colors' | 'counts'
): boolean {
  if (!kit) return false;
  const c = kit.confidence?.[group];
  if (c !== undefined && c < 0.5) return true;
  return (kit.evidence?.unsure ?? []).some((u) => DOUBT_WORDS[group].test(u));
}

/** A measured confidence raised toward 1 when the model doubts that field; 0 stays 0 (nothing measured). */
export const ledByMeasurement = (c: number, doubted: boolean): number =>
  c > 0 && doubted ? round2(c + (1 - c) * UNSURE_LEAD) : c;

export const mixNumber = (measured: number, prior: number, c: number) =>
  prior + clamp01(c) * (measured - prior);

/** Count: the measurement when trusted (c ≥ ½) or when there is no prior, else the prior. */
export const pickCount = (measured: number, prior: number | undefined, c: number) =>
  prior === undefined || c >= 0.5 ? measured : prior;

const hexRgb = (hex: string) =>
  srgbToLinear(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  );

/** Colour mix in linear light (no muddy sRGB average). */
export function mixColor(measured: string, prior: string, c: number): string {
  const m = hexRgb(measured);
  const p = hexRgb(prior);
  return linearToHex(mixNumber(m[0], p[0], c), mixNumber(m[1], p[1], c), mixNumber(m[2], p[2], c));
}

export function mixColors(
  measured: ObjectKit['colors'],
  prior: ObjectKit['colors'],
  c: number
): ObjectKit['colors'] {
  return {
    main: mixColor(measured.main, prior.main, c),
    secondary: mixColor(measured.secondary, prior.secondary, c),
    accent: mixColor(measured.accent, prior.accent, c),
  };
}

/**
 * Fitted recipe vs the recipe before the fit: proportions and yaw mixed by the fit confidence; the parts
 * (eave height) of the fitted one when trusted (c ≥ ½), else the start's.
 */
export function mixRecipe(fitted: ObjectRecipe, start: ObjectRecipe, c: number): ObjectRecipe {
  const p = (k: 'w' | 'h' | 'd') => mixNumber(fitted.proportions[k], start.proportions[k], c);
  const [w, h, d] = [p('w'), p('h'), p('d')];
  const max = Math.max(w, h, d);
  const yaw = mixNumber(fitted.yaw ?? 0, start.yaw ?? 0, c);
  return {
    proportions: { w: w / max, h: h / max, d: d / max },
    parts: c >= 0.5 ? fitted.parts : start.parts,
    ...(yaw !== 0 ? { yaw } : {}),
  };
}
