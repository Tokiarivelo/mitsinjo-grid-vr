import type { ApplianceCategory } from '@mitsinjo/engine';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  HIP_CLIP_MAX,
  MAX_TRIANGLES,
  type ObjectRecipe,
  type RecipePart,
} from '@/lib/object-shape';
import { HULL_LEVELS, HULL_SLICES, hullLoops } from '@/lib/hull';
import { SURFACE_LOOK, SURFACES, surfaceIndex } from './surface-look';
import { holedBox } from './holed-wall';
import { expandAssemblies } from './assembly-parts';
import type { AssemblyDetail } from './openings';
import { planarUvs } from './surface-maps';
import { applyVertexAo } from './vertex-ao';
import { type ApplianceDetection, type NormBox, type SceneryType } from '@/lib/vision';

/**
 * Geometry of the 3D object editor (PV-T10). Pure (three.js only, no React): a Spark recipe → one merged,
 * vertex-coloured mesh; the silhouette fallback → the outline extruded. Built from shapes and measured
 * colours only: the photo is never pasted on the model (user choice). Object centred at the origin,
 * largest side = 1 scene unit.
 */

/** Depth of the silhouette extrusion, share of the object's largest side, by what the object is. */
export const SILHOUETTE_DEPTH: Record<ApplianceCategory, number> = {
  fridge: 0.6,
  freezer: 0.6,
  fridge_vaccine: 0.6,
  tv: 0.12,
  lamp: 0.3,
  fan: 0.3,
  laptop: 0.1,
  phone_charger: 0.3,
  radio: 0.35,
  water_pump: 0.5,
  rice_mill: 0.6,
  sewing_machine: 0.4,
  welder: 0.5,
  computer: 0.4,
  other: 0.3,
};

/** Same for scenery (no load). */
export const SCENERY_DEPTH: Record<SceneryType, number> = {
  building: 0.8,
  vehicle: 0.45,
  tree: 0.7,
  plant: 0.6,
  person: 0.3,
  animal: 0.4,
  water: 0.1,
  other: 0.3,
};

/** Extrusion depth share for an object: its scenery type first (category is `other`), else its category. */
export function silhouetteDepth(d: Pick<ApplianceDetection, 'category' | 'scenery'>): number {
  return d.scenery ? SCENERY_DEPTH[d.scenery] : SILHOUETTE_DEPTH[d.category];
}

/** Curve segments of round parts (≤ 12 parts × ~1 k triangles: far under the scene budget). */
export const ROUND_SEGMENTS = 24;
/** Sphere segments (PR-1.3): 396 triangles, smooth normals; 12 spheres stay under 5 k. */
export const SPHERE_SEGMENTS = [18, 12] as const;
/**
 * Roof overhang (PR-1.3), object units: each gable prism reaches past the walls on every side — eaves on
 * the slopes, verge over the front and back — so the roof reads as a roof, not a wedge on a box.
 */
export const ROOF_OVERHANG = 0.03;
/** Largest unit bevel of a prism: well under its triangle's inner radius (≈ 0.3), so the cap never flips. */
export const PRISM_BEVEL_MAX = 0.1;
/**
 * Unit gable prism (PF-T3): triangle (base at y −0.5, ridge at x `apex − 0.5`, y 0.5) extruded along z.
 * Non-indexed with flat normals and empty UVs, the same attributes as the other primitives so they merge.
 */
export function unitPrism(
  apex = 0.5,
  bevel?: readonly [number, number, number]
): THREE.BufferGeometry {
  const r = Math.min(1, Math.max(0, apex)) - 0.5;
  // Soft edges (PT-1c): the bevelled extrusion of the same triangle, cut inside it (bounds kept).
  if (bevel)
    return unitExtrude(
      [
        [-0.5, -0.5],
        [0.5, -0.5],
        [r, 0.5],
      ],
      { size: Math.min(bevel[0], bevel[1], PRISM_BEVEL_MAX), thickness: Math.min(bevel[2], 0.25) }
    );
  const tri = (z: number) => [-0.5, -0.5, z, 0.5, -0.5, z, r, 0.5, z];
  const [a, b, c] = [0, 1, 2].map((k) => tri(0.5).slice(k * 3, k * 3 + 3)) as [
    number[],
    number[],
    number[],
  ];
  const [a2, b2, c2] = [0, 1, 2].map((k) => tri(-0.5).slice(k * 3, k * 3 + 3)) as [
    number[],
    number[],
    number[],
  ];
  const quad = (p: number[], q: number[], s: number[], t: number[]) => [
    ...p,
    ...q,
    ...s,
    ...p,
    ...s,
    ...t,
  ];
  const positions = [
    ...a,
    ...b,
    ...c, // front (+z)
    ...a2,
    ...c2,
    ...b2, // back (−z)
    ...quad(a2, b2, b, a), // bottom
    ...quad(b, b2, c2, c), // right slope
    ...quad(c, c2, a2, a), // left slope
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2)
  );
  g.computeVertexNormals();
  return g;
}

/** Twice the area of a triangle (zero for the collapsed faces of a full hip or a gable). */
function triArea(a: number[], b: number[], c: number[]): number {
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
  return Math.hypot(
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!
  );
}

/**
 * Unit hipped roof (2D facade, user 2026-11-02): base 1 × 1 at y −0.5, ridge along x at y 0.5, z 0,
 * `ridge` × the width long (0 = pyramid, 1 = side gable). Front / back slopes, hip ends to the ridge
 * tips. `clip` > 0 (PG-T22 half-hip): each end is a vertical gable up to `clip` of the height, the
 * hip triangle above it. Non-indexed, flat normals, empty UVs like `unitPrism`.
 */
export function unitHip(ridge = 0.5, clip = 0): THREE.BufferGeometry {
  const r = Math.min(1, Math.max(0, ridge)) / 2;
  const c = Math.min(HIP_CLIP_MAX, Math.max(0, clip));
  const yc = -0.5 + c;
  const zc = 0.5 * (1 - c);
  const A = [-0.5, -0.5, 0.5];
  const B = [0.5, -0.5, 0.5];
  const C = [0.5, -0.5, -0.5];
  const D = [-0.5, -0.5, -0.5];
  const R1 = [-r, 0.5, 0];
  const R2 = [r, 0.5, 0];
  // Gable shoulders (equal to the base corners when c = 0).
  const BF = [0.5, yc, zc];
  const BB = [0.5, yc, -zc];
  const AF = [-0.5, yc, zc];
  const AB = [-0.5, yc, -zc];
  const tris = [
    // front slope (+z): A B BF R2 R1 AF
    [A, B, BF],
    [A, BF, R2],
    [A, R2, R1],
    [A, R1, AF],
    // back slope (−z): C D AB R1 R2 BB
    [C, D, AB],
    [C, AB, R1],
    [C, R1, R2],
    [C, R2, BB],
    // hip ends
    [BF, BB, R2],
    [AB, AF, R1],
    // gable ends (zero area when c = 0)
    ...(c > 0
      ? [
          [B, C, BB],
          [B, BB, BF],
          [D, A, AF],
          [D, AF, AB],
        ]
      : []),
    // bottom
    [A, D, C],
    [A, C, B],
  ];
  const positions = tris.filter(([p, q, w]) => triArea(p!, q!, w!) > 1e-9).flat(2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2)
  );
  g.computeVertexNormals();
  return g;
}

/** Corner segments of a rounded box: 300 triangles per box, 12 boxes stay under 5 k. */
export const ROUNDED_SEGMENTS = 2;
/** Below this radius (object units, ≈ 1 px in the viewer) the rounding is invisible: plain box, 12 triangles. */
export const MIN_RADIUS = 0.005;

/**
 * Box of its final size with rounded edges and smooth corner normals (PR-1.2), non-indexed, centred.
 * Built at size (not scaled afterwards) so the radius stays round on long thin parts; ≤ ¼ of the thinnest side.
 */
export function roundedBox(w: number, h: number, d: number, radius: number): THREE.BufferGeometry {
  const r = Math.min(radius, Math.min(w, h, d) / 4);
  if (r < MIN_RADIUS) {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    g.scale(w, h, d);
    return g;
  }
  const g = new RoundedBoxGeometry(w, h, d, ROUNDED_SEGMENTS, r);
  if (!g.index) return g;
  const flat = g.toNonIndexed();
  g.dispose();
  return flat;
}

/** Bevel of an extruded profile (PR-2.1), unit space: soft edge, exact 1 × 1 × 1 bounds. */
export const EXTRUDE_BEVEL = 0.02;

/** Inset bevel of an extrusion (PT-1c): `size` across the profile, `thickness` along z; bounds exact. */
export type ExtrudeBevel = { size: number; thickness: number };

/**
 * Unit extruded profile (PR-2.1): the closed `points` ring (x right, y up) with a thin bevel,
 * 1 deep along z, centred. Non-indexed so parts merge; either winding accepted. Default bevel reaches
 * `EXTRUDE_BEVEL` past the ring; an `inset` bevel cuts inside it instead, so the bounds stay the ring's.
 */
export function unitExtrude(
  points: ReadonlyArray<readonly [number, number]>,
  inset?: ExtrudeBevel
): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const size = inset ? inset.size : EXTRUDE_BEVEL;
  const thickness = inset ? inset.thickness : EXTRUDE_BEVEL;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 1 - 2 * thickness,
    bevelEnabled: true,
    bevelThickness: thickness,
    bevelSize: size,
    bevelOffset: inset ? -size : 0,
    bevelSegments: 1,
    steps: 1,
  });
  g.translate(0, 0, -0.5 + thickness);
  if (g.index) {
    const flat = g.toNonIndexed();
    g.dispose();
    return flat;
  }
  return g;
}

/** Radial segments of a lathe profile (PR-2.3): round tanks, cheap enough to merge. */
export const LATHE_SEGMENTS = 16;

/**
 * Unit body of revolution (PR-2.3): `profile` ([radius, height], rising y) revolved around y.
 * Non-indexed so parts merge; smooth normals so tanks read round.
 */
export function unitLathe(
  profile: ReadonlyArray<readonly [number, number]>,
  segments = LATHE_SEGMENTS
): THREE.BufferGeometry {
  const raw =
    profile.length >= 2
      ? profile
      : ([
          [0, -0.5],
          [0, 0.5],
        ] as const);
  const pts = raw.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  const g = new THREE.LatheGeometry(pts, segments);
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  return flat;
}

/** Soft edge (PT-1): share of a part's smallest side, capped by its surface's edge radius. */
export const EDGE_BEVEL = 0.06;

/** Bevel of a part of final size `w × h × d` (object units), ≤ `radius`. */
export function edgeBevel(w: number, h: number, d: number, radius: number): number {
  return Math.min(EDGE_BEVEL * Math.min(w, h, d), radius);
}

/**
 * Chamfered profile of a unit cylinder / cone (PT-1b), [radius, y] rising y: each rim is cut by `br` across
 * and `by` along the axis, so the cap meets the side on a highlight ring. Radius 0.5 stays (bounds kept);
 * the cone's apex stays sharp.
 */
export function roundProfile(
  shape: 'cylinder' | 'cone',
  br: number,
  by: number
): Array<[number, number]> {
  const [r, y] = [Math.min(br, 0.25), Math.min(by, 0.25)];
  const bottom: Array<[number, number]> = [
    [0, -0.5],
    [0.5 - r, -0.5],
    [0.5, -0.5 + y],
  ];
  if (shape === 'cone') return [...bottom, [0, 0.5]];
  return [...bottom, [0.5, 0.5 - y], [0.5 - r, 0.5], [0, 0.5]];
}

/** Bevel of a part in its unit space: a round part turned to `axis` swaps which size each unit axis takes. */
function unitBevel(
  b: number,
  [sx, sy, sz]: readonly [number, number, number],
  axis?: RecipePart['axis']
): readonly [number, number, number] {
  if (axis === 'x') return [b / sy, b / sx, b / sz];
  if (axis === 'z') return [b / sx, b / sz, b / sy];
  return [b / sx, b / sy, b / sz];
}

type HullLoop = { z: number; loop: Array<[number, number]> };

/**
 * Bevel ring at each end of a hull (PT-1a): the end loop moves in by `bz` (≤ half the gap to its
 * neighbour) and a copy shrunk toward its centre by `bx` / `by` takes its place, so the cap meets the
 * side on a slope. Bounds unchanged; + 4 × n triangles. `bevel` in unit space per axis.
 */
function bevelHullEnds(
  loops: HullLoop[],
  [bx, by, bz]: readonly [number, number, number]
): HullLoop[] {
  const inset = ({ z, loop }: HullLoop, out: 1 | -1, next: HullLoop) => {
    const n = loop.length;
    const cx = loop.reduce((t, p) => t + p[0], 0) / n;
    const cy = loop.reduce((t, p) => t + p[1], 0) / n;
    const shrunk = loop.map(([x, y]): [number, number] => {
      // Direction in world units (bevel units per axis), at most half way to the centre.
      const u = (x - cx) / bx;
      const v = (y - cy) / by;
      const len = Math.hypot(u, v);
      if (!(len > 1e-9)) return [x, y];
      const t = Math.min(1, len / 2) / len;
      return [x - u * t * bx, y - v * t * by];
    });
    const dz = Math.min(bz, Math.abs(next.z - z) / 2);
    return [
      { z, loop: shrunk },
      { z: z - out * dz, loop },
    ];
  };
  const last = loops.length - 1;
  const [backCap, back] = inset(loops[0]!, -1, loops[1]!);
  const [frontCap, front] = inset(loops[last]!, 1, loops[last - 1]!);
  return [backCap!, back!, ...loops.slice(1, last), front!, frontCap!];
}

/**
 * Unit visual hull (PV-H): cross-section loops along z (`hullLoops`) stitched into a smooth skin,
 * flat caps front and back, bevelled ends when `bevel` is given (PT-1a). Non-indexed so parts merge;
 * ≈ 1.6 k triangles.
 */
export function unitHull(
  points: ReadonlyArray<readonly [number, number]>,
  section: ReadonlyArray<readonly [number, number]>,
  slices = HULL_SLICES,
  levels = HULL_LEVELS,
  bevel?: readonly [number, number, number]
): THREE.BufferGeometry {
  const raw = hullLoops(points, section, slices, levels);
  if (raw.length < 2) return new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const loops = bevel ? bevelHullEnds(raw, bevel) : raw;
  const n = loops[0]!.loop.length;
  const pos: number[] = [];
  loops.forEach(({ z, loop }) => loop.forEach(([x, y]) => pos.push(x, y, z)));
  const index: number[] = [];
  for (let i = 0; i + 1 < loops.length; i++)
    for (let j = 0; j < n; j++) {
      const a = i * n + j;
      const b = i * n + ((j + 1) % n);
      const c = b + n;
      const d = a + n;
      index.push(a, b, c, a, c, d);
    }
  const skin = new THREE.BufferGeometry();
  skin.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  skin.setIndex(index);
  skin.computeVertexNormals();
  const flat = skin.toNonIndexed();
  skin.dispose();
  // Caps: fans from each end loop's centre, facing out (−z at the back, +z at the front).
  const cap: number[] = [];
  const capN: number[] = [];
  for (const [k, out] of [
    [0, -1],
    [loops.length - 1, 1],
  ] as const) {
    const { z, loop } = loops[k]!;
    const cx = loop.reduce((t, p) => t + p[0], 0) / n;
    const cy = loop.reduce((t, p) => t + p[1], 0) / n;
    for (let j = 0; j < n; j++) {
      const p = loop[j]!;
      const q = loop[(j + 1) % n]!;
      const [b, c] = out > 0 ? [p, q] : [q, p];
      cap.push(cx, cy, z, b[0], b[1], z, c[0], c[1], z);
      for (let v = 0; v < 3; v++) capN.push(0, 0, out);
    }
  }
  const caps = new THREE.BufferGeometry();
  caps.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3));
  caps.setAttribute('normal', new THREE.Float32BufferAttribute(capN, 3));
  const merged = mergeGeometries([flat, caps])!;
  flat.dispose();
  caps.dispose();
  return merged;
}

/** Slices and levels of a skin patch hull (≈ 100 triangles). */
const SKIN_SLICES = 8;
const SKIN_LEVELS = 6;

/** Unit primitive (1 × 1 × 1 bounds) along y, non-indexed so parts merge. */
function unitPart(
  shape: RecipePart['shape'],
  apex?: number,
  points?: RecipePart['points'],
  profile?: RecipePart['profile'],
  ridge?: number,
  section?: RecipePart['section'],
  body = true,
  clip?: number,
  bevel?: readonly [number, number, number]
): THREE.BufferGeometry {
  switch (shape) {
    case 'hull':
      // Skin patches (glass, grille on a hull body) are small: a coarse skin, sharp edges.
      return body
        ? unitHull(points ?? [], section ?? [], HULL_SLICES, HULL_LEVELS, bevel)
        : unitHull(points ?? [], section ?? [], SKIN_SLICES, SKIN_LEVELS);
    case 'prism':
      return unitPrism(apex, bevel);
    case 'hip':
      return unitHip(ridge, clip);
    case 'extrude':
      return unitExtrude(points ?? []);
    case 'lathe':
      return unitLathe(profile ?? []);
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    case 'cylinder':
    case 'cone':
      // Soft rims (PT-1b): the lathe on a chamfered profile; sharp three.js primitive without a bevel.
      if (bevel)
        return unitLathe(
          roundProfile(shape, Math.min(bevel[0], bevel[2]), bevel[1]),
          ROUND_SEGMENTS
        );
      return shape === 'cylinder'
        ? new THREE.CylinderGeometry(0.5, 0.5, 1, ROUND_SEGMENTS).toNonIndexed()
        : new THREE.ConeGeometry(0.5, 1, ROUND_SEGMENTS).toNonIndexed();
    case 'sphere':
      return new THREE.SphereGeometry(0.5, ...SPHERE_SEGMENTS).toNonIndexed();
  }
}

const color = new THREE.Color();

/**
 * Recipe → one merged, vertex-coloured body (windows, doors, roofs are parts of their own colour).
 * Parts are grouped by material: one geometry group per surface, `materialIndex` = `surfaceIndex`, so the
 * view draws stone matte and glass shiny in one mesh.
 */
export function recipeMesh(
  recipe: ObjectRecipe,
  detail: AssemblyDetail = 'full'
): THREE.BufferGeometry {
  // `low` (village low tier): straight to the light assemblies.
  if (detail === 'low') return buildMesh(recipe, 'low');
  // Assemblies at full detail; past the triangle budget, again without bars, panels, lintels (PG-T10).
  const full = buildMesh(recipe, 'full');
  if (triangleCount(full) <= MAX_TRIANGLES) return full;
  full.dispose();
  return buildMesh(recipe, 'low');
}

function buildMesh(recipe: ObjectRecipe, detail: AssemblyDetail): THREE.BufferGeometry {
  const dims = [recipe.proportions.w, recipe.proportions.h, recipe.proportions.d] as const;
  // Windows and doors drawn with frame, glass, bars and sill (PG-T8), cut into their wall (PG-T11).
  // Roofs with a bulge end in a rounded eave roll (PG-T12), chimneys may wear a cap (PG-T10);
  // half-timbered walls get their beams. Objects from their 2D view: wheel rims, solar cell lines (PG-T21).
  const { parts: expanded, holes } = expandAssemblies(recipe, detail, ROOF_OVERHANG);
  const sorted = expanded
    .map((p) => ({ p, surface: surfaceIndex(p.material) }))
    .sort((a, b) => a.surface - b.surface);
  const parts = sorted.map(({ p, surface }) => {
    const [sx, sy, sz] = [p.size[0] * dims[0], p.size[1] * dims[1], p.size[2] * dims[2]];
    let g: THREE.BufferGeometry;
    const cut = holes.get(p);
    if (p.shape === 'box' && cut?.length) {
      g = holedBox(sx, sy, sz, cut);
    } else if (p.shape === 'box') {
      g = roundedBox(sx, sy, sz, SURFACE_LOOK[SURFACES[surface]!].radius);
    } else {
      // Soft edges (PT-1), in unit space per axis so the bevel stays even once scaled.
      const b = edgeBevel(sx, sy, sz, SURFACE_LOOK[SURFACES[surface]!].radius);
      // Hull bodies have no axis; round parts (wheels, poles) map the bevel to their turned axes.
      const round = p.shape === 'cylinder' || p.shape === 'cone';
      const eave = p.shape === 'prism' ? 2 * ROOF_OVERHANG : 0;
      const bevel =
        b > 0 && (round || !p.axis) ? unitBevel(b, [sx + eave, sy, sz + eave], p.axis) : undefined;
      g = unitPart(
        p.shape,
        p.apex,
        p.points,
        p.profile,
        p.ridge,
        p.section,
        !!p.front,
        p.clip,
        bevel
      );
      // Round parts turn to their axis before taking the part's own x / y / z extent.
      if (p.axis === 'x') g.rotateZ(Math.PI / 2);
      else if (p.axis === 'z') g.rotateX(Math.PI / 2);
      g.scale(sx + eave, sy, sz + eave);
    }
    g.translate(p.at[0] * dims[0], p.at[1] * dims[1], p.at[2] * dims[2]);
    // Surface maps (PR-1.4) tile in object units, aligned with the walls (before the yaw); roof
    // slopes in their own plane (PG-T7).
    g.setAttribute(
      'uv',
      new THREE.BufferAttribute(
        planarUvs(
          g.getAttribute('position').array,
          g.getAttribute('normal').array,
          p.shape === 'prism' || p.shape === 'hip'
        ),
        2
      )
    );
    // Measured yaw (PF-T5): turned like on the photo.
    if (recipe.yaw) g.rotateY(recipe.yaw);
    // `set` already turns sRGB into the linear working space (ColorManagement): no second conversion.
    color.set(p.color);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  // Shadow where parts meet and on the ground (PQ-T27), baked once into the vertex colours.
  applyVertexAo(parts);
  const body = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  body.clearGroups();
  let start = 0;
  parts.forEach((g, i) => {
    const count = g.getAttribute('position').count;
    const surface = sorted[i]!.surface;
    if (i > 0 && sorted[i - 1]!.surface === surface) body.groups.at(-1)!.count += count;
    else body.addGroup(start, count, surface);
    start += count;
  });
  parts.forEach((g) => g.dispose());
  return body;
}

/** Width and height of the object (largest = 1) from its box on a photo of `photoAspect` (w / h, pixels). */
export function silhouetteSize(box: NormBox, photoAspect: number): [number, number] {
  const a = box.h > 0 && photoAspect > 0 ? (box.w * photoAspect) / box.h : 1;
  return a >= 1 ? [1, 1 / a] : [a, 1];
}

/**
 * Silhouette fallback: `rings` (box fractions, y down, from `silhouetteRings`) extruded by the category
 * depth. Each ring is its own piece (SAM may return several).
 */
export function silhouetteMesh(
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  box: NormBox,
  photoAspect: number,
  /** Depth as a share of the largest side (`silhouetteDepth`). */
  depthShare: number
): THREE.BufferGeometry {
  const [w, h] = silhouetteSize(box, photoAspect);
  const depth = depthShare * Math.max(w, h);
  const shapes = rings
    .filter((r) => r.length >= 3)
    .map(
      (r) => new THREE.Shape(r.map(([u, v]) => new THREE.Vector2((u - 0.5) * w, (0.5 - v) * h)))
    );
  // Soft edges (PT-1d): one bevel ring, inset by `bevelOffset` so the outline keeps its size; a thin body
  // (TV, water) keeps half its depth flat.
  const b = Math.min(EDGE_BEVEL * Math.max(w, h), depth / 4);
  const body = new THREE.ExtrudeGeometry(shapes, {
    depth: depth - 2 * b,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 1,
    curveSegments: 1,
  });
  body.translate(0, 0, -depth / 2 + b);
  return body;
}

/** Triangles of a geometry (for the scene budget). */
export function triangleCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
}
