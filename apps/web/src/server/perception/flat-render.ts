/**
 * Flat renderer (PR-0.1): a recipe drawn at the photo view as colour, so the shape loop can compare it with
 * the photo crop. Orthographic, turned by the yaw, same frame as `renderRecipe` (the model's height fills the
 * rows, its width spans `h·aspect` across the columns, centred). One ray per pixel, exact primitives in
 * their unit space, nearest hit wins (z-buffer), Lambert shade of the part colour. Assemblies are drawn
 * as the viewer expands them (PQ-T3: frames, panes, sills, rims, caps, eave rolls, cell lines, beams),
 * glass seen through the hole cut in its wall; each pixel still names the recipe part it comes from.
 * Pure and deterministic; geometry and colours only.
 */
import { expandAssemblies } from '@/features/vision-insert/utils/assembly-parts';
import type { WallHole } from '@/features/vision-insert/utils/openings';
import { HIP_CLIP_MAX, wallTintFor, type ObjectRecipe, type RecipePart } from '@/lib/object-shape';
import { sdfNormal, sdfUnion, type SdfPoint } from '@/lib/sdf-field';
import { hexToRgb } from './color-measure';
import {
  applyTransform,
  emptyMask,
  partTransform,
  type Mask,
  type PartTransform,
} from './silhouette-fit';

type V3 = [number, number, number];

/** Light direction in view space (x right, y up, z to the camera): upper left, in front. */
export const FLAT_LIGHT: Readonly<V3> = normalize([-0.35, 0.6, 0.72]);
/** Share of the colour kept on faces turned away from the light. */
export const FLAT_AMBIENT = 0.4;

export interface FlatRender {
  /** 1 = the model covers the pixel. */
  mask: Mask;
  /** sRGB, 3 bytes per pixel, row-major; 0 outside the mask. */
  rgb: Uint8ClampedArray;
  /** Index of the visible recipe part per pixel (an assembly detail counts for its part), −1 outside. */
  part: Int16Array;
  /** Unshaded colour of each part (`#rrggbb`), by part index. */
  colors: readonly string[];
}

function normalize([x, y, z]: Readonly<V3>): V3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

const dot = (a: Readonly<V3>, b: Readonly<V3>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Inverse of a row-major 3 × 3 matrix, or null when flat. */
function invert(m: readonly number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [
    A * k,
    (c * h - b * i) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    (c * d - a * f) * k,
    C * k,
    (b * g - a * h) * k,
    (a * e - b * d) * k,
  ];
}

const mul = (m: readonly number[], [x, y, z]: Readonly<V3>): V3 => [
  m[0]! * x + m[1]! * y + m[2]! * z,
  m[3]! * x + m[4]! * y + m[5]! * z,
  m[6]! * x + m[7]! * y + m[8]! * z,
];

/** Ray span inside a convex solid, with the outward normal (unit space) where the ray enters. */
interface Span {
  tin: number;
  tout: number;
  n: V3 | null;
}

/** Keeps the part of the span where `n·p ≤ c`. */
function clipPlane(s: Span, o: V3, d: V3, n: V3, c: number): void {
  const den = dot(n, d);
  const num = c - dot(n, o);
  if (Math.abs(den) < 1e-12) {
    if (num < 0) s.tout = -Infinity;
    return;
  }
  const t = num / den;
  if (den < 0) {
    if (t > s.tin) {
      s.tin = t;
      s.n = n;
    }
  } else if (t < s.tout) s.tout = t;
}

/** Keeps the part of the span where `a t² + b t + c ≤ 0`; `grad` gives the normal at a point. */
function clipQuadric(s: Span, a: number, b: number, c: number, at: (t: number) => V3): void {
  let pieces: Array<[number, number]>;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) pieces = c <= 0 ? [[-Infinity, Infinity]] : [];
    else pieces = b > 0 ? [[-Infinity, -c / b]] : [[-c / b, Infinity]];
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) pieces = a > 0 ? [] : [[-Infinity, Infinity]];
    else {
      // Stable roots (no cancellation when `a` is tiny: a long cylinder seen almost along its axis).
      const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(disc)) / 2;
      // Ordered pair without a sort closure: the hot loop calls this per pixel per segment.
      const ra = q === 0 ? 0 : q / a;
      const rb = q === 0 ? 0 : c / q;
      const t1 = Math.min(ra, rb);
      const t2 = Math.max(ra, rb);
      pieces =
        a > 0
          ? [[t1, t2]]
          : [
              [-Infinity, t1],
              [t2, Infinity],
            ];
    }
  }
  // The solid is convex inside the slabs already clipped: at most one piece overlaps the span.
  const hit = pieces.find(([p, q]) => Math.max(p, s.tin) < Math.min(q, s.tout));
  if (!hit) {
    s.tout = -Infinity;
    return;
  }
  if (hit[0] > s.tin) {
    s.tin = hit[0];
    s.n = at(hit[0]);
  }
  s.tout = Math.min(s.tout, hit[1]);
}

const H = 0.5;

type Pt2 = readonly [number, number];

/** Even-odd point-in-ring test. */
function insideRing(ring: ReadonlyArray<Pt2>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Keeps the front-most part of the span whose xy runs inside `ring` (PR-2.1): ray–edge crossings
 * in t, even-odd paired, intersected with the z-slab span. Non-convex safe; only the front hit is
 * kept (what the z-buffer shows). Entry normals face the ray, whatever the winding.
 */
function clipPolygon(s: Span, o: V3, d: V3, ring: ReadonlyArray<Pt2>): void {
  const [ox, oy, dx, dy] = [o[0], o[1], d[0], d[1]];
  if (ring.length < 3 || Math.hypot(dx, dy) < 1e-12) {
    // Degenerate ring, or a ray along z: inside or out for the whole span.
    if (ring.length < 3 || !insideRing(ring, ox, oy)) s.tout = -Infinity;
    return;
  }
  // Edges strictly straddling the ray line: each crossing toggles inside/outside exactly once
  // (a pass-through vertex counts once, a tangent touch twice and cancels below).
  const hits: Array<{ t: number; nx: number; ny: number }> = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    if (dx * (a[1] - oy) - dy * (a[0] - ox) > 0 === dx * (b[1] - oy) - dy * (b[0] - ox) > 0)
      continue;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den;
    const nx = ey;
    const ny = -ex;
    const flip = nx * dx + ny * dy > 0 ? -1 : 1;
    hits.push({ t, nx: flip * nx, ny: flip * ny });
  }
  hits.sort((p, q) => p.t - q.t);
  // Same-t crossings come from one vertex: an even count cancels, an odd count toggles once.
  const toggles: Array<{ t: number; nx: number; ny: number }> = [];
  for (const h of hits) {
    const last = toggles[toggles.length - 1];
    if (last && Math.abs(last.t - h.t) < 1e-9) toggles.pop();
    else toggles.push(h);
  }
  let t = s.tin;
  // State just past the span entry (the entry itself may sit on the ring boundary).
  const probe = s.tin === -Infinity ? Infinity : Math.min(s.tin + 1e-7, (s.tin + s.tout) / 2);
  // Far outside any bounded ring the ray starts out.
  let inside = probe !== Infinity && insideRing(ring, ox + dx * probe, oy + dy * probe);
  let n = s.n;
  for (const h of toggles) {
    if (h.t <= t || h.t >= s.tout) continue;
    if (inside) {
      // Entered at t (or already inside at the span entry), leaves here.
      s.tin = t;
      s.n = n;
      s.tout = h.t;
      return;
    }
    t = h.t;
    n = [h.nx, h.ny, 0];
    inside = true;
  }
  if (!inside) {
    s.tout = -Infinity;
    return;
  }
  s.tin = t;
  s.n = n;
}

const Y_UP: V3 = [0, 1, 0];
const Y_DOWN: V3 = [0, -1, 0];
/** Placeholder normal for the shared scratch span; the winner's real normal is set below. */
const NO_NORMAL: V3 = [0, 0, 0];
const dummyAt = (): V3 => NO_NORMAL;

/** Outward cone normal at ray parameter `t` on the frustum (r0, y0) → (r1, y1). */
function frustumNormal(
  o: V3,
  d: V3,
  r0: number,
  r1: number,
  y0: number,
  y1: number,
  t: number
): V3 {
  const px = o[0] + d[0] * t;
  const py = o[1] + d[1] * t;
  const pz = o[2] + d[2] * t;
  const dr = r1 - r0;
  const m = dr === 0 ? 0 : dr / (y1 - y0);
  const rr = r0 + dr * ((py - y0) / (y1 - y0));
  return [px, 0 - m * rr, pz];
}

/**
 * Front-most ray hit on a lathe profile (PR-2.3): each segment is a cone frustum (or tube when
 * both radii match), solved with the tested quadric clipper inside its own y-slab; the nearest
 * segment wins. Slab entries lose the merge except at true rims (caps), where the plane normal
 * is the cap normal — so no flat bands at profile joints.
 *
 * Hot loop (per pixel per segment): the slab clips are inline scalars and one Span is reused,
 * so the loop allocates nothing except the winner's normal. Same tin/tout/n as the clipping
 * version — the quadric still decides, the cone normal applies exactly when its entry is in
 * front of the slab entry.
 */
function clipLathe(s: Span, o: V3, d: V3, profile: ReadonlyArray<Pt2>): void {
  const [ox, oy, oz] = o;
  const dy = d[1];
  const t: Span = { tin: 0, tout: 0, n: null };
  let hasBest = false;
  let bestTin = 0;
  let bestTout = 0;
  let bestN: V3 | null = null;
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, y0] = profile[i]!;
    const [r1, y1] = profile[i + 1]!;
    if (!(y1 > y0)) {
      // Flat annulus (rim or flange): disk hit at the plane, normal facing the ray.
      if (Math.abs(dy) < 1e-12) continue;
      const tHit = (y0 - oy) / dy;
      if (!(tHit > s.tin) || !(tHit < s.tout)) continue;
      const px = ox + d[0] * tHit;
      const pz = oz + d[2] * tHit;
      const rr = px * px + pz * pz;
      const a0 = Math.min(r0, r1);
      const a1 = Math.max(r0, r1);
      if (rr < a0 * a0 || rr > a1 * a1) continue;
      if (!hasBest || tHit < bestTin) {
        hasBest = true;
        bestTin = tHit;
        bestTout = tHit + 1e-9;
        bestN = [0, dy > 0 ? -1 : 1, 0];
      }
      continue;
    }
    // The two y-slab clips as scalar math (same thresholds and strictness as clipPlane).
    // Carry the incoming normal: a slab coinciding with an already-clipped plane keeps
    // its tin, and the cap normal with it (dropping it punches cap holes from above).
    let tin = s.tin;
    let tout = s.tout;
    let n: V3 | null = s.n;
    if (Math.abs(dy) < 1e-12) {
      if (oy > y1 || oy < y0) continue;
    } else if (dy < 0) {
      const ta = (y1 - oy) / dy;
      if (ta > tin) {
        tin = ta;
        n = Y_UP;
      }
      const tb = (y0 - oy) / dy;
      if (tb < tout) tout = tb;
      if (!(tin < tout)) continue;
    } else {
      const tb = (y1 - oy) / dy;
      if (tb < tout) tout = tb;
      const ta = (y0 - oy) / dy;
      if (ta > tin) {
        tin = ta;
        n = Y_DOWN;
      }
      if (!(tin < tout)) continue;
    }
    // Radius along the ray: r(t) = q0 + q1·t, linear in y like the cone case.
    const dr = r1 - r0;
    const u = (oy - y0) / (y1 - y0);
    const v = dy / (y1 - y0);
    const q0 = r0 + dr * u;
    const q1 = dr === 0 ? 0 : dr * v;
    t.tin = tin;
    t.tout = tout;
    t.n = null;
    clipQuadric(
      t,
      d[0] * d[0] + d[2] * d[2] - q1 * q1,
      2 * (ox * d[0] + oz * d[2] - q0 * q1),
      ox * ox + oz * oz - q0 * q0,
      dummyAt
    );
    if (!(t.tin < t.tout)) continue;
    if (hasBest && !(t.tin < bestTin)) continue;
    hasBest = true;
    bestTin = t.tin;
    bestTout = t.tout;
    bestN = t.tin > tin ? frustumNormal(o, d, r0, r1, y0, y1, t.tin) : n;
  }
  if (!hasBest) {
    s.tout = -Infinity;
    return;
  }
  s.tin = bestTin;
  s.tout = bestTout;
  s.n = bestN;
}

/** Marching steps of one SDF ray (an exact field converges in a dozen or so). */
const SDF_MARCH_STEPS = 64;
/** Field distance under which the ray has reached the surface (unit space). */
const SDF_MARCH_EPS = 2e-4;

/**
 * Sphere tracing on the shared union field (PQ-T53): the same blobs the viewer meshes,
 * so judge and viewer read one surface. `t` keeps the ray parameter (unit-space `t` is
 * view-space `t`: the part transform is affine), stepped by distance / |d|.
 */
function marchSdf(s: Span, o: V3, d: V3, blobs: RecipePart['blobs']): void {
  if (!blobs?.length) {
    s.tout = -Infinity;
    return;
  }
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  let t = Number.isFinite(s.tin) ? Math.max(s.tin, 0) : 0;
  for (let i = 0; i < SDF_MARCH_STEPS; i++) {
    if (t > s.tout) break;
    const p: SdfPoint = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const dist = sdfUnion(blobs, p);
    // At or inside the surface (a reused span may start inside): the entry is the hit.
    if (dist < SDF_MARCH_EPS) {
      s.tin = t;
      s.n = sdfNormal(blobs, p);
      return;
    }
    t += Math.max(dist / dl, SDF_MARCH_EPS / dl);
  }
  s.tout = -Infinity;
}

/** Ray (unit space) through one unit primitive (1 × 1 × 1 bounds, as the viewer's `unitPart`). */
function intersect(p: RecipePart, o: V3, d: V3): Span | null {
  const s: Span = { tin: -Infinity, tout: Infinity, n: null };
  const pt = (t: number): V3 => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  clipPlane(s, o, d, [0, 1, 0], H);
  clipPlane(s, o, d, [0, -1, 0], H);
  switch (p.shape) {
    case 'box':
    case 'prism':
    case 'extrude':
      clipPlane(s, o, d, [0, 0, 1], H);
      clipPlane(s, o, d, [0, 0, -1], H);
      if (p.shape === 'extrude') {
        clipPolygon(s, o, d, p.points ?? []);
      } else if (p.shape === 'box') {
        clipPlane(s, o, d, [1, 0, 0], H);
        clipPlane(s, o, d, [-1, 0, 0], H);
      } else {
        // Ridge at x = r, slopes down to the bottom corners.
        const r = Math.min(1, Math.max(0, p.apex ?? 0.5)) - H;
        clipPlane(s, o, d, [-1, r + H, 0], H - H * (r + H));
        clipPlane(s, o, d, [1, H - r, 0], H - H * (H - r));
      }
      break;
    case 'hip': {
      // Front / back slopes from the base edges to the ridge, hip ends to the ridge tips (n·p ≤ c).
      // Half-hip (PG-T22): the hip planes start at the gable shoulder y = −H + clip, not the base.
      const r = Math.min(1, Math.max(0, p.ridge ?? 0.5)) / 2;
      const yc = -H + Math.min(HIP_CLIP_MAX, Math.max(0, p.clip ?? 0));
      const k = (H - r) / (H - yc);
      const c = r + H * k;
      const unit = (n: V3): [V3, number] => {
        const l = Math.hypot(n[0], n[1], n[2]);
        return [[n[0] / l, n[1] / l, n[2] / l], l];
      };
      const plane = (n: V3, c: number) => {
        const [u, l] = unit(n);
        clipPlane(s, o, d, u, c / l);
      };
      plane([0, 1, 2], H);
      plane([0, 1, -2], H);
      plane([1, k, 0], c);
      plane([-1, k, 0], c);
      clipPlane(s, o, d, [1, 0, 0], H);
      clipPlane(s, o, d, [-1, 0, 0], H);
      break;
    }
    case 'cylinder':
      clipQuadric(
        s,
        d[0] ** 2 + d[2] ** 2,
        2 * (o[0] * d[0] + o[2] * d[2]),
        o[0] ** 2 + o[2] ** 2 - H * H,
        (t) => {
          const [x, , z] = pt(t);
          return [x, 0, z];
        }
      );
      break;
    case 'cone': {
      // Radius (0.5 − y) / 2: base 0.5 at y = −0.5, apex at y = 0.5.
      const q0 = (H - o[1]) / 2;
      const q1 = -d[1] / 2;
      clipQuadric(
        s,
        d[0] ** 2 + d[2] ** 2 - q1 * q1,
        2 * (o[0] * d[0] + o[2] * d[2] - q0 * q1),
        o[0] ** 2 + o[2] ** 2 - q0 * q0,
        (t) => {
          const [x, y, z] = pt(t);
          return [x, (H - y) / 4, z];
        }
      );
      break;
    }
    case 'sphere':
      clipQuadric(s, dot(d, d), 2 * dot(o, d), dot(o, o) - H * H, pt);
      break;
    case 'lathe':
      clipLathe(s, o, d, p.profile ?? []);
      break;
    case 'sdf':
      marchSdf(s, o, d, p.blobs);
      break;
    case 'hull': {
      // Front ring along z ∩ side ring along x (PV-H): the side clip runs in swapped (z, y, x) space.
      clipPolygon(s, o, d, p.points ?? []);
      if (s.tout === -Infinity) break;
      const before = s.n;
      clipPolygon(s, [o[2], o[1], o[0]], [d[2], d[1], d[0]], p.section ?? []);
      if (s.n && s.n !== before) s.n = [s.n[2], s.n[1], s.n[0]];
      break;
    }
  }
  return s.n && s.tin < s.tout ? s : null;
}

/** Depth difference under which two hits are the same surface. */
const TIE = 1e-6;

const CORNERS: V3[] = [-H, H].flatMap((x) =>
  [-H, H].flatMap((y) => [-H, H].map((z) => [x, y, z] as V3))
);

/** Extra camera turn for a look around the model: yaw (rad, around y), pitch (rad, + = seen from above). */
export interface FlatView {
  yaw: number;
  pitch: number;
}

/** The ¾ view of the contact sheet: turned 35°, seen 20° from above. */
export const THREE_QUARTER: FlatView = { yaw: (35 * Math.PI) / 180, pitch: (20 * Math.PI) / 180 };

/** `t` turned by the view: pitch·yaw·t (both rows of the matrix and the translation). */
function turned(t: PartTransform, { yaw, pitch }: FlatView): PartTransform {
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  const col = (x: number, y: number, z: number): V3 => {
    const [x1, z1] = [x * cy + z * sy, -x * sy + z * cy];
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  };
  const { m } = t;
  const c = [0, 1, 2].map((j) => col(m[j]!, m[3 + j]!, m[6 + j]!));
  return {
    m: [0, 1, 2].flatMap((i) => c.map((v) => v[i]!)),
    t: col(...t.t),
  };
}

/** Model bounds in view units (x right, y up) under a `FlatView`. */
export interface ViewBounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Grid window in view units: centre and full width / height. */
export interface ViewFrame {
  cx: number;
  cy: number;
  fw: number;
  fh: number;
}

type Dims = readonly [number, number, number];

/** True when a hit at `local` (unit space of `wall`) falls in one of its cut holes: the ray goes through. */
function inHole(local: V3, wall: RecipePart, holes: ReadonlyArray<WallHole>, dims: Dims): boolean {
  const off = local.map((v, i) => v * wall.size[i]! * dims[i]!);
  return holes.some((h) => {
    if (h.sign * local[h.axis] < 0.5 - 1e-3) return false;
    const u = h.axis === 2 ? off[0]! : off[2]!;
    return Math.abs(u - h.u) <= h.w / 2 && Math.abs(off[1]! - h.v) <= h.h / 2;
  });
}

/**
 * The recipe drawn on a `cols` × `rows` grid. Default: at the photo view (`aspect` = box width / height in
 * pixels, same frame as `renderRecipe`). With `view`: turned around the model and framed on its bounds
 * (contact sheet, 10 % margin), `aspect` unused; `frameOf` replaces that framing (elevation renders, PG-T1).
 */
export function renderFlat(
  recipe: ObjectRecipe,
  aspect: number,
  cols: number,
  rows: number,
  view?: FlatView,
  frameOf?: (bounds: ViewBounds) => ViewFrame
): FlatRender {
  const n = cols * rows;
  const mask = emptyMask(cols, rows);
  const rgb = new Uint8ClampedArray(n * 3);
  const part = new Int16Array(n).fill(-1);
  const depth = new Float64Array(n).fill(Infinity);
  const dims: Dims = [recipe.proportions.w, recipe.proportions.h, recipe.proportions.d];
  const { parts: drawn, holes, origin } = expandAssemblies(recipe);
  const transforms = drawn.map((p) => {
    const t = partTransform(recipe, p);
    return view ? turned(t, view) : t;
  });
  // Frame: centre and size in view units.
  let [cx, cy, fw, fh] = [0, 0, recipe.proportions.h * aspect, recipe.proportions.h];
  if (view) {
    // Framed on the recipe parts: details (a chimney cap, a sill) never rescale the picture.
    const kept = transforms.filter((_, j) => drawn[j] === recipe.parts[origin[j]!]);
    const pts = (kept.length ? kept : transforms).flatMap((t) =>
      CORNERS.map((c) => applyTransform(t, c))
    );
    const [x0, x1] = [Math.min(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[0]))];
    const [y0, y1] = [Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))];
    if (frameOf) ({ cx, cy, fw, fh } = frameOf({ x0, x1, y0, y1 }));
    else {
      const unit = Math.max((x1 - x0) / cols, (y1 - y0) / rows) * 1.1; // 10 % margin
      [cx, cy, fw, fh] = [(x0 + x1) / 2, (y0 + y1) / 2, unit * cols, unit * rows];
    }
  }
  const toCol = (x: number) => ((x - cx + fw / 2) / fw) * cols - 0.5;
  const toRow = (y: number) => ((cy + fh / 2 - y) / fh) * rows - 0.5;
  const EYE = 100; // in front of every part (recipes stay within ±2)

  drawn.forEach((p, j) => {
    const k = origin[j]!;
    const tf = transforms[j]!;
    const cut = holes.get(p);
    const inv = invert(tf.m);
    if (!inv) return;
    const box = CORNERS.map((c) => applyTransform(tf, c));
    const c0 = Math.max(0, Math.floor(Math.min(...box.map((b) => toCol(b[0])))));
    const c1 = Math.min(cols - 1, Math.ceil(Math.max(...box.map((b) => toCol(b[0])))));
    const r0 = Math.max(0, Math.floor(Math.min(...box.map((b) => toRow(b[1])))));
    const r1 = Math.min(rows - 1, Math.ceil(Math.max(...box.map((b) => toRow(b[1])))));
    // Ray toward −z in view space, mapped to the unit space of the part.
    const d = mul(inv, [0, 0, -1]);
    const [cr, cg, cb] = hexToRgb(p.color);
    const tintRgb = new Map<string, [number, number, number]>();
    for (let r = r0; r <= r1; r++) {
      const y = cy + fh / 2 - ((r + 0.5) / rows) * fh;
      for (let c = c0; c <= c1; c++) {
        const x = cx - fw / 2 + ((c + 0.5) / cols) * fw;
        const o = mul(inv, [x - tf.t[0], y - tf.t[1], EYE - tf.t[2]]);
        const hit = intersect(p, o, d);
        const i = r * cols + c;
        // Ties (a wheel flush with the body front) go to the later part: details come after the body.
        if (!hit || hit.tin > depth[i]! + TIE) continue;
        if (cut?.length) {
          const local: V3 = [o[0] + d[0] * hit.tin, o[1] + d[1] * hit.tin, o[2] + d[2] * hit.tin];
          if (inHole(local, p, cut, dims)) continue;
        }
        depth[i] = hit.tin;
        // Normals map by the inverse transpose.
        const [nx, ny, nz] = hit.n!;
        const nv = normalize([
          inv[0]! * nx + inv[3]! * ny + inv[6]! * nz,
          inv[1]! * nx + inv[4]! * ny + inv[7]! * nz,
          inv[2]! * nx + inv[5]! * ny + inv[8]! * nz,
        ]);
        const shade = FLAT_AMBIENT + (1 - FLAT_AMBIENT) * Math.max(0, dot(nv, FLAT_LIGHT));
        // Measured wall tints (PQ-T44 remedy 4): same face rule as the 3D view.
        const tint = wallTintFor(p, recipe.wallTints, hit.n!);
        let rr = cr;
        let gg = cg;
        let bb = cb;
        if (tint) {
          let v = tintRgb.get(tint);
          if (!v) {
            v = hexToRgb(tint);
            tintRgb.set(tint, v);
          }
          [rr, gg, bb] = v;
        }
        mask.data[i] = 1;
        part[i] = k;
        rgb[i * 3] = rr * shade;
        rgb[i * 3 + 1] = gg * shade;
        rgb[i * 3 + 2] = bb * shade;
      }
    }
  });
  return { mask, rgb, part, colors: recipe.parts.map((p) => p.color) };
}
