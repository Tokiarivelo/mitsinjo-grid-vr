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
  isWheelPart,
  MASK_YAW_HARD_MAX,
  MASK_YAW_MAX,
  PART_KEEP_VOLUME,
  PART_MIRROR_MIN_Z,
  photoToObject,
  type MaskMapGeom,
  type Pt,
} from './mask-geometry';
import { segmentWall, type FaceRect } from './wall-openings';

/** A mask rotated past this (degrees from the axes) is not a facade rectangle: skipped. */
export const PANEL_TILT_MAX = 20;

/** Smallest panel side (object units); smaller masks are handles and trim, not panels. */
export const PANEL_MIN_SIZE = 0.03;

/** Most panels used per concept (a side shows ≤ 3 windows; more are SAM duplicates). */
export const PANEL_WINDOWS_MAX = 3;
export const PANEL_DOORS_MAX = 2;

/** Decal thickness, the `facade()` convention (proud 0.015, embedded 0.005). */
export const PANEL_THICK = 0.02;
export const PANEL_PROUD = 0.005;

/**
 * Convex hull (monotone chain), counter-clockwise without repeated endpoints. Empty with fewer
 * than 3 distinct points. Pure.
 */
export function convexHull(points: ReadonlyArray<Pt>): Array<[number, number]> {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  const upper: Array<[number, number]> = [];
  for (const [x, y] of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, [x, y]) <= 0
    ) {
      lower.pop();
    }
    lower.push([x, y]);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const [x, y] = pts[i]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, [x, y]) <= 0
    ) {
      upper.pop();
    }
    upper.push([x, y]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export interface MinAreaRect {
  cx: number;
  cy: number;
  /** Long-ish side along `angle` (see below), in the points' units. */
  w: number;
  h: number;
  /** Direction of the w side in degrees, within ±45° of horizontal. */
  angle: number;
}

/**
 * Minimum-area enclosing rectangle (rotating calipers over the convex hull): centre, sides and
 * the w-side direction. Null with fewer than 3 hull points. Pure.
 */
export function minAreaRect(points: ReadonlyArray<Pt>): MinAreaRect | null {
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  let best: { cx: number; cy: number; w: number; h: number; theta: number; area: number } | null =
    null;
  for (let i = 0; i < hull.length; i++) {
    const [x0, y0] = hull[i]!;
    const [x1, y1] = hull[(i + 1) % hull.length]!;
    const theta = Math.atan2(y1 - y0, x1 - x0);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    let mnA = Infinity;
    let mxA = -Infinity;
    let mnB = Infinity;
    let mxB = -Infinity;
    for (const [px, py] of hull) {
      const a = px * c + py * s;
      const b = -px * s + py * c;
      if (a < mnA) mnA = a;
      if (a > mxA) mxA = a;
      if (b < mnB) mnB = b;
      if (b > mxB) mxB = b;
    }
    const area = (mxA - mnA) * (mxB - mnB);
    if (!best || area < best.area) {
      const ma = (mnA + mxA) / 2;
      const mb = (mnB + mxB) / 2;
      best = {
        cx: ma * c - mb * s,
        cy: ma * s + mb * c,
        w: mxA - mnA,
        h: mxB - mnB,
        theta,
        area,
      };
    }
  }
  const b = best!;
  // Report the w side within ±45° of horizontal (swap when the winning edge runs vertical).
  let deg = (b.theta * 180) / Math.PI;
  deg = ((deg + 90) % 180) - 90;
  let { w, h } = b;
  if (Math.abs(deg) > 45) {
    [w, h] = [h, w];
    deg = deg > 0 ? deg - 90 : deg + 90;
  }
  return { cx: b.cx, cy: b.cy, w, h, angle: deg };
}

/** Panel rectangle in object fractions from the mask outline (min-area rect) or its box. */
function maskPanel(
  geom: MaskMapGeom,
  mask: PartMask
): { x: number; y: number; w: number; h: number } | null {
  let cx = 0;
  let cy = 0;
  let w = 0;
  let h = 0;
  if (mask.outline) {
    const ring = pathToRings(mask.outline)[0];
    const pts = (ring ?? []).map(([u, v]) => cropToPhoto(geom, u, v));
    const rect = minAreaRect(pts);
    // A rotated mask (skylight, gable glass) is not a facade rectangle: skip, no box fallback
    // (its axis box would pave the pillars with glass).
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
  return { x: m.x, y: m.y, w: wu, h: hu };
}

const volume = (p: RecipePart) => p.size[0] * p.size[1] * p.size[2];

/** Largest non-front box above the body's middle: the cabin shell behind the side glass. */
export function vehicleShell(
  parts: ReadonlyArray<RecipePart>,
  main: RecipePart
): RecipePart | null {
  let shell: RecipePart | null = null;
  for (const p of parts) {
    if (p === main || p.shape !== 'box' || p.at[1] <= main.at[1]) continue;
    if (!shell || volume(p) > volume(shell)) shell = p;
  }
  return shell;
}

/** Thin boxes on the walls' front face: the `facade()` spread windows and doors. */
function facadePanels(parts: ReadonlyArray<RecipePart>, main: RecipePart): RecipePart[] {
  const face = main.at[2] + main.size[2] / 2;
  return parts.filter(
    (p) =>
      p !== main &&
      p.shape === 'box' &&
      p.size[2] <= 0.05 &&
      p.at[2] >= face - 0.03 &&
      p.at[2] <= face + 0.06 &&
      Math.abs(p.at[0] - main.at[0]) <= main.size[0] / 2 &&
      Math.abs(p.at[1] - main.at[1]) <= main.size[1] / 2
  );
}

interface PlacedPanel {
  concept: 'window' | 'door';
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Measured glass and door panels (PR-2.7, PR-2.12): each window/door mask becomes a thin
 * panel at its min-area rectangle on the shell (vehicle) or walls (house) face, replacing the
 * `spread()` guesses — the vehicle cabin shell takes the body colour behind them. Panels never
 * float: centres outside the face span are skipped, sizes clamp into it. ≤ 17° both sides while
 * decals fund the room (house backs mirror the front), else near only, else the fitting prefix;
 * 17–60° near only; structure never drops for panels.
 * `frontal`: the masks come from the validated 2D facade (a straight-on elevation), so they
 * are already front-face fractions: no un-turning by the yaw, no yaw limit, back mirrored.
 * Returns the recipe unchanged (same reference) without usable masks, past the hard yaw
 * limit, or for another archetype. Pure: same inputs → same recipe.
 */
export function withMaskPanels(
  archetype: KitArchetype,
  recipe: ObjectRecipe,
  masks: ReadonlyArray<PartMask>,
  geom: MaskMapGeom,
  { frontal = false }: { frontal?: boolean } = {}
): ObjectRecipe {
  if (archetype !== 'vehicle' && archetype !== 'house') return recipe;
  if (!frontal && Math.abs(recipe.yaw ?? 0) > MASK_YAW_HARD_MAX) return recipe;
  // ≤ 17° the far side mirrors the near one (both archetypes); 17–60° the near side only.
  const allowMirror = frontal || Math.abs(recipe.yaw ?? 0) <= MASK_YAW_MAX;
  const CEIL = partCeiling(recipe);
  const main = recipe.parts[frontPartIndex(recipe)]!;

  // The face behind the panels + the colours they reuse.
  const shell = archetype === 'vehicle' ? vehicleShell(recipe.parts, main) : main;
  if (!shell) return recipe;
  const face = shell.at[2] + shell.size[2] / 2;
  const removed = archetype === 'house' ? facadePanels(recipe.parts, main) : [];
  let glass: { color: string; material?: RecipePart['material'] } | null =
    archetype === 'vehicle'
      ? {
          color: shell.color,
          ...(shell.material ? { material: shell.material } : {}),
        }
      : null;
  let doorPaint: { color: string; material?: RecipePart['material'] } | null = null;
  if (archetype === 'house') {
    if (removed.length === 0) return recipe;
    const heights = removed.map((p) => p.size[1]).sort((a, b) => a - b);
    const median = heights[Math.floor(heights.length / 2)]!;
    const short = removed.find((p) => p.size[1] <= median)!;
    glass = { color: short.color, ...(short.material ? { material: short.material } : {}) };
    const tall = removed.find((p) => p.size[1] > median);
    const prism = recipe.parts.find((p) => p.shape === 'prism');
    const doorLike = tall ?? prism;
    doorPaint = doorLike
      ? { color: doorLike.color, ...(doorLike.material ? { material: doorLike.material } : {}) }
      : { color: main.color, ...(main.material ? { material: main.material } : {}) };
  }

  // Usable panels: on the face span, clamped into it.
  const x0 = shell.at[0] - shell.size[0] / 2;
  const x1 = shell.at[0] + shell.size[0] / 2;
  const y0 = shell.at[1] - shell.size[1] / 2;
  const y1 = shell.at[1] + shell.size[1] / 2;
  const yaw = frontal ? 0 : (recipe.yaw ?? 0);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const { w, d } = recipe.proportions;
  const panels: PlacedPanel[] = [];
  let windows = 0;
  let doors = 0;
  for (const mask of masks) {
    if (mask.concept !== 'window' && mask.concept !== 'door') continue;
    if (archetype === 'vehicle' && mask.concept !== 'window') continue;
    if (mask.concept === 'window' && windows >= PANEL_WINDOWS_MAX) continue;
    if (mask.concept === 'door' && doors >= PANEL_DOORS_MAX) continue;
    const rect = maskPanel(geom, mask);
    if (!rect) continue;
    // Un-project like the wheels: the render turns x by the yaw around the panel plane.
    // Un-turning comes before the clamp so panels never poke past the span.
    let ux = rect.x;
    let uw = rect.w;
    if (yaw !== 0 && cos > 1e-6) {
      ux = (rect.x * w - face * d * sin) / cos / w;
      uw = rect.w / cos;
    }
    if (ux < x0 - 0.03 || ux > x1 + 0.03 || rect.y < y0 - 0.03 || rect.y > y1 + 0.03) continue;
    const cw = Math.min(uw, x1 - x0);
    const ch = Math.min(rect.h, y1 - y0);
    const px = Math.min(x1 - cw / 2, Math.max(x0 + cw / 2, ux));
    const py = Math.min(y1 - ch / 2, Math.max(y0 + ch / 2, rect.y));
    if (cw < PANEL_MIN_SIZE || ch < PANEL_MIN_SIZE) continue;
    panels.push({ concept: mask.concept, x: px, y: py, w: cw, h: ch });
    if (mask.concept === 'window') windows++;
    else doors++;
  }
  if (panels.length === 0) return recipe;
  const paint = (c: PlacedPanel['concept']) => (c === 'window' ? glass! : (doorPaint ?? glass!));

  // PR-2.17: real openings — the wall segments around the measured holes and each leaf sits
  // centred in its hole instead of floating on the face. Whole-wall atomic: when strips +
  // leaves do not fit the room the facade removal freed, fall through to today's overlays.
  if (archetype === 'house') {
    const seg = segmentWall(
      { x: shell.at[0], y: shell.at[1], w: shell.size[0], h: shell.size[1] },
      panels
    );
    if (seg) {
      const holeConcept = (h: FaceRect): PlacedPanel['concept'] =>
        panels.find(
          (p) => Math.abs(p.x - h.x) * 2 < p.w + h.w && Math.abs(p.y - h.y) * 2 < p.h + h.h
        )?.concept ?? 'window';
      const rest = recipe.parts.filter((p) => !removed.includes(p) && p !== main);
      if (rest.length + seg.strips.length + seg.holes.length <= CEIL) {
        const stripParts: RecipePart[] = seg.strips.map((s) => ({
          shape: 'box',
          at: [s.x, s.y, main.at[2]],
          size: [s.w, s.h, main.size[2]],
          color: main.color,
          ...(main.material ? { material: main.material } : {}),
        }));
        // The wall node survives as its largest strip (keeps `front`, parents the leaves).
        let wall = stripParts[0]!;
        for (const s of stripParts) {
          if (s.size[0] * s.size[1] > wall.size[0] * wall.size[1]) wall = s;
        }
        wall.front = true;
        const leaves: RecipePart[] = seg.holes.map((h) => {
          const pc = paint(holeConcept(h));
          return {
            shape: 'box',
            at: [h.x, h.y, main.at[2]],
            size: [h.w, h.h, PANEL_THICK],
            color: pc.color,
            ...(pc.material ? { material: pc.material } : {}),
          };
        });
        return { ...recipe, parts: [...rest, ...stripParts, ...leaves] };
      }
    }
  }

  // Room for the panels: soft-drop decals (never structure) to fit both sides, else near
  // only, else the fitting prefix; a structure-full recipe keeps its template panels.
  const kept = recipe.parts.filter((p) => !removed.includes(p));
  // Wheels and roof furniture are never displaced by panels (a window must not eat a wheel).
  const mainTop = main.at[1] + main.size[1] / 2;
  const protect = kept.filter(
    (p) =>
      p === main ||
      p === shell ||
      isWheelPart(p, main.at[1]) ||
      p.at[1] - p.size[1] / 2 >= mainTop - 0.01
  );
  // Both sides while fundable decals cover both, else near only, else the fitting prefix.
  // The count is decided before dropping so the both-sides attempt never eats decals for
  // panels unplaced.
  const fundable = (list: ReadonlyArray<RecipePart>) =>
    list.filter(
      (p) => !protect.includes(p) && (volume(p) < PART_KEEP_VOLUME || p.at[2] < -PART_MIRROR_MIN_Z)
    ).length;
  const both = allowMirror ? panels.length * 2 : panels.length;
  const shortBoth = kept.length + both - CEIL;
  const shortNear = kept.length + panels.length - CEIL;
  let base = { parts: kept, dropped: [] as string[] };
  let mirror = false;
  let use = panels;
  if (shortBoth <= 0) {
    mirror = allowMirror;
  } else if (fundable(kept) >= shortBoth) {
    base = enforcePartBudget(kept, protect, { max: CEIL - both, soft: true });
    mirror = allowMirror;
  } else {
    if (shortNear > 0) {
      base =
        fundable(kept) >= shortNear
          ? enforcePartBudget(kept, protect, { max: CEIL - panels.length, soft: true })
          : enforcePartBudget(kept, protect, { max: 0, soft: true });
    }
    const room = CEIL - base.parts.length;
    if (room <= 0) return recipe;
    use = panels.slice(0, room);
  }
  const mk = (pp: PlacedPanel, z: number): RecipePart => {
    const pc = paint(pp.concept);
    return {
      shape: 'box',
      at: [pp.x, pp.y, z],
      size: [pp.w, pp.h, PANEL_THICK],
      color: pc.color,
      ...(pc.material ? { material: pc.material } : {}),
    };
  };
  const parts = base.parts.slice();
  const shellIdx = parts.indexOf(shell);
  if (archetype === 'vehicle') {
    // The cabin shell behind the glass takes the body colour (roof included).
    parts[shellIdx] = {
      ...shell,
      color: main.color,
      ...(main.material ? { material: main.material } : {}),
    };
    if (!main.material) delete (parts[shellIdx] as Partial<RecipePart>).material;
  }
  for (const pp of use) {
    parts.push(mk(pp, face + PANEL_PROUD));
    if (mirror) parts.push(mk(pp, -(face + PANEL_PROUD)));
  }
  const { parts: fit, dropped } = enforcePartBudget(parts, protect, { max: CEIL });
  const allDropped = [...base.dropped, ...dropped];
  if (allDropped.length > 0) {
    console.info(
      `[vision] 3D panels: budget dropped ${allDropped.length} part(s): ${allDropped.join(' ')}`
    );
  }
  return { ...recipe, parts: fit };
}
