import 'server-only';

import {
  MAX_COMPONENTS,
  MAX_RECIPE_PARTS,
  type ObjectRecipe,
  type PartMask,
  type RecipePart,
} from '@/lib/object-shape';
import type { NormBox } from '@/lib/vision';
import { insideRings } from './color-measure';
import type { CropRect } from './shape-crop';

/** Geometry mapping SAM's crop fractions onto the recipe's box fractions. */
export interface MaskMapGeom {
  photoW: number;
  photoH: number;
  box: NormBox;
  crop: CropRect;
}

export type Pt = readonly [number, number];

/** Crop fractions → photo pixels. The resize to the SAM image keeps fractions. */
export function cropToPhoto(geom: MaskMapGeom, cu: number, cv: number): Pt {
  return [geom.crop.left + cu * geom.crop.width, geom.crop.top + cv * geom.crop.height];
}

/**
 * The part masks that belong to the object (PQ-T37): centre inside its outline (`rings`, photo fractions).
 * SAM segments the whole crop, so a neighbour's windows or a background building come back too; counted,
 * they read as « seen, not built » and lower part recall. No outline → every mask is kept.
 */
export function masksOnObject(
  masks: ReadonlyArray<PartMask>,
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  geom: MaskMapGeom
): PartMask[] {
  if (!rings.length || !(geom.photoW > 0) || !(geom.photoH > 0)) return [...masks];
  return masks.filter((m) => {
    const [px, py] = cropToPhoto(geom, m.box.x + m.box.w / 2, m.box.y + m.box.h / 2);
    return insideRings(px / geom.photoW, py / geom.photoH, rings);
  });
}

/**
 * Photo pixels → object fractions (centred box fractions, y up), plus the per-pixel unit on
 * each axis (a photo circle has different x/y radii in box units when the box is not square).
 */
export function photoToObject(
  geom: MaskMapGeom,
  px: number,
  py: number
): { x: number; y: number; rbx: number; rby: number } | null {
  const { photoW: W, photoH: H, box } = geom;
  const bw = box.w * W;
  const bh = box.h * H;
  if (!(bw > 0) || !(bh > 0)) return null;
  return {
    x: (px - box.x * W) / bw - 0.5,
    y: 0.5 - (py - box.y * H) / bh,
    rbx: 1 / bw,
    rby: 1 / bh,
  };
}

/** Parts at least this big (object volume) survive the 12-part budget backstop. */
export const PART_KEEP_VOLUME = 0.02;

/**
 * Top of the roof at its highest (PR-2.14): the max part top above the eave, else the eave.
 * Excluded parts (the main body, chimney stacks) never count as roof.
 */
export function roofTopAbove(
  parts: ReadonlyArray<RecipePart>,
  eave: number,
  exclude: (p: RecipePart) => boolean = () => false
): number {
  let top = eave;
  for (const p of parts) {
    if (exclude(p)) continue;
    const t = p.at[1] + p.size[1] / 2;
    if (t > eave && t > top) top = t;
  }
  return top;
}

/**
 * Shared yaw gates for the measured passes (PR-2.12: profile, wheels, panels, chimney — one
 * constant, not 0.26 here and 0.3 there). ≤ 17° the photo reads like a front view: profile
 * bodies, measured wheels/panels/stacks, mirror to the far side. 17–60° only near-side panels
 * place (no mirror: the far side is guesswork, and wheels/stacks shear too far). Past 60° the
 * template is kept (even panels would clamp into a span the photo barely shows).
 */
export const MASK_YAW_MAX = 0.3;
/** Past this measured yaw (≈ 60°) even near-side panels stop: keep the template. */
export const MASK_YAW_HARD_MAX = 1.05;

/** |z| below this is the centre plane, not a far side. */
export const PART_MIRROR_MIN_Z = 0.05;

/**
 * Most parts a recipe may hold while a mask pass adds measured ones (PQ-T21): `MAX_COMPONENTS` when the
 * extra parts come from SAM masks, `MAX_RECIPE_PARTS` for a Spark-imagined list (`source: 'free'`) and for
 * the passes that only deduce (hidden sides), so an imagined or inferred part never takes a measured one's room.
 */
export function partCeiling(recipe: Pick<ObjectRecipe, 'source'>): number {
  return recipe.source === 'free' ? MAX_RECIPE_PARTS : MAX_COMPONENTS;
}

/** Template wheels: z-axis cylinders below the body's middle (PR-2.2/2.6/2.7 share this). */
export function isWheelPart(p: RecipePart, midY: number): boolean {
  return p.shape === 'cylinder' && p.axis === 'z' && p.at[1] < midY;
}

const volume = (p: RecipePart) => p.size[0] * p.size[1] * p.size[2];
const describe = (p: RecipePart) => `${p.shape}@[${p.at.map((v) => v.toFixed(2)).join(',')}]`;

/**
 * Part-budget backstop for the measured passes (PR-2.6…2.7): while over `max`, drops the
 * smallest part that is either a decal (below `PART_KEEP_VOLUME`) or far-side mirrored, never
 * a protected one; hard mode (`soft: false`) falls back to the smallest unprotected part when
 * only structure remains, soft mode stops there. Pure.
 */
export function enforcePartBudget(
  parts: ReadonlyArray<RecipePart>,
  protect: ReadonlyArray<RecipePart>,
  { max = MAX_RECIPE_PARTS, soft = false }: { max?: number; soft?: boolean } = {}
): { parts: RecipePart[]; dropped: string[] } {
  const out = parts.slice();
  const dropped: string[] = [];
  while (out.length > max) {
    let drop = -1;
    let dropVol = Infinity;
    out.forEach((p, i) => {
      if (protect.includes(p)) return;
      const v = volume(p);
      if (v < dropVol && (v < PART_KEEP_VOLUME || p.at[2] < -PART_MIRROR_MIN_Z)) {
        drop = i;
        dropVol = v;
      }
    });
    if (drop < 0 && !soft) {
      out.forEach((p, i) => {
        if (protect.includes(p)) return;
        if (volume(p) < dropVol) {
          drop = i;
          dropVol = volume(p);
        }
      });
    }
    if (drop < 0) break;
    dropped.push(describe(out[drop]!));
    out.splice(drop, 1);
  }
  return { parts: out, dropped };
}
