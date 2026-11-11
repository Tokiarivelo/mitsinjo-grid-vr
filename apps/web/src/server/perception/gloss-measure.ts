import 'server-only';

import {
  GLOSS_CLASSES,
  type GlossClass,
  type ObjectRecipe,
  type RecipeMaterial,
} from '@/lib/object-shape';
import { insideRings, linearToLab, srgbToLinear } from './color-measure';
import type { RgbGrid } from './model-score';
import type { NormBox } from './schemas';

/**
 * Gloss from the photo (PQ-T26): the gap between the brightest 1 % and the bright body (90th percentile) of a
 * region's luminance (CIELAB L*, 0–100). A sharp highlight on a flat surface = a large gap. Pure, deterministic.
 */

/** Share of the brightest cells that stand for the highlight. */
export const HIGHLIGHT_SHARE = 0.01;

/**
 * L* gap under `MATT_GAP` reads matt, from `GLOSS_GAP` gloss, between satin. Read on the real captures
 * (`make gloss-report`, 2026-11-11): flat-lit smooth objects (fridge, TV, lamp, roof sheet) stay under 6.5, the
 * three car bodies read 14.9–20.1.
 */
export const MATT_GAP = 8;
export const GLOSS_GAP = 14;

/**
 * Materials that can carry a specular highlight. The others (stone, brick, plaster, wood, foliage…) are rough
 * by nature: a bright spot on them is mortar, a window frame or sky between leaves, so they are never classed
 * and keep their default look.
 */
export const SPECULAR_MATERIALS: ReadonlyArray<RecipeMaterial> = [
  'painted',
  'plastic',
  'metal',
  'glass',
  'tile',
  'water',
];

/** Never classed matt: without a highlight on the photo, glass and water are still smooth (the light was flat). */
export const NEVER_MATT: ReadonlyArray<RecipeMaterial> = ['glass', 'water'];

/** Fewer cells than this in a material's region → too noisy to class (the default look stays). */
export const MIN_GLOSS_CELLS = 30;

const lightness = (r: number, g: number, b: number): number => {
  const [lr, lg, lb] = srgbToLinear(r, g, b);
  return linearToLab(lr, lg, lb)[0];
};

/** The highlight is read against this quantile of the region, not its median (see `highlightGap`). */
export const BODY_QUANTILE = 0.9;

/**
 * Gap (L*) between the brightest 1 % (at least one cell) and the bright body of the region (its 90th
 * percentile). A specular highlight is a few cells far above everything else; a two-tone or textured surface
 * (livery, mortar, sky between leaves) is bright over a wide share, so its 90th percentile is already high and
 * the gap stays small.
 */
export function highlightGap(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const body = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * BODY_QUANTILE))]!;
  const top = Math.max(1, Math.ceil(sorted.length * HIGHLIGHT_SHARE));
  const peak = sorted.slice(sorted.length - top).reduce((s, v) => s + v, 0) / top;
  return Math.max(0, peak - body);
}

/** Class of a highlight gap (L*). */
export function glossOfGap(gap: number): GlossClass {
  return gap < MATT_GAP ? GLOSS_CLASSES[0] : gap < GLOSS_GAP ? GLOSS_CLASSES[1] : GLOSS_CLASSES[2];
}

/** Class of a region from its lightness values; null under `MIN_GLOSS_CELLS`. */
export function classifyGloss(values: ReadonlyArray<number>): GlossClass | null {
  if (values.length < MIN_GLOSS_CELLS) return null;
  return glossOfGap(highlightGap(values));
}

/** Highlight gap of one material: the mean gap of its parts, weighted by their cells. */
export interface MaterialGap {
  gap: number;
  cells: number;
}

/**
 * Highlight gap per material of a recipe: each part's front rectangle (object fractions) picks the grid cells
 * it covers (the smallest part wins an overlap, cells outside the outline skipped). The gap is read **inside each
 * part** and averaged over the material's parts by their cells: two parts of one material in different colours
 * (a dark pole, a pale cap) are two flat surfaces, not one surface with a highlight. Parts under
 * `MIN_GLOSS_CELLS` and parts of a rough material (not in `SPECULAR_MATERIALS`) do not count. Rings are in photo fractions, `box` is the grid's box.
 */
export function measureGlossGaps(
  grid: RgbGrid,
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  box: Pick<NormBox, 'x' | 'y' | 'w' | 'h'>,
  recipe: Pick<ObjectRecipe, 'parts'>
): Map<RecipeMaterial, MaterialGap> {
  const { cols, rows, rgb } = grid;
  const taken = new Uint8Array(cols * rows);
  const sums = new Map<RecipeMaterial, { weighted: number; cells: number }>();
  // Smallest rectangle first: a window, a wheel or a lamp on the body takes its own cells, so the body is read
  // without them (a pale window on a red door is not a highlight of the paint).
  const rects = recipe.parts
    .map((p) => ({
      p,
      i0: Math.max(0, Math.floor((p.at[0] - p.size[0] / 2 + 0.5) * cols)),
      i1: Math.min(cols - 1, Math.ceil((p.at[0] + p.size[0] / 2 + 0.5) * cols) - 1),
      j0: Math.max(0, Math.floor((0.5 - p.at[1] - p.size[1] / 2) * rows)),
      j1: Math.min(rows - 1, Math.ceil((0.5 - p.at[1] + p.size[1] / 2) * rows) - 1),
    }))
    .sort((a, b) => (a.i1 - a.i0) * (a.j1 - a.j0) - (b.i1 - b.i0) * (b.j1 - b.j0));
  for (const { p, i0, i1, j0, j1 } of rects) {
    const measured = p.material !== undefined && SPECULAR_MATERIALS.includes(p.material);
    const values: number[] = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        if (taken[k]) continue;
        taken[k] = 1;
        if (
          !measured ||
          (rings.length > 0 &&
            !insideRings(
              box.x + (box.w * (i + 0.5)) / cols,
              box.y + (box.h * (j + 0.5)) / rows,
              rings
            ))
        )
          continue;
        values.push(lightness(rgb[k * 3]!, rgb[k * 3 + 1]!, rgb[k * 3 + 2]!));
      }
    }
    if (!measured || values.length < MIN_GLOSS_CELLS) continue;
    const sum = sums.get(p.material!) ?? { weighted: 0, cells: 0 };
    sum.weighted += highlightGap(values) * values.length;
    sum.cells += values.length;
    sums.set(p.material!, sum);
  }
  const out = new Map<RecipeMaterial, MaterialGap>();
  for (const [material, { weighted, cells }] of sums)
    out.set(material, { gap: weighted / cells, cells });
  return out;
}

/** Gloss class per material of a recipe (`measureGlossGaps`, classed). Empty without a measurable material. */
export function measureRecipeGloss(
  grid: RgbGrid,
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  box: Pick<NormBox, 'x' | 'y' | 'w' | 'h'>,
  recipe: Pick<ObjectRecipe, 'parts'>
): Partial<Record<RecipeMaterial, GlossClass>> {
  const out: Partial<Record<RecipeMaterial, GlossClass>> = {};
  for (const [material, { gap }] of measureGlossGaps(grid, rings, box, recipe)) {
    const cls = glossOfGap(gap);
    if (cls === 'matt' && NEVER_MATT.includes(material)) continue;
    out[material] = cls;
  }
  return out;
}
