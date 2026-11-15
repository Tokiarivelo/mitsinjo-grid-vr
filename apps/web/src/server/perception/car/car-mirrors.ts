import 'server-only';

import { CAR_MIRROR_LEVELS, type CarMirror, type CarPlan } from '@/lib/car-plan';
import type { GridView } from '../recon/views';

/**
 * The wing mirrors measured on the front drawing (PQ-T80), pure. A mirror is a short bump on the
 * outline of the front: rows that stand out from the body just above and just below them. It is
 * found by a top-hat of the outline (what an opening `MIRROR_TALL` high takes away), so a cab that
 * is wide over a long height is body and a mirror is not. The rows found are then left out of the
 * body's section (`fitSection`), and the mirror is built as its own piece (`carMesh`).
 */

/** Tallest mirror, share of the car's height: anything taller is body. */
export const MIRROR_TALL = 0.22;
/** A row is part of a mirror when it stands out by this share of the width. */
export const MIRROR_OUT = 0.012;
/** A mirror's tip stands out by at least this share of the width. */
export const MIRROR_TIP = 0.025;
/** Heights (ground → top) a mirror's middle may be at: over the wings, under the roof. */
export const MIRROR_BAND = [0.5, 0.92] as const;
/** Rows of a mirror that do not stand out (a thin arm) are bridged up to this many. */
export const MIRROR_GAP = 2;

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export interface MirrorRead {
  /** First and last row of the front the mirrors take (top → down): left out of the section. */
  rows: readonly [number, number];
  /** The mirror's outline, without its place along the car. */
  outline: Omit<CarMirror, 'z'>;
}

/** What an opening `size` rows high takes away from a profile (white top-hat). */
function topHat(e: Float64Array, size: number): Float64Array {
  const n = e.length;
  const h = Math.max(1, Math.floor(size / 2));
  const pass = (src: Float64Array, pick: (a: number, b: number) => number) => {
    const out = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      let v = src[r]!;
      for (let k = Math.max(0, r - h); k <= Math.min(n - 1, r + h); k++) v = pick(v, src[k]!);
      out[r] = v;
    }
    return out;
  };
  const opened = pass(pass(e, Math.min), Math.max);
  return e.map((v, r) => Math.max(0, v - opened[r]!));
}

/** The mirrors on the front (canonical view, square cells); null when its outline shows none. */
export function fitMirrors(front: GridView, levels = CAR_MIRROR_LEVELS): MirrorRead | null {
  const { cols, rows } = front;
  const first = new Int32Array(rows).fill(-1);
  const last = new Int32Array(rows).fill(-1);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (front.mask[r * cols + c]) {
        if (first[r]! < 0) first[r] = c;
        last[r] = c;
      }
  // The car's centre line: the middle of its widest row in the lower half (the body, no mirror).
  let [wide, centre] = [0, cols / 2];
  for (let r = Math.floor(rows / 2); r < rows; r++) {
    const w = first[r]! < 0 ? 0 : last[r]! - first[r]! + 1;
    if (w > wide) [wide, centre] = [w, (first[r]! + last[r]! + 1) / 2];
  }
  if (!wide) return null;
  const out = Math.max(2, MIRROR_OUT * cols);
  let best: { r0: number; r1: number; area: number; e: Float64Array } | null = null;
  for (const side of [-1, 1] as const) {
    const e = new Float64Array(rows);
    for (let r = 0; r < rows; r++)
      if (first[r]! >= 0) e[r] = Math.max(0, side < 0 ? centre - first[r]! : last[r]! + 1 - centre);
    const hat = topHat(e, Math.round(MIRROR_TALL * rows));
    let r = 0;
    while (r < rows) {
      if (hat[r]! < out) {
        r++;
        continue;
      }
      let [r1, area, tip] = [r, 0, 0];
      for (let k = r; k < rows && k - r1 <= MIRROR_GAP + 1; k++)
        if (hat[k]! >= out) {
          r1 = k;
          area += hat[k]!;
          tip = Math.max(tip, hat[k]!);
        }
      const mid = 1 - (r + r1 + 1) / 2 / rows;
      if (
        tip >= MIRROR_TIP * cols &&
        mid >= MIRROR_BAND[0] &&
        mid <= MIRROR_BAND[1] &&
        (!best || area > best.area)
      )
        best = { r0: r, r1, area, e };
      r = r1 + 1;
    }
  }
  if (!best) return null;
  const { r0, r1, e } = best;
  const reach: number[] = [];
  for (let j = 0; j < levels; j++) {
    const r = Math.round(r1 - ((r1 - r0) * j) / (levels - 1));
    reach.push(round3(Math.min(0.5, e[r]! / cols)));
  }
  return {
    rows: [Math.max(0, r0 - 1), Math.min(rows - 1, r1 + 1)],
    outline: { y0: round3(1 - (r1 + 1) / rows), y1: round3(1 - r0 / rows), reach },
  };
}

/** The cabin has risen this share of the way from the mirror's top to the roof where it stands. */
export const MIRROR_RISE = 1 / 3;

/**
 * Where the mirrors stand along the car: at the front corner of the side glass (the foot of the
 * windscreen pillar), never ahead of the station where the profile has risen `MIRROR_RISE` of the
 * way from their top to the roof (a mirror stands beside the cabin, on the door, not over the
 * bonnet). Null when neither is known.
 */
export function mirrorStation(
  plan: Pick<CarPlan, 'body' | 'windows'>,
  outline: Pick<CarMirror, 'y1'>
): number | null {
  const body = plan.body;
  let cabin: number | null = null;
  if (body) {
    const n = body.top.length;
    const over = outline.y1 + (Math.max(...body.top) - outline.y1) * MIRROR_RISE;
    for (let i = n - 1; i >= 0 && cabin === null; i--)
      if (body.top[i]! >= over) cabin = body.z0 + ((body.z1 - body.z0) * i) / (n - 1);
  }
  let glass: number | null = null;
  for (const w of plan.windows ?? [])
    if (w.view === 'right' || w.view === 'left')
      for (const [z] of w.points) glass = Math.max(glass ?? 0, z);
  const z = glass !== null && cabin !== null ? Math.min(glass, cabin) : (glass ?? cabin);
  return z === null ? null : round3(Math.min(1, Math.max(0, z)));
}
