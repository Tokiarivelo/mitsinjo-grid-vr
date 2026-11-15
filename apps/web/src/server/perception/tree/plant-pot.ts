import { POT_PROFILE_MAX, type PlantPlan, type PlantPot } from '@/lib/plant-plan';
import type { AlignedViews, GridView } from '../recon/views';
import { hex, isLeaf } from './tree-fit';
import { FRAME_MARGIN } from './tree-parts';

/**
 * The pot under a potted plant (VS-T25), read on its drawings: the band at the foot of the drawn
 * object that is wide, not leafy, and keeps its width up to its rim (a trunk is narrow; a trunk
 * that flares at its foot narrows to the top). The plant is then fitted on the drawing above the
 * pot's rim and stood on its soil. Pure: cells of the aligned grid in, cells out.
 */

export interface PotRead {
  /** Rows of the aligned grid: the rim (top) and the foot. */
  top: number;
  foot: number;
  /** Half width on the front (cells), one per row top → foot. */
  half: number[];
  /** Axis on the front (x) and on the side (z), cells. */
  cx: number;
  cz: number;
  /** Side half width over front half width (1 = round). */
  depth: number;
  rgb: [number, number, number];
}

/** A pot is at least this share of the drawing's rows… */
export const POT_MIN_ROWS = 0.08;
/** …at least this share of the widest drawn row wide… */
export const POT_MIN_WIDTH = 0.2;
/** …its rows carry at most this share of leaves (leaves hanging over its rim stop the band)… */
export const POT_LEAF_MAX = 0.25;
/** …its top quarter is at least this share of its widest row (a flared trunk narrows up)… */
export const POT_RIM_SHARE = 0.8;
/** Narrow rows at the very foot (a rounded base, the outline) skipped, share of the rows. */
export const POT_FOOT_SLACK = 0.04;
/** …and leaves rise above it over at least this share of the rows. */
export const POT_PLANT_MIN = 0.15;

type Span = { lo: number; hi: number; obj: number; leaf: number };

/** Object span, object cells and leafy cells of each row of one view. */
function rowSpans(v: GridView): Array<Span | null> {
  const out: Array<Span | null> = [];
  for (let y = 0; y < v.rows; y++) {
    let [lo, hi, obj, leaf] = [-1, -1, 0, 0];
    for (let x = 0; x < v.cols; x++) {
      const i = y * v.cols + x;
      if (!v.mask[i]) continue;
      if (lo < 0) lo = x;
      hi = x;
      obj++;
      if (isLeaf(v.rgb[i * 3]!, v.rgb[i * 3 + 1]!, v.rgb[i * 3 + 2]!)) leaf++;
    }
    out.push(lo < 0 ? null : { lo, hi, obj, leaf });
  }
  return out;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/** The pot at the foot of the front drawing, or null when the plant stands on the ground. */
export function findPot(aligned: AlignedViews, sideIsFront = false): PotRead | null {
  const front = aligned.views.front;
  const rows = front.rows;
  const spans = rowSpans(front);
  const width = (s: Span | null) => (s ? s.hi - s.lo + 1 : 0);
  const widest = Math.max(0, ...spans.map(width));
  if (widest <= 0) return null;
  let foot = rows - 1;
  while (foot >= 0 && !spans[foot]) foot--;
  if (foot < 0) return null;
  const potRow = (s: Span | null) =>
    !!s && width(s) >= POT_MIN_WIDTH * widest && s.leaf <= POT_LEAF_MAX * s.obj;
  // The pot's rounded foot (and the outline's last stroke) may be narrow: it starts a little up.
  const lowest = foot;
  while (foot > lowest - POT_FOOT_SLACK * rows && !potRow(spans[foot]!)) foot--;
  if (!potRow(spans[foot]!)) return null;
  foot = lowest;
  let top = foot;
  while (top - 1 >= 0 && (potRow(spans[top - 1]!) || top - 1 > lowest - POT_FOOT_SLACK * rows))
    top--;
  const height = foot - top + 1;
  if (height < POT_MIN_ROWS * rows) return null;
  // Leaves above the rim: a potted plant, not a bare pot or a wide trunk under nothing.
  const leafy = spans.slice(0, top).filter((s) => s && s.leaf > 0.3 * s.obj).length;
  if (leafy < POT_PLANT_MIN * rows) return null;
  const half = spans.slice(top, foot + 1).map((s) => width(s) / 2);
  const widestPot = Math.max(...half);
  const quarter = half.slice(0, Math.max(1, Math.round(half.length / 4)));
  if (median(quarter) < POT_RIM_SHARE * widestPot) return null;

  const cx = median(spans.slice(top, foot + 1).flatMap((s) => (s ? [(s.lo + s.hi + 1) / 2] : [])));
  let cz = aligned.D / 2;
  let depth = 1;
  if (!sideIsFront) {
    const side = rowSpans(aligned.views.right).slice(top, foot + 1);
    const ratios = side.flatMap((s, i) => (s && half[i]! > 0 ? [width(s) / 2 / half[i]!] : []));
    if (ratios.length) {
      depth = Math.max(0.3, Math.min(3, median(ratios)));
      cz = median(side.flatMap((s) => (s ? [(s.lo + s.hi + 1) / 2] : [])));
    }
  }
  // Colour: the median of the pot's cells that are not leaves.
  const ch: [number[], number[], number[]] = [[], [], []];
  for (let y = top; y <= foot; y++)
    for (let x = 0; x < front.cols; x++) {
      const i = y * front.cols + x;
      if (!front.mask[i]) continue;
      const [r, g, b] = [front.rgb[i * 3]!, front.rgb[i * 3 + 1]!, front.rgb[i * 3 + 2]!];
      if (isLeaf(r, g, b)) continue;
      ch[0].push(r);
      ch[1].push(g);
      ch[2].push(b);
    }
  return {
    top,
    foot,
    half,
    cx,
    cz,
    depth,
    rgb: [median(ch[0]), median(ch[1]), median(ch[2])],
  };
}

/** The aligned views cut to their first `rows` rows (the plant above the pot's rim). */
export function cropRows(aligned: AlignedViews, rows: number): AlignedViews {
  const cut = (v: GridView): GridView => ({
    cols: v.cols,
    rows,
    rgb: v.rgb.slice(0, v.cols * rows * 3),
    mask: v.mask.slice(0, v.cols * rows),
  });
  const { front, right, back, left } = aligned.views;
  return {
    ...aligned,
    H: rows,
    views: {
      front: cut(front),
      right: cut(right),
      ...(back ? { back: cut(back) } : {}),
      ...(left ? { left: cut(left) } : {}),
    },
  };
}

/**
 * A plant fitted on the rows above the rim (`rows` of `H`) put back in the whole box: heights
 * lifted over the pot, radii and widths re-scaled to the whole box's largest side. Same frame
 * (`FRAME_MARGIN`) as `buildPlant`.
 */
export function raisePlant(
  plant: PlantPlan,
  grid: { W: number; H: number; D: number },
  rows: number
): PlantPlan {
  const M = FRAME_MARGIN;
  const { W, H, D } = grid;
  const a = (H - rows) / (H * M);
  const b = rows / H;
  const y = (s: number) => Math.min(1, Math.max(0, a + s * b));
  const k = Math.max(W, rows, D) / Math.max(W, H, D);
  const P = (p: readonly [number, number, number]): [number, number, number] => [
    p[0],
    y(p[1]),
    p[2],
  ];
  const R = (r: number) => r * k;
  return {
    ...plant,
    stems: plant.stems.map((s) => ({ ...s, points: s.points.map(P), r: s.r.map(R) })),
    masses: plant.masses.map((m) => ({ ...m, c: P(m.c), r: [m.r[0], m.r[1] * b, m.r[2]] })),
    ...(plant.strands
      ? {
          strands: plant.strands.map((s) => ({
            ...s,
            top: P(s.top),
            bottom: y(s.bottom),
            width: Math.max(0.002, R(s.width)),
          })),
        }
      : {}),
    ...(plant.leaves
      ? {
          leaves: plant.leaves.map((l) => ({
            ...l,
            base: P(l.base),
            tip: P(l.tip),
            width: Math.max(0.002, R(l.width)),
            ...(l.mid ? { mid: l.mid.map(P) } : {}),
          })),
        }
      : {}),
    ...(plant.tiers
      ? {
          tiers: plant.tiers.map((t) => ({
            y0: y(t.y0),
            y1: y(t.y1),
            r: Math.max(0.005, R(t.r)),
          })),
        }
      : {}),
  };
}

/** The pot as the plan stores it: axis, outline foot → rim (at most `POT_PROFILE_MAX` points). */
export function potPlan(pot: PotRead, grid: { W: number; H: number; D: number }): PlantPot {
  const M = FRAME_MARGIN;
  const { W, H, D } = grid;
  const [fW, fH, fD] = [W * M, H * M, D * M];
  const big = Math.max(fW, fH, fD);
  const n = pot.half.length;
  const keep = Math.min(POT_PROFILE_MAX, n);
  const profile: Array<[number, number]> = [];
  for (let j = 0; j < keep; j++) {
    // Foot first: the last row of the band, up to its rim.
    const i = n - 1 - Math.round((j * (n - 1)) / Math.max(1, keep - 1));
    const row = pot.top + i;
    // The foot row's bottom edge stands on the ground; the rim row's top edge is the rim.
    const edge = j === 0 ? row + 1 : j === keep - 1 ? row : row + 0.5;
    profile.push([
      Math.min(1, Math.max(0, (H - edge) / fH)),
      Math.min(0.5, Math.max(0.005, pot.half[i]! / big)),
    ]);
  }
  return {
    c: [
      Math.min(1, Math.max(0, (pot.cx + (fW - W) / 2) / fW)),
      Math.min(1, Math.max(0, (pot.cz + (fD - D) / 2) / fD)),
    ],
    profile,
    ...(Math.abs(pot.depth - 1) > 0.08 ? { depth: pot.depth } : {}),
    color: hex(pot.rgb),
  };
}
