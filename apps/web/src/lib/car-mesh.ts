import type { CarPlan, CarWindow } from './car-plan';
import { atlasUv, faceSlot, type AtlasView, type FaceView } from './face-atlas';

/**
 * A car built from its plan (PQ-T76), pure: the body lofted along the car (one ring per station:
 * its height the profile, its width at each height the front section narrowed by the taper), with
 * smooth normals, its underside raised over each wheel; the wheels as cylinders. Every triangle
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
}

/** Ring segments: across the underside, up each flank, across the roof. */
export const RING_UNDER = 6;
export const RING_SIDE = 14;
export const RING_ROOF = 10;
/** Segments round a wheel. */
export const WHEEL_SEGMENTS = 28;
/** A body face whose normal points up past this (y component) is roof. */
export const ROOF_UP = 0.7;
/** Tyre width (share of the box width) and track when the front gave none. */
export const DEFAULT_TYRE = 0.1;
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

/** The car as triangles in the model's frame (`dims` = w, h, d); null without a fitted body. */
export function carMesh(
  plan: CarPlan,
  dims: readonly [number, number, number],
  { views = ['front'] }: CarMeshOptions = {}
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

  const uvOf = (p: V3, view: AtlasView): [number, number] => {
    const [x, y, z] = shares(p);
    if (view === 'top') return atlasUv(faceSlot('top'), clamp01(x), clamp01(z));
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
  const tri = (vs: [V3, V3, V3], ns: [V3, V3, V3], fixed?: { slot: CarSlot; view?: AtlasView }) => {
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
    let view: AtlasView;
    if (fixed) {
      slot = fixed.slot;
      view = fixed.view ?? viewOf(fn);
    } else if (fn[1] < -0.6) {
      slot = 'under';
      view = 'front';
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
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
      uvs.push(...uvOf(p, view));
    }
    slots.push(slotOf(slot));
  };

  // ---------------------------------------------------------------- body
  const N = body.top.length;
  const halfAt = (y: number) => sample(body.half, y);
  const rings: V3[][] = [];
  const centres: number[] = [];
  for (let i = 0; i < N; i++) {
    const z = body.z0 + ((body.z1 - body.z0) * i) / (N - 1);
    const t = body.top[i]!;
    const b = Math.min(body.bottom[i]!, t);
    const tp = body.taper ? sample(body.taper, i / (N - 1)) : 1;
    const ring: Array<[number, number]> = [];
    const hb = halfAt(b) * tp;
    const ht = halfAt(t) * tp;
    for (let u = 0; u <= RING_UNDER; u++) ring.push([0.5 + (-1 + (2 * u) / RING_UNDER) * hb, b]);
    for (let k = 1; k <= RING_SIDE; k++) {
      const y = b + ((t - b) * k) / RING_SIDE;
      ring.push([0.5 + halfAt(y) * tp, y]);
    }
    for (let u = 1; u <= RING_ROOF; u++) ring.push([0.5 + (1 - (2 * u) / RING_ROOF) * ht, t]);
    for (let k = RING_SIDE - 1; k >= 1; k--) {
      const y = b + ((t - b) * k) / RING_SIDE;
      ring.push([0.5 - halfAt(y) * tp, y]);
    }
    rings.push(ring.map(([x, y]) => [X(x), Y(y), Z(z)]));
    centres.push(Y((b + t) / 2));
  }
  const P = rings[0]!.length;
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
      tri([A, B, C], [nA, nB, nC]);
      tri([A, C, D], [nA, nC, nD]);
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
  const track = plan.track;
  const tyre = track?.tyre ?? DEFAULT_TYRE;
  const cx = track ? (track.x0 + track.x1) / 2 : 0.5;
  const outer = track ? (track.x1 - track.x0) / 2 : Math.max(...body.half) * DEFAULT_TRACK_SHARE;
  for (const wh of plan.wheels)
    for (const sx of [1, -1] as const) {
      const xc = X(cx + sx * (outer - tyre / 2));
      const [yc, zc] = [Y(wh.y), Z(wh.z)];
      const R = wh.r * h;
      const half = (tyre * w) / 2;
      const ring = (x: number): V3[] =>
        Array.from({ length: WHEEL_SEGMENTS }, (_, s) => {
          const a = (2 * Math.PI * s) / WHEEL_SEGMENTS;
          return [x, yc + R * Math.cos(a), zc + R * Math.sin(a)];
        });
      const [o, inn] = [ring(xc + sx * half), ring(xc - sx * half)];
      const side: FaceView = sx > 0 ? 'right' : 'left';
      const out: V3 = [sx, 0, 0];
      const back: V3 = [-sx, 0, 0];
      for (let s = 0; s < WHEEL_SEGMENTS; s++) {
        const t = (s + 1) % WHEEL_SEGMENTS;
        const r0 = unit([0, o[s]![1] - yc, o[s]![2] - zc]);
        const r1 = unit([0, o[t]![1] - yc, o[t]![2] - zc]);
        tri([o[s]!, inn[s]!, inn[t]!], [r0, r0, r1], { slot: 'tyre', view: side });
        tri([o[s]!, inn[t]!, o[t]!], [r0, r1, r1], { slot: 'tyre', view: side });
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
