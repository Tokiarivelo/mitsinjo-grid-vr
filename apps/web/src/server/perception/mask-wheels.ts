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
  PART_MIRROR_MIN_Z,
  photoToObject,
  type MaskMapGeom,
  type Pt,
} from './mask-geometry';

/** Most wheel masks used per side (a side view shows 2–3; more are SAM duplicates). */
export const WHEEL_MASKS_MAX = 3;

/** Rim radius as a share of the tyre radius. */
export const RIM_RATIO = 0.55;

/** A rim stands proud of the tyre faces by this (object units) so its face renders. */
export const RIM_PROUD = 0.02;

/** Neutral alloy grey: shape is measured here, the rim tint waits for PR-2.8 region colours. */
export const RIM_COLOR = '#b9bec6';

/** 3×3 solve by Gaussian elimination; null when singular. */
function solve3(a: number[][]): [number, number, number] | null {
  const m = a.map((r) => r.slice());
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    if (Math.abs(m[piv]![c]!) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = m[r]![c]! / m[c]![c]!;
      for (let cc = c; cc < 4; cc++) m[r]![cc]! -= k * m[c]![cc]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

/**
 * Algebraic (Kasa) circle fit on photo-pixel points: centre, radius and rms residual, all in
 * pixels. Null with fewer than 3 points or a singular (collinear) set. Pure.
 */
export function fitCircle(points: ReadonlyArray<Pt>): {
  cx: number;
  cy: number;
  r: number;
  rms: number;
} | null {
  if (points.length < 3) return null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxz = 0;
  let syz = 0;
  for (const [x, y] of points) {
    const z = x * x + y * y;
    sx += x;
    sy += y;
    sz += z;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxz += x * z;
    syz += y * z;
  }
  const n = points.length;
  const sol = solve3([
    [sxx, sxy, sx, -sxz],
    [sxy, syy, sy, -syz],
    [sx, sy, n, -sz],
  ]);
  if (!sol) return null;
  const [a, b, c] = sol;
  const cx = -a / 2;
  const cy = -b / 2;
  const r2 = (a * a + b * b) / 4 - c;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let se = 0;
  for (const [x, y] of points) {
    const e = Math.hypot(x - cx, y - cy) - r;
    se += e * e;
  }
  return { cx, cy, r, rms: Math.sqrt(se / n) };
}

/** Wheel centre + radii in object fractions, from the mask outline (circle fit) or its box. */
function maskWheel(
  geom: MaskMapGeom,
  mask: PartMask
): { x: number; y: number; rx: number; ry: number } | null {
  let cx = 0;
  let cy = 0;
  let r = 0;
  if (mask.outline) {
    const ring = pathToRings(mask.outline)[0];
    const pts = (ring ?? []).map(([u, v]) => cropToPhoto(geom, u, v));
    const fit = fitCircle(pts);
    // A clean outline wins; a ragged one (half-hidden wheel) falls back to the box.
    if (fit && fit.r > 0 && fit.rms <= 0.15 * fit.r) {
      cx = fit.cx;
      cy = fit.cy;
      r = fit.r;
    }
  }
  if (!(r > 0)) {
    const { box } = mask;
    if (!(box.w > 0) || !(box.h > 0)) return null;
    const [x0, y0] = cropToPhoto(geom, box.x, box.y);
    const [x1, y1] = cropToPhoto(geom, box.x + box.w, box.y + box.h);
    cx = (x0 + x1) / 2;
    cy = (y0 + y1) / 2;
    r = Math.min(x1 - x0, y1 - y0) / 2;
    if (!(r > 0)) return null;
  }
  const m = photoToObject(geom, cx, cy);
  if (!m) return null;
  return { x: m.x, y: m.y, rx: r * m.rbx, ry: r * m.rby };
}

/**
 * Measured wheels for a vehicle (PR-2.6): each wheel mask becomes a tyre (z-cylinder at the
 * fitted centre with the fitted radii — rx ≠ ry in box units so it renders round) plus a rim
 * on the camera side, mirrored to the far side. Template wheels are replaced, so the count
 * comes from the masks; the 12-part budget drops the smallest decals first (documented in the
 * log) and never the body. Returns the recipe unchanged (same reference) without usable wheel
 * masks, past the yaw limit, or for another archetype. Pure: same inputs → same recipe.
 */
export function withMaskWheels(
  archetype: KitArchetype,
  recipe: ObjectRecipe,
  masks: ReadonlyArray<PartMask>,
  geom: MaskMapGeom
): ObjectRecipe {
  if (archetype !== 'vehicle') return recipe;
  if (Math.abs(recipe.yaw ?? 0) > MASK_YAW_MAX) return recipe;
  const main = recipe.parts[frontPartIndex(recipe)]!;
  // Template wheels: z-axis cylinders below the body's middle (same predicate as PR-2.2).
  const midY = main.at[1];
  const templateWheels = recipe.parts.filter(
    (p) => p.shape === 'cylinder' && p.axis === 'z' && p.at[1] < midY
  );
  if (templateWheels.length === 0) return recipe;
  // Filter-then-cap (FIX 3): out-of-span false positives used to spend the 3-mask budget
  // before the real wheels were even considered.
  const wheels = masks
    .filter((m) => m.concept === 'wheel')
    .map((m) => maskWheel(geom, m))
    .filter((w): w is NonNullable<typeof w> => w !== null)
    .filter(
      (w) =>
        w.rx >= 0.02 &&
        w.ry >= 0.02 &&
        w.rx <= 0.5 &&
        w.ry <= 0.5 &&
        Math.abs(w.x) <= 0.6 &&
        Math.abs(w.y) <= 0.6
    )
    .slice(0, WHEEL_MASKS_MAX);
  if (wheels.length === 0) return recipe;

  const first = templateWheels[0]!;
  const tyreColor = first.color;
  const tyreMaterial = first.material;
  const thick = Math.max(0.05, Math.min(0.3, first.size[2]));
  // Un-project the centres: the render turns x by the yaw around the wheel plane.
  const yaw = recipe.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const zSide = Math.abs(first.at[2]);
  const { w, d } = recipe.proportions;
  const unturned = wheels.map((wl) => {
    if (yaw === 0 || !(cos > 1e-6)) return wl;
    const xw = wl.x * w;
    const zw = zSide * d;
    return { ...wl, x: (xw - zw * sin) / cos / w, rx: wl.rx / cos, ry: wl.ry / cos };
  });
  const mirror = zSide >= PART_MIRROR_MIN_Z;
  const parts: RecipePart[] = recipe.parts.filter((p) => !templateWheels.includes(p));
  for (const wl of unturned) {
    const tyre: RecipePart = {
      shape: 'cylinder',
      axis: 'z',
      at: [wl.x, wl.y, zSide],
      size: [2 * wl.rx, 2 * wl.ry, thick],
      color: tyreColor,
      ...(tyreMaterial ? { material: tyreMaterial } : {}),
    };
    const rim: RecipePart = {
      shape: 'cylinder',
      axis: 'z',
      at: [wl.x, wl.y, zSide],
      size: [2 * wl.rx * RIM_RATIO, 2 * wl.ry * RIM_RATIO, thick + RIM_PROUD],
      color: RIM_COLOR,
      material: 'metal',
    };
    parts.push(tyre, rim);
    if (mirror) {
      parts.push({ ...tyre, at: [wl.x, wl.y, -zSide] });
    }
  }
  // Budget backstop: smallest decals go first, the body and structural parts never.
  const { parts: fit, dropped } = enforcePartBudget(parts, [main], {
    max: partCeiling(recipe),
  });
  if (dropped.length > 0) {
    console.info(
      `[vision] 3D wheels: budget dropped ${dropped.length} part(s): ${dropped.join(' ')}`
    );
  }
  return { ...recipe, parts: fit };
}
