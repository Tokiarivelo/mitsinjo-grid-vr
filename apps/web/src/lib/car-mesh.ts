import type { CarBody, CarPlan, CarWindow } from './car-plan';
import { atlasUv, faceSlot, type AtlasView, type FaceView } from './face-atlas';

/**
 * A car built from its plan (PQ-T76), pure: the body lofted along the car (one ring per station:
 * its height the profile, its width at each height the front section), its underside raised over
 * each wheel; the wheels as cylinders. The section is read as a car is built: the lower body up
 * to the shoulder (the widest band of the front), then the cabin, narrowing up to a flat roof.
 * A station whose top stays near the shoulder (bonnet, boot) is a flat deck at the body's width,
 * never pinched to the cabin; the roof keeps the cabin's width under the drawing's rounded top
 * row; the view from above only narrows the nose and the tail. Normals are smooth except across
 * a crease (windscreen base, roof edge), so flat panels stay flat. Every triangle
 * reads the drawing that faces it (atlas uvs, `lib/face-atlas.ts`), so the model wears its
 * validated drawings; the windows the team read become the glass slot; a wheel's outer face reads
 * the drawn wheel. Shared by the 3D views, the village and the Blender export.
 *
 * Frame as `lib/house-mesh.ts`: centred, x right as seen from the front, y up, z toward the front.
 */

/**
 * Slots: the five drawn surfaces first (`HULL_SURFACES` order: the surface editor picks them),
 * then the glass, the tyres, the wheel faces (rims) and the underside.
 */
export const CAR_SLOTS = [
  'roof',
  'front',
  'right',
  'back',
  'left',
  'glass',
  'tyre',
  'rim',
  'under',
] as const;
export type CarSlot = (typeof CAR_SLOTS)[number];

export interface CarMesh {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  /** Slot index per triangle (`CAR_SLOTS`). */
  slot: Uint8Array;
}

export interface CarMeshOptions {
  /** Drawings the atlas holds (a missing one reads its opposite). */
  views?: ReadonlyArray<AtlasView>;
  /** The atlas holds the drawn underside (its sixth tile): the floor wears it. */
  underside?: boolean;
}

/** Ring segments: across the underside, up each flank, across the roof. */
export const RING_UNDER = 6;
export const RING_SIDE = 14;
export const RING_ROOF = 10;
/** Segments round a wheel. */
export const WHEEL_SEGMENTS = 28;
/** A body face whose normal points up past this (y component) is roof. */
export const ROOF_UP = 0.7;
/** A station within this share of the cabin's height under the roof is the roof's edge. */
export const ROOF_EDGE = 0.12;
/** A windscreen falls at least this share of the cabin's height per station (64-station profile). */
export const CLIMB_MIN = 0.04;
const CAR_STATIONS_REF = 64;
/** Level spans a climb may hold, and how far under the roof its rounded edge may reach. */
export const CLIMB_GAP = 2;
export const ROOF_ROUND = 0.4;
/** A face of the roof leaning this much forward or backward (z of its normal) may be glazed. */
export const RAKE_MIN = 0.08;
/** A face turned down past this (y component of its normal) is the underside. */
export const UNDER_DOWN = -0.6;
/** Slack of the window cuts (shares of the box): a triangle this close to an edge is not cut. */
export const CUT_EPS = 1e-5;
/** The shoulder: the highest level of the front still this share of the body's widest. */
export const SHOULDER_SHARE = 0.92;
/** A station whose top is within this share of the cabin's height above the shoulder is a deck. */
export const DECK_BAND = 0.35;
/** A station whose top reaches this share of the cabin's height has the cabin's full section. */
export const CABIN_FULL = 0.85;
/** The roof keeps the cabin's width this far (share of the height) under the top of the front. */
export const ROOF_CROWN = 0.05;
/** Edges of a deck or the roof round in by this share of their half-width over `EDGE_BAND`. */
export const EDGE_IN = 0.06;
export const EDGE_BAND = 0.03;
/** The view from above narrows only this share of the length at each end, never under `TAPER_MIN`. */
export const TAPER_END = 0.18;
export const TAPER_MIN = 0.8;
/** A vertex normal further than this from its face (cosine, ≈ 35°) is a crease: the face's own. */
export const CREASE_COS = 0.82;
/** Tyre width (share of the box width) and track when the front gave none. */
export const DEFAULT_TYRE = 0.1;
/** Gap between a tyre's inner face and its wheel well's wall (share of the width). */
export const WELL_GAP = 0.012;
/** A tyre's sidewall radius (share of the wheel's) and its tread's share of the tyre width. */
export const TYRE_SHOULDER = 0.9;
export const TYRE_TREAD = 0.7;
/** An axle tube's radius, share of its wheels' radius; segments round it. */
export const AXLE_SHARE = 0.14;
export const AXLE_SEGMENTS = 12;
/** A station this close to a wheel's span (share of its radius) is over the wheel. */
export const ARCH_MARGIN = 1.08;
export const DEFAULT_TRACK_SHARE = 0.94;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Even-odd test of a point in a polygon (shared with the server's fit). */
export function inPolygon(
  [px, py]: readonly [number, number],
  poly: ReadonlyArray<readonly [number, number]>
) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Linear read of an array spread evenly over 0–1. */
const sample = (arr: readonly number[], f: number) => {
  const x = clamp01(f) * (arr.length - 1);
  const i = Math.min(arr.length - 2, Math.floor(x));
  const t = x - i;
  return arr[i]! * (1 - t) + arr[i + 1]! * t;
};

/** A view a triangle reads: a face's drawing, or the underside's tile. */
type UvView = AtlasView | 'bottom';

/**
 * Where the cabin starts on a body: the shoulder (the highest level of the front still as wide
 * as the body, share of the height), the roof, and how far a station's top rises into the cabin
 * (0 at the shoulder, 1 at the roof).
 */
export function carShoulder(body: Pick<CarBody, 'half' | 'top'>) {
  const half = body.half;
  const L = half.length;
  const max = Math.max(...half);
  let widest = half.indexOf(max);
  while (widest + 1 < L && half[widest + 1]! >= SHOULDER_SHARE * max) widest++;
  const shoulder = widest / (L - 1);
  const roof = Math.max(...body.top);
  const cabinHeight = Math.max(1e-6, roof - shoulder);
  return { widest, shoulder, roof, rise: (t: number) => (t - shoulder) / cabinHeight };
}

/**
 * Half-width of the body at height `y` on a station whose top is `t` (shares; 0–0.5). Below the
 * shoulder the front's section; above it the cabin, never wider going up and holding its width
 * under the drawing's rounded top; a deck station (bonnet, boot) keeps the shoulder's width up to
 * its top. Every top edge rounds in a little (`EDGE_IN`).
 */
export function carSection(body: Pick<CarBody, 'half' | 'top'>): (t: number, y: number) => number {
  const half = body.half;
  const L = half.length;
  const { widest, shoulder, roof, rise: riseOf } = carShoulder(body);
  const shoulderHalf = half[widest]!;
  // At least one and a half levels: a coarse front still loses its rounded top row.
  const crown = Math.max(shoulder, roof - Math.max(ROOF_CROWN, 1.5 / (L - 1)));
  // The cabin, monotone: each level no wider than the one under it.
  const cabin = [...half];
  for (let j = widest + 1; j < L; j++) cabin[j] = Math.min(cabin[j]!, cabin[j - 1]!);
  const edge = (w: number, t: number, y: number) => {
    const k = (y - (t - EDGE_BAND)) / EDGE_BAND;
    return k > 0 ? w * (1 - EDGE_IN * Math.min(1, k) ** 2) : w;
  };
  return (t, y) => {
    if (y <= shoulder) return edge(sample(half, y), t, y);
    // How much of a cabin the station is: a deck under `DECK_BAND`, the full cabin from
    // `CABIN_FULL`, and between them (the windscreen, the rear window) the pillars lean in
    // smoothly instead of the width jumping from one station to the next.
    const rise = riseOf(t);
    const k = clamp01((rise - DECK_BAND) / (CABIN_FULL - DECK_BAND));
    const cabinShare = k * k * (3 - 2 * k);
    const cabinHalf = sample(cabin, Math.min(y, crown));
    return edge(shoulderHalf + (cabinHalf - shoulderHalf) * cabinShare, t, y);
  };
}

/**
 * Width share per station from the view from above: only the nose and the tail narrow (`TAPER_END`
 * of the length each), against the width where that end starts, never under `TAPER_MIN`. A plan
 * drawn with a little perspective no longer shrinks the whole car toward one end.
 */
export function stationTaper(body: Pick<CarBody, 'taper' | 'top'>): (i: number) => number {
  const taper = body.taper;
  const N = body.top.length;
  if (!taper) return () => 1;
  const at = (i: number) => sample(taper, i / Math.max(1, N - 1));
  const end = Math.max(1, Math.round(TAPER_END * (N - 1)));
  const [backRef, frontRef] = [at(end), at(N - 1 - end)];
  return (i) => {
    const ref = i < end ? backRef : i > N - 1 - end ? frontRef : 0;
    if (!ref) return 1;
    return Math.min(1, Math.max(TAPER_MIN, at(i) / ref));
  };
}

/**
 * The floor's height at each station: the body's underside with the wheel arches taken out (over
 * a wheel, the line between the stations just before and after it). `hOverD` turns a wheel's
 * radius (share of the height) into a share of the length.
 */
export function floorLine(
  body: Pick<CarBody, 'bottom' | 'z0' | 'z1'>,
  wheels: CarPlan['wheels'],
  hOverD: number
): number[] {
  const N = body.bottom.length;
  const zAt = (i: number) => body.z0 + ((body.z1 - body.z0) * i) / Math.max(1, N - 1);
  const over = (i: number) =>
    wheels.some((w) => Math.abs(zAt(i) - w.z) < w.r * hOverD * ARCH_MARGIN);
  const out = [...body.bottom];
  for (let i = 0; i < N; i++) {
    if (!over(i)) continue;
    let a = i;
    while (a >= 0 && over(a)) a--;
    let b = i;
    while (b < N && over(b)) b++;
    const [ya, yb] = [a >= 0 ? body.bottom[a] : undefined, b < N ? body.bottom[b] : undefined];
    const y =
      ya !== undefined && yb !== undefined
        ? ya + ((yb - ya) * (i - a)) / (b - a)
        : (ya ?? yb ?? body.bottom[i]!);
    out[i] = Math.min(body.bottom[i]!, y);
  }
  return out;
}

/**
 * The spans between stations where the body climbs to the roof: from each end of the roof, down
 * the windscreen and the rear window while the top keeps falling by `CLIMB_MIN` of the cabin's
 * height per station (of a 64-station profile). The bonnet and the boot, nearly level, are not.
 */
export function cabinClimbs(body: Pick<CarBody, 'half' | 'top'>): boolean[] {
  const top = body.top;
  const N = top.length;
  const { shoulder, roof } = carShoulder(body);
  const cabin = Math.max(1e-6, roof - shoulder);
  const out = Array.from({ length: Math.max(0, N - 1) }, () => false);
  const high = (i: number) => top[i]! >= roof - ROOF_EDGE * cabin;
  const step = (CLIMB_MIN * cabin * (CAR_STATIONS_REF - 1)) / Math.max(1, N - 1);
  /** Walks from the roof's edge `from` toward one end (`dir` +1 = the nose), marking the climb. */
  const walk = (from: number, dir: 1 | -1) => {
    let started = false;
    let pending: number[] = [];
    for (let i = from; i + dir >= 0 && i + dir < N; i += dir) {
      const span = dir > 0 ? i : i - 1;
      if (top[i]! - top[i + dir]! >= step) {
        // A short level stretch inside the climb (a wiper cowl, a spoiler lip) belongs to it.
        for (const k of pending) out[k] = true;
        out[span] = true;
        pending = [];
        started = true;
      } else if (started) {
        pending.push(span);
        if (pending.length > CLIMB_GAP) break;
      } else if (top[i + dir]! < roof - ROOF_ROUND * cabin) break;
    }
  };
  let front = N - 1;
  while (front > 0 && !high(front)) front--;
  walk(front, 1);
  let back = 0;
  while (back < N - 1 && !high(back)) back++;
  walk(back, -1);
  return out;
}

const SLOT_INDEX = Object.fromEntries(CAR_SLOTS.map((slot, i) => [slot, i])) as Record<
  CarSlot,
  number
>;

type Corners = [V3, V3, V3];
/** Which part of a body ring a face lies on. */
type RingPart = 'under' | 'right' | 'roof' | 'left';
/** A window ready to cut the mesh: its polygon and bounds [min s, min y, max s, max y]. */
interface WindowCut {
  points: CarWindow['points'];
  box: [number, number, number, number];
}

const mix = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * A triangle cut along the line p0 → p1 of a drawing (`project` gives a point's place on it): the
 * pieces on each side, their normals interpolated. Left whole when it lies outside `box` (the
 * window's bounds) or on one side of the line.
 */
export function cutTriangle<View>(
  piece: { vs: Corners; ns: Corners },
  box: readonly [number, number, number, number],
  p0: readonly [number, number],
  p1: readonly [number, number],
  view: View,
  project: (p: V3, view: View) => [number, number]
): Array<{ vs: Corners; ns: Corners }> {
  const flat = piece.vs.map((p) => project(p, view));
  const xs = flat.map((q) => q[0]);
  const ys = flat.map((q) => q[1]);
  if (
    Math.max(...xs) <= box[0] ||
    Math.min(...xs) >= box[2] ||
    Math.max(...ys) <= box[1] ||
    Math.min(...ys) >= box[3]
  )
    return [piece];
  const [dx, dy] = [p1[0] - p0[0], p1[1] - p0[1]];
  const side = flat.map((q) => dx * (q[1] - p0[1]) - dy * (q[0] - p0[0]));
  const scale = Math.hypot(dx, dy) || 1;
  const sign = side.map((v) => (v > CUT_EPS * scale ? 1 : v < -CUT_EPS * scale ? -1 : 0));
  if (!sign.includes(1) || !sign.includes(-1)) return [piece];
  // The corner alone on its side of the line (a corner on the line goes with the larger side).
  const alone = [0, 1, 2].find(
    (i) => sign[i] !== 0 && sign.filter((v) => v === sign[i]).length === 1
  )!;
  const [j, k] = [(alone + 1) % 3, (alone + 2) % 3];
  const at = (other: number) => side[alone]! / (side[alone]! - side[other]!);
  const cutAt = (other: number) => {
    // A corner on the line is its own crossing.
    const t = sign[other] === 0 ? 1 : at(other);
    return {
      v: mix(piece.vs[alone]!, piece.vs[other]!, t),
      n: mix(piece.ns[alone]!, piece.ns[other]!, t),
    };
  };
  const [pj, pk] = [cutAt(j), cutAt(k)];
  const out: Array<{ vs: Corners; ns: Corners }> = [
    { vs: [piece.vs[alone]!, pj.v, pk.v], ns: [piece.ns[alone]!, pj.n, pk.n] },
  ];
  if (sign[j] !== 0)
    out.push({ vs: [pj.v, piece.vs[j]!, piece.vs[k]!], ns: [pj.n, piece.ns[j]!, piece.ns[k]!] });
  if (sign[k] !== 0) out.push({ vs: [pj.v, piece.vs[k]!, pk.v], ns: [pj.n, piece.ns[k]!, pk.n] });
  return out;
}

/** The car as triangles in the model's frame (`dims` = w, h, d); null without a fitted body. */
export function carMesh(
  plan: CarPlan,
  dims: readonly [number, number, number],
  { views = ['front'], underside = false }: CarMeshOptions = {}
): CarMesh | null {
  const body = plan.body;
  if (!body || body.top.length < 2) return null;
  const [w, h, d] = dims;
  const has = new Set<AtlasView>(views);
  const tile = (v: FaceView): FaceView => {
    if (has.has(v)) return v;
    const other = ({ front: 'back', back: 'front', right: 'left', left: 'right' } as const)[v];
    return has.has(other) ? other : (views.find((x): x is FaceView => x !== 'top') ?? 'front');
  };
  const X = (x: number) => (x - 0.5) * w;
  const Y = (y: number) => (y - 0.5) * h;
  const Z = (z: number) => (z - 0.5) * d;
  const shares = (p: V3): V3 => [p[0] / w + 0.5, p[1] / h + 0.5, p[2] / d + 0.5];

  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const slots: number[] = [];

  const uvOf = (p: V3, view: UvView): [number, number] => {
    const [x, y, z] = shares(p);
    if (view === 'top' || view === 'bottom') return atlasUv(faceSlot(view), clamp01(x), clamp01(z));
    const s = view === 'front' || view === 'back' ? x : z;
    return atlasUv(faceSlot(tile(view)), clamp01(s), clamp01(1 - y));
  };
  /** The drawing a face looks at: the plan from above when there is one, else its flank or end. */
  const viewOf = (n: V3): AtlasView => {
    const [ax, ay, az] = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
    if (n[1] > 0 && ay > ax && ay > az && has.has('top')) return 'top';
    if (ax > az) return n[0] > 0 ? 'right' : 'left';
    return n[2] > 0 ? 'front' : 'back';
  };
  /** The windows of each view with their bounds, read once. */
  const windowCache = new Map<CarWindow['view'], WindowCut[]>();
  const windowsOf = (v: CarWindow['view']): WindowCut[] => {
    const cached = windowCache.get(v);
    if (cached) return cached;
    let own = (plan.windows ?? []).filter((x) => x.view === v);
    // A side the team did not read wears the other side's windows (same z, same y).
    if (!own.length && (v === 'right' || v === 'left'))
      own = (plan.windows ?? []).filter((x) => x.view === (v === 'right' ? 'left' : 'right'));
    const cuts = own.map(({ points }): WindowCut => {
      const xs = points.map((q) => q[0]);
      const ys = points.map((q) => q[1]);
      return {
        points,
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      };
    });
    windowCache.set(v, cuts);
    return cuts;
  };
  /** A point on the drawing of an elevation: [x or z, y], shares of the box. */
  const onView = (p: V3, view: FaceView): [number, number] => {
    const [x, y, z] = shares(p);
    return view === 'front' || view === 'back' ? [x, y] : [z, y];
  };
  const centreOf = ([a, b, c]: Corners): V3 => [
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
    (a[2] + b[2] + c[2]) / 3,
  ];

  /** One triangle out: its vertex normals kept except across a crease, its uvs on `view`. */
  const emit = (vs: Corners, ns: Corners, fn: V3, slot: CarSlot, view: UvView) => {
    for (let k = 0; k < 3; k++) {
      const p = vs[k]!;
      // A normal across a crease takes the face's own: flat panels stay flat.
      const m = dot(ns[k]!, fn) < CREASE_COS ? fn : ns[k]!;
      pos.push(p[0], p[1], p[2]);
      nrm.push(m[0], m[1], m[2]);
      const uv = uvOf(p, view);
      uvs.push(uv[0], uv[1]);
    }
    slots.push(SLOT_INDEX[slot]);
  };

  /**
   * A triangle with its vertex normals, wound to face the mean of them. Its slot: `fixed`, else
   * the drawing it faces: the underside when turned down, the roof when turned up on the roof's
   * part of the ring (`part`; a wing or a sill turned up stays its flank), the glass inside a
   * window. A triangle crossing a window's edge is cut along it: the glass follows the polygon
   * the team read, not the mesh's own triangles.
   */
  const tri = (
    vs: Corners,
    ns: Corners,
    fixed?: { slot: CarSlot; view?: UvView },
    part: RingPart = 'roof',
    raked = false
  ) => {
    const a = vs[0];
    let [b, c] = [vs[1], vs[2]];
    const na = ns[0];
    let [nb, nc] = [ns[1], ns[2]];
    let fn = unit(cross(sub(b, a), sub(c, a)));
    if (!fn[0] && !fn[1] && !fn[2]) return;
    const mean: V3 = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    if (dot(fn, mean) < 0) {
      [b, c] = [c, b];
      [nb, nc] = [nc, nb];
      fn = [-fn[0], -fn[1], -fn[2]];
    }
    const corners: Corners = [a, b, c];
    const normalsOf: Corners = [na, nb, nc];
    if (fixed) return emit(corners, normalsOf, fn, fixed.slot, fixed.view ?? viewOf(fn));
    if (fn[1] < UNDER_DOWN)
      return emit(corners, normalsOf, fn, 'under', underside ? 'bottom' : 'front');
    const view = viewOf(fn);
    // A face turned up is the roof even without a drawing from above (its uv reads a flank).
    const up = view === 'top' || fn[1] > ROOF_UP;
    const solid: CarSlot =
      up && part === 'roof'
        ? 'roof'
        : up && part !== 'under'
          ? part
          : view === 'top'
            ? 'roof'
            : view;
    // The glass a face may be: its flank's windows; on the roof's part of the ring only where
    // the body climbs into the cabin (`raked`: a bonnet's small steps are never glass). A raked
    // windscreen faces the sky more than the road: it still reads the drawing from above, but
    // its glass is the window the team read on the front or the back.
    const flank = part === 'right' || part === 'left';
    const glazed: FaceView | null =
      view === 'right' || view === 'left'
        ? view
        : flank
          ? view === 'top'
            ? part
            : view
          : part !== 'roof' || !raked
            ? null
            : view !== 'top'
              ? view
              : fn[2] > RAKE_MIN
                ? 'front'
                : fn[2] < -RAKE_MIN
                  ? 'back'
                  : null;
    if (!glazed) return emit(corners, normalsOf, fn, solid, view);
    const all = windowsOf(glazed);
    if (!all.length) return emit(corners, normalsOf, fn, solid, view);
    // Only the windows whose bounds the triangle reaches can cut it or glaze it.
    const [fa, fb, fc] = [onView(a, glazed), onView(b, glazed), onView(c, glazed)];
    const [s0, s1] = [Math.min(fa[0], fb[0], fc[0]), Math.max(fa[0], fb[0], fc[0])];
    const [y0, y1] = [Math.min(fa[1], fb[1], fc[1]), Math.max(fa[1], fb[1], fc[1])];
    const cuts = all.filter(
      (cut) => s1 > cut.box[0] && s0 < cut.box[2] && y1 > cut.box[1] && y0 < cut.box[3]
    );
    if (!cuts.length) return emit(corners, normalsOf, fn, solid, view);
    let pieces: Array<{ vs: Corners; ns: Corners }> = [{ vs: corners, ns: normalsOf }];
    for (const cut of cuts) {
      const n = cut.points.length;
      for (let e = 0; e < n; e++) {
        const [p0, p1] = [cut.points[e]!, cut.points[(e + 1) % n]!];
        pieces = pieces.flatMap((piece) => cutTriangle(piece, cut.box, p0, p1, glazed, onView));
      }
    }
    for (const piece of pieces) {
      const at = onView(centreOf(piece.vs), glazed);
      const glass = cuts.some(
        (cut) =>
          at[0] >= cut.box[0] &&
          at[0] <= cut.box[2] &&
          at[1] >= cut.box[1] &&
          at[1] <= cut.box[3] &&
          inPolygon(at, cut.points)
      );
      emit(piece.vs, piece.ns, fn, glass ? 'glass' : solid, view);
    }
  };

  // ---------------------------------------------------------------- body
  const N = body.top.length;
  const section = carSection(body);
  const taperAt = stationTaper(body);
  const track = plan.track;
  const tyre = track?.tyre ?? DEFAULT_TYRE;
  const cx = track ? (track.x0 + track.x1) / 2 : 0.5;
  const outer = track ? (track.x1 - track.x0) / 2 : Math.max(...body.half) * DEFAULT_TRACK_SHARE;
  /** Half the gap between the wheel wells: the floor runs at its own height across it. */
  const wellHalf = Math.max(0, outer - tyre - WELL_GAP);
  const floor = floorLine(body, plan.wheels, h / d);
  const rings: V3[][] = [];
  const centres: number[] = [];
  /** Ring points of the underside (both edges, both well walls, the floor between). */
  const UNDER_POINTS = RING_UNDER + 5;
  for (let i = 0; i < N; i++) {
    const z = body.z0 + ((body.z1 - body.z0) * i) / (N - 1);
    const t = body.top[i]!;
    const b = Math.min(body.bottom[i]!, t);
    const f = Math.min(floor[i]!, b);
    const tp = taperAt(i);
    const halfAt = (y: number) => section(t, y) * tp;
    const ring: Array<[number, number]> = [];
    const hb = halfAt(b);
    const ht = halfAt(t);
    // Over a wheel the body's underside is the arch only above the tyres: between the wells the
    // floor stays at its own line (no slot across the car at each axle).
    const xi = Math.min(wellHalf, hb * 0.98);
    ring.push([0.5 - hb, b], [0.5 - xi, b], [0.5 - xi, f]);
    for (let u = 1; u < RING_UNDER; u++) ring.push([0.5 + (-1 + (2 * u) / RING_UNDER) * xi, f]);
    ring.push([0.5 + xi, f], [0.5 + xi, b], [0.5 + hb, b]);
    for (let k = 1; k <= RING_SIDE; k++) {
      const y = b + ((t - b) * k) / RING_SIDE;
      ring.push([0.5 + halfAt(y), y]);
    }
    for (let u = 1; u <= RING_ROOF; u++) ring.push([0.5 + (1 - (2 * u) / RING_ROOF) * ht, t]);
    for (let k = RING_SIDE - 1; k >= 1; k--) {
      const y = b + ((t - b) * k) / RING_SIDE;
      ring.push([0.5 - halfAt(y), y]);
    }
    rings.push(ring.map(([x, y]) => [X(x), Y(y), Z(z)]));
    centres.push(Y((b + t) / 2));
  }
  const P = rings[0]!.length;
  /** Ring index of the flank's top on the right: the roof's part runs from it. */
  const ROOF_FROM = UNDER_POINTS + RING_SIDE - 1;
  // Spans between two stations that lie past the wheels (the front and rear overhangs).
  const reach = (wh: CarPlan['wheels'][number]) => wh.r * (h / d) * ARCH_MARGIN;
  const firstWheel = Math.min(...plan.wheels.map((wh) => wh.z - reach(wh)));
  const lastWheel = Math.max(...plan.wheels.map((wh) => wh.z + reach(wh)));
  const overhang = Array.from({ length: N - 1 }, (_, i) => {
    if (!plan.wheels.length) return false;
    const z = body.z0 + ((body.z1 - body.z0) * (i + 0.5)) / (N - 1);
    return z < firstWheel || z > lastWheel;
  });
  // Spans that climb into the cabin (windscreen, rear window): only there may the roof be glass.
  const raked = cabinClimbs(body);
  const floorFace = { slot: 'under' as const, view: (underside ? 'bottom' : 'front') as UvView };
  // Smooth normals: across the ring and along the car, turned outward from the station's axis.
  const normals: V3[][] = rings.map((ring, i) =>
    ring.map((p, k) => {
      const across = sub(ring[(k + 1) % P]!, ring[(k - 1 + P) % P]!);
      const along = sub(rings[Math.min(N - 1, i + 1)]![k]!, rings[Math.max(0, i - 1)]![k]!);
      let n = unit(cross(across, along));
      const out: V3 = [p[0], p[1] - centres[i]!, 0];
      if (!n[0] && !n[1] && !n[2]) n = unit(out);
      return dot(n, out) < 0 ? [-n[0], -n[1], -n[2]] : n;
    })
  );
  for (let i = 0; i + 1 < N; i++)
    for (let k = 0; k < P; k++) {
      const q = (k + 1) % P;
      const [A, B, C, D] = [rings[i]![k]!, rings[i + 1]![k]!, rings[i + 1]![q]!, rings[i]![q]!];
      const [nA, nB, nC, nD] = [
        normals[i]![k]!,
        normals[i + 1]![k]!,
        normals[i + 1]![q]!,
        normals[i]![q]!,
      ];
      // The underside (floor and wheel wells) is the floor's, whatever way it faces, from the
      // first wheel to the last. Past them (nose, tail) a face of the underside ring that looks
      // forward or backward is the bumper's: it reads its elevation, not the floor's drawing.
      const below = q < UNDER_POINTS;
      const under = below && !overhang[i] ? floorFace : undefined;
      const part: RingPart = below
        ? 'under'
        : q <= ROOF_FROM
          ? 'right'
          : q <= ROOF_FROM + RING_ROOF
            ? 'roof'
            : 'left';
      tri([A, B, C], [nA, nB, nC], under, part, raked[i]);
      tri([A, C, D], [nA, nC, nD], under, part, raked[i]);
    }
  // End caps: the back and the nose, flat, each reading its drawing.
  for (const [i, sz] of [
    [0, -1],
    [N - 1, 1],
  ] as const) {
    const ring = rings[i]!;
    const c: V3 = [
      ring.reduce((s, p) => s + p[0], 0) / P,
      ring.reduce((s, p) => s + p[1], 0) / P,
      ring[0]![2],
    ];
    const n: V3 = [0, 0, sz];
    // A flat end that stands into the cabin (a van, a bus) carries its windscreen or rear window.
    const tall = carShoulder(body).rise(body.top[i]!) > DECK_BAND;
    for (let k = 0; k < P; k++)
      tri([c, ring[k]!, ring[(k + 1) % P]!], [n, n, n], undefined, 'roof', tall);
  }

  // ---------------------------------------------------------------- wheels
  for (const wh of plan.wheels) {
    // The axle: a tube from one tyre's inner face to the other's, under the floor's colour.
    const ar = wh.r * h * AXLE_SHARE;
    const [ay, az] = [Y(wh.y), Z(wh.z)];
    const [x0, x1] = [X(cx - (outer - tyre)), X(cx + (outer - tyre))];
    for (let s = 0; s < AXLE_SEGMENTS; s++) {
      const a0 = (2 * Math.PI * s) / AXLE_SEGMENTS;
      const a1 = (2 * Math.PI * (s + 1)) / AXLE_SEGMENTS;
      const n0: V3 = [0, Math.cos(a0), Math.sin(a0)];
      const n1: V3 = [0, Math.cos(a1), Math.sin(a1)];
      const at = (x: number, n: V3): V3 => [x, ay + ar * n[1], az + ar * n[2]];
      tri([at(x0, n0), at(x1, n0), at(x1, n1)], [n0, n0, n1], floorFace);
      tri([at(x0, n0), at(x1, n1), at(x0, n1)], [n0, n1, n1], floorFace);
    }
  }
  for (const wh of plan.wheels)
    for (const sx of [1, -1] as const) {
      const xc = X(cx + sx * (outer - tyre / 2));
      const [yc, zc] = [Y(wh.y), Z(wh.z)];
      const R = wh.r * h;
      const half = (tyre * w) / 2;
      const ring = (x: number, r = R): V3[] =>
        Array.from({ length: WHEEL_SEGMENTS }, (_, s) => {
          const a = (2 * Math.PI * s) / WHEEL_SEGMENTS;
          return [x, yc + r * Math.cos(a), zc + r * Math.sin(a)];
        });
      // A tyre with rounded shoulders: sidewall at `TYRE_SHOULDER` × R, tread over the middle.
      const rs = R * TYRE_SHOULDER;
      const bands = [
        ring(xc + sx * half, rs),
        ring(xc + sx * half * TYRE_TREAD),
        ring(xc - sx * half * TYRE_TREAD),
        ring(xc - sx * half, rs),
      ];
      const side: FaceView = sx > 0 ? 'right' : 'left';
      const out: V3 = [sx, 0, 0];
      const back: V3 = [-sx, 0, 0];
      /** A band's normal at segment s: radial, leaning out on the shoulders. */
      const lean = [sx * 0.6, 0, 0, -sx * 0.6];
      const nAt = (b: number, s: number): V3 => {
        const p = bands[b]![s]!;
        return unit([lean[b]!, (p[1] - yc) / R, (p[2] - zc) / R]);
      };
      for (let s = 0; s < WHEEL_SEGMENTS; s++) {
        const t = (s + 1) % WHEEL_SEGMENTS;
        for (let b = 0; b < 3; b++) {
          const [p, q] = [bands[b]!, bands[b + 1]!];
          tri([p[s]!, q[s]!, q[t]!], [nAt(b, s), nAt(b + 1, s), nAt(b + 1, t)], {
            slot: 'tyre',
            view: side,
          });
          tri([p[s]!, q[t]!, p[t]!], [nAt(b, s), nAt(b + 1, t), nAt(b, t)], {
            slot: 'tyre',
            view: side,
          });
        }
        const [o, inn] = [bands[0]!, bands[3]!];
        tri([[xc + sx * half, yc, zc], o[s]!, o[t]!], [out, out, out], { slot: 'rim', view: side });
        tri([[xc - sx * half, yc, zc], inn[t]!, inn[s]!], [back, back, back], {
          slot: 'tyre',
          view: side,
        });
      }
    }

  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    uv: new Float32Array(uvs),
    slot: Uint8Array.from(slots),
  };
}
