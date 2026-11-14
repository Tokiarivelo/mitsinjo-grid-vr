import {
  HOUSE_CHIMNEYS_MAX,
  HOUSE_OPENINGS_MAX,
  HOUSE_PIERS_MAX,
  HOUSE_VOLUMES_MAX,
  HOUSE_WALL_FINISHES,
  HOUSE_WALLS,
  HousePlanSchema,
  finishLook,
  isOpenVolume,
  type HouseFinish,
  type HouseMaterial,
  type HouseOpening,
  type HousePier,
  type HousePlan,
  type HouseVolume,
  type HouseWall,
} from '@/lib/house-plan';
import type { GridView } from '../recon/views';
import type { HouseReading, ReadFinish, ReadOpening } from './house-prompt';

/**
 * The house specialist's reading brought to the model (PQ-T72): every measure turned from its
 * image's own shares into the model's frame (x left → right, y ground → top, z back → front),
 * the block edges snapped on the silhouettes' steps, the ridges on the drawn roof line, every
 * opening snapped on its frame in the drawing and given to the block whose wall holds it, the
 * colours measured on the drawings. Pure.
 */

/** A block edge moves to a silhouette step at most this far (share of the side). */
export const EDGE_SNAP = 0.035;
/** A silhouette step: the outline's height jumps by at least this share between two columns. */
export const STEP_JUMP = 0.04;
/** An outer block edge this close to the box is put on it. */
export const OUTER_SNAP = 0.06;
/** A ridge moves to the drawn roof line when they differ by at most this share. */
export const RIDGE_SNAP = 0.08;
/** Percentile of the outline heights over a block read as its ridge (a chimney stays out). */
export const RIDGE_PERCENTILE = 0.85;
/** A shed roof's fall is read on the outline when it drops by at least this share over the block. */
export const SHED_SLOPE_MIN = 0.03;
/** Colour distance (RGB) past which a pixel is not the wall round an opening. */
export const OPENING_CONTRAST = 55;
/** A snapped opening keeps between these shares of the area the specialist gave. */
export const OPENING_AREA = [0.35, 2.2] as const;
/** Highest deck of a veranda / porch, share of the house height (a model reads stoops far too high). */
export const DECK_MAX = 0.15;
/** A footprint cell no block covers is filled by an annex past this share of drawn roof. */
export const FOOTPRINT_FILL = 0.6;
/** Smallest annex added on the footprint (share of the plan area). */
export const FOOTPRINT_MIN_AREA = 0.02;
/** Narrowest annex (share of the plan): thinner is a roof overhang. */
export const FOOTPRINT_MIN_SIDE = 0.12;

/** Two openings of one view overlapping more than this (IoU) are one. */
export const OPENING_DUPLICATE = 0.5;

export interface HouseFitInput {
  reading: HouseReading;
  /** Canonical grid views (`AlignedViews.views`, the right only when the right drawing exists). */
  views: Partial<Record<HouseWall, GridView>>;
  /** Per drawing: true when its canonical view is the drawing mirrored (`ViewFrame.mirrored`). */
  mirrored: Partial<Record<HouseWall, boolean>>;
  /** The view from above on the grid (W × D, row 0 = back), when it agreed. */
  top?: GridView | null;
  /** Materials when the specialist named none (the colour classes' reading). */
  fallback?: { wall?: HouseMaterial; roof?: HouseMaterial };
}

/** Thickest strip of footprint along a block's side taken as that block being deeper (PQ-T74). */
export const STRIP_MAX = 0.16;
/** Share of the block's side such a strip runs along, at least. */
export const STRIP_ALONG = 0.7;

/**
 * Rectangles of the footprint no volume covers: the plan cut on every block edge and outline
 * step, each cell drawn as roof on the view from above (≥ `FOOTPRINT_FILL`) and under no block,
 * merged along x, then equal runs along z.
 */
function footprintGaps(
  volumes: ReadonlyArray<HouseVolume>,
  top: GridView,
  xSteps: number[],
  zSteps: number[]
): Array<[number, number, number, number]> {
  const cuts = (extra: number[], i: 0 | 2) =>
    [...new Set([0, 1, ...extra, ...volumes.flatMap((v) => [v.plan[i], v.plan[i + 1]!])])]
      .map(round3)
      .filter((c, k, all) => c >= 0 && c <= 1 && all.indexOf(c) === k)
      .sort((a, b) => a - b);
  const xs = cuts(xSteps, 0);
  const zs = cuts(zSteps, 2);
  const filled = (x0: number, x1: number, z0: number, z1: number) => {
    const [c0, c1] = [Math.floor(x0 * top.cols), Math.ceil(x1 * top.cols)];
    const [r0, r1] = [Math.floor(z0 * top.rows), Math.ceil(z1 * top.rows)];
    let n = 0;
    let on = 0;
    for (let r = r0; r < r1; r++)
      for (let c = c0; c < c1; c++) {
        n++;
        on += top.mask[r * top.cols + c] ? 1 : 0;
      }
    return n ? on / n : 0;
  };
  const covered = (x: number, z: number) =>
    volumes.some((v) => x > v.plan[0] && x < v.plan[1] && z > v.plan[2] && z < v.plan[3]);
  // Runs along x of empty, drawn cells, row by row.
  const runs: Array<[number, number, number, number]> = [];
  for (let j = 0; j + 1 < zs.length; j++) {
    const [z0, z1] = [zs[j]!, zs[j + 1]!];
    let start: number | null = null;
    for (let i = 0; i + 1 <= xs.length; i++) {
      const open =
        i + 1 < xs.length &&
        !covered((xs[i]! + xs[i + 1]!) / 2, (z0 + z1) / 2) &&
        filled(xs[i]!, xs[i + 1]!, z0, z1) >= FOOTPRINT_FILL;
      if (open && start === null) start = xs[i]!;
      if (!open && start !== null) {
        runs.push([start, xs[i]!, z0, z1]);
        start = null;
      }
    }
  }
  // Runs with the same x span stacked along z.
  const merged: Array<[number, number, number, number]> = [];
  for (const r of runs) {
    const prev = merged.find((m) => m[0] === r[0] && m[1] === r[1] && m[3] === r[2]);
    if (prev) prev[3] = r[3];
    else merged.push([...r]);
  }
  return merged;
}

/**
 * Blocks grown over the strips of footprint running along them (PQ-T74): a strip the reading
 * left out along most of a block's front or back (a body read shorter than its roof on the view
 * from above) is that block being deeper, not a new block. As an annex it got its own steep roof
 * in front of the walls and took the facade's windows.
 */
export function growToFootprint(
  volumes: HouseVolume[],
  top: GridView,
  xSteps: number[] = [],
  zSteps: number[] = []
): HouseVolume[] {
  const out = volumes.map((v) => ({ ...v, plan: [...v.plan] as HouseVolume['plan'] }));
  for (const [x0, x1, z0, z1] of footprintGaps(volumes, top, xSteps, zSteps)) {
    const [dx, dz] = [x1 - x0, z1 - z0];
    // Along x (a strip in front of or behind a block), then along z (beside it).
    for (const [i, thick, long] of [
      [2, dz, dx],
      [0, dx, dz],
    ] as const) {
      if (thick < FOOTPRINT_MIN_SIDE || thick > STRIP_MAX || long <= thick) continue;
      const j = i === 2 ? 0 : 2;
      const [g0, g1, a0, a1] = i === 2 ? [z0, z1, x0, x1] : [x0, x1, z0, z1];
      const host = out.find((v) => {
        if (isOpenVolume(v)) return false;
        const side = v.plan[j + 1]! - v.plan[j]!;
        const shared = Math.min(a1, v.plan[j + 1]!) - Math.max(a0, v.plan[j]!);
        const touches = Math.abs(v.plan[i]! - g1) < 1e-6 || Math.abs(v.plan[i + 1]! - g0) < 1e-6;
        return touches && shared >= STRIP_ALONG * side && shared >= STRIP_ALONG * (a1 - a0);
      });
      if (!host) continue;
      if (Math.abs(host.plan[i]! - g1) < 1e-6) host.plan[i] = g0;
      else host.plan[i + 1] = g1;
      break;
    }
  }
  return out;
}

/** Steepest roof given to an annex: rise over half its span (PQ-T74; 2 ≈ 63°). */
export const ANNEX_PITCH = 2;

/**
 * Blocks for the footprint no volume covers (`footprintGaps`), at the lowest solid's heights. A
 * narrow annex does not reach that block's ridge: its roof is no steeper than `ANNEX_PITCH`
 * (PQ-T74: two spires stood on the small back wings of a cottage). `height` = the house's height
 * as a share of its width (the front drawing's), the depth being the view from above's.
 */
export function footprintAnnexes(
  volumes: HouseVolume[],
  top: GridView,
  xSteps: number[] = [],
  zSteps: number[] = [],
  height: number | null = null
): HouseVolume[] {
  const solids = volumes.filter((v) => !isOpenVolume(v));
  if (!solids.length) return [];
  const merged = footprintGaps(volumes, top, xSteps, zSteps);
  const low = solids.reduce((a, b) => (b.eave < a.eave ? b : a));
  return (
    merged
      // A thin strip along a block is its roof's overhang on the view from above, not a block.
      .filter(
        ([x0, x1, z0, z1]) =>
          (x1 - x0) * (z1 - z0) >= FOOTPRINT_MIN_AREA &&
          Math.min(x1 - x0, z1 - z0) >= FOOTPRINT_MIN_SIDE
      )
      .map(([x0, x1, z0, z1]) => ({
        kind: 'annex' as const,
        plan: [x0, x1, z0, z1] as HouseVolume['plan'],
        eave: low.eave,
        ridge:
          low.roof === 'flat' || low.roof === 'none'
            ? low.eave
            : height
              ? round3(
                  Math.min(
                    low.ridge,
                    low.eave +
                      (ANNEX_PITCH * Math.min(x1 - x0, ((z1 - z0) * top.rows) / top.cols)) /
                        2 /
                        height
                  )
                )
              : low.ridge,
        roof: low.roof === 'none' ? ('flat' as const) : low.roof,
        ridgeAxis: x1 - x0 >= z1 - z0 ? ('x' as const) : ('z' as const),
        ...(low.roof === 'shed' && low.fall ? { fall: low.fall } : {}),
      }))
  );
}

/** Natural orientation of each drawing: whether its canonical view is mirrored by default. */
const MIRRORED_DEFAULT: Record<HouseWall, boolean> = {
  front: false,
  right: true,
  back: true,
  left: false,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Height share (ground = 0) of the outline's top in each column; 0 for an empty column. */
export function outlineHeights(g: GridView): number[] {
  const heights: number[] = [];
  for (let x = 0; x < g.cols; x++) {
    let top = g.rows;
    for (let y = 0; y < g.rows; y++)
      if (g.mask[y * g.cols + x]) {
        top = y;
        break;
      }
    heights.push(1 - top / g.rows);
  }
  return heights;
}

/** Shares where a profile steps by `jump` or more (between two cells), plus both ends. */
export function profileSteps(profile: ReadonlyArray<number>, jump = STEP_JUMP): number[] {
  const steps = [0, 1];
  for (let i = 1; i < profile.length; i++)
    if (Math.abs(profile[i]! - profile[i - 1]!) >= jump) steps.push(i / profile.length);
  return steps;
}

/** Occupancy of a plan mask along x (columns) or z (rows), as shares of the other side. */
function planProfile(top: GridView, alongX: boolean): number[] {
  const [n, m] = alongX ? [top.cols, top.rows] : [top.rows, top.cols];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let j = 0; j < m; j++) c += top.mask[alongX ? j * top.cols + i : i * top.cols + j]!;
    out.push(c / m);
  }
  return out;
}

const snapTo = (v: number, candidates: ReadonlyArray<number>, within = EDGE_SNAP) => {
  let best = v;
  let gap = within;
  for (const c of candidates) if (Math.abs(c - v) <= gap) [best, gap] = [c, Math.abs(c - v)];
  return best;
};

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};

/**
 * Side a shed roof falls toward, read on the outlines: across the front drawing (left / right)
 * or across the side drawing (front / back), whichever drops more over the block; null = flat.
 */
export function shedFallOf(
  plan: HouseVolume['plan'],
  front: ReadonlyArray<number> | null,
  side: ReadonlyArray<number> | null
): HouseWall | null {
  /** Mean of the last third minus the first third of a profile between two shares. */
  const drop = (h: ReadonlyArray<number> | null, a: number, b: number) => {
    if (!h) return 0;
    const [from, to] = [Math.floor(a * h.length), Math.ceil(b * h.length)];
    const part = h.slice(from, to);
    const third = Math.max(1, Math.floor(part.length / 3));
    if (part.length < 3) return 0;
    const mean = (xs: ReadonlyArray<number>) => xs.reduce((p, q) => p + q, 0) / xs.length;
    return mean(part.slice(-third)) - mean(part.slice(0, third));
  };
  const dx = drop(front, plan[0], plan[1]);
  // Canonical side columns run back → front.
  const dz = drop(side, plan[2], plan[3]);
  // The front first: it is the reference drawing, and a side outline often shows another block
  // (the one nearer that side) over this one.
  if (Math.abs(dx) >= SHED_SLOPE_MIN) return dx > 0 ? 'left' : 'right';
  if (Math.abs(dz) >= SHED_SLOPE_MIN) return dz > 0 ? 'back' : 'front';
  return null;
}

/** Natural image share → canonical share of a view (mirrored drawings read backwards). */
const canonical = (u: number, mirrored: boolean) => (mirrored ? 1 - u : u);

type Cells = [number, number, number, number]; // c0, c1, r0, r1 (exclusive ends, fractional)

const rgbAt = (g: GridView, i: number): [number, number, number] => [
  g.rgb[i * 3]!,
  g.rgb[i * 3 + 1]!,
  g.rgb[i * 3 + 2]!,
];
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const median3 = (px: Array<[number, number, number]>): [number, number, number] | null => {
  if (!px.length) return null;
  const at = (k: 0 | 1 | 2) => [...px.map((p) => p[k])].sort((a, b) => a - b)[px.length >> 1]!;
  return [at(0), at(1), at(2)];
};
const toHex = (c: readonly number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * An opening's box snapped on the drawing: the pixels that differ from the wall colour round it,
 * connected to its core, inside a margin round the given box. The given box when nothing fits.
 */
export function snapOpening(g: GridView, box: Cells): Cells {
  const [c0, c1, r0, r1] = box;
  const [bw, bh] = [c1 - c0, r1 - r0];
  if (bw <= 0 || bh <= 0) return box;
  const cell = (x: number, y: number) => y * g.cols + x;
  const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < g.cols && y < g.rows;
  // Wall colour: the drawn cells of a ring round the box.
  const ring: Array<[number, number, number]> = [];
  const pad = 3;
  for (let y = Math.floor(r0) - pad; y < Math.ceil(r1) + pad; y++)
    for (let x = Math.floor(c0) - pad; x < Math.ceil(c1) + pad; x++) {
      if (!inGrid(x, y) || !g.mask[cell(x, y)]) continue;
      const inside =
        x >= Math.floor(c0) && x < Math.ceil(c1) && y >= Math.floor(r0) && y < Math.ceil(r1);
      if (!inside) ring.push(rgbAt(g, cell(x, y)));
    }
  const wall = median3(ring);
  if (!wall || ring.length < 6) return box;
  const gx = Math.max(2, bw * 0.3);
  const gy = Math.max(2, bh * 0.3);
  const [sx0, sx1, sy0, sy1] = [
    Math.max(0, Math.floor(c0 - gx)),
    Math.min(g.cols, Math.ceil(c1 + gx)),
    Math.max(0, Math.floor(r0 - gy)),
    Math.min(g.rows, Math.ceil(r1 + gy)),
  ];
  const differs = (x: number, y: number) =>
    Boolean(g.mask[cell(x, y)]) && dist(rgbAt(g, cell(x, y)), wall) > OPENING_CONTRAST;
  // Seeds: differing cells in the core (the box shrunk by a quarter).
  const [k0, k1, q0, q1] = [c0 + bw / 4, c1 - bw / 4, r0 + bh / 4, r1 - bh / 4];
  const seen = new Uint8Array((sx1 - sx0) * (sy1 - sy0));
  const idx = (x: number, y: number) => (y - sy0) * (sx1 - sx0) + (x - sx0);
  const stack: Array<[number, number]> = [];
  for (let y = Math.floor(q0); y < Math.ceil(q1); y++)
    for (let x = Math.floor(k0); x < Math.ceil(k1); x++)
      if (x >= sx0 && x < sx1 && y >= sy0 && y < sy1 && differs(x, y)) {
        seen[idx(x, y)] = 1;
        stack.push([x, y]);
      }
  if (!stack.length) return box;
  let [mx0, mx1, my0, my1] = [Infinity, -Infinity, Infinity, -Infinity];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    mx0 = Math.min(mx0, x);
    mx1 = Math.max(mx1, x + 1);
    my0 = Math.min(my0, y);
    my1 = Math.max(my1, y + 1);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const [nx, ny] = [x + dx, y + dy];
      if (nx < sx0 || nx >= sx1 || ny < sy0 || ny >= sy1 || seen[idx(nx, ny)]) continue;
      if (!differs(nx, ny)) continue;
      seen[idx(nx, ny)] = 1;
      stack.push([nx, ny]);
    }
  }
  const area = (mx1 - mx0) * (my1 - my0);
  const given = bw * bh;
  if (area < OPENING_AREA[0] * given || area > OPENING_AREA[1] * given) return box;
  return [mx0, mx1, my0, my1];
}

/** Axis of a wall: x for the front and the back, z for the sides. */
const alongX = (wall: HouseWall) => wall === 'front' || wall === 'back';

/** How far a volume stands out toward a wall's side (larger = nearer the viewer of that view). */
const outerness = (v: HouseVolume, wall: HouseWall) =>
  ({ front: v.plan[3], back: -v.plan[2], right: v.plan[1], left: -v.plan[0] })[wall];

/**
 * Block whose wall holds an opening seen on `wall` at share `s` along it and height `y`: the
 * outermost solid block there, else an open one closed on that side, else the largest block.
 */
export function ownerOf(
  volumes: ReadonlyArray<HouseVolume>,
  wall: HouseWall,
  s: number,
  y: number
): number {
  const slack = 0.01;
  const holds = (v: HouseVolume) => {
    const [a, b] = alongX(wall) ? [v.plan[0], v.plan[1]] : [v.plan[2], v.plan[3]];
    const gable = v.roof === 'gable' && (v.ridgeAxis === 'x') !== alongX(wall) ? v.ridge : v.eave;
    return s >= a - slack && s <= b + slack && y >= (v.floor ?? 0) - slack && y <= gable + slack;
  };
  const pick = (ok: (v: HouseVolume) => boolean) => {
    let best = -1;
    volumes.forEach((v, i) => {
      if (ok(v) && holds(v) && (best < 0 || outerness(v, wall) > outerness(volumes[best]!, wall)))
        best = i;
    });
    return best;
  };
  const solid = pick((v) => !isOpenVolume(v));
  if (solid >= 0) return solid;
  const closed = pick((v) => isOpenVolume(v) && !v.open!.includes(wall));
  if (closed >= 0) return closed;
  let largest = 0;
  volumes.forEach((v, i) => {
    const area = (p: HouseVolume) => (p.plan[1] - p.plan[0]) * (p.plan[3] - p.plan[2]);
    if (!isOpenVolume(v) && area(v) > area(volumes[largest]!)) largest = i;
  });
  return largest;
}

const iou = (a: readonly number[], b: readonly number[]) => {
  const ix = Math.max(0, Math.min(a[1]!, b[1]!) - Math.max(a[0]!, b[0]!));
  const iy = Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[2]!, b[2]!));
  const inter = ix * iy;
  const union = (a[1]! - a[0]!) * (a[3]! - a[2]!) + (b[1]! - b[0]!) * (b[3]! - b[2]!) - inter;
  return union > 0 ? inter / union : 0;
};

/** The plan of the house; null when the reading cannot be made a valid plan. */
export function fitHouse({
  reading,
  views,
  mirrored,
  top = null,
  fallback = {},
}: HouseFitInput): HousePlan | null {
  const front = views.front;
  // Silhouette steps along x and z: where a block may start or end.
  const side = views.right ?? views.left;
  const xSteps = [
    ...(front ? profileSteps(outlineHeights(front)) : [0, 1]),
    ...(top ? profileSteps(planProfile(top, true), 0.15) : []),
  ];
  const zSteps = [
    ...(side ? profileSteps(outlineHeights(side)) : [0, 1]),
    ...(top ? profileSteps(planProfile(top, false), 0.15) : []),
  ];
  const frontHeights = front ? outlineHeights(front) : null;

  let volumes: HouseVolume[] = reading.volumes.slice(0, HOUSE_VOLUMES_MAX).flatMap((r) => {
    const [a0, a1, b0, b1] = r.plan.map(clamp01) as [number, number, number, number];
    let [x0, x1] = [Math.min(a0, a1), Math.max(a0, a1)];
    let [z0, z1] = [Math.min(b0, b1), Math.max(b0, b1)];
    x0 = snapTo(x0, xSteps);
    x1 = snapTo(x1, xSteps);
    z0 = snapTo(z0, zSteps);
    z1 = snapTo(z1, zSteps);
    if (x1 - x0 < 0.02 || z1 - z0 < 0.02) return [];
    const eave = clamp01(1 - r.eave);
    let ridge = Math.max(eave, clamp01(1 - r.ridge));
    if (r.roof === 'flat' || r.roof === 'none')
      ridge = r.roof === 'flat' ? Math.max(eave, ridge) : eave;
    const open = r.open?.length ? [...new Set(r.open)] : undefined;
    // A deck stays low; a balcony's slab is at its storey (PQ-T73: it was pinned to the deck).
    const floor =
      r.floor !== undefined
        ? r.kind === 'balcony'
          ? clamp01(1 - r.floor)
          : Math.min(DECK_MAX, clamp01(1 - r.floor))
        : undefined;
    const volume: HouseVolume = {
      kind: r.kind,
      plan: [round3(x0), round3(x1), round3(z0), round3(z1)],
      eave: round3(eave),
      ridge: round3(ridge),
      roof: r.roof,
      ridgeAxis: r.ridgeAxis,
      ...(open ? { open } : {}),
      ...(open && r.columns !== undefined ? { columns: r.columns } : {}),
      ...(open && floor !== undefined && floor < eave ? { floor: round3(floor) } : {}),
      ...(open && r.rail ? { rail: true } : {}),
      ...(r.bands?.length
        ? {
            bands: r.bands
              .map((b) => round3(clamp01(1 - b)))
              // PQ-T74: a gable end's wall rises to the ridge (an A-frame has no eave wall).
              .filter((b) => b > 0.02 && b < (r.roof === 'gable' ? ridge : eave))
              .slice(0, 4),
          }
        : {}),
    };
    if (volume.bands && !volume.bands.length) delete volume.bands;
    // PQ-T73: its finishes, the head of its bays, its gable trusses.
    if (r.wallFinish && r.wallFinish !== 'wall') volume.wallFinish = r.wallFinish;
    if (r.roofFinish === 'roof2') volume.roofFinish = 'roof2';
    if (open && r.arcade && r.arcade !== 'flat') volume.arcade = r.arcade;
    if (r.truss && r.roof === 'gable') volume.truss = true;
    // A balcony is open by nature: on its free sides at least the front.
    if (volume.kind === 'balcony' && !volume.open) volume.open = ['front'];
    return [volume];
  });
  if (!volumes.some((v) => !isOpenVolume(v))) return null;
  // PQ-T73: the largest closed block wears the main cladding and roofing by definition (a reading
  // that names its only block's walls "wall2" painted a white school brown).
  const area = (v: HouseVolume) => (v.plan[1] - v.plan[0]) * (v.plan[3] - v.plan[2]);
  const main = volumes
    .filter((v) => !isOpenVolume(v))
    .reduce((a, b) => (area(b) > area(a) ? b : a));
  volumes = volumes.map((v) => {
    if (v !== main || (!v.wallFinish && !v.roofFinish)) return v;
    const rest = { ...v };
    delete rest.wallFinish;
    delete rest.roofFinish;
    return rest;
  });
  // PQ-T73: a balcony read without its floor stands on the veranda under it (same plan, lower).
  volumes = volumes.map((v) => {
    if (v.kind !== 'balcony' || v.floor !== undefined) return v;
    const under = volumes.find(
      (u) =>
        u !== v &&
        isOpenVolume(u) &&
        u.kind !== 'balcony' &&
        u.eave < v.eave &&
        iou(
          [u.plan[0], u.plan[2], u.plan[1], u.plan[3]],
          [v.plan[0], v.plan[2], v.plan[1], v.plan[3]]
        ) > OPENING_DUPLICATE
    );
    return under ? { ...v, floor: under.eave } : v;
  });

  // Outer edges on the box: the house fills its drawings.
  const solids = volumes.filter((v) => !isOpenVolume(v));
  const ext = {
    x0: Math.min(...volumes.map((v) => v.plan[0])),
    x1: Math.max(...volumes.map((v) => v.plan[1])),
    z0: Math.min(...volumes.map((v) => v.plan[2])),
    z1: Math.max(...volumes.map((v) => v.plan[3])),
  };
  volumes = volumes.map((v) => {
    const p = [...v.plan] as HouseVolume['plan'];
    if (p[0] === ext.x0 && p[0] <= OUTER_SNAP) p[0] = 0;
    if (p[1] === ext.x1 && p[1] >= 1 - OUTER_SNAP) p[1] = 1;
    if (p[2] === ext.z0 && p[2] <= OUTER_SNAP) p[2] = 0;
    if (p[3] === ext.z1 && p[3] >= 1 - OUTER_SNAP) p[3] = 1;
    return { ...v, plan: p };
  });

  // A part of the footprint the reading left out (a back annex hidden on the front): the walls
  // behind it would wear its roof's drawing. Filled at the height of the lowest block.
  if (top) {
    volumes = growToFootprint(volumes, top, xSteps, zSteps);
    volumes = [
      ...volumes,
      ...footprintAnnexes(volumes, top, xSteps, zSteps, front ? front.rows / front.cols : null),
    ].slice(0, HOUSE_VOLUMES_MAX);
  }

  // Ridges on the drawn roof line (the front outline over the block's width).
  if (frontHeights) {
    const tallest = Math.max(...solids.map((v) => v.ridge));
    volumes = volumes.map((v) => {
      if (isOpenVolume(v) || v.roof === 'none') return v;
      const from = Math.floor(v.plan[0] * frontHeights.length);
      const to = Math.ceil(v.plan[1] * frontHeights.length);
      const line = percentile(frontHeights.slice(from, to), RIDGE_PERCENTILE);
      // Only the blocks that reach the top of the outline there: a lower one is hidden behind.
      if (line === null || Math.abs(line - v.ridge) > RIDGE_SNAP) return v;
      if (v.ridge < tallest - RIDGE_SNAP && line > v.ridge) return v;
      const ridge = round3(Math.max(v.eave, line));
      return { ...v, ridge: v.roof === 'flat' ? Math.max(v.eave, ridge) : ridge };
    });
  }

  // Shed roofs fall the way their outline drops (the reading often names the wrong axis).
  const sideHeights = side ? outlineHeights(side) : null;
  volumes = volumes.map((v) => {
    if (v.roof !== 'shed') return v;
    const fall = shedFallOf(v.plan, frontHeights, sideHeights);
    return fall ? { ...v, fall } : v;
  });

  // Openings: canonical shares, snapped on the drawing, owned by the block whose wall holds them.
  const kept: Array<{ wall: HouseWall; box: number[] }> = [];
  const openings: HouseOpening[] = [];
  for (const o of reading.openings) {
    if (openings.length >= HOUSE_OPENINGS_MAX) break;
    const fitted = fitOpening(o, views[o.view], mirrored[o.view] ?? MIRRORED_DEFAULT[o.view]);
    if (!fitted) continue;
    const [s0, s1, y0, y1] = fitted;
    if (kept.some((k) => k.wall === o.view && iou(k.box, fitted) > OPENING_DUPLICATE)) continue;
    kept.push({ wall: o.view, box: fitted });
    const volume = ownerOf(volumes, o.view, (s0 + s1) / 2, (y0 + y1) / 2);
    openings.push({
      volume,
      wall: o.view,
      kind: o.kind,
      along: [round3(s0), round3(s1)],
      rise: [round3(y0), round3(y1)],
      ...(o.panes ? { panes: [o.panes[0]!, o.panes[1]!] as [number, number] } : {}),
      ...(o.head && o.head !== 'flat' && o.head !== 'bracket' ? { head: o.head } : {}),
    });
  }

  const stoneRead = Boolean(reading.finishes?.some((f) => f.finish === 'stone'));
  const chimneys = reading.chimneys.slice(0, HOUSE_CHIMNEYS_MAX).flatMap((c) => {
    const [a0, a1, b0, b1] = c.plan.map(clamp01) as [number, number, number, number];
    const plan: [number, number, number, number] = [
      round3(Math.min(a0, a1)),
      round3(Math.max(a0, a1)),
      round3(Math.min(b0, b1)),
      round3(Math.max(b0, b1)),
    ];
    if (plan[1] - plan[0] < 0.005 || plan[3] - plan[2] < 0.005) return [];
    // PQ-T74: with a masonry finish read (brick or stone), the stacks wear it, not the walls.
    return [
      { plan, top: round3(clamp01(1 - c.top)), ...(stoneRead ? { finish: 'stone' as const } : {}) },
    ];
  });

  const piers = fitPiers(reading.piers ?? []);

  const look = measureLook(reading, volumes, openings, views, top, fallback, mirrored);
  const plan: HousePlan = {
    volumes: lowerFinishes(
      volumes,
      look,
      views,
      Boolean(reading.finishes?.some((f) => f.finish === 'wall' && f.figured))
    ),
    openings,
    chimneys,
    ...(piers.length ? { piers } : {}),
    look,
    ...(reading.type ? { type: reading.type } : {}),
  };
  const valid = HousePlanSchema.safeParse(plan);
  return valid.success ? valid.data : null;
}

/** Colour distance (rgb) past which the two storeys of a wall are two claddings. */
export const LOWER_CONTRAST = 30;
/** A cell this near (rgb) a finish's colour is of that finish. */
export const LOWER_NEAR = 60;
/** Fewest drawn cells of a storey's wall read before its colour counts. */
export const LOWER_MIN_CELLS = 24;
/** Share of the lower storey's wall cells near the finish's colour for it to be its cladding. */
export const LOWER_SHARE = 0.5;

/**
 * Blocks whose lower storey wears another cladding (PQ-T74): under a block's floor band, the wall
 * drawn in a colour far from its own cladding and near another finish read on the house (a
 * plastered ground storey under dark boards) gets that finish as `lower`. Read on the first
 * elevation that shows both storeys of the block; the blocks standing in front are left out.
 */
export function lowerFinishes(
  volumes: HouseVolume[],
  look: HousePlan['look'],
  views: HouseFitInput['views'],
  figured = false
): HouseVolume[] {
  // Figured walls (half-timbering) keep their drawing: no storey of theirs is a plain cladding.
  if (figured) return volumes;
  const others = (own: HouseFinish) =>
    HOUSE_WALL_FINISHES.filter((f) => f !== own && (f === 'wall' || look[f])).map((f) => ({
      finish: f,
      rgb: hexRgb(finishLook(look, f).color),
    }));
  return volumes.map((v) => {
    if (isOpenVolume(v) || v.lower || !v.bands?.length) return v;
    const own = v.wallFinish ?? 'wall';
    const candidates = others(own);
    if (!candidates.length) return v;
    const ownRgb = hexRgb(finishLook(look, own).color);
    for (const wall of HOUSE_WALLS) {
      const g = views[wall];
      if (!g) continue;
      const span = (b: HouseVolume) =>
        alongX(wall) ? [b.plan[0], b.plan[1]] : [b.plan[2], b.plan[3]];
      const [a0, a1] = span(v) as [number, number];
      const ahead = volumes.filter((b) => b !== v && outerness(b, wall) > outerness(v, wall));
      const free = (s: number, y: number) =>
        s > a0 && s < a1 && !ahead.some((b) => s >= span(b)[0]! && s <= span(b)[1]! && y <= b.eave);
      // A gable end rises to the ridge (an A-frame has no other wall).
      const wallTop =
        v.roof === 'gable' && (v.ridgeAxis === 'x') !== alongX(wall) ? v.ridge : v.eave;
      for (const top of [...v.bands].sort((p, q) => q - p)) {
        const up = dominantBin(g, (s, y) => y > top + 0.02 && y < wallTop - 0.02 && free(s, y));
        const lowAt = (s: number, y: number) => y > BASE_BAND && y < top - 0.02 && free(s, y);
        const low = dominantBin(g, lowAt);
        if (!up || !low || up.cells < LOWER_MIN_CELLS || low.cells < LOWER_MIN_CELLS) continue;
        if (dist(up.rgb, low.rgb) < LOWER_CONTRAST) continue;
        const best = candidates.reduce((p, q) =>
          dist(low.rgb, q.rgb) < dist(low.rgb, p.rgb) ? q : p
        );
        // Clearly that finish, not the block's own: twice nearer to it.
        if (dist(low.rgb, best.rgb) * 2 >= dist(low.rgb, ownRgb)) continue;
        // One plain cladding down there: most of the storey is nearer that finish's colour (the
        // timbers of a half-timbered wall are a third of it, not a cladding).
        let [n, near] = [0, 0];
        for (let r = 0; r < g.rows; r++)
          for (let c = 0; c < g.cols; c++) {
            const [s, y] = [(c + 0.5) / g.cols, 1 - (r + 0.5) / g.rows];
            if (!g.mask[r * g.cols + c] || !lowAt(s, y)) continue;
            n++;
            const px = rgbAt(g, r * g.cols + c);
            if (dist(px, best.rgb) < LOWER_NEAR && dist(px, best.rgb) < dist(px, ownRgb)) near++;
          }
        if (near >= LOWER_SHARE * n) return { ...v, lower: { finish: best.finish, top } };
      }
    }
    return v;
  });
}

/** Smallest pier side kept, share of the plan. */
export const PIER_MIN = 0.008;
/** Lowest pier top kept, share of the height (lower: a post base, not a pier). */
export const PIER_MIN_TOP = 0.08;

/**
 * Piers (PQ-T73) in the model's frame (y up), one per square: a pier read twice (front and side)
 * overlapping another by half is dropped.
 */
export function fitPiers(read: NonNullable<HouseReading['piers']>): HousePier[] {
  const out: HousePier[] = [];
  for (const p of read) {
    if (out.length >= HOUSE_PIERS_MAX) break;
    const [a0, a1, b0, b1] = p.plan.map(clamp01) as [number, number, number, number];
    const plan: HousePier['plan'] = [
      round3(Math.min(a0, a1)),
      round3(Math.max(a0, a1)),
      round3(Math.min(b0, b1)),
      round3(Math.max(b0, b1)),
    ];
    if (plan[1] - plan[0] < PIER_MIN || plan[3] - plan[2] < PIER_MIN) continue;
    const top = round3(clamp01(1 - p.top));
    if (top < PIER_MIN_TOP) continue;
    const box = [plan[0], plan[2], plan[1], plan[3]];
    if (out.some((q) => iou([q.plan[0], q.plan[2], q.plan[1], q.plan[3]], box) > OPENING_DUPLICATE))
      continue;
    const band = p.band !== undefined ? round3(clamp01(1 - p.band)) : undefined;
    out.push({ plan, top, ...(band !== undefined && band > 0.02 && band < top ? { band } : {}) });
  }
  return out;
}

/** Fewest drawn cells a finish's sample box must hold to be measured. */
export const SAMPLE_MIN_CELLS = 6;

/**
 * Median colour of a finish's sample box (PQ-T73), read on its view's grid: the box is in the
 * drawing's own shares (y down), the grid canonical (mirrored back), the view from above as drawn.
 * Null when the box holds too few drawn cells.
 */
export function sampleColor(
  g: GridView,
  box: ReadonlyArray<number>,
  mirrored: boolean
): [number, number, number] | null {
  const [u0, v0, u1, v1] = box.map(clamp01) as [number, number, number, number];
  const [a, b] = [canonical(u0, mirrored), canonical(u1, mirrored)];
  const [c0, c1] = [Math.min(a, b) * g.cols, Math.max(a, b) * g.cols];
  const [r0, r1] = [Math.min(v0, v1) * g.rows, Math.max(v0, v1) * g.rows];
  const px: Array<[number, number, number]> = [];
  for (let r = Math.floor(r0); r < Math.ceil(r1); r++)
    for (let c = Math.floor(c0); c < Math.ceil(c1); c++) {
      if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue;
      const i = r * g.cols + c;
      if (g.mask[i]) px.push(rgbAt(g, i));
    }
  return px.length >= SAMPLE_MIN_CELLS ? median3(px) : null;
}

/** The grid a finish's sample is on, and whether it is mirrored; null without that view. */
const sampleGrid = (
  f: ReadFinish,
  views: HouseFitInput['views'],
  top: GridView | null,
  mirrored: Partial<Record<HouseWall, boolean>>
): { g: GridView; mirrored: boolean } | null => {
  if (!f.view || !f.box) return null;
  if (f.view === 'top') return top ? { g: top, mirrored: false } : null;
  const g = views[f.view];
  return g ? { g, mirrored: mirrored[f.view] ?? MIRRORED_DEFAULT[f.view] } : null;
};

/** An opening in the model's frame: [s0, s1, y0, y1], snapped on its drawing; null when empty. */
function fitOpening(
  o: ReadOpening,
  g: GridView | undefined,
  mirrored: boolean
): [number, number, number, number] | null {
  const [u0, v0, u1, v1] = o.box.map(clamp01) as [number, number, number, number];
  const [a, b] = [canonical(u0, mirrored), canonical(u1, mirrored)];
  let s0 = Math.min(a, b);
  let s1 = Math.max(a, b);
  let t0 = Math.min(v0, v1);
  let t1 = Math.max(v0, v1);
  if (g) {
    const [c0, c1, r0, r1] = snapOpening(g, [s0 * g.cols, s1 * g.cols, t0 * g.rows, t1 * g.rows]);
    [s0, s1, t0, t1] = [c0 / g.cols, c1 / g.cols, r0 / g.rows, r1 / g.rows];
  }
  if (s1 - s0 < 0.008 || t1 - t0 < 0.008) return null;
  return [s0, s1, 1 - t1, 1 - t0];
}

/** Colours read on the drawings (the specialist's hex when a region cannot be measured). */
function measureLook(
  reading: HouseReading,
  volumes: ReadonlyArray<HouseVolume>,
  openings: ReadonlyArray<HouseOpening>,
  views: HouseFitInput['views'],
  top: GridView | null,
  fallback: NonNullable<HouseFitInput['fallback']>,
  mirrored: Partial<Record<HouseWall, boolean>> = {}
): HousePlan['look'] {
  const front = views.front;
  const main = volumes
    .filter((v) => !isOpenVolume(v))
    .reduce((a, b) =>
      (b.plan[1] - b.plan[0]) * (b.plan[3] - b.plan[2]) >
      (a.plan[1] - a.plan[0]) * (a.plan[3] - a.plan[2])
        ? b
        : a
    );
  const fronts = openings.filter((o) => o.wall === 'front');
  const inOpening = (s: number, y: number) =>
    fronts.some((o) => s >= o.along[0] && s <= o.along[1] && y >= o.rise[0] && y <= o.rise[1]);
  const wallPx: Array<[number, number, number]> = [];
  const roofPx: Array<[number, number, number]> = [];
  const glassPx: Array<[number, number, number]> = [];
  if (front) {
    for (let r = 0; r < front.rows; r++)
      for (let c = 0; c < front.cols; c++) {
        const i = r * front.cols + c;
        if (!front.mask[i]) continue;
        const [s, y] = [(c + 0.5) / front.cols, 1 - (r + 0.5) / front.rows];
        const px = rgbAt(front, i);
        if (inOpening(s, y)) {
          const o = fronts.find(
            (f) => s >= f.along[0] && s <= f.along[1] && y >= f.rise[0] && y <= f.rise[1]
          );
          if (o && (o.kind === 'window' || o.kind === 'arch')) glassPx.push(px);
        } else if (y > 0.04 && y < main.eave - 0.02) wallPx.push(px);
        else if (y > main.eave + 0.02 && s >= main.plan[0] && s <= main.plan[1]) roofPx.push(px);
      }
  }
  if (top) for (let i = 0; i < top.mask.length; i++) if (top.mask[i]) roofPx.push(rgbAt(top, i));
  // Glass: the darker half of what the windows show (the frames and the bars are pale).
  const dark = [...glassPx]
    .sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]))
    .slice(0, Math.max(1, glassPx.length >> 1));
  const measured = (px: Array<[number, number, number]>) => {
    const m = median3(px);
    return m ? toHex(m) : null;
  };
  // PQ-T73: a finish with a sample box is measured there (the wall median mixed piers, posts
  // and shadows; the roof median mixed shingles and metal).
  const sampled = (finish: HouseFinish) => {
    const f = reading.finishes?.find((x) => x.finish === finish);
    if (!f) return null;
    const grid = sampleGrid(f, views, top, mirrored);
    const c = grid ? sampleColor(grid.g, f.box!, grid.mirrored) : null;
    return { material: f.material, color: c ? toHex(c) : (f.color?.toLowerCase() ?? null) };
  };
  const extra = Object.fromEntries(
    (['wall2', 'stone', 'roof2', 'timber'] as const).flatMap((k) => {
      const s = sampled(k);
      return s?.color ? [[k, { material: s.material, color: s.color }]] : [];
    })
  ) as Partial<Pick<HousePlan['look'], 'wall2' | 'stone' | 'roof2' | 'timber'>>;
  const wallS = sampled('wall');
  const roofS = sampled('roof');
  return {
    wall: {
      material: reading.walls?.material ?? fallback.wall ?? 'plaster',
      color: wallS?.color ?? measured(wallPx) ?? reading.walls?.color ?? '#d8cfc0',
    },
    roof: {
      material: reading.roof?.material ?? fallback.roof ?? 'tile',
      color: roofS?.color ?? measured(roofPx) ?? reading.roof?.color ?? '#8a4b38',
    },
    ...extra,
    trim: reading.trim ?? '#f2efe8',
    glass: (glassPx.length ? measured(dark) : null) ?? reading.glass ?? '#4d6475',
    door: reading.door ?? '#5a3d2b',
    // PQ-T74: a base the reading does not give is measured at the foot of the front walls.
    base: reading.base ?? measuredBase(front, volumes, fronts) ?? '#8f8a80',
  };
}

/** Height of the band at the foot of the front walls where the base is measured, share of height. */
export const BASE_BAND = 0.04;

/**
 * Colour of the base (plinth, deck) when the reading gives none (PQ-T74: the finishes specialist
 * may omit it, and a grey default replaced a red brick plinth): the most common colour at the
 * foot of the front walls, doors left out. A house without a plinth gets its wall colour there.
 */
export function measuredBase(
  front: GridView | undefined,
  volumes: ReadonlyArray<HouseVolume>,
  fronts: ReadonlyArray<HouseOpening>
): string | null {
  if (!front) return null;
  const solids = volumes.filter((v) => !isOpenVolume(v) && v.kind !== 'balcony');
  const c = dominantColor(
    front,
    (s, y) =>
      y < BASE_BAND &&
      solids.some((v) => s > v.plan[0] && s < v.plan[1]) &&
      !fronts.some((o) => s >= o.along[0] && s <= o.along[1] && o.rise[0] < BASE_BAND)
  );
  return c ? toHex(c) : null;
}

/** Side of a swatch square, share of the view width (a few boards, bricks or tile rows). */
export const SWATCH_SIDE = 0.1;
/** Smallest swatch square, in grid cells. */
export const SWATCH_MIN_CELLS = 4;
/** Margin kept around an opening when a wall swatch is chosen, share of the view. */
export const SWATCH_MARGIN = 0.015;

/** A cell this far (rgb distance) from the surface's colour is something else on it. */
export const SWATCH_ODD = 45;
/** Score cost of a square made only of such cells (vs its mean colour's distance). */
export const SWATCH_ODD_WEIGHT = 400;

/** A wall swatch stays this far under the eave (soffits, fascias, rafter tails), share of height. */
export const SWATCH_EAVE_GAP = 0.06;
/** Score cost per smaller swatch size tried (a large square shows more of the pattern). */
export const SWATCH_SMALLER_COST = 40;

/** Score cost per unit of the spread (rgb sum) of a square's column or row means, the flatter. */
export const SWATCH_LINE_WEIGHT = 0.5;

/** A square of a view chosen as a swatch: canonical shares, `y` from the ground up. */
export interface HousePatch {
  view: HouseWall | 'top';
  box: [number, number, number, number];
}

/**
 * The square of a view most like `target` with every cell drawn and accepted (`accept(s, y)`,
 * canonical shares, y up): the cleanest sample of a surface. Null when no square fits.
 */
export function pickPatch(
  view: GridView,
  target: readonly number[],
  accept: (s: number, y: number) => boolean,
  side = SWATCH_SIDE
): { box: [number, number, number, number]; score: number } | null {
  const k = Math.max(SWATCH_MIN_CELLS, Math.round(side * view.cols));
  if (k > view.cols || k > view.rows) return null;
  // Cells usable (drawn and accepted), summed for an O(1) test of a whole square.
  const W = view.cols + 1;
  const sat = new Int32Array(W * (view.rows + 1));
  for (let r = 0; r < view.rows; r++)
    for (let c = 0; c < view.cols; c++) {
      const i = r * view.cols + c;
      const ok = view.mask[i] && accept((c + 0.5) / view.cols, 1 - (r + 0.5) / view.rows) ? 1 : 0;
      sat[(r + 1) * W + c + 1] = ok + sat[r * W + c + 1]! + sat[(r + 1) * W + c]! - sat[r * W + c]!;
    }
  const full = (r: number, c: number) =>
    sat[(r + k) * W + c + k]! - sat[r * W + c + k]! - sat[(r + k) * W + c]! + sat[r * W + c]! ===
    k * k;
  const stride = Math.max(1, k >> 2);
  let best: { score: number; r: number; c: number } | null = null;
  for (let r = 0; r + k <= view.rows; r += stride)
    for (let c = 0; c + k <= view.cols; c += stride) {
      if (!full(r, c)) continue;
      // Unlike the surface: a frame, a post, a lamp caught in the square. A line across the
      // pattern (a post in horizontal boards) shows as rows or columns unlike the others.
      let [sr, sg, sb, odd] = [0, 0, 0, 0];
      const colSum = new Float64Array(k);
      const rowSum = new Float64Array(k);
      for (let y = r; y < r + k; y++)
        for (let x = c; x < c + k; x++) {
          const i = (y * view.cols + x) * 3;
          const px = [view.rgb[i]!, view.rgb[i + 1]!, view.rgb[i + 2]!];
          sr += px[0]!;
          sg += px[1]!;
          sb += px[2]!;
          const lum = px[0]! + px[1]! + px[2]!;
          colSum[x - c]! += lum;
          rowSum[y - r]! += lum;
          if (dist(px, target) > SWATCH_ODD) odd++;
        }
      const n = k * k;
      const score =
        dist([sr / n, sg / n, sb / n], target) +
        SWATCH_ODD_WEIGHT * (odd / n) +
        SWATCH_LINE_WEIGHT * Math.min(spreadOf(colSum, k), spreadOf(rowSum, k));
      if (!best || score < best.score) best = { score, r, c };
    }
  if (!best) return null;
  return {
    box: [
      round3(best.c / view.cols),
      round3((best.c + k) / view.cols),
      round3(1 - (best.r + k) / view.rows),
      round3(1 - best.r / view.rows),
    ],
    score: best.score,
  };
}

/** Swatch sides tried, largest first (a wall crowded with windows leaves only small squares). */
const SWATCH_SIDES = [SWATCH_SIDE, 0.07, 0.05, 0.035, 0.025];

const firstPatch = (
  view: GridView,
  target: readonly number[],
  accept: (s: number, y: number) => boolean
) => {
  // The cleanest square of any size, a larger one preferred (more of the pattern).
  let best: { box: [number, number, number, number]; score: number } | null = null;
  for (const [rank, side] of SWATCH_SIDES.entries()) {
    const found = pickPatch(view, target, accept, side);
    if (!found) continue;
    const score = found.score + rank * SWATCH_SMALLER_COST;
    if (!best || score < best.score) best = { box: found.box, score };
  }
  return best ? best.box : null;
};

/** Colour bins per channel when the dominant colour is looked for. */
const DOMINANT_BINS = 8;

/**
 * The most common colour of a view's accepted cells (mean of the fullest bin): the cladding of a
 * wall that mixes boards, posts and trims, where a median falls between them. Null without cells.
 */
export function dominantColor(
  view: GridView,
  accept: (s: number, y: number) => boolean
): [number, number, number] | null {
  return dominantBin(view, accept)?.rgb ?? null;
}

/** `dominantColor` with the cells read and the share of them in that colour's bin. */
function dominantBin(
  view: GridView,
  accept: (s: number, y: number) => boolean
): { rgb: [number, number, number]; cells: number; share: number } | null {
  const bins = new Map<number, [number, number, number, number]>();
  const step = 256 / DOMINANT_BINS;
  for (let r = 0; r < view.rows; r++)
    for (let c = 0; c < view.cols; c++) {
      const i = r * view.cols + c;
      if (!view.mask[i] || !accept((c + 0.5) / view.cols, 1 - (r + 0.5) / view.rows)) continue;
      const [R, G, B] = rgbAt(view, i);
      const key =
        (Math.floor(R / step) * DOMINANT_BINS + Math.floor(G / step)) * DOMINANT_BINS +
        Math.floor(B / step);
      const bin = bins.get(key) ?? [0, 0, 0, 0];
      bins.set(key, [bin[0] + R, bin[1] + G, bin[2] + B, bin[3] + 1]);
    }
  let best: [number, number, number, number] | null = null;
  let cells = 0;
  for (const bin of bins.values()) {
    cells += bin[3];
    if (!best || bin[3] > best[3]) best = bin;
  }
  return best
    ? {
        rgb: [best[0] / best[3], best[1] / best[3], best[2] / best[3]],
        cells,
        share: best[3] / cells,
      }
    : null;
}

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Where to sample the walls and the roof of a fitted plan: the wall on the front drawing, inside
 * a closed block's wall, away from every opening and band; the roof on the view from above.
 */
export function housePatches(
  plan: HousePlan,
  views: HouseFitInput['views'],
  top: GridView | null,
  finishes: ReadonlyArray<ReadFinish> = [],
  mirrored: Partial<Record<HouseWall, boolean>> = {}
): Partial<Record<HouseFinish, HousePatch>> {
  const out: Partial<Record<HouseFinish, HousePatch>> = {};
  const front = views.front;
  if (front) {
    const m = SWATCH_MARGIN;
    const fronts = plan.openings.filter((o) => o.wall === 'front');
    const solids = plan.volumes.filter((v) => !isOpenVolume(v) && v.kind !== 'balcony');
    const opens = plan.volumes.filter(isOpenVolume);
    const onWall = (s: number, y: number) => {
      if (
        fronts.some(
          (o) => s > o.along[0] - m && s < o.along[1] + m && y > o.rise[0] - m && y < o.rise[1] + m
        )
      )
        return false;
      // In front of a veranda or a balcony: its posts and rails, not the wall.
      if (opens.some((v) => s > v.plan[0] - m && s < v.plan[1] + m && y < v.eave + m)) return false;
      return solids.some(
        (v) => s > v.plan[0] + m && s < v.plan[1] - m && y > 0.06 && y < v.eave - SWATCH_EAVE_GAP
      );
    };
    const target = dominantColor(front, onWall) ?? hexRgb(plan.look.wall.color);
    const box = firstPatch(front, target, onWall);
    if (box) out.wall = { view: 'front', box };
  }
  if (top) {
    const target = dominantColor(top, () => true) ?? hexRgb(plan.look.roof.color);
    const box = firstPatch(top, target, () => true);
    if (box) out.roof = { view: 'top', box };
  }
  // PQ-T73: each finish the specialist sampled gets the cleanest square inside its sample box,
  // in place of the guess above (a wall square caught on a pier, a roof square on the metal).
  for (const f of finishes) {
    const grid = sampleGrid(f, views, top, mirrored);
    if (!grid) continue;
    const [u0, v0, u1, v1] = f.box!.map(clamp01) as [number, number, number, number];
    const [a, b] = [canonical(u0, grid.mirrored), canonical(u1, grid.mirrored)];
    const [s0, s1] = [Math.min(a, b), Math.max(a, b)];
    const [y0, y1] = [1 - Math.max(v0, v1), 1 - Math.min(v0, v1)];
    const inside = (s: number, y: number) => s >= s0 && s <= s1 && y >= y0 && y <= y1;
    const target = sampleColor(grid.g, f.box!, grid.mirrored);
    if (!target) continue;
    const box = firstPatch(grid.g, target, inside);
    if (box) out[f.finish] = { view: f.view!, box };
  }
  // PQ-T74: figured walls (half-timbering) keep their whole drawing: no swatch to repeat.
  if (finishes.some((f) => f.finish === 'wall' && f.figured)) delete out.wall;
  return out;
}

/** Spread ratio past which a swatch has a direction (boards, courses) and is cleaned along it. */
export const SWATCH_GRAIN_RATIO = 1.8;
/** A run of odd lines this long (share of the swatch) is a band to drop, not a groove. */
export const SWATCH_BAND = 0.08;
/** A line this far (rgb) from the swatch's typical colour is unlike the boards. */
export const SWATCH_BAND_DISTANCE = 25;

/**
 * A swatch made clean (rgb, `w` × `h`): boards or courses running one way are replaced by their
 * profile — every row (horizontal boards) or column (vertical boards) set to its median colour —
 * so a post, a bracket or a lamp caught in the square is gone and the repeat has no seam. A
 * pattern without a direction (brick, stone, tiles) is kept as cut. Returns a new buffer.
 */
export function cleanSwatch(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const lum = (i: number) => rgb[i * 3]! + rgb[i * 3 + 1]! + rgb[i * 3 + 2]!;
  const colSum = new Float64Array(w);
  const rowSum = new Float64Array(h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = lum(y * w + x);
      colSum[x]! += v;
      rowSum[y]! += v;
    }
  const [cols, rows] = [spreadOf(colSum, h), spreadOf(rowSum, w)];
  const out = new Uint8Array(rgb);
  // Rows differ, columns alike: horizontal boards (each row one colour); and the other way.
  const horizontal = rows > cols * SWATCH_GRAIN_RATIO;
  const vertical = cols > rows * SWATCH_GRAIN_RATIO;
  if (!horizontal && !vertical) return out;
  const [lines, length] = horizontal ? [h, w] : [w, h];
  const at = (line: number, k: number) => (horizontal ? line * w + k : k * w + line);
  const channel = new Uint8Array(length);
  const profile: Array<[number, number, number]> = [];
  for (let line = 0; line < lines; line++) {
    const c: [number, number, number] = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++) {
      for (let k = 0; k < length; k++) channel[k] = rgb[at(line, k) * 3 + ch]!;
      c[ch] = channel.sort()[length >> 1]!;
    }
    profile.push(c);
  }
  // A thick band unlike the boards (a beam, a lintel) is not the cladding: the nearest board
  // lines stand in for it. Thin dark lines (the grooves between boards) stay.
  const typical = median3(profile)!;
  const odd = profile.map((c) => dist(c, typical) > SWATCH_BAND_DISTANCE);
  const band = Math.max(2, Math.round(lines * SWATCH_BAND));
  for (let a = 0; a < lines;) {
    if (!odd[a]) {
      a++;
      continue;
    }
    let b = a;
    while (b < lines && odd[b]) b++;
    if (b - a >= band) {
      const good = profile.flatMap((_, i) => (odd[i] ? [] : [i]));
      if (good.length)
        for (let i = a; i < b; i++) {
          // The board lines just past the band, read again (the pattern goes on).
          const from = good[(i - a) % good.length]!;
          profile[i] = profile[from]!;
        }
    }
    a = b;
  }
  for (let line = 0; line < lines; line++)
    for (let k = 0; k < length; k++) out.set(profile[line]!, at(line, k) * 3);
  return out;
}

/** Coherence (0–1) of a swatch's line direction past which it has one direction. */
export const SWATCH_COHERENCE = 0.3;
/** Degrees off the horizontal or the vertical past which that direction is oblique. */
export const SWATCH_OBLIQUE = 15;

/**
 * Whether a swatch's pattern runs oblique (PQ-T74): rows of tiles drawn at an angle on the view
 * from above, repeated mirrored, turn into a kaleidoscope of diamonds. Read on the structure
 * tensor of the luminance: one clear direction (`SWATCH_COHERENCE`), neither level nor upright.
 */
export function swatchOblique(rgb: Uint8Array, w: number, h: number): boolean {
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 3;
    return rgb[i]! + rgb[i + 1]! + rgb[i + 2]!;
  };
  let [xx, yy, xy] = [0, 0, 0];
  for (let y = 1; y + 1 < h; y++)
    for (let x = 1; x + 1 < w; x++) {
      const gx = lum(x + 1, y) - lum(x - 1, y);
      const gy = lum(x, y + 1) - lum(x, y - 1);
      xx += gx * gx;
      yy += gy * gy;
      xy += gx * gy;
    }
  if (xx + yy < 1e-6) return false;
  const coherence = Math.hypot(xx - yy, 2 * xy) / (xx + yy);
  if (coherence < SWATCH_COHERENCE) return false;
  // Direction of the strongest change, 0–90° from the horizontal.
  const angle = Math.abs((Math.atan2(2 * xy, xx - yy) / 2) * (180 / Math.PI));
  return Math.min(angle, 90 - angle) > SWATCH_OBLIQUE;
}

/** Standard deviation of line sums of `k` values each, as means. */
function spreadOf(sums: Float64Array, k: number): number {
  let [m, m2] = [0, 0];
  for (const v of sums) {
    m += v / k;
    m2 += (v / k) ** 2;
  }
  const n = sums.length || 1;
  return Math.sqrt(Math.max(0, m2 / n - (m / n) ** 2));
}
