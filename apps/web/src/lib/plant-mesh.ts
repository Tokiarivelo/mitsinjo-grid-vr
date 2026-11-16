import type {
  PlantLeaf,
  PlantMass,
  PlantPlan,
  PlantStem,
  PlantStrand,
  PlantTier,
} from './plant-plan';
import { mulberry32 } from './seeded-random';

/**
 * A plant as triangles (PQ-T82), from its plan (`plant-plan.ts`), in the model's frame (centred,
 * y up, `dims` = w, h, d): trunks, limbs and canes as tubes along their centre lines (a lean or a
 * fork follows the drawing, never a stack of boxes); each foliage mass a closed lumpy ball bristling
 * with leaf cards (its outline breaks up like leaves, it is never hollow); a weeping curtain as
 * hanging ribbons; palm fronds, banana paddles, grass blades and agave spikes as whole leaves; a
 * conifer as stacked skirts. Closed solids face out; thin leaves are two-sided. Pure and
 * deterministic (`plan.seed`). One slot per triangle: the viewer draws a material per slot.
 */

export const PLANT_SLOTS = ['bark', 'leaf', 'leafDark', 'flower', 'pot', 'soil'] as const;
/** Slots whose thin surfaces (cards, strands, whole leaves) the material draws on both sides. */
export const PLANT_TWO_SIDED: ReadonlySet<string> = new Set(['leaf', 'leafDark', 'flower']);
export type PlantSlot = (typeof PLANT_SLOTS)[number];
const SLOT: Record<PlantSlot, number> = {
  bark: 0,
  leaf: 1,
  leafDark: 2,
  flower: 3,
  pot: 4,
  soil: 5,
};
/** Potting soil under the leaves: dark earth (VS-T25). */
export const PLANT_SOIL = '#3f2e22';

/** The colour of every slot: measured on the drawing (bark, leaves, flowers, pot), the soil fixed. */
export function plantSlotColors(plan: Pick<PlantPlan, 'look' | 'pot'>): Record<PlantSlot, string> {
  const { look } = plan;
  return {
    bark: look.bark,
    leaf: look.leaf,
    leafDark: look.leafDark,
    flower: look.flower ?? look.leaf,
    pot: plan.pot?.color ?? look.bark,
    soil: PLANT_SOIL,
  };
}

/** Sides round a pot; its wall's thickness (share of the rim radius); soil this far under the rim (share of its height). */
export const POT_SIDES = 32;
export const POT_WALL = 0.07;
export const POT_SOIL_DROP = 0.06;

export interface PlantMesh {
  /** Non-indexed triangles: 9 floats each. */
  position: Float32Array;
  normal: Float32Array;
  /** The front projection (`plan.skin`); without a skin the viewer maps its own textures. */
  uv: Float32Array;
  /** `PLANT_SLOTS` index per triangle. */
  slot: Uint8Array;
}

/** Sides round a trunk, a limb. */
export const TRUNK_SIDES = 10;
export const BRANCH_SIDES = 6;
/** How far a mass's surface wanders in and out, share of its radius: lumps of leaves. */
export const MASS_LUMP = 0.24;
/** Triangles the foliage balls may take in all; a ball is subdivided as far as its share allows. */
export const MASS_TRIANGLES = 7200;
/** Leaf cards the foliage may carry in all (2 triangles each, drawn two-sided). */
export const CARDS_MAX = 1400;
/** A leaf card's size, share of its mass's mean radius (broad leaves; needles are thinner). */
export const CARD_SIZE = 0.4;
/** Segments of a hanging strand, of a whole leaf, round a conifer skirt. */
export const STRAND_SEGMENTS = 7;
export const LEAF_SEGMENTS = 10;
/** Leaflets on each side of a cut frond (a coconut's comb). */
export const FROND_LEAFLETS = 22;
/** Width of a cut frond's bare rachis, share of its width. */
const RACHIS_SHARE = 0.06;
export const TIER_SIDES = 18;
/** A hanging strand's arch over its top: share of its drop, and its segments. */
export const STRAND_ARCH = 0.22;
export const STRAND_ARCH_SEGMENTS = 3;
/** Pleated blades of a palmate leaf, and the angle its fan opens round its top. */
export const FAN_PLEATS = 22;
export const FAN_ARC = Math.PI * 1.75;

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};

/** An icosahedron subdivided `level` times, on the unit sphere: vertices and faces wound out. */
export function icosphere(level: number): { v: V3[]; f: Array<[number, number, number]> } {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: V3[] = (
    [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ] as V3[]
  ).map(unit);
  let f: Array<[number, number, number]> = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let k = 0; k < level; k++) {
    const mid = new Map<string, number>();
    const at = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mid.get(key);
      if (i === undefined) {
        i = v.length;
        v.push(unit(mul(add(v[a]!, v[b]!), 0.5)));
        mid.set(key, i);
      }
      return i;
    };
    const next: typeof f = [];
    for (const [a, b, c] of f) {
      const [ab, bc, ca] = [at(a, b), at(b, c), at(c, a)];
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    f = next;
  }
  // Wound out: each face's normal along its centre's direction.
  f = f.map(([a, b, c]) => {
    const n = cross(sub(v[b]!, v[a]!), sub(v[c]!, v[a]!));
    return dot(n, add(add(v[a]!, v[b]!), v[c]!)) >= 0 ? [a, b, c] : [a, c, b];
  });
  return { v, f };
}

const SPHERES = [0, 1, 2, 3].map(icosphere);
const faces = (level: number) => 20 * 4 ** level;

/** Smooth seeded noise on the sphere, about −1…1: a few waves of random direction and phase. */
function lumps(seed: number) {
  const rnd = mulberry32(seed);
  const waves = Array.from({ length: 6 }, () => ({
    d: unit([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]),
    f: 2.2 + rnd() * 3.2,
    p: rnd() * Math.PI * 2,
    a: 0.6 + rnd() * 0.4,
  }));
  const total = waves.reduce((s, w) => s + w.a, 0);
  return (n: V3) => waves.reduce((s, w) => s + w.a * Math.sin(dot(n, w.d) * w.f + w.p), 0) / total;
}

/** A point at `t` (0..1) on the Catmull-Rom curve through `pts` (ends repeated). */
export function catmull(pts: readonly V3[], t: number): V3 {
  const n = pts.length - 1;
  const f = Math.min(n - 1e-9, Math.max(0, t * n));
  const i = Math.floor(f);
  const u = f - i;
  const p0 = pts[Math.max(0, i - 1)]!;
  const [p1, p2] = [pts[i]!, pts[i + 1]!];
  const p3 = pts[Math.min(n, i + 2)]!;
  const c = (k: 0 | 1 | 2) =>
    0.5 *
    (2 * p1[k] +
      (p2[k] - p0[k]) * u +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u +
      (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u * u * u);
  return [c(0), c(1), c(2)];
}

/**
 * Uvs of the drawing's projection: a face turned to the front or the back reads the front drawing
 * where it falls on it (x across); a face turned sideways reads it across its depth (z), the side
 * of a plant being its front; one turned up or down the same as its nearest side. Per triangle, so
 * a triangle never straddles two projections. The skin spans the plant's box (v up).
 */
function frontUv(
  pos: number[],
  nrm: number[],
  dims: readonly [number, number, number]
): Float32Array {
  const [w, h, d] = dims;
  const uv = new Float32Array((pos.length / 3) * 2);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  for (let t = 0; t < pos.length; t += 9) {
    // The triangle's facing: the sum of its vertex normals.
    let [nx, nz] = [0, 0];
    for (let k = 0; k < 9; k += 3) {
      nx += Math.abs(nrm[t + k]!);
      nz += Math.abs(nrm[t + k + 2]!);
    }
    const sideways = nx > nz;
    for (let k = 0; k < 9; k += 3) {
      const j = ((t + k) / 3) * 2;
      uv[j] = clamp(sideways ? pos[t + k + 2]! / d + 0.5 : pos[t + k]! / w + 0.5);
      uv[j + 1] = clamp(pos[t + k + 1]! / h + 0.5);
    }
  }
  return uv;
}

/** The plant as triangles; empty arrays for an empty plan. */
export function plantMesh(plan: PlantPlan, dims: readonly [number, number, number]): PlantMesh {
  const [w, h, d] = dims;
  const big = Math.max(w, h, d);
  const P = (p: readonly [number, number, number]): V3 => [
    (p[0] - 0.5) * w,
    (p[1] - 0.5) * h,
    (p[2] - 0.5) * d,
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const slots: number[] = [];
  const tri = (a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3, slot: PlantSlot) => {
    pos.push(...a, ...b, ...c);
    nrm.push(...na, ...nb, ...nc);
    slots.push(SLOT[slot]);
  };
  /**
   * A thin surface (a leaf, a strand): the quad a b c e (in order round it), facing `n`, emitted
   * once. Its material draws both sides (`PLANT_TWO_SIDED`): two faces back to back would fight
   * over every pixel.
   */
  const card = (a: V3, b: V3, c: V3, e: V3, n: V3, slot: PlantSlot) => {
    const f = cross(sub(b, a), sub(c, a));
    if (dot(f, n) >= 0) {
      tri(a, b, c, n, n, n, slot);
      tri(a, c, e, n, n, n, slot);
    } else {
      tri(a, c, b, n, n, n, slot);
      tri(a, e, c, n, n, n, slot);
    }
  };
  const rnd = mulberry32(plan.seed);

  // ---------------------------------------------------------------- stems
  for (const stem of plan.stems) tube(stem);

  function tube(stem: PlantStem) {
    const pts = stem.points.map(P);
    const radii = stem.r.map((r) => r * big);
    const sides = stem.kind === 'trunk' || stem.green ? TRUNK_SIDES : BRANCH_SIDES;
    const slot: PlantSlot = stem.green ? 'leaf' : 'bark';
    // Frames carried along the line (no twist): `u`, `v` across it.
    const dirs = pts.map((_, i) =>
      unit(sub(pts[Math.min(pts.length - 1, i + 1)]!, pts[Math.max(0, i - 1)]!))
    );
    let u = unit(cross(dirs[0]!, Math.abs(dirs[0]![1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const rings: V3[][] = [];
    const ns: V3[][] = [];
    pts.forEach((p, i) => {
      const t = dirs[i]!;
      u = unit(sub(u, mul(t, dot(u, t))));
      const v = cross(t, u);
      const ring: V3[] = [];
      const nring: V3[] = [];
      for (let s = 0; s < sides; s++) {
        const a = (2 * Math.PI * s) / sides;
        const n = add(mul(u, Math.cos(a)), mul(v, Math.sin(a)));
        ring.push(add(p, mul(n, radii[i]!)));
        nring.push(n);
      }
      rings.push(ring);
      ns.push(nring);
    });
    for (let i = 0; i + 1 < rings.length; i++)
      for (let s = 0; s < sides; s++) {
        const q = (s + 1) % sides;
        const [A, B, C, D] = [rings[i]![s]!, rings[i]![q]!, rings[i + 1]![q]!, rings[i + 1]![s]!];
        const [nA, nB, nC, nD] = [ns[i]![s]!, ns[i]![q]!, ns[i + 1]![q]!, ns[i + 1]![s]!];
        tri(A, B, C, nA, nB, nC, slot);
        tri(A, C, D, nA, nC, nD, slot);
      }
    // Capped at both ends, facing out of the tube.
    const cap = (k: number, out: V3) => {
      const ring = rings[k]!;
      const c = pts[k]!;
      for (let s = 0; s < sides; s++) {
        const [a, b] = [ring[s]!, ring[(s + 1) % sides]!];
        const n = cross(sub(a, c), sub(b, c));
        if (dot(n, out) >= 0) tri(c, a, b, out, out, out, slot);
        else tri(c, b, a, out, out, out, slot);
      }
    };
    cap(0, mul(dirs[0]!, -1));
    cap(rings.length - 1, dirs[dirs.length - 1]!);
  }

  // ---------------------------------------------------------------- foliage masses
  const masses = plan.masses;
  if (masses.length) {
    const share = MASS_TRIANGLES / masses.length;
    const level = [3, 2, 1, 0].find((l) => faces(l) <= share) ?? 0;
    const sphere = SPHERES[level]!;
    const cardsEach = Math.min(64, Math.floor(CARDS_MAX / masses.length));
    const needle = plan.leaf === 'needle' || plan.leaf === 'scale';
    masses.forEach((m, k) => massBall(m, k, sphere, cardsEach, needle));
  }

  function massBall(
    m: PlantMass,
    k: number,
    sphere: { v: V3[]; f: Array<[number, number, number]> },
    cards: number,
    needle: boolean
  ) {
    const c = P(m.c);
    const r: V3 = [m.r[0] * w, m.r[1] * h, m.r[2] * d];
    const noise = lumps(plan.seed + 7919 * (k + 1));
    const slot: PlantSlot = m.shade ? 'leafDark' : 'leaf';
    /** A point of the surface in the direction `n` (unit), and the radius factor there. */
    const at = (n: V3): V3 => {
      const f = 1 + MASS_LUMP * noise(n);
      return add(c, [n[0] * r[0] * f, n[1] * r[1] * f, n[2] * r[2] * f]);
    };
    const vs = sphere.v.map(at);
    // Smooth normals: the faces round each vertex.
    const vn: V3[] = vs.map(() => [0, 0, 0]);
    for (const [a, b, e] of sphere.f) {
      const n = cross(sub(vs[b]!, vs[a]!), sub(vs[e]!, vs[a]!));
      for (const i of [a, b, e]) vn[i] = add(vn[i]!, n);
    }
    for (const [a, b, e] of sphere.f) {
      // A lump folded over can turn a face in: it follows its vertices' normals.
      const n = cross(sub(vs[b]!, vs[a]!), sub(vs[e]!, vs[a]!));
      const out = add(add(vn[a]!, vn[b]!), vn[e]!);
      if (dot(n, out) >= 0)
        tri(vs[a]!, vs[b]!, vs[e]!, unit(vn[a]!), unit(vn[b]!), unit(vn[e]!), slot);
      else tri(vs[a]!, vs[e]!, vs[b]!, unit(vn[a]!), unit(vn[e]!), unit(vn[b]!), slot);
    }
    // Leaf cards on the surface, turned every way: the outline breaks into leaves.
    const mean = (r[0] + r[1] + r[2]) / 3;
    for (let i = 0; i < cards; i++) {
      const n = unit([rnd() * 2 - 1, rnd() * 1.6 - 0.6, rnd() * 2 - 1]);
      const p = add(at(n), mul(n, mean * (rnd() * 0.08 - 0.02)));
      const size = mean * CARD_SIZE * (0.7 + rnd() * 0.6);
      const [long, wide] = needle ? [size * 1.4, size * 0.22] : [size, size * 0.6];
      // Along the surface, tilted out by a random angle.
      const t0 = unit(cross(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const a = rnd() * Math.PI * 2;
      const t1 = add(mul(t0, Math.cos(a)), mul(cross(n, t0), Math.sin(a)));
      const along = unit(add(t1, mul(n, 0.5 + rnd() * 0.6)));
      const across = unit(cross(n, along));
      const face = unit(cross(along, across));
      const tip = add(p, mul(along, long));
      const mid = add(p, mul(along, long * 0.45));
      const leafSlot: PlantSlot =
        plan.bloom && rnd() < plan.bloom ? 'flower' : rnd() < 0.3 ? 'leafDark' : slot;
      card(
        p,
        add(mid, mul(across, wide / 2)),
        tip,
        add(mid, mul(across, -wide / 2)),
        dot(face, n) >= 0 ? face : mul(face, -1),
        leafSlot
      );
    }
  }

  // ---------------------------------------------------------------- hanging strands
  for (const s of plan.strands ?? []) strand(s);

  function strand(s: PlantStrand) {
    const top = P(s.top);
    const bottomY = (s.bottom - 0.5) * h;
    const length = top[1] - bottomY;
    if (length <= 1e-6) return;
    const width = s.width * big;
    // Outward from the plant's axis: the ribbon faces out; it sways a little with the seed.
    const out = unit([top[0], 0, top[2]]);
    const side = unit(cross([0, 1, 0], out));
    const phase = rnd() * Math.PI * 2;
    const sway = length * 0.05;
    const at = (t: number): V3 => {
      const bow = Math.sin(Math.PI * t) * length * 0.04;
      const sw = Math.sin(phase + t * 3) * sway * t;
      return add(add(top, [0, -length * t, 0]), add(mul(out, bow), mul(side, sw)));
    };
    // The arch: the twig leaves the crown nearer its axis, rises and turns over before it falls,
    // so the curtain is never a cut wall seen from above.
    const reachIn = Math.hypot(top[0], top[2]);
    const arch = Math.min(length * STRAND_ARCH, reachIn * 0.5);
    if (arch > 1e-6) {
      const root = add(top, add(mul(out, -arch), [0, -arch * 0.25, 0]));
      const ctrl = add(top, add(mul(out, -arch * 0.25), [0, arch * 0.45, 0]));
      const bez = (t: number): V3 =>
        add(add(mul(root, (1 - t) ** 2), mul(ctrl, 2 * t * (1 - t))), mul(top, t * t));
      for (let k = 0; k < STRAND_ARCH_SEGMENTS; k++) {
        const [a, b] = [bez(k / STRAND_ARCH_SEGMENTS), bez((k + 1) / STRAND_ARCH_SEGMENTS)];
        const w = width * 0.8;
        const n = unit(cross(side, sub(b, a)));
        card(
          add(a, mul(side, -w / 2)),
          add(a, mul(side, w / 2)),
          add(b, mul(side, w / 2)),
          add(b, mul(side, -w / 2)),
          n[1] >= 0 ? n : mul(n, -1),
          'leaf'
        );
      }
    }
    for (let k = 0; k < STRAND_SEGMENTS; k++) {
      const [t0, t1] = [k / STRAND_SEGMENTS, (k + 1) / STRAND_SEGMENTS];
      // Leaves along the strand: the ribbon swells and pinches, narrower toward its tip.
      const wAt = (t: number, i: number) => width * (1 - 0.55 * t) * (i % 2 ? 0.55 : 1);
      const [a, b] = [at(t0), at(t1)];
      const [wa, wb] = [wAt(t0, k), wAt(t1, k + 1)];
      card(
        add(a, mul(side, -wa / 2)),
        add(a, mul(side, wa / 2)),
        add(b, mul(side, wb / 2)),
        add(b, mul(side, -wb / 2)),
        out,
        rnd() < 0.35 ? 'leafDark' : 'leaf'
      );
    }
  }

  // ---------------------------------------------------------------- whole leaves
  (plan.leaves ?? []).forEach((leaf, i) => wholeLeaf(leaf, i));

  function wholeLeaf(leaf: PlantLeaf, index: number) {
    const base = P(leaf.base);
    const tip = P(leaf.tip);
    const span = sub(tip, base);
    const length = Math.hypot(span[0], span[1], span[2]);
    if (length <= 1e-6) return;
    const dir = unit(span);
    // Flat across, the leaf's face turned up as much as it can; a traced leaf faces the front.
    const across =
      leaf.facing && Math.abs(dir[2]) < 0.95
        ? unit(cross(dir, [0, 0, 1]))
        : unit(cross(dir, Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
    const width = leaf.width * big;
    // An arched leaf rises first, then bends out and down to its tip (an agave, a grass blade):
    // its centre line curves over a control point raised above the chord.
    const arch = Math.max(0, Math.min(1, leaf.arch ?? 0));
    const ctrl: V3 = add(add(base, mul(span, 0.25)), [
      0,
      Math.max(0, -span[1]) + arch * length * 0.6,
      0,
    ]);
    // A traced leaf runs through its midrib's points (Catmull-Rom).
    const line = leaf.mid?.length ? [base, ...leaf.mid.map(P), tip] : null;
    const at = (t: number): V3 => {
      if (line) return catmull(line, t);
      const chord = arch
        ? add(add(mul(base, (1 - t) ** 2), mul(ctrl, 2 * t * (1 - t))), mul(tip, t * t))
        : add(base, mul(span, t));
      return add(chord, [0, -leaf.droop * length * 0.6 * t * t, 0]);
    };
    if (leaf.fan) {
      fanLeaf(leaf, at, across, width / 2);
      return;
    }
    const fold = Math.max(-1, Math.min(1, leaf.fold ?? 0));
    const slot: PlantSlot = index % 3 === 2 ? 'leafDark' : 'leaf';
    if (leaf.cut) {
      pinnate(at, across, width, fold, slot);
      return;
    }
    for (let k = 0; k < LEAF_SEGMENTS; k++) {
      const [t0, t1] = [k / LEAF_SEGMENTS, (k + 1) / LEAF_SEGMENTS];
      // A strap keeps its width and tapers in its last third; a blade swells and narrows.
      const wAt = (t: number) =>
        width *
        (leaf.pad
          ? Math.sqrt(Math.max(0.04, 1 - (2 * t - 1) ** 2))
          : leaf.strap
            ? Math.min(1, (1 - t) / 0.35 + 0.02) * (0.75 + 0.25 * Math.min(1, t / 0.12))
            : Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.04)) ** 0.7);
      const [a, b] = [at(t0), at(t1)];
      const [wa, wb] = [wAt(t0), wAt(t1)];
      const face = unit(cross(across, sub(b, a)));
      const up = face[1] >= 0 ? face : mul(face, -1);
      if (!fold) {
        card(
          add(a, mul(across, -wa / 2)),
          add(a, mul(across, wa / 2)),
          add(b, mul(across, wb / 2)),
          add(b, mul(across, -wb / 2)),
          up,
          slot
        );
        continue;
      }
      // Folded on its midrib: each half's edge bends down (a banana's paddle, a frond's leaflets)
      // or up (an agave's channel), so the leaf shows from the side as well as from above.
      const edge = (p: V3, w: number, s: number): V3 =>
        add(add(p, mul(across, (s * w) / 2)), mul(up, (-fold * w) / 2));
      for (const sgn of [-1, 1]) {
        const [ea, eb] = [edge(a, wa, sgn), edge(b, wb, sgn)];
        const n = unit(cross(sub(ea, a), sub(b, a)));
        card(a, ea, eb, b, n[1] >= 0 ? n : mul(n, -1), slot);
      }
    }
  }

  /**
   * A cut frond (coconut, date palm): a thin rachis along the centre line and a comb of narrow
   * leaflets on both sides, swept toward the tip and hanging by `fold`; longest mid-frond.
   */
  function pinnate(
    at: (t: number) => V3,
    across: V3,
    width: number,
    fold: number,
    slot: PlantSlot
  ) {
    for (let k = 0; k < LEAF_SEGMENTS; k++) {
      const [a, b] = [at(k / LEAF_SEGMENTS), at((k + 1) / LEAF_SEGMENTS)];
      const r = (width * RACHIS_SHARE) / 2;
      const face = unit(cross(across, sub(b, a)));
      card(
        add(a, mul(across, -r)),
        add(a, mul(across, r)),
        add(b, mul(across, r)),
        add(b, mul(across, -r)),
        face[1] >= 0 ? face : mul(face, -1),
        slot
      );
    }
    const dt = 1 / FROND_LEAFLETS;
    for (let k = 0; k < FROND_LEAFLETS; k++) {
      const t = 0.06 + 0.92 * k * dt;
      const [p, q] = [at(t), at(Math.min(1, t + dt * 0.9))];
      const along = unit(sub(q, p));
      const up = unit(cross(across, along));
      const len = (width / 2) * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.03)) ** 0.6;
      for (const sgn of [-1, 1]) {
        const tip = add(
          add(add(p, mul(across, sgn * len * 0.92)), mul(along, len * 0.4)),
          mul(up[1] >= 0 ? up : mul(up, -1), -Math.abs(fold) * len * 0.45)
        );
        const n = unit(cross(sub(q, p), sub(tip, p)));
        face3(p, q, tip, n[1] >= 0 ? n : mul(n, -1), slot);
      }
    }
  }

  /** A thin triangle facing `n` (its material draws both sides). */
  function face3(a: V3, b: V3, c: V3, n: V3, slot: PlantSlot) {
    if (dot(cross(sub(b, a), sub(c, a)), n) >= 0) tri(a, b, c, n, n, n, slot);
    else tri(a, c, b, n, n, n, slot);
  }

  /**
   * A palmate leaf: its stalk a narrow strip along the arched centre line, its fan a pleated disc of
   * `FAN_PLEATS` pointed blades round the stalk's end, turned out from the plant's heart, open
   * `FAN_ARC` round its top (the gap where the stalk joins), the outer blades sagging.
   */
  function fanLeaf(leaf: PlantLeaf, at: (t: number) => V3, across: V3, radius: number) {
    const stalk = Math.max(big * 0.004, radius * 0.07);
    for (let k = 0; k < LEAF_SEGMENTS; k++) {
      const [a, b] = [at(k / LEAF_SEGMENTS), at((k + 1) / LEAF_SEGMENTS)];
      const n = unit(cross(across, sub(b, a)));
      card(
        add(a, mul(across, -stalk / 2)),
        add(a, mul(across, stalk / 2)),
        add(b, mul(across, stalk / 2)),
        add(b, mul(across, -stalk / 2)),
        n[1] >= 0 ? n : mul(n, -1),
        'leaf'
      );
    }
    const c = at(1);
    const end = unit(sub(c, at(0.92)));
    // Facing out: the stalk's way, flattened toward the horizon (a fan held up to the light).
    const out = unit(
      Math.hypot(end[0], end[2]) > 0.05
        ? [end[0], end[1] * 0.45, end[2]]
        : [sub(c, P(leaf.base))[0] || 1e-3, 0, sub(c, P(leaf.base))[2]]
    );
    const u = unit(cross([0, 1, 0], out));
    const v = cross(out, u);
    const ring = (theta: number, rho: number, fold: number): V3 =>
      add(
        add(c, add(mul(v, Math.cos(theta) * rho * radius), mul(u, Math.sin(theta) * rho * radius))),
        add(mul(out, fold * radius * rho), [0, -leaf.droop * radius * 0.35 * rho * rho, 0])
      );
    const step = FAN_ARC / FAN_PLEATS;
    for (let k = 0; k < FAN_PLEATS; k++) {
      const [t0, t1] = [-FAN_ARC / 2 + k * step, -FAN_ARC / 2 + (k + 1) * step];
      // Pleats: every other rib stands out of the fan's plane.
      const [f0, f1] = [k % 2 ? 0.07 : -0.03, k % 2 ? -0.03 : 0.07];
      const slot: PlantSlot = k % 2 ? 'leafDark' : 'leaf';
      const [m0, m1] = [ring(t0, 0.5, f0), ring(t1, 0.5, f1)];
      face3(c, m0, m1, out, slot);
      // The blade: from the mid ring out to a split tip.
      const [o0, o1] = [ring(t0 + step * 0.12, 0.82, f0), ring(t1 - step * 0.12, 0.82, f1)];
      card(m0, m1, o1, o0, out, slot);
      face3(o0, o1, ring((t0 + t1) / 2, 1, (f0 + f1) / 2), out, slot);
    }
  }

  // ---------------------------------------------------------------- conifer skirts
  const axisAt = (y: number): [number, number] => {
    const trunk = plan.stems.find((s) => s.kind === 'trunk');
    if (!trunk) return [0.5, 0.5];
    const pts = trunk.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i]!, pts[i + 1]!];
      if ((y >= a[1] && y <= b[1]) || (y <= a[1] && y >= b[1])) {
        const t = b[1] === a[1] ? 0 : (y - a[1]) / (b[1] - a[1]);
        return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
      }
    }
    const last = pts[pts.length - 1]!;
    return [last[0], last[2]];
  };
  plan.tiers?.forEach((tier, k) => skirt(tier, k));

  function skirt(tier: PlantTier, k: number) {
    const [cx, cz] = axisAt((tier.y0 + tier.y1) / 2);
    const apex = P([cx, tier.y1, cz]);
    const rim = tier.r * big;
    const fall = (tier.y1 - tier.y0) * h;
    const centre = P([cx, tier.y0, cz]);
    // The skirt's rim hangs a little past its foot; its underside rises back into the cone.
    const under = add(centre, [0, fall * 0.3, 0]);
    const ring: V3[] = [];
    for (let s = 0; s < TIER_SIDES; s++) {
      const a = (2 * Math.PI * (s + 0.5 * (k % 2))) / TIER_SIDES;
      const rr = rim * (s % 2 ? 0.86 : 1);
      ring.push(add(centre, [Math.cos(a) * rr, -fall * 0.08 * (s % 2 ? 0 : 1), Math.sin(a) * rr]));
    }
    const slot: PlantSlot = k % 2 ? 'leafDark' : 'leaf';
    for (let s = 0; s < TIER_SIDES; s++) {
      const [a, b] = [ring[s]!, ring[(s + 1) % TIER_SIDES]!];
      // Outside: up and out; underneath: down.
      const nOut = unit(cross(sub(b, apex), sub(a, apex)));
      const up = dot(nOut, [0, 1, 0]) >= 0;
      if (up) tri(apex, b, a, nOut, nOut, nOut, slot);
      else tri(apex, a, b, mul(nOut, -1), mul(nOut, -1), mul(nOut, -1), slot);
      const nIn = unit(cross(sub(a, under), sub(b, under)));
      if (dot(nIn, [0, -1, 0]) >= 0) tri(under, a, b, nIn, nIn, nIn, 'leafDark');
      else tri(under, b, a, mul(nIn, -1), mul(nIn, -1), mul(nIn, -1), 'leafDark');
    }
  }

  // ---------------------------------------------------------------- pot (VS-T25)
  if (plan.pot) pot(plan.pot);

  /**
   * The pot turned round its axis: outer wall foot → rim, a flat lip, the inner wall down to the
   * soil (a disc), and a closed foot. A closed solid facing out; `depth` squeezes it into an oval.
   */
  function pot(p: NonNullable<PlantPlan['pot']>) {
    const prof = p.profile.map(([y, r]) => [y * h - h / 2, r * big] as const);
    const [cx, cz] = [(p.c[0] - 0.5) * w, (p.c[1] - 0.5) * d];
    const k = p.depth ?? 1;
    const at = (y: number, r: number, s: number): V3 => {
      const a = (2 * Math.PI * s) / POT_SIDES;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r * k];
    };
    const around = (s: number, ny: number, out: number): V3 => {
      const a = (2 * Math.PI * s) / POT_SIDES;
      return unit([Math.cos(a) * out, ny, (Math.sin(a) * out) / k]);
    };
    /** A band between two rings (y, r) facing `out` (+1 outward, -1 inward). */
    const band = (y0: number, r0: number, y1: number, r1: number, out: 1 | -1, slot: PlantSlot) => {
      // Slope of the wall: its normal leans up when it narrows to the top.
      const ny = ((r0 - r1) / Math.max(1e-9, Math.hypot(y1 - y0, r1 - r0))) * out;
      for (let s = 0; s < POT_SIDES; s++) {
        const [A, B, C, D] = [at(y0, r0, s), at(y0, r0, s + 1), at(y1, r1, s + 1), at(y1, r1, s)];
        const [nA, nB] = [around(s, ny, out), around(s + 1, ny, out)];
        if (out > 0) {
          tri(A, C, B, nA, nB, nB, slot);
          tri(A, D, C, nA, nA, nB, slot);
        } else {
          tri(A, B, C, nA, nB, nB, slot);
          tri(A, C, D, nA, nB, nA, slot);
        }
      }
    };
    /** A flat disc at `y` of radius `r`, facing up (+1) or down (-1). */
    const disc = (y: number, r: number, up: 1 | -1, slot: PlantSlot) => {
      const c: V3 = [cx, y, cz];
      const n: V3 = [0, up, 0];
      for (let s = 0; s < POT_SIDES; s++) {
        const [a, b] = [at(y, r, s), at(y, r, s + 1)];
        if (up > 0) tri(c, b, a, n, n, n, slot);
        else tri(c, a, b, n, n, n, slot);
      }
    };
    for (let i = 0; i + 1 < prof.length; i++)
      band(prof[i]![0], prof[i]![1], prof[i + 1]![0], prof[i + 1]![1], 1, 'pot');
    const [footY, footR] = prof[0]!;
    const [rimY, rimR] = prof[prof.length - 1]!;
    const inner = rimR * (1 - POT_WALL);
    const soilY = rimY - (rimY - footY) * POT_SOIL_DROP;
    // Lip: a ring from the rim in to the inner wall.
    for (let s = 0; s < POT_SIDES; s++) {
      const [A, B, C, D] = [
        at(rimY, rimR, s),
        at(rimY, rimR, s + 1),
        at(rimY, inner, s + 1),
        at(rimY, inner, s),
      ];
      const n: V3 = [0, 1, 0];
      tri(A, C, B, n, n, n, 'pot');
      tri(A, D, C, n, n, n, 'pot');
    }
    band(soilY, inner, rimY, inner, -1, 'pot');
    disc(soilY, inner, 1, 'soil');
    disc(footY, footR, -1, 'pot');
  }

  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    uv: frontUv(pos, nrm, dims),
    slot: Uint8Array.from(slots),
  };
}
