import 'server-only';

import { carShoulder } from '@/lib/car-mesh';
import { CAR_MIRROR_LEVELS, type CarMirror, type CarPlan } from '@/lib/car-plan';
import type { GridView } from '../recon/views';
import type { CarReading } from './car-tools';

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
  // The body under the mirror: half-way between its edge just above and just below those rows.
  const edge = (r: number) => e[Math.min(rows - 1, Math.max(0, r))]!;
  const body = Math.min((edge(r0 - 2) + edge(r1 + 2)) / 2, Math.max(...reach) * cols);
  return {
    rows: [Math.max(0, r0 - 1), Math.min(rows - 1, r1 + 1)],
    outline: {
      y0: round3(1 - (r1 + 1) / rows),
      y1: round3(1 - r0 / rows),
      reach,
      root: round3(Math.min(0.5, body / cols)),
    },
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

/** A mirror the team read is this wide over its height when no drawing shows it from the front. */
export const MIRROR_WIDE = 1.4;
/** Colour of a mirror the team read without naming one: dark plastic. */
export const MIRROR_COLOR = '#202225';
/** The team's place along the car is kept within this of the one the body gives. */
export const MIRROR_Z_SLACK = 0.15;

/** A rounded housing between the body's edge and the tip, bottom → top. */
function housing(root: number, tip: number, levels: number): number[] {
  return Array.from({ length: levels }, (_, j) => {
    const t = (2 * j) / (levels - 1) - 1;
    return round3(root + (tip - root) * (0.55 + 0.45 * Math.sqrt(1 - t * t)));
  });
}

export interface MirrorTold {
  /** Their place along the car, from the side drawings (model frame); null when not read there. */
  z: number | null;
  /** Their outline from the team's boxes, in a plain colour (not measured on pixels). */
  outline: Omit<CarMirror, 'z'> | null;
}

/**
 * The wing mirrors the car team found (`details` of kind `mirror`): the model looks for them on
 * every drawing, so a front drawn without mirrors, or with mirrors that do not break its outline,
 * still gets them. The side boxes give their place along the car (a drawing read mirrored is
 * turned back); the front (else the back) boxes their heights and reach; with side boxes only, the
 * heights and a width of `MIRROR_WIDE` × their height. `heightOverWidth` = the front's box.
 */
export function readMirrors(
  reading: Pick<CarReading, 'details'>,
  mirrored: Partial<Record<'front' | 'right' | 'back' | 'left', boolean>>,
  heightOverWidth: number,
  levels = CAR_MIRROR_LEVELS
): MirrorTold | null {
  const found = reading.details.filter((d) => d.kind === 'mirror' && d.box[2] > d.box[0]);
  if (!found.length) return null;
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const sides = found.filter((d) => d.view === 'right' || d.view === 'left');
  const z = sides.length
    ? round3(
        mean(
          sides.map((d) => {
            const x = (d.box[0] + d.box[2]) / 2;
            return mirrored[d.view as 'right' | 'left'] ? 1 - x : x;
          })
        )
      )
    : null;
  // Seen from an end, a mirror is a box on one side of the centre line.
  const ends = (['front', 'back'] as const)
    .map((v) => found.filter((d) => d.view === v && (d.box[0] - 0.5) * (d.box[2] - 0.5) > 0))
    .find((list) => list.length);
  const from = ends ?? sides;
  if (!from.length) return { z, outline: null };
  const y0 = 1 - mean(from.map((d) => d.box[3]));
  const y1 = 1 - mean(from.map((d) => d.box[1]));
  if (!(y1 > y0)) return { z, outline: null };
  const far = (d: (typeof from)[number]) =>
    Math.max(Math.abs(d.box[0] - 0.5), Math.abs(d.box[2] - 0.5));
  const near = (d: (typeof from)[number]) =>
    Math.min(Math.abs(d.box[0] - 0.5), Math.abs(d.box[2] - 0.5));
  const root = ends ? mean(ends.map(near)) : 0.4;
  const tip = Math.min(
    0.5,
    ends ? mean(ends.map(far)) : root + (y1 - y0) * heightOverWidth * MIRROR_WIDE
  );
  if (!(tip > root)) return { z, outline: null };
  const reach = housing(root, tip, levels);
  const color = from.find((d) => d.color)?.color?.toLowerCase() ?? MIRROR_COLOR;
  return {
    z,
    outline: { y0: round3(y0), y1: round3(y1), reach, root: round3(root), color },
  };
}

/** A standard mirror is this high, share of the car's height. */
export const MIRROR_HIGH = 0.08;
/** Heights (ground → top) the foot of a standard mirror is kept in: a van's side has no shoulder. */
export const MIRROR_BELT = [0.45, 0.7] as const;

/**
 * The mirrors of a car nobody saw any on (no bump on the front's outline, no reading by the team,
 * or a team that named none): a road vehicle carries them, so it gets standard ones in a plain
 * colour. They sit on the shoulder (the foot of the side glass when the team read it), `MIRROR_HIGH`
 * high and `MIRROR_WIDE` × that wide, out of the body's side there. Null for a kind `other` (a
 * tractor, a cart) and without a body. `heightOverWidth` = the front's box.
 */
export function standardMirrors(
  plan: Pick<CarPlan, 'body' | 'windows' | 'kind'>,
  heightOverWidth: number,
  levels = CAR_MIRROR_LEVELS
): Omit<CarMirror, 'z'> | null {
  const body = plan.body;
  if (!body || plan.kind === 'other') return null;
  const { widest, shoulder, roof } = carShoulder(body);
  let belt = shoulder;
  let glass: number | null = null;
  for (const w of plan.windows ?? [])
    if (w.view === 'right' || w.view === 'left')
      for (const [, y] of w.points) glass = Math.min(glass ?? 1, y);
  if (glass !== null) belt = glass;
  const y0 = Math.min(Math.max(belt, MIRROR_BELT[0]), MIRROR_BELT[1], roof - MIRROR_HIGH);
  if (!(y0 > 0)) return null;
  const wide = MIRROR_HIGH * heightOverWidth * MIRROR_WIDE;
  // A body that fills the box leaves no room on the drawing: the outline keeps its size inside
  // the body's edge, and the mesh moves it out with the flank (`mirrorStand`).
  const tip = Math.min(0.5, body.half[widest]! + wide);
  const root = Math.max(0, tip - wide);
  return {
    y0: round3(y0),
    y1: round3(y0 + MIRROR_HIGH),
    reach: housing(root, tip, levels),
    root: round3(root),
    color: MIRROR_COLOR,
  };
}

/**
 * The mirrors of a plan: the outline measured on the front's pixels, else the one the team read,
 * else standard ones (`standardMirrors`, when `heightOverWidth` is given); along the car where the
 * team saw them on a side drawing when that agrees with the body (`MIRROR_Z_SLACK`), else where
 * the body puts them. Null when they cannot be placed, or for a kind that carries none.
 */
export function placeMirrors(
  plan: Pick<CarPlan, 'body' | 'windows' | 'kind'>,
  seen: Omit<CarMirror, 'z'> | null,
  told: MirrorTold | null,
  heightOverWidth?: number
): CarMirror | null {
  const outline =
    seen ??
    told?.outline ??
    (heightOverWidth === undefined ? null : standardMirrors(plan, heightOverWidth));
  if (!outline) return null;
  const built = mirrorStation(plan, outline);
  const read = told?.z ?? null;
  const z =
    read !== null && (built === null || Math.abs(read - built) <= MIRROR_Z_SLACK) ? read : built;
  return z === null ? null : { z, ...outline };
}
