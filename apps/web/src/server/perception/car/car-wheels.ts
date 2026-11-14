import 'server-only';

import type { CarPlan, CarWheel } from '@/lib/car-plan';
import { fitCircle } from '../mask-wheels';
import type { GridView } from '../recon/views';

/**
 * Wheels measured on the drawings (PQ-T76), pure. On the profile a wheel is where the silhouette
 * touches the ground; between two wheels the body's underside stands higher (the clearance). The
 * silhouette's bottom edge below that underside is the lower arc of the tyre: a circle fitted on it
 * gives the centre and the radius, whatever the colours (a black tyre under a black body included).
 * The rim is the lighter disk inside the tyre. On the front view the two tyres are the two runs that
 * touch the ground: they give the track and a tyre's width.
 *
 * Views are canonical (`recon/views.ts`): the side has column 0 at the back, rows top → bottom. The
 * side must have square cells (a drawing resampled at its own aspect), so its circles stay circles.
 */

/** A column touches the ground when its lowest drawn cell is this share of the rows from the bottom. */
export const GROUND_TOL = 0.012;
/** Contact runs closer than this share of the columns are one wheel (a tread gap, a mud flap). */
export const CONTACT_GAP = 0.02;
/** A contact run narrower than this share of the columns is not a wheel (a speck, a mud flap). */
export const CONTACT_MIN = 0.01;
/** A fitted tyre radius outside this range (share of the rows) is not a wheel. */
export const WHEEL_R_MIN = 0.08;
export const WHEEL_R_MAX = 0.45;
/** A fitted circle whose rms residual passes this share of its radius is a ragged arc, not a tyre. */
export const WHEEL_RMS_MAX = 0.12;
/** Shadow cells: the lower share of the rows looked at, the darkening range, the colour residual. */
export const SHADOW_ROWS = 0.2;
export const SHADOW_K: readonly [number, number] = [0.4, 0.97];
export const SHADOW_RESIDUAL = 14;
/**
 * On a tinted paper (chroma at least `SHADOW_TINT_MIN`) the contact shadow under a tyre, darker
 * than `SHADOW_K[0]`, is told from a neutral tyre by its tint: it keeps at least half the paper's.
 * Darkening down to `SHADOW_K_TINTED` is then shadow.
 */
export const SHADOW_TINT_MIN = 15;
export const SHADOW_K_TINTED = 0.2;
/** Fewest arc points a fit needs. */
const ARC_MIN_POINTS = 6;
/** A rim is this much lighter (luma) than the tyre round it. */
export const RIM_CONTRAST = 40;

type Run = { a: number; b: number };

const luma = (v: GridView, i: number) =>
  0.299 * v.rgb[i * 3]! + 0.587 * v.rgb[i * 3 + 1]! + 0.114 * v.rgb[i * 3 + 2]!;
const toHex = (c: readonly number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Lowest drawn row of each column (-1 when the column is empty). */
export function bottomEdge(v: GridView): Int32Array {
  const out = new Int32Array(v.cols).fill(-1);
  for (let c = 0; c < v.cols; c++)
    for (let r = v.rows - 1; r >= 0; r--)
      if (v.mask[r * v.cols + c]) {
        out[c] = r;
        break;
      }
  return out;
}

/** Runs of columns touching the ground, small gaps closed, specks dropped. */
export function contactRuns(v: GridView, bottom: Int32Array = bottomEdge(v)): Run[] {
  let ground = -1;
  for (const b of bottom) ground = Math.max(ground, b);
  if (ground < 0) return [];
  const tol = Math.max(1, Math.round(GROUND_TOL * v.rows));
  const runs: Run[] = [];
  for (let c = 0; c < v.cols; c++) {
    if (bottom[c]! < ground - tol) continue;
    const last = runs[runs.length - 1];
    if (last && c - last.b <= Math.max(1, Math.round(CONTACT_GAP * v.cols))) last.b = c;
    else runs.push({ a: c, b: c });
  }
  const min = Math.max(1, Math.round(CONTACT_MIN * v.cols));
  return runs.filter((r) => r.b - r.a + 1 >= min);
}

/** Median of a list (0 when empty). */
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
};

/**
 * Row of the body's underside between the outer wheels: median bottom of the columns between two
 * contact runs that do not touch the ground. Null with fewer than two runs.
 */
export function sillRow(bottom: Int32Array, runs: ReadonlyArray<Run>): number | null {
  if (runs.length < 2) return null;
  const between: number[] = [];
  for (let k = 0; k + 1 < runs.length; k++) {
    const [a, b] = [runs[k]!.b + 1, runs[k + 1]!.a - 1];
    // The middle half of the gap: away from the arcs of both wheels.
    const q = Math.floor((b - a) / 4);
    for (let c = a + q; c <= b - q; c++) if (bottom[c]! >= 0) between.push(bottom[c]!);
  }
  return between.length ? median(between) : null;
}

/**
 * Rim radius (share of the tyre radius) and the tyre / rim colours: the luma of rings round the
 * centre, from the tyre's edge inward; the rim starts where the luma first rises `RIM_CONTRAST`
 * over the tyre's. Lower half only (the arch's shadow sits above the wheel).
 */
function rimOf(
  v: GridView,
  cx: number,
  cy: number,
  r: number
): { rim?: number; tyre: number[] | null; rimRgb: number[] | null } {
  const ring = (f0: number, f1: number) => {
    const px: number[] = [];
    let n = 0;
    for (let y = Math.floor(cy); y <= Math.ceil(cy + r * f1); y++)
      for (let x = Math.floor(cx - r * f1); x <= Math.ceil(cx + r * f1); x++) {
        if (x < 0 || y < 0 || x >= v.cols || y >= v.rows) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < r * f0 || d > r * f1) continue;
        const i = y * v.cols + x;
        if (!v.mask[i]) continue;
        px.push(luma(v, i));
        n++;
      }
    return n ? median(px) : null;
  };
  const tyreLuma = ring(0.82, 0.95);
  const median3 = (f0: number, f1: number) => {
    const ch: number[][] = [[], [], []];
    for (let y = Math.floor(cy - r * f1); y <= Math.ceil(cy + r * f1); y++)
      for (let x = Math.floor(cx - r * f1); x <= Math.ceil(cx + r * f1); x++) {
        if (x < 0 || y < 0 || x >= v.cols || y >= v.rows) continue;
        const d = Math.hypot(x - cx, y - cy);
        const i = y * v.cols + x;
        if (d < r * f0 || d > r * f1 || !v.mask[i]) continue;
        for (let k = 0; k < 3; k++) ch[k]!.push(v.rgb[i * 3 + k]!);
      }
    return ch[0]!.length ? ch.map(median) : null;
  };
  const tyre = median3(0.82, 0.95);
  if (tyreLuma === null) return { tyre, rimRgb: null };
  for (let f = 0.8; f >= 0.2; f -= 0.05) {
    const l = ring(f - 0.05, f);
    if (l !== null && l > tyreLuma + RIM_CONTRAST) {
      const rim = Math.round(f * 100) / 100;
      return { rim, tyre, rimRgb: median3(0.2 * rim, 0.8 * rim) };
    }
  }
  return { tyre, rimRgb: null };
}

/**
 * A circle fitted on an arc, then refitted without the points far off it (a tread notch, a mud
 * flap caught at the arc's end). Null with too few points.
 */
export function trimmedCircle(pts: ReadonlyArray<readonly [number, number]>) {
  if (pts.length < ARC_MIN_POINTS) return null;
  const first = fitCircle(pts);
  if (!first) return null;
  const keep = pts.filter(
    ([x, y]) => Math.abs(Math.hypot(x - first.cx, y - first.cy) - first.r) <= 2 * first.rms + 1
  );
  return keep.length >= ARC_MIN_POINTS && keep.length < pts.length
    ? (fitCircle(keep) ?? first)
    : first;
}

/**
 * Drops the drawn shadow under the object (PQ-T76): in the lower `SHADOW_ROWS` of the view, a cell
 * whose colour is the paper's darkened (k × paper, k in `SHADOW_K`, within `SHADOW_RESIDUAL`) is
 * paper in shade, not object. A tyre is darker than any shadow; a body has its own hue.
 */
export function dropShadow(v: GridView, paper: readonly [number, number, number]): GridView {
  const pp = paper[0] ** 2 + paper[1] ** 2 + paper[2] ** 2;
  if (!pp) return v;
  const pm = (paper[0] + paper[1] + paper[2]) / 3;
  const tint = [paper[0] - pm, paper[1] - pm, paper[2] - pm];
  const tt = tint[0]! ** 2 + tint[1]! ** 2 + tint[2]! ** 2;
  const tinted = Math.sqrt(tt) >= SHADOW_TINT_MIN;
  const kMin = tinted ? SHADOW_K_TINTED : SHADOW_K[0];
  const mask = v.mask.slice();
  for (let r = Math.floor(v.rows * (1 - SHADOW_ROWS)); r < v.rows; r++)
    for (let c = 0; c < v.cols; c++) {
      const i = r * v.cols + c;
      if (!mask[i]) continue;
      const p = [v.rgb[i * 3]!, v.rgb[i * 3 + 1]!, v.rgb[i * 3 + 2]!] as const;
      const k = (p[0] * paper[0] + p[1] * paper[1] + p[2] * paper[2]) / pp;
      if (k < kMin || k > SHADOW_K[1]) continue;
      const res = Math.hypot(p[0] - k * paper[0], p[1] - k * paper[1], p[2] - k * paper[2]);
      if (res > SHADOW_RESIDUAL) continue;
      if (k < SHADOW_K[0]) {
        // Darker than a soft shadow: shadow only if it keeps half the paper's tint.
        const m = (p[0] + p[1] + p[2]) / 3;
        const own = ((p[0] - m) * tint[0]! + (p[1] - m) * tint[1]! + (p[2] - m) * tint[2]!) / tt;
        if (own < 0.5 * k) continue;
      }
      mask[i] = 0;
    }
  return { ...v, mask };
}

/**
 * The axles on a side view (canonical, square cells), back → front, and the clearance. A contact
 * run whose arc does not fit a clean circle of a plausible size is dropped. Null without a wheel.
 */
export function readProfileWheels(
  side: GridView
): (Pick<CarPlan, 'wheels' | 'clearance'> & { look: { tyre?: string; rim?: string } }) | null {
  const bottom = bottomEdge(side);
  const runs = contactRuns(side, bottom);
  if (!runs.length) return null;
  let ground = -1;
  for (const b of bottom) ground = Math.max(ground, b);
  const sill = sillRow(bottom, runs);
  const wheels: CarWheel[] = [];
  const tyres: number[][] = [];
  const rims: number[][] = [];
  for (const run of runs) {
    // The lower arc: from the contact outward while the edge stays under the body's underside.
    const under = (c: number) =>
      c >= 0 && c < side.cols && bottom[c]! > (sill ?? ground - 0.25 * side.rows) + 1;
    let [a, b] = [run.a, run.b];
    while (under(a - 1)) a--;
    while (under(b + 1)) b++;
    // Symmetric round the contact: a bumper lip or an exhaust on one side never bends the circle.
    const centre = (run.a + run.b) / 2;
    const half = Math.min(centre - a, b - centre);
    const pts: Array<readonly [number, number]> = [];
    for (let c = Math.ceil(centre - half); c <= Math.floor(centre + half); c++)
      if (bottom[c]! >= 0) pts.push([c + 0.5, bottom[c]! + 0.5]);
    const fit = trimmedCircle(pts);
    if (!fit || fit.rms > WHEEL_RMS_MAX * fit.r) continue;
    const r = fit.r / side.rows;
    if (r < WHEEL_R_MIN || r > WHEEL_R_MAX) continue;
    const { rim, tyre, rimRgb } = rimOf(side, fit.cx, fit.cy, fit.r);
    if (tyre) tyres.push(tyre);
    if (rimRgb) rims.push(rimRgb);
    wheels.push({
      z: Math.min(1, Math.max(0, fit.cx / side.cols)),
      y: Math.min(1, Math.max(0, 1 - fit.cy / side.rows)),
      r: Math.round(r * 1000) / 1000,
      ...(rim !== undefined ? { rim } : {}),
    });
  }
  if (!wheels.length) return null;
  const mid = (xs: number[][]) =>
    xs.length ? toHex([0, 1, 2].map((k) => median(xs.map((x) => x[k]!)))) : undefined;
  const [tyre, rim] = [mid(tyres), mid(rims)];
  return {
    wheels: wheels.map((w) => ({
      ...w,
      z: Math.round(w.z * 1000) / 1000,
      y: Math.round(w.y * 1000) / 1000,
    })),
    ...(sill !== null ? { clearance: Math.round((1 - (sill + 1) / side.rows) * 1000) / 1000 } : {}),
    look: { ...(tyre ? { tyre } : {}), ...(rim ? { rim } : {}) },
  };
}

/**
 * The track on the front view (canonical, column 0 = left seen from the front): the outer edges of
 * the leftmost and rightmost runs touching the ground, and one tyre's width (mean of the two).
 * Null without two runs.
 */
export function readFrontTrack(front: GridView): CarPlan['track'] | null {
  const runs = contactRuns(front);
  if (runs.length < 2) return null;
  const [l, r] = [runs[0]!, runs[runs.length - 1]!];
  const k = (x: number) => Math.round((x / front.cols) * 1000) / 1000;
  return {
    x0: k(l.a),
    x1: k(r.b + 1),
    tyre: k((l.b - l.a + 1 + (r.b - r.a + 1)) / 2),
  };
}

/** The measured part of a car plan; null when no wheel is read on the profile. */
export function measureCar(side: GridView, front: GridView | null): CarPlan | null {
  const profile = readProfileWheels(side);
  if (!profile) return null;
  const track = front ? readFrontTrack(front) : null;
  return {
    wheels: profile.wheels,
    ...(track ? { track } : {}),
    ...(profile.clearance !== undefined ? { clearance: profile.clearance } : {}),
    ...(Object.keys(profile.look).length ? { look: profile.look } : {}),
  };
}
