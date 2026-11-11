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
 * Gloss from the photo (PQ-T26): the gap between the brightest 1 % and the median luminance of a region (in
 * CIELAB L*, 0–100). A sharp highlight on a flat surface = a large gap. Pure, deterministic.
 */

/** Share of the brightest cells that stand for the highlight. */
export const HIGHLIGHT_SHARE = 0.01;

/** L* gap under `MATT_GAP` reads matt, from `GLOSS_GAP` gloss, between satin. */
export const MATT_GAP = 14;
export const GLOSS_GAP = 32;

/** Fewer cells than this in a material's region → too noisy to class (the default look stays). */
export const MIN_GLOSS_CELLS = 30;

const lightness = (r: number, g: number, b: number): number => {
  const [lr, lg, lb] = srgbToLinear(r, g, b);
  return linearToLab(lr, lg, lb)[0];
};

/** Gap (L*) between the brightest 1 % (at least one cell) and the median of the given lightness values. */
export function highlightGap(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const top = Math.max(1, Math.ceil(sorted.length * HIGHLIGHT_SHARE));
  const peak = sorted.slice(sorted.length - top).reduce((s, v) => s + v, 0) / top;
  return peak - median;
}

/** Class of a region from its lightness values; null under `MIN_GLOSS_CELLS`. */
export function classifyGloss(values: ReadonlyArray<number>): GlossClass | null {
  if (values.length < MIN_GLOSS_CELLS) return null;
  const gap = highlightGap(values);
  return gap < MATT_GAP ? GLOSS_CLASSES[0] : gap < GLOSS_GAP ? GLOSS_CLASSES[1] : GLOSS_CLASSES[2];
}

/**
 * Gloss per material of a recipe: each part's front rectangle (object fractions) picks the grid cells it
 * covers (first part wins an overlap, cells outside the outline skipped); a material with enough cells gets a
 * class. Rings are in photo fractions, `box` is the grid's box. Empty without a measurable material.
 */
export function measureRecipeGloss(
  grid: RgbGrid,
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  box: Pick<NormBox, 'x' | 'y' | 'w' | 'h'>,
  recipe: Pick<ObjectRecipe, 'parts'>
): Partial<Record<RecipeMaterial, GlossClass>> {
  const { cols, rows, rgb } = grid;
  const taken = new Uint8Array(cols * rows);
  const byMaterial = new Map<RecipeMaterial, number[]>();
  for (const p of recipe.parts) {
    if (!p.material) continue;
    const i0 = Math.max(0, Math.floor((p.at[0] - p.size[0] / 2 + 0.5) * cols));
    const i1 = Math.min(cols - 1, Math.ceil((p.at[0] + p.size[0] / 2 + 0.5) * cols) - 1);
    const j0 = Math.max(0, Math.floor((0.5 - p.at[1] - p.size[1] / 2) * rows));
    const j1 = Math.min(rows - 1, Math.ceil((0.5 - p.at[1] + p.size[1] / 2) * rows) - 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        if (taken[k]) continue;
        if (
          rings.length > 0 &&
          !insideRings(
            box.x + (box.w * (i + 0.5)) / cols,
            box.y + (box.h * (j + 0.5)) / rows,
            rings
          )
        )
          continue;
        taken[k] = 1;
        const list = byMaterial.get(p.material) ?? [];
        list.push(lightness(rgb[k * 3]!, rgb[k * 3 + 1]!, rgb[k * 3 + 2]!));
        byMaterial.set(p.material, list);
      }
    }
  }
  const out: Partial<Record<RecipeMaterial, GlossClass>> = {};
  for (const [material, values] of byMaterial) {
    const cls = classifyGloss(values);
    if (cls) out[material] = cls;
  }
  return out;
}
