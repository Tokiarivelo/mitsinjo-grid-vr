import 'server-only';

import {
  CAR_LEVELS,
  CAR_STATIONS,
  type CarBody,
  type CarPlan,
  type CarWheel,
  type CarWindow,
} from '@/lib/car-plan';
import { inPolygon } from '@/lib/car-mesh';
import { dominantColor } from '../house/house-fit';
import type { GridView } from '../recon/views';
import { bottomEdge } from './car-wheels';
import type { CarReading } from './car-tools';

/**
 * The car fitted on its drawings (PQ-T76), pure. The pixels decide every shape: the body's profile
 * is the side silhouette (top and underside per station, wheel arches cut over the measured
 * wheels), its cross-section the front silhouette (mirrors capped), its taper the view from above.
 * The team's reading only adds what pixels cannot name: the windows (converted into the model's
 * frame, kept inside the silhouette), the kind, and where to sample the paint and the glass.
 *
 * Views are canonical (`recon/views.ts`): the side has column 0 at the back; the front column 0 at
 * the left seen from the front; the view from above rows back → front.
 */

/** A wheel arch clears the tyre by this share of its radius. */
export const ARCH_CLEARANCE = 1.12;
/** Thinnest body kept at a station (share of the height): a nose tip, a bumper end. */
export const BODY_MIN = 0.02;

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const toHex = (c: readonly number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Drawn span (first, last column) of a row; null when empty. */
function rowSpan(v: GridView, r: number): [number, number] | null {
  let [a, b] = [-1, -1];
  for (let c = 0; c < v.cols; c++)
    if (v.mask[r * v.cols + c]) {
      if (a < 0) a = c;
      b = c;
    }
  return a < 0 ? null : [a, b];
}

/** Topmost drawn row of each column (-1 when empty). */
function topEdge(v: GridView): Int32Array {
  const out = new Int32Array(v.cols).fill(-1);
  for (let c = 0; c < v.cols; c++)
    for (let r = 0; r < v.rows; r++)
      if (v.mask[r * v.cols + c]) {
        out[c] = r;
        break;
      }
  return out;
}

/**
 * The profile on the side: top and underside per station (shares of the height, ground → top),
 * the underside raised over each wheel to its arch. Null when the side is empty.
 */
export function fitProfile(
  side: GridView,
  wheels: ReadonlyArray<CarWheel>,
  stations = CAR_STATIONS
): Pick<CarBody, 'z0' | 'z1' | 'top' | 'bottom'> | null {
  const top = topEdge(side);
  const bottom = bottomEdge(side);
  let [c0, c1] = [-1, -1];
  for (let c = 0; c < side.cols; c++)
    if (top[c]! >= 0) {
      if (c0 < 0) c0 = c;
      c1 = c;
    }
  if (c0 < 0 || c1 <= c0) return null;
  const [z0, z1] = [c0 / side.cols, (c1 + 1) / side.cols];
  // Length per unit height (square cells): turns a z share into height units round a wheel.
  const k = side.cols / side.rows;
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (let i = 0; i < stations; i++) {
    const z = z0 + ((z1 - z0) * i) / (stations - 1);
    const c = Math.min(c1, Math.max(c0, Math.round(z * side.cols - 0.5)));
    const t = top[c]! >= 0 ? 1 - top[c]! / side.rows : 0;
    let b = bottom[c]! >= 0 ? 1 - (bottom[c]! + 1) / side.rows : 0;
    for (const w of wheels) {
      const dz = (z - w.z) * k;
      const R = w.r * ARCH_CLEARANCE;
      if (Math.abs(dz) < R) b = Math.max(b, w.y + Math.sqrt(R * R - dz * dz));
    }
    b = Math.min(b, t - BODY_MIN);
    tops.push(round3(clamp01(t)));
    bottoms.push(round3(clamp01(b)));
  }
  return { z0: round3(z0), z1: round3(z1), top: tops, bottom: bottoms };
}

/**
 * Half-width per level on the front (share of the width, ground → top). Rows of the upper half are
 * capped at the widest row of the lower half: wing mirrors stick out there, the body does not.
 */
export function fitSection(front: GridView, levels = CAR_LEVELS): number[] | null {
  const width = (r: number) => {
    const s = rowSpan(front, r);
    return s ? (s[1] - s[0] + 1) / front.cols : 0;
  };
  let low = 0;
  for (let r = Math.floor(front.rows / 2); r < front.rows; r++) low = Math.max(low, width(r));
  if (!low) return null;
  const half: number[] = [];
  for (let j = 0; j < levels; j++) {
    const y = j / (levels - 1);
    const r = Math.min(front.rows - 1, Math.round((1 - y) * (front.rows - 1)));
    const w = r < front.rows / 2 ? Math.min(width(r), low) : width(r);
    half.push(round3(Math.min(0.5, w / 2)));
  }
  return half;
}

/** Width per station on the view from above, over its widest (1 = full width). */
export function fitTaper(
  top: GridView,
  z0: number,
  z1: number,
  stations = CAR_STATIONS
): number[] | null {
  const widths: number[] = [];
  for (let i = 0; i < stations; i++) {
    const z = z0 + ((z1 - z0) * i) / (stations - 1);
    const r = Math.min(top.rows - 1, Math.max(0, Math.round(z * top.rows - 0.5)));
    const s = rowSpan(top, r);
    widths.push(s ? s[1] - s[0] + 1 : 0);
  }
  const max = Math.max(...widths);
  return max ? widths.map((w) => round3(w / max)) : null;
}

/** The body measured on the drawings; null without a profile and a section. */
export function fitCarBody(
  side: GridView,
  front: GridView | null,
  top: GridView | null,
  wheels: ReadonlyArray<CarWheel>
): CarBody | null {
  const profile = fitProfile(side, wheels);
  const half = front ? fitSection(front) : null;
  if (!profile || !half) return null;
  const taper = top ? fitTaper(top, profile.z0, profile.z1) : null;
  return { ...profile, half, ...(taper ? { taper } : {}) };
}

/** Interpolated value of a station array at a z share. */
const atZ = (body: CarBody, arr: readonly number[], z: number) => {
  const f = ((z - body.z0) / Math.max(1e-6, body.z1 - body.z0)) * (arr.length - 1);
  const i = Math.max(0, Math.min(arr.length - 2, Math.floor(f)));
  const t = Math.max(0, Math.min(1, f - i));
  return arr[i]! * (1 - t) + arr[i + 1]! * t;
};

/**
 * The team's windows in the model's frame: a drawing share x becomes the canonical one (a view
 * drawn mirrored reads backwards), y turns up; on a side each point is kept under the roof line.
 * Windows on the view from above are left out.
 */
export function fitWindows(
  reading: Pick<CarReading, 'windows'>,
  mirrored: Partial<Record<CarWindow['view'], boolean>>,
  body: CarBody | null
): CarWindow[] {
  const out: CarWindow[] = [];
  for (const w of reading.windows) {
    if (w.view === 'top') continue;
    const view: CarWindow['view'] = w.view;
    const side = view === 'right' || view === 'left';
    const points = w.points.map(([x, y]): [number, number] => {
      const s = mirrored[view] ? 1 - x : x;
      let up = 1 - y;
      if (side && body) up = Math.min(up, atZ(body, body.top, s));
      return [round3(clamp01(s)), round3(clamp01(up))];
    });
    out.push({ view, points });
  }
  return out.slice(0, 24);
}

/**
 * Paint and glass colours on the side view: the paint is the dominant colour of the body under the
 * belt line, wheels and windows left out; the glass the dominant colour inside the side windows.
 */
export function fitColors(
  side: GridView,
  plan: Pick<CarPlan, 'wheels' | 'body' | 'windows'>,
  belt: number | null
): { paint?: string; glass?: string } {
  const k = side.cols / side.rows;
  const onWheel = (s: number, y: number) =>
    plan.wheels.some((w) => Math.hypot((s - w.z) * k, y - w.y) < w.r * ARCH_CLEARANCE);
  const glassOn = (plan.windows ?? []).filter((w) => w.view === 'right' || w.view === 'left');
  const inGlass = (s: number, y: number) => glassOn.some((w) => inPolygon([s, y], w.points));
  const beltY = belt ?? 0.55;
  const paint = dominantColor(
    side,
    (s, y) =>
      y < beltY &&
      !onWheel(s, y) &&
      !inGlass(s, y) &&
      (!plan.body || y > atZ(plan.body, plan.body.bottom, s) + 0.02)
  );
  const glass = glassOn.length ? dominantColor(side, (s, y) => inGlass(s, y)) : null;
  return { ...(paint ? { paint: toHex(paint) } : {}), ...(glass ? { glass: toHex(glass) } : {}) };
}

/** The measured plan completed by the team's reading: kind, windows, paint and glass. */
export function applyCarReading(
  plan: CarPlan,
  reading: CarReading | null,
  side: GridView,
  mirrored: Partial<Record<CarWindow['view'], boolean>>
): CarPlan {
  const windows = reading ? fitWindows(reading, mirrored, plan.body ?? null) : [];
  const withWindows: CarPlan = {
    ...plan,
    ...(reading?.kind ? { kind: reading.kind } : {}),
    ...(windows.length ? { windows } : {}),
  };
  // The belt line read on the side drawing, as a height share (the drawing's y runs down).
  const belt = reading?.body?.heights.belt;
  const colors = fitColors(side, withWindows, belt !== undefined ? 1 - belt : null);
  return Object.keys(colors).length
    ? { ...withWindows, look: { ...withWindows.look, ...colors } }
    : withWindows;
}
