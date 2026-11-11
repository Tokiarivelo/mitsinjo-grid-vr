import 'server-only';

import type { KitArchetype } from '@/lib/object-kit';
import { clipRing, ringRange } from '@/lib/hull';
import {
  frontPartIndex,
  MAX_COMPONENTS,
  type ObjectRecipe,
  type PartMask,
  type RecipePart,
} from '@/lib/object-shape';
import { pathToRings } from '@/lib/vision';
import {
  deltaE2000,
  hexToLab,
  insideRings,
  LIT_SHARE,
  linearToHex,
  srgbToLinear,
} from './color-measure';
import { confidence, mixColor } from './fusion';
import { isWheelPart, type MaskMapGeom } from './mask-geometry';
import { vehicleShell } from './mask-panels';
import type { RgbGrid } from './model-score';
import { pixelBox } from './shape-colors';
import type { PhotoForRegions } from './region';

/** Region grid: 96² cells over the box, the colour sampling budget. */
export const REGION_GRID = 96;

/** Fewer cells than this in a region → too noisy, the role colour stays. */
export const MIN_REGION_PIXELS = 12;

/**
 * How much a box-only mask shrinks for colour sampling (each side): box corners around a round
 * wheel are background, and box edges bleed. Outline masks are used exactly.
 */
export const BOX_REGION_ERODE = 0.2;

export interface RegionMeasure {
  /**
   * Median colour of the region's lit cells, in linear light: the brightest `LIT_SHARE` of them, so a part
   * half in shadow reads its own colour, not the mix (PQ-T10).
   */
  color: string;
  /** Cells inside the region (drives the fusion confidence). */
  pixels: number;
  /** Share of the cells read as shadow (under `SHADOW_RATIO` of the lit luminance), 0–1; reported apart. */
  shadow: number;
}

/** A cell is shadow when its luminance is under this share of the lit cells' median luminance. */
export const SHADOW_RATIO = 0.6;

export interface RegionColors {
  /** Per input mask (same order): null when too few cells fell inside. */
  regions: Array<RegionMeasure | null>;
  /** Outline cells outside every mask: null without an outline or too few cells. */
  rest: RegionMeasure | null;
}

interface PreparedMask {
  box: { x0: number; y0: number; x1: number; y1: number };
  rings: Array<Array<readonly [number, number]>>;
}

const median = (values: number[]): number => {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Relative luminance of a linear-light colour (Rec. 709). */
const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Colour of a region read on its lit surface (PQ-T10): the median of its brightest `LIT_SHARE` cells, and the
 * share of cells that are shadow (clearly darker than that lit median). Pure.
 */
export function litMeasure(rs: number[], gs: number[], bs: number[]): RegionMeasure {
  const n = rs.length;
  const order = rs.map((_, i) => i).sort((a, b) => lum(b) - lum(a));
  function lum(i: number) {
    return luminance(rs[i]!, gs[i]!, bs[i]!);
  }
  const lit = order.slice(0, Math.max(1, Math.ceil(n * LIT_SHARE)));
  const color = linearToHex(
    median(lit.map((i) => rs[i]!)),
    median(lit.map((i) => gs[i]!)),
    median(lit.map((i) => bs[i]!))
  );
  const litLum = median(lit.map(lum));
  const dark = order.filter((i) => lum(i) < litLum * SHADOW_RATIO).length;
  return { color, pixels: n, shadow: n ? Math.round((dark / n) * 100) / 100 : 0 };
}

/**
 * Colours measured per mask region on a box grid (PR-2.8): each cell lands in the first mask
 * containing it (outline-tested, box-eroded without an outline) or in the rest pool (outline
 * cells outside every mask). Pure: same inputs → same colours.
 */
export function measureRegionColors(
  grid: RgbGrid,
  outline: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  masks: ReadonlyArray<PartMask>,
  geom: MaskMapGeom,
  photo: Pick<PhotoForRegions, 'width' | 'height'>,
  box: MaskMapGeom['box']
): RegionColors {
  const prepared: PreparedMask[] = masks.map((m) => {
    const erode = m.outline ? 0 : BOX_REGION_ERODE;
    const ix = m.box.w * erode;
    const iy = m.box.h * erode;
    return {
      box: {
        x0: m.box.x + ix,
        y0: m.box.y + iy,
        x1: m.box.x + m.box.w - ix,
        y1: m.box.y + m.box.h - iy,
      },
      rings: m.outline ? pathToRings(m.outline).filter((r) => r.length >= 3) : [],
    };
  });
  const reds = masks.map((): number[] => []);
  const greens = masks.map((): number[] => []);
  const blues = masks.map((): number[] => []);
  const restR: number[] = [];
  const restG: number[] = [];
  const restB: number[] = [];
  const { left, top, width, height } = pixelBox(photo, box);
  const { cols, rows, rgb } = grid;
  for (let j = 0; j < rows; j++) {
    const photoY = top + ((j + 0.5) / rows) * height;
    const v = photoY / photo.height;
    for (let i = 0; i < cols; i++) {
      const photoX = left + ((i + 0.5) / cols) * width;
      const u = photoX / photo.width;
      if (outline.length > 0 && !insideRings(u, v, outline)) continue;
      const cu = (photoX - geom.crop.left) / geom.crop.width;
      const cv = (photoY - geom.crop.top) / geom.crop.height;
      let hit = -1;
      for (let k = 0; k < prepared.length; k++) {
        const pm = prepared[k]!;
        if (cu < pm.box.x0 || cu > pm.box.x1 || cv < pm.box.y0 || cv > pm.box.y1) continue;
        if (pm.rings.length > 0 && !insideRings(cu, cv, pm.rings)) continue;
        hit = k;
        break;
      }
      const o = (j * cols + i) * 3;
      const [lr, lg, lb] = srgbToLinear(rgb[o]!, rgb[o + 1]!, rgb[o + 2]!);
      if (hit >= 0) {
        reds[hit]!.push(lr);
        greens[hit]!.push(lg);
        blues[hit]!.push(lb);
      } else if (outline.length > 0) {
        restR.push(lr);
        restG.push(lg);
        restB.push(lb);
      }
    }
  }
  return {
    regions: masks.map((_, k) =>
      reds[k]!.length >= MIN_REGION_PIXELS ? litMeasure(reds[k]!, greens[k]!, blues[k]!) : null
    ),
    rest: restR.length >= MIN_REGION_PIXELS ? litMeasure(restR, restG, restB) : null,
  };
}

/** Mask box (crop fractions) → object-fraction rect, for part overlap. */
function maskObjectRect(
  geom: MaskMapGeom,
  box: PartMask['box']
): { x0: number; y0: number; x1: number; y1: number } {
  const W = geom.photoW;
  const H = geom.photoH;
  const px = (cu: number) => geom.crop.left + cu * geom.crop.width;
  const py = (cv: number) => geom.crop.top + cv * geom.crop.height;
  const bw = geom.box.w * W;
  const bh = geom.box.h * H;
  return {
    x0: (px(box.x) - geom.box.x * W) / bw - 0.5,
    x1: (px(box.x + box.w) - geom.box.x * W) / bw - 0.5,
    y0: 0.5 - (py(box.y + box.h) - geom.box.y * H) / bh,
    y1: 0.5 - (py(box.y) - geom.box.y * H) / bh,
  };
}

const inside = (r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) =>
  x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/**
 * Recolours the recipe from its regions (PR-2.8): thin glass/door panels take their mask's
 * colour, the biggest wheel per masked site takes the tyre colour (rims keep their alloy),
 * and the front body — plus a body-unified cabin shell — takes the rest colour. Each colour
 * mixes by its pixel confidence, so thin evidence barely moves the role colour. Returns the
 * recipe unchanged (same reference) when nothing applies. Pure: same inputs → same recipe.
 */
export function withRegionColors(
  archetype: KitArchetype,
  recipe: ObjectRecipe,
  masks: ReadonlyArray<PartMask>,
  measured: RegionColors,
  geom: MaskMapGeom
): ObjectRecipe {
  if (archetype !== 'vehicle' && archetype !== 'house') return recipe;
  const main = recipe.parts[frontPartIndex(recipe)]!;
  const rects = masks.map((m) => maskObjectRect(geom, m.box));
  const shell = archetype === 'vehicle' ? vehicleShell(recipe.parts, main) : null;
  const shellFollows = !!shell && shell.color.toLowerCase() === main.color.toLowerCase();
  const recoloured = new Map<number, string>();
  const applied: string[] = [];
  masks.forEach((mask, k) => {
    const region = measured.regions[k];
    if (!region) return;
    const conf = confidence.colors(region.pixels);
    if (!(conf > 0)) return;
    const rect = rects[k]!;
    if (mask.concept === 'window' || mask.concept === 'door') {
      const before = recoloured.size;
      recipe.parts.forEach((p, i) => {
        if (recoloured.has(i) || p === main || p.shape !== 'box' || p.size[2] > 0.05) return;
        if (!inside(rect, p.at[0], p.at[1])) return;
        recoloured.set(i, mixColor(region.color, p.color, conf));
      });
      if (recoloured.size > before) {
        applied.push(`${mask.concept} ${region.color} (${region.pixels} px)`);
      }
      return;
    }
    if (mask.concept === 'wheel') {
      const sites = recipe.parts
        .map((p, i) => ({ p, i }))
        .filter(
          ({ p, i }) =>
            !recoloured.has(i) && isWheelPart(p, main.at[1]) && inside(rect, p.at[0], p.at[1])
        );
      if (sites.length === 0) return;
      const radii = sites.map(({ p }) => Math.max(p.size[0], p.size[1]) / 2);
      const maxR = Math.max(...radii);
      sites.forEach(({ p, i }, s) => {
        // The biggest wheel per site is the tyre; smaller concentric ones are rims.
        if (radii[s]! >= 0.8 * maxR) recoloured.set(i, mixColor(region.color, p.color, conf));
      });
      applied.push(`${mask.concept} ${region.color} (${region.pixels} px)`);
    }
  });
  if (measured.rest) {
    const conf = confidence.colors(measured.rest.pixels);
    if (conf > 0) {
      const mainIdx = recipe.parts.indexOf(main);
      recoloured.set(mainIdx, mixColor(measured.rest.color, main.color, conf));
      if (shell && shellFollows) {
        recoloured.set(
          recipe.parts.indexOf(shell),
          mixColor(measured.rest.color, shell.color, conf)
        );
      }
      applied.push(`body ${measured.rest.color} (${measured.rest.pixels} px)`);
    }
  }
  if (recoloured.size === 0) return recipe;
  console.info(`[vision] 3D region colours: ${applied.join(', ')}`);
  return {
    ...recipe,
    parts: recipe.parts.map((p, i) =>
      recoloured.has(i) ? { ...p, color: recoloured.get(i)! } : p
    ),
  };
}

/** SAM concepts of the upper colour zone of a hull body (PQ-T25): the roof of a car, the crown of a tree. */
export const HULL_TONE_CONCEPTS: Readonly<Partial<Record<KitArchetype, ReadonlyArray<string>>>> = {
  vehicle: ['roof'],
  tree: ['tree crown'],
  bush: ['foliage'],
};

/** Two zones count as two tones above this colour distance (ΔE 2000); under it the body stays one colour. */
export const TONE_DELTA_E = 10;

/** The upper zone must cover between these shares of the body height, else it is the body or noise. */
export const TONE_MIN_SHARE = 0.1;
export const TONE_MAX_SHARE = 0.85;

/** Thinnest zone the split keeps, in object units (the schema's `MIN_EXTENT` with margin). */
const TONE_MIN_EXTENT = 0.02;

/**
 * One zone of a hull body: both rings cut to `y ∈ [lo, hi]` (part unit space) and stretched back to
 * the unit box, so the part's `at` / `size` carry the zone. Null when a ring vanishes or the zone is thin.
 */
function hullZone(main: RecipePart, lo: number, hi: number): RecipePart | null {
  const points = clipRing(main.points!, -0.5, 0.5, lo, hi);
  const section = clipRing(main.section!, -0.5, 0.5, lo, hi);
  if (points.length < 3 || section.length < 3) return null;
  const [a0, a1] = ringRange(points, 1);
  const [b0, b1] = ringRange(section, 1);
  const y0 = Math.min(a0, b0);
  const y1 = Math.max(a1, b1);
  const span = y1 - y0;
  if (span * main.size[1] < TONE_MIN_EXTENT) return null;
  const mid = (y0 + y1) / 2;
  const unit = (ring: Array<[number, number]>) =>
    ring.map((p) => [p[0], (p[1] - mid) / span] as [number, number]);
  return {
    ...main,
    at: [main.at[0], main.at[1] + main.size[1] * mid, main.at[2]],
    size: [main.size[0], main.size[1] * span, main.size[2]],
    points: unit(points),
    section: unit(section),
  };
}

/**
 * Two-tone hull body (PQ-T25, closes PH-T8): when the photo's upper region (roof, crown) is a clearly
 * different colour from the rest of the body, the hull is cut at the region's lower edge into a lower part
 * (keeps `front`) and an upper part appended last, each in its own measured colour. The extra part is
 * appended so every other part keeps its index. Same reference when it does not apply. Pure.
 */
export function withHullTones(
  recipe: ObjectRecipe,
  masks: ReadonlyArray<PartMask>,
  measured: RegionColors,
  geom: MaskMapGeom,
  concepts: ReadonlyArray<string>
): ObjectRecipe {
  const mainIdx = frontPartIndex(recipe);
  const main = recipe.parts[mainIdx]!;
  if (main.shape !== 'hull' || !main.points || !main.section) return recipe;
  if (recipe.parts.length >= MAX_COMPONENTS || !measured.rest) return recipe;
  let top = -1;
  masks.forEach((m, k) => {
    const r = measured.regions[k];
    if (!r || !concepts.includes(m.concept)) return;
    if (top < 0 || r.pixels > measured.regions[top]!.pixels) top = k;
  });
  if (top < 0) return recipe;
  const region = measured.regions[top]!;
  const topConf = confidence.colors(region.pixels);
  const restConf = confidence.colors(measured.rest.pixels);
  if (!(topConf > 0) || !(restConf > 0)) return recipe;
  const rect = maskObjectRect(geom, masks[top]!.box);
  const cut = (rect.y0 - main.at[1]) / main.size[1];
  const share = 0.5 - cut;
  if (share < TONE_MIN_SHARE || share > TONE_MAX_SHARE) return recipe;
  const upperColor = mixColor(region.color, main.color, topConf);
  const lowerColor = mixColor(measured.rest.color, main.color, restConf);
  if (deltaE2000(hexToLab(upperColor), hexToLab(lowerColor)) < TONE_DELTA_E) return recipe;
  const lower = hullZone(main, -0.5, cut);
  const upper = hullZone(main, cut, 0.5);
  if (!lower || !upper) return recipe;
  console.info(`[vision] 3D two-tone body: ${upperColor} above ${lowerColor}`);
  const parts = recipe.parts.map((p, i) => (i === mainIdx ? { ...lower, color: lowerColor } : p));
  const { front: _front, ...rest } = upper;
  parts.push({ ...rest, color: upperColor, status: 'measured' });
  return { ...recipe, parts };
}
