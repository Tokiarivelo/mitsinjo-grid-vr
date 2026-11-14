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
/** The shoulder: the highest level of the front still this share of the body's widest. */
export const SHOULDER_SHARE = 0.92;
/** A station whose top is within this share of the cabin's height above the shoulder is a deck. */
export const DECK_BAND = 0.35;
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
 * Half-width of the body at height `y` on a station whose top is `t` (shares; 0–0.5). Below the
 * shoulder the front's section; above it the cabin, never wider going up and holding its width
 * under the drawing's rounded top; a deck station (bonnet, boot) keeps the shoulder's width up to
 * its top. Every top edge rounds in a little (`EDGE_IN`).
 */
export function carSection(body: Pick<CarBody, 'half' | 'top'>): (t: number, y: number) => number {
  const half = body.half;
  const L = half.length;
  const max = Math.max(...half);
  let widest = half.indexOf(max);
  while (widest + 1 < L && half[widest + 1]! >= SHOULDER_SHARE * max) widest++;
  const shoulder = widest / (L - 1);
  const shoulderHalf = half[widest]!;
  const roof = Math.max(...body.top);
  // At least one and a half levels: a coarse front still loses its rounded top row.
  const crown = Math.max(shoulder, roof - Math.max(ROOF_CROWN, 1.5 / (L - 1)));
  // The cabin, monotone: each level no wider than the one under it.
  const cabin = [...half];
  for (let j = widest + 1; j < L; j++) cabin[j] = Math.min(cabin[j]!, cabin[j - 1]!);
  const deckTop = shoulder + DECK_BAND * Math.max(0, roof - shoulder);
  const edge = (w: number, t: number, y: number) => {
    const k = (y - (t - EDGE_BAND)) / EDGE_BAND;
    return k > 0 ? w * (1 - EDGE_IN * Math.min(1, k) ** 2) : w;
  };
  return (t, y) => {
    if (y <= shoulder) return edge(sample(half, y), t, y);
    if (t <= deckTop) return edge(shoulderHalf, t, y);
    return edge(sample(cabin, Math.min(y, crown)), t, y);
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
  const slotOf = (s: CarSlot) => CAR_SLOTS.indexOf(s);

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
  const windowsOf = (v: CarWindow['view']): CarWindow[] => {
    const own = (plan.windows ?? []).filter((x) => x.view === v);
    if (own.length || (v !== 'right' && v !== 'left')) return own;
    // A side the team did not read wears the other side's windows (same z, same y).
    return (plan.windows ?? []).filter((x) => x.view === (v === 'right' ? 'left' : 'right'));
  };
  const glassAt = (c: V3, view: AtlasView) => {
    if (view === 'top') return false;
    const [x, y, z] = shares(c);
    const pt: [number, number] = view === 'front' || view === 'back' ? [x, y] : [z, y];
    return windowsOf(view).some((win) => inPolygon(pt, win.points));
  };

  /**
   * A triangle with its vertex normals, wound to face the mean of them. Its slot: `fixed`, else
   * the drawing it faces (the glass inside a window, the underside under the car).
   */
  const tri = (vs: [V3, V3, V3], ns: [V3, V3, V3], fixed?: { slot: CarSlot; view?: UvView }) => {
    // A normal across a crease takes the face's own: flat panels stay flat.
    const crease = (n: V3, f: V3): V3 => (dot(n, f) < CREASE_COS ? f : n);
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
    let slot: CarSlot;
    let view: UvView;
    if (fixed) {
      slot = fixed.slot;
      view = fixed.view ?? viewOf(fn);
    } else if (fn[1] < -0.6) {
      slot = 'under';
      view = underside ? 'bottom' : 'front';
    } else {
      view = viewOf(fn);
      const centre: V3 = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ];
      // A face turned up is the roof even without a drawing from above (its uv reads a flank).
      slot = glassAt(centre, view)
        ? 'glass'
        : view === 'top' || fn[1] > ROOF_UP
          ? 'roof'
          : (view as FaceView);
    }
    for (const [p, n] of [
      [a, na],
      [b, nb],
      [c, nc],
    ] as const) {
      const m = crease(n, fn);
      pos.push(p[0], p[1], p[2]);
      nrm.push(m[0], m[1], m[2]);
      uvs.push(...uvOf(p, view));
    }
    slots.push(slotOf(slot));
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
      // The underside (floor and wheel wells) is the floor's, whatever way it faces.
      const under = q < UNDER_POINTS ? floorFace : undefined;
      tri([A, B, C], [nA, nB, nC], under);
      tri([A, C, D], [nA, nC, nD], under);
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
    for (let k = 0; k < P; k++) tri([c, ring[k]!, ring[(k + 1) % P]!], [n, n, n]);
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
