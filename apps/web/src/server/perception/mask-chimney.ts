import 'server-only';

import type { KitArchetype } from '@/lib/object-kit';
import {
  frontPartIndex,
  type ObjectRecipe,
  type PartMask,
  type RecipePart,
} from '@/lib/object-shape';
import { pathToRings } from '@/lib/vision';
import {
  cropToPhoto,
  enforcePartBudget,
  partCeiling,
  MASK_YAW_MAX,
  photoToObject,
  roofTopAbove,
  type MaskMapGeom,
} from './mask-geometry';
import { minAreaRect, PANEL_MIN_SIZE, PANEL_TILT_MAX } from './mask-panels';

/** Most chimney masks used (a house shows 1–2; more are SAM duplicates). */
export const CHIMNEY_MASKS_MAX = 2;

/** Stack footprint clamp (object units): narrower is trim, wider is a tower, not a stack. */
export const CHIMNEY_MIN_WIDTH = 0.04;
export const CHIMNEY_MAX_WIDTH = 0.2;

/** Tallest stack above the eave (object units); taller masks are towers, not chimneys. */
export const CHIMNEY_MAX_HEIGHT = 0.5;

/** A mask further than this past the walls belongs to the neighbour's house: skipped. */
export const CHIMNEY_OFFSPAN_SKIP = 0.1;

/** Chimney top in object fractions, from the mask outline (min-area rect) or its box. */
function maskChimney(
  geom: MaskMapGeom,
  mask: PartMask
): { x: number; top: number; w: number; h: number } | null {
  let cx = 0;
  let cy = 0;
  let w = 0;
  let h = 0;
  if (mask.outline) {
    const ring = pathToRings(mask.outline)[0];
    const pts = (ring ?? []).map(([u, v]) => cropToPhoto(geom, u, v));
    const rect = minAreaRect(pts);
    // A rotated mask (a leaning aerial, a gable shadow) is not a stack: skip, no box fallback
    // (its axis box would pave the ridge with brick).
    if (!rect || Math.abs(rect.angle) > PANEL_TILT_MAX) return null;
    cx = rect.cx;
    cy = rect.cy;
    w = rect.w;
    h = rect.h;
  } else {
    const { box } = mask;
    if (!(box.w > 0) || !(box.h > 0)) return null;
    const [x0, y0] = cropToPhoto(geom, box.x, box.y);
    const [x1, y1] = cropToPhoto(geom, box.x + box.w, box.y + box.h);
    cx = (x0 + x1) / 2;
    cy = (y0 + y1) / 2;
    w = x1 - x0;
    h = y1 - y0;
  }
  if (!(w > 0) || !(h > 0)) return null;
  const m = photoToObject(geom, cx, cy);
  if (!m) return null;
  const wu = w * m.rbx;
  const hu = h * m.rby;
  if (wu < PANEL_MIN_SIZE || hu < PANEL_MIN_SIZE) return null;
  return { x: m.x, top: m.y + hu / 2, w: wu, h: hu };
}

/**
 * Chimney stack (template or measured): a small centred box rising past the eave (stepped and
 * measured houses). Shared with the object graph (PR-2.14).
 */
export function isChimneyStack(p: RecipePart, midY: number, eave: number): boolean {
  return (
    p.shape === 'box' &&
    Math.abs(p.at[2]) <= 0.3 &&
    p.size[0] <= 0.15 &&
    p.size[2] <= 0.2 &&
    p.at[1] - p.size[1] / 2 >= midY &&
    p.at[1] + p.size[1] / 2 > eave
  );
}

/**
 * Measured chimney stacks (PR-2.10): each chimney mask becomes a brick stack at the mask's x,
 * feet buried at the eave (never floating) and top following the mask — at least peeking above
 * the roof so the stack reads when our roof runs taller than the photo's. The template stack is
 * replaced, so the count comes from the masks; the part budget drops the smallest decals first
 * and never structure. Returns the recipe unchanged (same reference) without usable chimney
 * masks, past the yaw limit, or for another archetype. Pure: same inputs → same recipe.
 */
export function withMaskChimney(
  archetype: KitArchetype,
  recipe: ObjectRecipe,
  masks: ReadonlyArray<PartMask>,
  geom: MaskMapGeom
): ObjectRecipe {
  if (archetype !== 'house') return recipe;
  if (Math.abs(recipe.yaw ?? 0) > MASK_YAW_MAX) return recipe;
  const main = recipe.parts[frontPartIndex(recipe)]!;
  const eave = main.at[1] + main.size[1] / 2;
  const removed = recipe.parts.filter((p) => isChimneyStack(p, main.at[1], eave));
  const paint = removed[0] ?? main;
  const roofTop = roofTopAbove(recipe.parts, eave, (p) => p === main || removed.includes(p));

  const x0 = main.at[0] - main.size[0] / 2;
  const x1 = main.at[0] + main.size[0] / 2;
  const yaw = recipe.yaw ?? 0;
  const cos = Math.cos(yaw);
  const stacks: RecipePart[] = [];
  for (const mask of masks) {
    if (mask.concept !== 'chimney') continue;
    if (stacks.length >= CHIMNEY_MASKS_MAX) break;
    const rect = maskChimney(geom, mask);
    if (!rect) continue;
    // Un-turn the x: the stack stands at z ≈ 0, where the render only foreshortens by cos.
    const ux = yaw !== 0 && cos > 1e-6 ? rect.x / cos : rect.x;
    const uw = yaw !== 0 && cos > 1e-6 ? rect.w / cos : rect.w;
    if (ux < x0 - CHIMNEY_OFFSPAN_SKIP || ux > x1 + CHIMNEY_OFFSPAN_SKIP) continue;
    if (rect.top <= eave) continue;
    const w = Math.min(CHIMNEY_MAX_WIDTH, Math.max(CHIMNEY_MIN_WIDTH, uw));
    const px = Math.min(x1 - w / 2, Math.max(x0 + w / 2, ux));
    const top = Math.max(Math.min(rect.top, eave + CHIMNEY_MAX_HEIGHT), roofTop + 0.02);
    stacks.push({
      shape: 'box',
      at: [px, (eave + top) / 2, 0],
      size: [w, top - eave, w],
      color: paint.color,
      ...(paint.material ? { material: paint.material } : {}),
    });
  }
  if (stacks.length === 0) return recipe;

  // Room for the stacks: soft-drop decals (never structure); a structure-full recipe keeps
  // its template stack.
  const ceiling = partCeiling(recipe);
  const kept = recipe.parts.filter((p) => !removed.includes(p));
  const protect = kept.filter((p) => p === main || p.at[1] + p.size[1] / 2 > eave);
  const base = enforcePartBudget(kept, protect, {
    max: ceiling - stacks.length,
    soft: true,
  });
  const room = ceiling - base.parts.length;
  if (room <= 0) return recipe;
  const use = stacks.slice(0, room);
  const { parts: fit, dropped } = enforcePartBudget([...base.parts, ...use], [...protect, ...use], {
    max: ceiling,
  });
  const softDropped = kept.length - base.parts.length;
  if (softDropped > 0 || dropped.length > 0) {
    console.info(
      `[vision] 3D chimney: budget dropped ${softDropped + dropped.length} part(s)${dropped.length > 0 ? `: ${dropped.join(' ')}` : ''}`
    );
  }
  return { ...recipe, parts: fit };
}
