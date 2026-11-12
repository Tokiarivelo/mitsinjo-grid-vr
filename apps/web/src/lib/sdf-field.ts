import type { SdfBlob } from './object-shape';

/**
 * SDF smooth-union field (§8, PQ-T53): the shared maths behind the `sdf` shape. Pure TS,
 * no three.js (server and lib stay three-free): the viewer meshes it (`sdf-mesh.ts`), the
 * judge raymarches it (`flat-render.ts`), the fit samples it below. Unit space, y up.
 */

export type SdfPoint = readonly [number, number, number];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function sdSphere(p: SdfPoint, c: SdfPoint, r: number): number {
  return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;
}

function sdCapsule(p: SdfPoint, a: SdfPoint, b: SdfPoint, r: number): number {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const len2 = bax * bax + bay * bay + baz * baz;
  // A zero-length segment (halfLen 0) is a sphere: no division by zero.
  if (!(len2 > 1e-18)) return sdSphere(p, a, r);
  const h = clamp01(((p[0] - a[0]) * bax + (p[1] - a[1]) * bay + (p[2] - a[2]) * baz) / len2);
  return Math.hypot(p[0] - a[0] - bax * h, p[1] - a[1] - bay * h, p[2] - a[2] - baz * h) - r;
}

/** Bound of an ellipsoid (Inigo Quilez): exact enough to mesh and march, cheap to evaluate. */
function sdEllipsoid(p: SdfPoint, c: SdfPoint, r: SdfPoint): number {
  const k0 = Math.hypot((p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]);
  if (k0 < 1e-12) return -Math.min(r[0], r[1], r[2]);
  const k1 = Math.hypot(
    (p[0] - c[0]) / (r[0] * r[0]),
    (p[1] - c[1]) / (r[1] * r[1]),
    (p[2] - c[2]) / (r[2] * r[2])
  );
  return (k0 * (k0 - 1)) / (k1 || 1e-12);
}

function sdRoundBox(p: SdfPoint, c: SdfPoint, s: SdfPoint, r: number): number {
  const qx = Math.abs(p[0] - c[0]) - (s[0] / 2 - r);
  const qy = Math.abs(p[1] - c[1]) - (s[1] / 2 - r);
  const qz = Math.abs(p[2] - c[2]) - (s[2] / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  const az = Math.max(qz, 0);
  return Math.hypot(ax, ay, az) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/**
 * Polynomial smooth-min (Inigo Quilez): the organic joint (§8: neck, thigh) no union of
 * solids offers. k = 0 is the hard union; the bulge past the min-union stays under k / 4
 * (the schema's extent rule counts a full k of margin).
 */
export function sdfSmoothMin(a: number, b: number, k: number): number {
  if (!(k > 0)) return Math.min(a, b);
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
}

const AXIS_VEC = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const;

/** Distance from `p` to one blob's surface (< 0 inside). */
export function sdfBlob(blob: SdfBlob, p: SdfPoint): number {
  switch (blob.kind) {
    case 'sphere':
      return sdSphere(p, blob.c, blob.r);
    case 'capsule': {
      const v = AXIS_VEC[blob.axis];
      const a: SdfPoint = [
        blob.c[0] - v[0] * blob.halfLen,
        blob.c[1] - v[1] * blob.halfLen,
        blob.c[2] - v[2] * blob.halfLen,
      ];
      const b: SdfPoint = [
        blob.c[0] + v[0] * blob.halfLen,
        blob.c[1] + v[1] * blob.halfLen,
        blob.c[2] + v[2] * blob.halfLen,
      ];
      return sdCapsule(p, a, b, blob.r);
    }
    case 'ellipsoid':
      return sdEllipsoid(p, blob.c, blob.radii);
    case 'box':
      return sdRoundBox(p, blob.c, blob.size, blob.r);
  }
}

/**
 * The union field: blobs folded in order, each pair smoothed by the incoming blob's `k`.
 * Empty = +Infinity (no surface; the schema asks for ≥ 1 blob, the mesher stays total).
 */
export function sdfUnion(blobs: ReadonlyArray<SdfBlob>, p: SdfPoint): number {
  let d = Infinity;
  for (const blob of blobs)
    d = d === Infinity ? sdfBlob(blob, p) : sdfSmoothMin(d, sdfBlob(blob, p), blob.k ?? 0);
  return d;
}

/** Outward unit normal at `p` by central differences (smooth shading, judge Lambert). */
export function sdfNormal(
  blobs: ReadonlyArray<SdfBlob>,
  p: SdfPoint,
  eps = 1e-3
): [number, number, number] {
  const gx = sdfUnion(blobs, [p[0] + eps, p[1], p[2]]) - sdfUnion(blobs, [p[0] - eps, p[1], p[2]]);
  const gy = sdfUnion(blobs, [p[0], p[1] + eps, p[2]]) - sdfUnion(blobs, [p[0], p[1] - eps, p[2]]);
  const gz = sdfUnion(blobs, [p[0], p[1], p[2] + eps]) - sdfUnion(blobs, [p[0], p[1], p[2] - eps]);
  const len = Math.hypot(gx, gy, gz);
  // On the surface the gradient never vanishes (the field crosses 0 there); off it, up.
  if (!(len > 1e-12)) return [0, 1, 0];
  return [gx / len, gy / len, gz / len];
}

type Pt3 = [number, number, number];

/** Rings of a sphere, the silhouette fit's sampling (`unitPoints`): 5 levels × 12 + poles. */
function sphereSamples(c: SdfPoint, r: number): Pt3[] {
  const out: Pt3[] = [];
  for (const t of [-0.8, -0.4, 0, 0.4, 0.8]) {
    const rr = r * Math.sqrt(1 - t * t);
    for (let i = 0; i < 12; i++) {
      const a = (2 * Math.PI * i) / 12;
      out.push([c[0] + rr * Math.cos(a), c[1] + t * r, c[2] + rr * Math.sin(a)]);
    }
  }
  out.push([c[0], c[1] - r, c[2]], [c[0], c[1] + r, c[2]]);
  return out;
}

/**
 * Surface samples of the union for the fit outline (`silhouette-fit.ts` hulls them): each
 * blob sampled on its own surface, padded by its blend radius (a smooth-min bulge stays
 * under k / 4, so the padded samples bound the fused surface). Deterministic; ≤ 12 blobs
 * × ~130 points.
 */
export function sdfOutlinePoints(blobs: ReadonlyArray<SdfBlob>): Pt3[] {
  const out: Pt3[] = [];
  for (const blob of blobs) {
    const k = blob.k ?? 0;
    if (blob.kind === 'sphere') out.push(...sphereSamples(blob.c, blob.r + k));
    else if (blob.kind === 'capsule') {
      const v = AXIS_VEC[blob.axis];
      const a: SdfPoint = [
        blob.c[0] - v[0] * blob.halfLen,
        blob.c[1] - v[1] * blob.halfLen,
        blob.c[2] - v[2] * blob.halfLen,
      ];
      const b: SdfPoint = [
        blob.c[0] + v[0] * blob.halfLen,
        blob.c[1] + v[1] * blob.halfLen,
        blob.c[2] + v[2] * blob.halfLen,
      ];
      out.push(...sphereSamples(a, blob.r + k), ...sphereSamples(b, blob.r + k));
    } else if (blob.kind === 'ellipsoid') {
      const r: SdfPoint = [blob.radii[0] + k, blob.radii[1] + k, blob.radii[2] + k];
      for (const [x, y, z] of sphereSamples([0, 0, 0], 1))
        out.push([blob.c[0] + x * r[0], blob.c[1] + y * r[1], blob.c[2] + z * r[2]]);
    } else {
      const hx = blob.size[0] / 2 + k;
      const hy = blob.size[1] / 2 + k;
      const hz = blob.size[2] / 2 + k;
      const [cx, cy, cz] = blob.c;
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) out.push([cx + sx * hx, cy + sy * hy, cz + sz * hz]);
      out.push(
        [cx + hx, cy, cz],
        [cx - hx, cy, cz],
        [cx, cy + hy, cz],
        [cx, cy - hy, cz],
        [cx, cy, cz + hz],
        [cx, cy, cz - hz]
      );
    }
  }
  return out;
}
