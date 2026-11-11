import 'server-only';

import type { KitArchetype } from '@/lib/object-kit';
import {
  frontPartIndex,
  type ObjectRecipe,
  type PartKind,
  type PartMask,
} from '@/lib/object-shape';
import type { Component } from '@/lib/shape-script';
import type { NormBox } from '@/lib/vision';
import { CONCEPT_KINDS } from './detail-score';
import { renderFlat } from './flat-render';
import { PART_MIRROR_MIN_Z, type MaskMapGeom } from './mask-geometry';
import type { RgbGrid } from './model-score';
import { detailParts, gridParts } from './score-shape';
import type { StageScorer, StageSpec } from './shape-stages';
import type { Mask } from './silhouette-fit';
import { matchPartBoxes, photoStages, type ScoredViews, type ViewStage } from './view-stages';

/**
 * Photo-path staged loop, target and scorer (PQ-T19). Same runner as the 2D path (`runShapeStages`); the
 * target is the photo itself: the tight crop, the SAM outline (silhouette IoU at the measured yaw, since
 * the flat render turns the model like the photo) and the SAM part masks (boxes per part kind). A stage
 * is scored by the silhouette (`body`) or by how its part kinds match the masks. Parts the photo cannot
 * see (far side, inferred) are locked, like side walls on a front elevation. Pure; no energy values.
 */

export interface PhotoTarget {
  /** Box width / height in photo pixels (the render's frame). */
  aspect: number;
  /** The tight crop sampled on the fit grid (the sheet's photo tile). */
  crop: RgbGrid;
  /** The SAM outline on the fit grid (1 = object). */
  outline: Mask;
  /** SAM parts read on the object, by the part kind that draws them; object-box fractions, y down. */
  parts: ReadonlyArray<{ kind: PartKind; box: NormBox }>;
}

/** Target of a photo-path object; null without an outline (nothing to score the silhouette on). */
export function photoTarget(input: {
  aspect: number;
  crop: RgbGrid;
  outline: Mask;
  /** Masks already filtered to the object (`masksOnObject`). */
  masks: ReadonlyArray<PartMask>;
  geom: MaskMapGeom;
}): PhotoTarget | null {
  const { aspect, crop, outline, masks, geom } = input;
  if (!(aspect > 0) || !outline.data.some((v) => v === 1)) return null;
  const { cols, rows } = outline;
  const parts = gridParts(masks, geom, cols, rows).flatMap((g) => {
    const kind = CONCEPT_KINDS[g.concept]?.[0];
    const [w, h] = [g.x1 - g.x0, g.y1 - g.y0];
    if (!kind || !(w > 0) || !(h > 0)) return [];
    return [{ kind, box: { x: g.x0 / cols, y: g.y0 / rows, w: w / cols, h: h / rows } }];
  });
  return { aspect, crop, outline, parts };
}

/**
 * Kit parts carry no `kind`, and the runner only lets a stage touch the kinds it names: the main body and
 * the parts the score already guesses (wheels, thin boxes = windows or doors) are tagged, nothing else
 * changes. Tagged parts keep their own kind. Pure.
 */
export function tagPhotoParts(recipe: ObjectRecipe, archetype: KitArchetype): ObjectRecipe {
  const main = frontPartIndex(recipe);
  const guess = detailParts(recipe);
  const parts = recipe.parts.map((p, i) => {
    if (p.kind) return p;
    if (i === main)
      return { ...p, kind: archetype === 'house' ? ('wall' as const) : ('body' as const) };
    const kinds = guess[i]!.kinds;
    if (kinds.length === 1) return { ...p, kind: kinds[0]! };
    // Thin box that is window or door: the taller one is the door.
    if (kinds.includes('door') && kinds.includes('window'))
      return { ...p, kind: p.size[1] > 1.4 * p.size[0] ? ('door' as const) : ('window' as const) };
    return p;
  });
  return { ...recipe, parts };
}

/** What the photo cannot show stays as built: far-side parts and anything inferred (hidden sides, mirrors). */
export const photoCanEdit = (c: Component): boolean =>
  c.part.at[2] >= -PART_MIRROR_MIN_Z && c.part.status !== 'inferred';

/** Stages the photo can judge: the body, and each stage whose kinds SAM drew on the object. */
export function judgedPhotoStages(
  archetype: KitArchetype,
  target: Pick<PhotoTarget, 'parts'>
): ReadonlyArray<StageSpec<ViewStage>> {
  const all = photoStages(archetype) ?? [];
  const drawn = new Set(target.parts.map((p) => p.kind));
  return all.filter((st) => st.id === 'body' || st.kinds.some((k) => drawn.has(k)));
}

/** Visible box of each recipe part at the photo view, object-box fractions (y down), with its kind. */
export function builtParts(recipe: ObjectRecipe, aspect: number, outline: Mask) {
  const { cols, rows } = outline;
  const r = renderFlat(recipe, aspect, cols, rows);
  const guess = detailParts(recipe);
  const bounds = recipe.parts.map(() => [Infinity, -Infinity, Infinity, -Infinity]);
  let inter = 0;
  let union = 0;
  for (let row = 0; row < rows; row++)
    for (let c = 0; c < cols; c++) {
      const i = row * cols + c;
      const a = r.mask.data[i] === 1;
      const b = outline.data[i] === 1;
      if (a && b) inter++;
      if (a || b) union++;
      const k = r.part[i]!;
      if (k < 0) continue;
      const bb = bounds[k]!;
      bb[0] = Math.min(bb[0]!, c);
      bb[1] = Math.max(bb[1]!, c);
      bb[2] = Math.min(bb[2]!, row);
      bb[3] = Math.max(bb[3]!, row);
    }
  const parts: Array<{ kind: PartKind; box: NormBox }> = [];
  recipe.parts.forEach((p, k) => {
    const [c0, c1, r0, r1] = bounds[k]!;
    const kind = p.kind ?? guess[k]!.kinds[0];
    if (!kind || c1! < c0!) return;
    parts.push({
      kind,
      box: { x: c0! / cols, y: r0! / rows, w: (c1! + 1 - c0!) / cols, h: (r1! + 1 - r0!) / rows },
    });
  });
  return { silhouette: union ? inter / union : 0, parts };
}

/** Scores the model on the photo for every stage of the list (same shape as `scoreViews`). Pure. */
export function scorePhoto(
  recipe: ObjectRecipe,
  target: PhotoTarget,
  stages: ReadonlyArray<StageSpec<ViewStage>>
): ScoredViews {
  const built = builtParts(recipe, target.aspect, target.outline);
  const out: ScoredViews = {
    stages: {},
    measured: [],
    silhouette: built.silhouette,
    overall: built.silhouette,
    counts: {},
  };
  const partScores: number[] = [];
  for (const st of stages) {
    if (st.id === 'body') {
      out.stages.body = built.silhouette;
      continue;
    }
    const drawn = target.parts.filter((p) => st.kinds.includes(p.kind)).map((p) => p.box);
    const mine = built.parts.filter((p) => st.kinds.includes(p.kind)).map((p) => p.box);
    const m = matchPartBoxes(drawn, mine);
    if (!m) {
      out.stages[st.id] = 1;
      continue;
    }
    out.stages[st.id] = m.score;
    out.measured.push(st.id);
    out.counts[st.id] = { drawn: drawn.length, built: mine.length, matched: m.matched };
    partScores.push(m.score);
  }
  if (partScores.length)
    out.overall =
      (built.silhouette + partScores.reduce((a, b) => a + b, 0) / partScores.length) / 2;
  return out;
}

/** Runner scorer of the photo loop (stage share from `scorePhoto`). */
export function photoStageScorer(
  target: PhotoTarget,
  stages: ReadonlyArray<StageSpec<ViewStage>>
): StageScorer<ViewStage> {
  return (recipe, stage) => {
    const s = scorePhoto(recipe, target, stages);
    return { stage: s.stages[stage] ?? 1, overall: s.overall };
  };
}
