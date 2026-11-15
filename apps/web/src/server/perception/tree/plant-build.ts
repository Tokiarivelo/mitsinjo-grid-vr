import { HABIT_LEAF, habitFromLabel, habitFromShape, leafFromLabel } from './plant-habit';
import {
  PLANT_LEAVES_MAX,
  PLANT_MASSES_MAX,
  PLANT_STRANDS_MAX,
  PlantPlanSchema,
  STEM_POINTS_MAX,
  type LeafType,
  type PlantHabit,
  type PlantLeaf,
  type PlantMass,
  type PlantPlan,
  type PlantStem,
  type PlantStrand,
  type PlantTier,
} from '@/lib/plant-plan';
import { mulberry32 } from '@/lib/seeded-random';
import type { Lobe, TreePlan } from './tree-fit';
import { FRAME_MARGIN } from './tree-parts';

/**
 * A measured tree (`fitTree`, cells) → the plant plan the 3D views build (PQ-T82), one builder per
 * habit: the crown's clumps, a weeping curtain's strands, a conifer's skirts, a palm's fronds, a
 * banana's paddles, grass blades, agave spikes, cactus columns, bamboo canes, the trunk and its
 * limbs. Every place and size comes from the drawing; the habit, the leaf and the visible limbs may
 * come from the plant team (`PlantHints`). Shares of the recipe's box (`treeRecipe`'s frame, the
 * blend margin included), so the plan sits on the same box as the fallback parts. Pure.
 */

/** What the plant team read (`plant-tools.ts`), in the front image's shares (y 0 = top). */
export interface PlantHints {
  /** The species the team named (« coconut palm, Cocos nucifera »): read like the label. */
  species?: string;
  habit?: PlantHabit;
  leaf?: LeafType;
  /** Visible limbs on the front image: centre lines, base first, and their width. */
  branches?: Array<{ points: Array<[number, number]>; width: number }>;
  /** Trunks from the ground (several for a clump), same lines: the ones past the measured trunk. */
  trunks?: Array<{ points: Array<[number, number]>; width: number }>;
  /** Big leaves counted one by one (palm fronds, banana paddles, agave spikes). */
  leafCount?: number;
  /** Big leaves traced one by one (midrib base first, widest width): drawn where they lie. */
  traces?: Array<{ points: Array<[number, number]>; width: number }>;
  flower?: string;
  bloom?: number;
}

/** Strands of a weeping curtain on its outer, middle and inner rings (within `PLANT_STRANDS_MAX`). */
export const STRANDS_OUTER = 72;
export const STRANDS_MID = 52;
export const STRANDS_INNER = 32;
/** Size of a weeping dome's clumps, share of the measured lobes. */
export const DOME_CLUMP = 0.72;
/** Where the dome of a weeping crown ends, share of the crown's height from its top. */
export const DOME_SHARE = 0.42;
/** Limbs grown when the team did not draw any. */
export const AUTO_LIMBS = 6;
/** Where a stemless crown of big leaves radiates from, share of the crown's height from its top. */
export const HEART_SHARE = 0.5;
/** Turn between two leaves round a stem (the golden angle): never two in line. */
const GOLDEN = 2.39996;
/** Traced leaves needed before they replace the grown ones (fewer: the trace missed the plant). */
export const TRACES_MIN = 3;
/** How far a traced leaf may turn toward or away from the viewer, share of the plant's reach. */
const TRACE_DEPTH = 0.85;
/** A prickly pear grows its pads near one plane: their turn, share of `TRACE_DEPTH`. */
const PAD_DEPTH = 0.3;

type V3 = [number, number, number];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
};

export function buildPlant(
  plan: TreePlan,
  label: string,
  hints: PlantHints = {},
  seed = 1
): PlantPlan {
  const { W, H, D } = plan;
  const [fW, fH, fD] = [W * FRAME_MARGIN, H * FRAME_MARGIN, D * FRAME_MARGIN];
  const big = Math.max(fW, fH, fD);
  /** Cells (x, row, z) → shares of the box. */
  const S = (x: number, row: number, z: number): V3 => [
    clamp01((x + (fW - W) / 2) / fW),
    clamp01((H - row) / fH),
    clamp01((z + (fD - D) / 2) / fD),
  ];
  const R = (cells: number) => Math.min(0.25, Math.max(0.001, cells / big));
  const rnd = mulberry32(seed);

  // ---------------------------------------------------------------- what the crown measures
  const rowsF = plan.rows.front;
  const rowsS = plan.rows.side;
  const crownBottom = Math.max(plan.crownBase, ...plan.hem.front.filter((v) => v >= 0));
  let widest = plan.crownTop;
  let widestHalf = 0;
  for (let y = plan.crownTop; y <= crownBottom; y++) {
    const s = rowsF[y];
    if (s && (s[1] - s[0]) / 2 > widestHalf) [widest, widestHalf] = [y, (s[1] - s[0]) / 2];
  }
  const spanAt = (rows: typeof rowsF, y: number, fallback: number): [number, number] => {
    const s = rows[Math.max(0, Math.min(rows.length - 1, Math.round(y)))];
    return s ?? [fallback - 1, fallback + 1];
  };
  const [fwLo, fwHi] = spanAt(rowsF, widest, W / 2);
  const [swLo, swHi] = spanAt(rowsS, widest, D / 2);
  const cx = (fwLo + fwHi) / 2;
  const cz = plan.sideIsFront ? D / 2 : (swLo + swHi) / 2;
  const rx = Math.max(1, (fwHi - fwLo) / 2);
  const rz = Math.max(1, plan.sideIsFront ? rx * (D / W) : (swHi - swLo) / 2);
  const crownRows = Math.max(1, crownBottom - plan.crownTop);
  const habit: PlantHabit =
    hints.habit ??
    habitFromLabel(`${label} ${hints.species ?? ''}`) ??
    habitFromShape({
      bush: plan.bush,
      crownHeight: crownRows / H,
      aspect: (2 * rx) / Math.max(1, crownRows),
      widestAt: (widest - plan.crownTop) / crownRows,
    });
  const leaf = hints.leaf ?? leafFromLabel(`${label} ${hints.species ?? ''}`) ?? HABIT_LEAF[habit];

  // ---------------------------------------------------------------- trunk
  const stems: PlantStem[] = [];
  const radius = (l: Lobe) => Math.sqrt(l.r[0] * l.r[2]);
  const trunkLobes = [...plan.trunk].reverse(); // foot first
  let top: { at: V3; cells: V3; r: number } | null = null;
  // A cactus, a grass, a rosette stand on no bark trunk: their own builders draw their stems.
  const trunkless = habit === 'cactus' || habit === 'grass' || habit === 'rosette';
  if (trunkLobes.length && !trunkless) {
    const foot = trunkLobes[0]!;
    const pts: V3[] = [S(foot.c[0], H, foot.c[2])];
    const rs = [R(radius(foot) * 1.3)];
    for (const l of trunkLobes) {
      pts.push(S(l.c[0], l.c[1], l.c[2]));
      rs.push(R(radius(l)));
    }
    const last = trunkLobes[trunkLobes.length - 1]!;
    // A conifer's or a palm's trunk runs to its top; a broad crown's hides in its leaves.
    if (habit === 'conical' || habit === 'columnar') {
      pts.push(S(last.c[0], plan.crownTop + crownRows * 0.08, last.c[2]));
      rs.push(R(radius(last) * 0.35));
    }
    const kept = thin(pts, rs, STEM_POINTS_MAX);
    stems.push({
      points: kept.pts,
      r: kept.rs,
      kind: 'trunk',
      ...(habit === 'fan' ? { green: true } : {}),
    });
    top = {
      at: kept.pts[kept.pts.length - 1]!,
      cells: [last.c[0], last.c[1], last.c[2]],
      r: radius(last),
    };
  }

  // ---------------------------------------------------------------- foliage
  const masses: PlantMass[] = [];
  const strands: PlantStrand[] = [];
  const leaves: PlantLeaf[] = [];
  const tiers: PlantTier[] = [];
  const massOf = (l: Lobe, scale = 1): PlantMass => {
    const low = (l.c[1] - plan.crownTop) / crownRows > 0.62;
    const inner = Math.hypot((l.c[0] - cx) / rx, (l.c[2] - cz) / rz) < 0.35;
    return {
      c: S(l.c[0], l.c[1], l.c[2]),
      r: [
        clamp01((l.r[0] * scale) / fW),
        clamp01((l.r[1] * scale) / fH),
        clamp01((l.r[2] * scale) / fD),
      ],
      ...(low || inner ? { shade: true } : {}),
    };
  };
  // Where a crown of big leaves radiates from: the trunk's top, else (a banana, a palm whose stem
  // hides) low in the crown, a green stem under it.
  const radiating = habit === 'palm' || habit === 'fan';
  const heart: V3 = top
    ? top.cells
    : radiating
      ? [cx, plan.crownTop + crownRows * HEART_SHARE, cz]
      : [cx, plan.crownBase, cz];
  if (!top && radiating) {
    const r = R(rx * 0.07);
    stems.push({
      points: [S(heart[0], H, heart[2]), S(heart[0], heart[1], heart[2])],
      r: [r, r * 0.8],
      kind: 'trunk',
      green: true,
    });
  }
  /**
   * Cells from `from` to the drawn front outline along (ex, ey) in the front's plane (ey up): the
   * furthest point of the ray still inside it. A leaf seen past a gap (a banana's paddles above
   * its bare heart, a palm's fronds beyond the sky between them) is reached all the same.
   */
  const frontReach = (from: V3, ex: number, ey: number) => {
    const limit = 2 * Math.max(W, H);
    let far = 0;
    for (let t = 0; t < limit; t += 0.5) {
      const [x, r] = [from[0] + ex * t, Math.round(from[1] - ey * t)];
      if (r < 0 || r >= H || x < 0 || x >= W) break;
      const f = rowsF[r];
      if (f && x >= f[0] - 0.5 && x <= f[1] + 0.5) far = t;
    }
    return far;
  };
  /**
   * One whole leaf from `from` out to the outline: raised `elevation` (radians) above the ground
   * and turned `azimuth` round the stem. Its reach is measured on the front, on the side it leans
   * to; turned, its depth is the plant's own. The tip is aimed above its mark by what the droop
   * pulls it down. A fan leaf's stalk stops its fan's radius short of the outline.
   */
  const leafTo = (
    from: V3,
    elevation: number,
    azimuth: number,
    o: {
      droop: number;
      widthShare: number;
      cut?: boolean;
      fan?: boolean;
      fold?: number;
      arch?: number;
      strap?: boolean;
    }
  ): PlantLeaf => {
    const side = Math.cos(azimuth) >= 0 ? 1 : -1;
    const reachCells = frontReach(from, side * Math.cos(elevation), Math.sin(elevation));
    const [hz, vt] = [reachCells * Math.cos(elevation), reachCells * Math.sin(elevation)];
    let vec: V3 = [Math.cos(azimuth) * hz, vt, Math.sin(azimuth) * hz * (rz / rx)];
    let length = Math.max(1, Math.hypot(...vec));
    const fanR = o.fan ? Math.min(length * 0.5, Math.max(rx, rz) * 0.42) : 0;
    if (o.fan) {
      const k = Math.max(0.2, (length - fanR * 0.85) / length);
      vec = [vec[0] * k, vec[1] * k, vec[2] * k];
      length *= k;
    }
    const lift = o.droop * 0.6 * length;
    return {
      base: S(from[0], from[1], from[2]),
      tip: S(from[0] + vec[0], Math.max(-H * 0.2, from[1] - vec[1] - lift), from[2] + vec[2]),
      width: Math.min(0.5, Math.max(0.002, o.fan ? (2 * fanR) / big : R(length * o.widthShare))),
      droop: o.droop,
      ...(o.cut ? { cut: true } : {}),
      ...(o.fan ? { fan: true } : {}),
      ...(o.fold ? { fold: o.fold } : {}),
      ...(o.arch ? { arch: o.arch } : {}),
      ...(o.strap ? { strap: true } : {}),
    };
  };
  const deg = Math.PI / 180;

  /**
   * The team's traced leaves, drawn where they lie on the front: each midrib keeps its x and y
   * (the front matches by construction) and turns toward or away from the viewer by what the
   * plant's reach leaves it (a leaf drawn short and central points at the viewer), alternately,
   * so the side and the top show a full plant too. Null when too few were traced.
   */
  const traced = (o: {
    fold: number;
    cut?: boolean;
    fan?: boolean;
    strap?: boolean;
    pad?: boolean;
    min?: number;
  }) => {
    const ts = hints.traces ?? [];
    if (ts.length < (o.min ?? TRACES_MIN)) return null;
    const cells = ts.map((t) => t.points.map(([x, y]) => [x * W, y * H] as const));
    const reach = Math.max(rx, ...cells.map((c) => Math.abs(c[c.length - 1]![0] - c[0]![0])));
    return ts.slice(0, PLANT_LEAVES_MAX).map((t, i): PlantLeaf => {
      const c = cells[i]!;
      const [bx] = c[0]!;
      const dx = Math.abs(c[c.length - 1]![0] - bx);
      const sign = i % 2 ? -1 : 1;
      const depth =
        sign *
        Math.sqrt(Math.max(0, reach * reach - dx * dx)) *
        TRACE_DEPTH *
        (o.pad ? PAD_DEPTH : 1) *
        (0.45 + 0.55 * ((i * GOLDEN) % 1));
      // Depth grows along the midrib as its length does.
      const lens = [0];
      for (let k = 1; k < c.length; k++)
        lens.push(lens[k - 1]! + Math.hypot(c[k]![0] - c[k - 1]![0], c[k]![1] - c[k - 1]![1]));
      const total = Math.max(1e-6, lens[lens.length - 1]!);
      const pts = c.map(([x, y], k) => S(x, y, cz + depth * (lens[k]! / total) * (rz / rx)));
      return {
        base: pts[0]!,
        tip: pts[pts.length - 1]!,
        ...(pts.length > 2 ? { mid: pts.slice(1, -1).slice(0, 6) } : {}),
        width: Math.min(0.5, Math.max(0.002, (t.width * W) / big)),
        droop: 0,
        facing: true,
        ...(o.fold ? { fold: o.fold } : {}),
        ...(o.cut ? { cut: true } : {}),
        ...(o.fan ? { fan: true } : {}),
        ...(o.strap ? { strap: true } : {}),
        ...(o.pad ? { pad: true } : {}),
      };
    });
  };

  switch (habit) {
    case 'weeping': {
      const domeEnd = plan.crownTop + crownRows * DOME_SHARE;
      const dome = plan.crown.filter((l) => l.c[1] <= domeEnd);
      // The dome's clumps stay small: the strands hanging from all over it make the crown.
      for (const l of dome.length ? dome : plan.crown.slice(0, Math.ceil(plan.crown.length / 2)))
        masses.push(massOf(l, DOME_CLUMP));
      const hemAt = (hems: number[], c: number) => {
        const i = Math.max(0, Math.min(hems.length - 1, Math.round(c)));
        for (let k = 0; k < hems.length; k++)
          for (const j of [i - k, i + k])
            if (j >= 0 && j < hems.length && hems[j]! >= 0) return hems[j]!;
        return crownBottom;
      };
      const ring = (count: number, at: number, startShare: number) => {
        for (let i = 0; i < count; i++) {
          const a = ((i + rnd() * 0.6) / count) * Math.PI * 2;
          // Each twig at its own radius and height: no ring reads as a step.
          const r = at * (0.86 + 0.28 * rnd());
          const [px, pz] = [cx + rx * r * Math.cos(a), cz + rz * r * Math.sin(a)];
          // From just under the dome's outline above this point: the strands cover the clumps.
          let outlineTop = plan.crownTop;
          while (outlineTop < domeEnd) {
            const f = rowsF[Math.round(outlineTop)];
            if (f && px >= f[0] && px <= f[1]) break;
            outlineTop++;
          }
          const startRow =
            outlineTop +
            (domeEnd - outlineTop) * Math.max(0, startShare + (rnd() - 0.5) * 0.3) * 0.6;
          const hem =
            (hemAt(plan.hem.front, px) + hemAt(plan.hem.side, plan.sideIsFront ? px : pz)) / 2;
          const bottom = Math.min(H - 1, hem + crownRows * (rnd() * 0.06 - 0.03));
          if (bottom <= startRow) continue;
          strands.push({
            top: S(px, startRow, pz),
            bottom: clamp01((H - bottom) / fH),
            width: Math.min(
              0.1,
              Math.max(0.002, R(((2 * Math.PI * rx * at) / count) * (0.9 + 0.6 * rnd())))
            ),
          });
        }
      };
      ring(STRANDS_OUTER, 0.94, 0.7);
      ring(STRANDS_MID, 0.7, 0.35);
      ring(STRANDS_INNER, 0.42, 0.1);
      break;
    }
    case 'conical': {
      const n = Math.max(5, Math.min(10, Math.round(crownRows / 10)));
      const step = crownRows / n;
      for (let i = 0; i < n; i++) {
        const tip = plan.crownTop + Math.max(0, i * step - step * 0.6);
        const skirt = plan.crownTop + (i + 1) * step;
        const f = spanAt(rowsF, skirt, cx);
        const s = spanAt(rowsS, skirt, cz);
        const r = Math.max((f[1] - f[0]) / 2, plan.sideIsFront ? 0 : (s[1] - s[0]) / 2, 1);
        tiers.push({
          y0: clamp01((H - skirt) / fH),
          y1: clamp01((H - tip) / fH),
          r: Math.min(0.5, Math.max(0.005, r / big)),
        });
      }
      break;
    }
    case 'palm':
    case 'fan': {
      const reach = Math.max(rx, rz);
      const palmate = habit === 'palm' && leaf === 'palmate';
      const fronds = Math.max(
        5,
        Math.min(
          PLANT_LEAVES_MAX - 4,
          hints.leafCount ?? (habit === 'palm' ? (palmate ? 13 : 18) : 9)
        )
      );
      // A traveller's palm opens in one plane: its paddles fan out to both sides.
      const plane = /\b(ravenala|traveller'?s|voyageur|strelitzia)\b/i.test(
        `${label} ${hints.species ?? ''}`
      );
      // Upright first, the older leaves lower round them: feathers arch down below the heart,
      // fans stay near level, paddles hang furthest.
      const [high, low] = palmate ? [80, -10] : habit === 'palm' ? [75, -40] : [82, -50];
      const drawn = traced({
        fold: habit === 'palm' ? 0.35 : 0.25,
        ...(palmate ? { fan: true } : habit === 'palm' ? { cut: true } : {}),
      });
      if (drawn) leaves.push(...drawn);
      for (let i = 0; i < (drawn ? 0 : fronds); i++) {
        const k = fronds > 1 ? i / (fronds - 1) : 0;
        const elevation = (high + (low - high) * k) * deg;
        // Palms spiral; a banana or a traveller's palm carries its leaves in two opposite ranks
        // (seen on the drawing's plane, a banana's a little turned in turn).
        const azimuth =
          habit === 'palm'
            ? i * GOLDEN
            : (i % 2 ? Math.PI : 0) + (plane ? 0 : Math.floor(i / 2) % 2 ? 0.55 : -0.55);
        leaves.push(
          leafTo(heart, elevation, azimuth, {
            droop: palmate ? 0.12 : habit === 'palm' ? 0.25 + 0.6 * k : 0.3,
            widthShare: habit === 'palm' ? 0.28 : 0.34,
            fold: habit === 'palm' ? 0.75 : 0.55,
            ...(palmate ? { fan: true } : habit === 'palm' ? { cut: true } : {}),
          })
        );
      }
      masses.push({
        c: S(heart[0], heart[1], heart[2]),
        r: [
          clamp01((reach * 0.12) / fW),
          clamp01((reach * 0.12) / fH),
          clamp01((reach * 0.12) / fD),
        ],
        shade: true,
      });
      break;
    }
    case 'grass':
    case 'rosette': {
      const blades =
        habit === 'rosette' && hints.leafCount
          ? Math.max(8, Math.min(PLANT_LEAVES_MAX, hints.leafCount))
          : habit === 'grass'
            ? 56
            : 22;
      // From the foot to points of the outline, the upright ones first, the outer ones low at the
      // sides: each rises, then arches out and down to its point (a fountain of straps).
      const foot: V3 = [cx, H - 1, cz];
      const [high, low] = habit === 'grass' ? [86, 6] : [80, 4];
      const drawn = traced({ fold: habit === 'rosette' ? -0.3 : 0, strap: true });
      if (drawn) leaves.push(...drawn);
      for (let i = 0; i < (drawn ? 0 : blades); i++) {
        const k = (i + 0.5) / blades;
        const elevation = (high + (low - high) * Math.sqrt(k)) * deg;
        leaves.push(
          leafTo(foot, elevation, i * GOLDEN + rnd() * 0.3, {
            droop: 0.04,
            arch: (habit === 'grass' ? 0.25 : 0.2) + 0.5 * k,
            widthShare: habit === 'grass' ? 0.03 : 0.1,
            strap: true,
            ...(habit === 'rosette' ? { fold: -0.4 } : {}),
          })
        );
      }
      break;
    }
    case 'cactus': {
      // A prickly pear: its pads traced one by one, flat ovals, on the team's woody trunks.
      const pads = traced({ fold: 0, pad: true, min: 2 });
      if (pads) {
        leaves.push(...pads);
        for (const t of hints.trunks ?? []) {
          const cells = t.points.map(([x, y]) => [x * W, y * H] as const);
          const r0 = Math.max(0.6, (t.width * W) / 2);
          stems.push({
            points: cells.map(([x, y]) => S(x, y, cz)),
            r: cells.map((_, i) => R(r0 * (1 - 0.3 * (i / Math.max(1, cells.length - 1))))),
            kind: 'trunk',
          });
          if (stems.length >= 4) break;
        }
        break;
      }
      // The column the drawing stands on, then the arms: the clumps far from it.
      const pts: V3[] = [];
      const rs: number[] = [];
      for (let k = 0; k <= 10; k++) {
        const row = H - 1 - ((H - 1 - plan.crownTop) * k) / 10;
        const f = spanAt(rowsF, row, cx);
        pts.push(S(cx, row, cz));
        rs.push(R(Math.min((f[1] - f[0]) / 2, rx * 0.45) * 0.95));
      }
      const main = rs.reduce((a, b) => a + b, 0) / rs.length;
      stems.push({ points: pts, r: rs, kind: 'trunk', green: true });
      for (const l of plan.crown) {
        if (Math.abs(l.c[0] - cx) < main * big * 1.8) continue;
        const r = R(l.r[0] * 0.75);
        const foot = S(l.c[0], l.c[1] + l.r[1], cz);
        const elbow = S(cx, l.c[1] + l.r[1], cz);
        stems.push({
          points: [elbow, foot, S(l.c[0], l.c[1] - l.r[1] * 0.8, cz)],
          r: [r, r, r * 0.9],
          kind: 'branch',
          green: true,
        });
        if (stems.length >= 8) break;
      }
      break;
    }
    case 'bamboo': {
      for (let i = 0; i < 7; i++) {
        const a = i * 2.39996;
        const base: V3 = [cx + Math.cos(a) * rx * 0.12, H, cz + Math.sin(a) * rz * 0.12];
        const tip: V3 = [
          cx + Math.cos(a) * rx * 0.55,
          plan.crownTop + crownRows * 0.05,
          cz + Math.sin(a) * rz * 0.55,
        ];
        const mid: V3 = [
          (base[0] * 2 + tip[0]) / 3,
          (base[1] + tip[1]) / 2,
          (base[2] * 2 + tip[2]) / 3,
        ];
        const r = R(rx * 0.035);
        stems.push({
          points: [S(...base), S(...mid), S(...tip)],
          r: [r, r * 0.9, r * 0.6],
          kind: 'cane',
          green: true,
        });
      }
      for (const l of plan.crown) masses.push(massOf(l, 0.8));
      break;
    }
    default: {
      for (const l of plan.crown) masses.push(massOf(l));
    }
  }

  // ---------------------------------------------------------------- the team's other trunks
  // The measured trunk is the one the pixels found; the team's trunks standing apart from it (a
  // clump of stems, a forked foot) are added as their own trunks.
  if (hints.trunks && hints.trunks.length > 1 && !(habit === 'cactus' && leaves.length)) {
    const footX = trunkLobes[0]?.c[0] ?? cx;
    for (const t of hints.trunks) {
      const cells = t.points.map(([x, y]) => [x * W, y * H] as const);
      if (Math.abs(cells[0]![0] - footX) < Math.max(2, t.width * W)) continue;
      const r0 = Math.max(0.6, (t.width * W) / 2);
      stems.push({
        points: cells.map(([x, y]) => S(x, y, cz)),
        r: cells.map((_, i) => R(r0 * (1 - 0.4 * (i / Math.max(1, cells.length - 1))))),
        kind: habit === 'bamboo' ? 'cane' : 'trunk',
        ...(habit === 'bamboo' || habit === 'fan' ? { green: true } : {}),
      });
      if (stems.length >= 12) break;
    }
  }

  // ---------------------------------------------------------------- limbs
  const woody =
    habit === 'round' ||
    habit === 'spreading' ||
    habit === 'weeping' ||
    habit === 'columnar' ||
    habit === 'shrub';
  if (woody && hints.branches?.length) {
    for (const b of hints.branches) {
      const cells = b.points.map(([x, y]) => [x * W, y * H] as const);
      const r0 = Math.max(0.6, (b.width * W) / 2);
      const n = cells.length;
      // Seen on the front, a limb lies across it; a round plant has the same limbs turned a quarter.
      for (const turn of plan.sideIsFront ? [0, 1] : [0]) {
        const pts = cells.map(([x, y]) =>
          turn ? S(cx, y, cz + (x - cx) * (rz / rx)) : S(x, y, plan.sideIsFront ? cz : heart[2])
        );
        stems.push({
          points: pts,
          r: pts.map((_, i) => R(r0 * (1 - 0.6 * (i / Math.max(1, n - 1))))),
          kind: 'branch',
        });
        if (stems.length >= 30) break;
      }
    }
  } else if (woody && top) {
    // No limb drawn by the team: from the trunk's top toward the largest clumps, stopping inside them.
    const targets = [...plan.crown]
      .sort((a, b) => b.r[0] * b.r[1] * b.r[2] - a.r[0] * a.r[1] * a.r[2])
      .slice(0, AUTO_LIMBS);
    for (const l of targets) {
      const [tx, ty, tz] = top.cells;
      const k = habit === 'weeping' ? 0.95 : 0.78;
      const end: V3 = [tx + (l.c[0] - tx) * k, ty + (l.c[1] - ty) * k, tz + (l.c[2] - tz) * k];
      const lift = habit === 'spreading' ? 0.1 : habit === 'weeping' ? 0.35 : 0.2;
      const mid: V3 = [
        (tx + end[0]) / 2,
        Math.min(ty, end[1]) - crownRows * lift * 0.5,
        (tz + end[2]) / 2,
      ];
      const r0 = top.r * 0.55;
      stems.push({
        points: [S(tx, ty, tz), S(...mid), S(...end)],
        r: [R(r0), R(r0 * 0.7), R(r0 * 0.4)],
        kind: 'branch',
      });
    }
  }

  // ---------------------------------------------------------------- colours
  const shades = [...plan.leaf].sort((a, b) => lum(b) - lum(a));
  const flower = hints.flower ?? plan.bloom?.color;
  const bloom = hints.bloom ?? plan.bloom?.share;
  return PlantPlanSchema.parse({
    habit,
    leaf,
    stems: stems.slice(0, 32),
    masses: masses.slice(0, PLANT_MASSES_MAX),
    ...(strands.length ? { strands: strands.slice(0, PLANT_STRANDS_MAX) } : {}),
    ...(leaves.length ? { leaves: leaves.slice(0, PLANT_LEAVES_MAX) } : {}),
    ...(tiers.length ? { tiers } : {}),
    look: {
      bark: plan.bark,
      leaf: shades[0] ?? plan.leaf[0],
      leafDark: shades[shades.length - 1] ?? plan.leaf[0],
      ...(flower ? { flower } : {}),
    },
    ...(flower && bloom ? { bloom: Math.min(0.6, Math.max(0.05, bloom * 1.5)) } : {}),
    seed,
  });
}

/** At most `max` points of a line, its ends kept, evenly picked. */
function thin(pts: V3[], rs: number[], max: number): { pts: V3[]; rs: number[] } {
  if (pts.length <= max) return { pts, rs };
  const idx = Array.from({ length: max }, (_, i) => Math.round((i * (pts.length - 1)) / (max - 1)));
  return { pts: idx.map((i) => pts[i]!), rs: idx.map((i) => rs[i]!) };
}
