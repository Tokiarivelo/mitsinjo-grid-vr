import {
  MAX_RECIPE_PARTS,
  ObjectRecipeSchema,
  SDF_BLEND_MAX,
  SDF_BLOBS_MAX,
  SDF_RADIUS_MIN,
  type ObjectRecipe,
  type RecipePart,
  type SdfBlob,
} from '@/lib/object-shape';
import type { Lobe, TreePlan } from './tree-fit';

/**
 * A tree plan (cells) → the recipe parts the viewer, the village and the Blender export already
 * draw (PQ-T79): each tier of the crown is an `sdf` part (ellipsoid lobes fused by a smooth union,
 * rounded foliage), the trunk one turned column (`lathe`) with its measured radius at each height,
 * never a stack of boxes. Pure.
 */

/** Blend of the smooth union between lobes, unit space of the part. */
export const LOBE_BLEND = Math.min(0.05, SDF_BLEND_MAX);
/** The recipe's box is this much larger than the drawn tree: each part's box keeps its blend margin inside. */
export const FRAME_MARGIN = 1 / (1 - 2 * LOBE_BLEND) + 0.002;
/** Lobes per part (the schema's blob limit). */
export const LOBES_PER_PART = SDF_BLOBS_MAX;
/** Radius of the trunk's top, share of the radius just under it: a rounded shoulder, hidden in the crown. */
export const TRUNK_TIP = 0.6;
/** Crown tiers, each with its own leaf colour. */
export const CROWN_TIERS = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * One `sdf` part holding `lobes` (cells): its box is their bounding box plus the blend margin, so
 * every blob stays inside unit space; radii under the schema's floor are raised to it.
 */
export function lobePart(
  lobes: readonly Lobe[],
  frame: { W: number; H: number; D: number },
  look: Pick<RecipePart, 'color' | 'material' | 'kind'>
): RecipePart {
  const radii = lobes.map((l) => [...l.r] as [number, number, number]);
  let box = { lo: [0, 0, 0], size: [1, 1, 1] };
  for (let pass = 0; pass < 4; pass++) {
    const lo = [0, 1, 2].map((a) => Math.min(...lobes.map((l, i) => l.c[a]! - radii[i]![a]!)));
    const hi = [0, 1, 2].map((a) => Math.max(...lobes.map((l, i) => l.c[a]! + radii[i]![a]!)));
    const size = [0, 1, 2].map((a) => Math.max(1e-6, (hi[a]! - lo[a]!) * FRAME_MARGIN));
    box = { lo: lo.map((v, a) => (v + hi[a]!) / 2 - size[a]! / 2), size };
    // A radius under the floor of the unit space would vanish between grid vertices.
    lobes.forEach((_, i) => {
      for (let a = 0; a < 3; a++)
        radii[i]![a] = Math.max(radii[i]![a]!, SDF_RADIUS_MIN * 1.1 * size[a]!);
    });
  }
  const centre = [0, 1, 2].map((a) => box.lo[a]! + box.size[a]! / 2);
  const blobs: SdfBlob[] = lobes.map((l, i) => ({
    kind: 'ellipsoid',
    c: [0, 1, 2].map((a) => clamp((l.c[a]! - centre[a]!) / box.size[a]!, -0.5, 0.5)) as [
      number,
      number,
      number,
    ],
    radii: [0, 1, 2].map((a) =>
      clamp(radii[i]![a]! / box.size[a]!, SDF_RADIUS_MIN, 0.5 - LOBE_BLEND)
    ) as [number, number, number],
    ...(i > 0 ? { k: LOBE_BLEND } : {}),
  }));
  const dims = [frame.W, frame.H, frame.D];
  return {
    shape: 'sdf',
    at: [
      clamp(centre[0]! / dims[0]! - 0.5, -0.6, 0.6),
      clamp(0.5 - centre[1]! / dims[1]!, -0.6, 0.6),
      clamp(centre[2]! / dims[2]! - 0.5, -0.6, 0.6),
    ],
    size: box.size.map((s, a) => clamp(s / dims[a]!, 0.01, 1)) as [number, number, number],
    blobs,
    status: 'measured',
    ...look,
  };
}

/**
 * The trunk as one turned column (a `lathe`): its radius at each height is the one measured on the
 * drawings (mean of the front and side half-widths), so a bottle trunk keeps its belly and a palm
 * its taper; the foot is flat on the ground. `lobes` run top to bottom (cells); `foot` is the
 * ground row. A leaning trunk stands at its mean place.
 */
export function trunkPart(
  lobes: readonly Lobe[],
  foot: number,
  frame: { W: number; H: number; D: number },
  look: Pick<RecipePart, 'color' | 'material' | 'kind'>
): RecipePart {
  const radius = (l: Lobe) => Math.sqrt(l.r[0] * l.r[2]);
  const step = lobes.length > 1 ? lobes[1]!.c[1] - lobes[0]!.c[1] : lobes[0]!.r[1];
  const top = Math.min(foot - 1e-3, lobes[0]!.c[1] - step / 2);
  const height = foot - top;
  const max = Math.max(...lobes.map(radius));
  const mean = (a: 0 | 2) => lobes.reduce((s, l) => s + l.c[a], 0) / lobes.length;
  // Foot first (y rises): cap, the measured radii, a narrower tip, cap.
  const profile: Array<[number, number]> = [
    [0, -0.5],
    [radius(lobes[lobes.length - 1]!) / (2 * max), -0.5],
  ];
  for (let i = lobes.length - 1; i >= 0; i--)
    profile.push([
      radius(lobes[i]!) / (2 * max),
      clamp((foot - lobes[i]!.c[1]) / height - 0.5, -0.5, 0.5),
    ]);
  profile.push([(radius(lobes[0]!) * TRUNK_TIP) / (2 * max), 0.5], [0, 0.5]);
  const dims = [frame.W, frame.H, frame.D];
  return {
    shape: 'lathe',
    at: [
      clamp(mean(0) / dims[0]! - 0.5, -0.6, 0.6),
      clamp(0.5 - (top + height / 2) / dims[1]!, -0.6, 0.6),
      clamp(mean(2) / dims[2]! - 0.5, -0.6, 0.6),
    ],
    size: [
      clamp((2 * max) / dims[0]!, 0.01, 1),
      clamp(height / dims[1]!, 0.01, 1),
      clamp((2 * max) / dims[2]!, 0.01, 1),
    ],
    profile,
    status: 'measured',
    ...look,
  };
}

/** The tiers of a crown: lobes split by height into `n` groups, each cut to at most `LOBES_PER_PART`. */
export function crownTiers(crown: readonly Lobe[], n: number): Lobe[][] {
  const groups: Lobe[][] = Array.from({ length: n }, () => []);
  const [top, base] = [
    Math.min(...crown.map((l) => l.c[1])),
    Math.max(...crown.map((l) => l.c[1])),
  ];
  for (const l of crown) {
    const k = Math.min(n - 1, Math.floor(((l.c[1] - top) / Math.max(1e-6, base - top + 1e-6)) * n));
    groups[k]!.push(l);
  }
  // A tier with too many lobes becomes several parts, in the same tier colour.
  return groups.flatMap((g) => {
    if (!g.length) return [];
    const parts = Math.ceil(g.length / LOBES_PER_PART);
    const size = Math.ceil(g.length / parts);
    return Array.from({ length: parts }, (_, i) => g.slice(i * size, (i + 1) * size));
  });
}

/**
 * The recipe of a tree: its box is the drawn tree plus the blend margin on every side (so each
 * part's own margin stays inside the unit box), the foot of the trunk on the ground.
 */
export function treeRecipe(plan: TreePlan): ObjectRecipe {
  const frame = {
    W: plan.W * FRAME_MARGIN,
    H: plan.H * FRAME_MARGIN,
    D: plan.D * FRAME_MARGIN,
  };
  // Centre the tree across the box, rest it on the ground: shift x, z by the margin, y by the top margin.
  const shift = (l: Lobe): Lobe => ({
    c: [
      l.c[0] + (frame.W - plan.W) / 2,
      l.c[1] + (frame.H - plan.H),
      l.c[2] + (frame.D - plan.D) / 2,
    ],
    r: l.r,
  });
  const parts: RecipePart[] = [];
  if (plan.trunk.length)
    parts.push(
      trunkPart(plan.trunk.map(shift), plan.H + (frame.H - plan.H), frame, {
        color: plan.bark,
        material: 'wood',
        kind: 'trunk',
      })
    );
  const leaves = (lobes: Lobe[], tier: number) =>
    parts.push(
      lobePart(lobes.map(shift), frame, {
        color: plan.leaf[Math.min(plan.leaf.length - 1, tier)]!,
        material: 'foliage',
        kind: 'crown',
      })
    );
  if (plan.fronds) {
    // A palm: opposite fronds two by two (a part holds 12 lobes); they meet on the trunk's tip.
    const { fronds } = plan.fronds;
    const half = Math.ceil(fronds.length / 2);
    for (let k = 0; k < half && parts.length < MAX_RECIPE_PARTS; k++) {
      const pair = [fronds[k]!, fronds[k + half]].filter((f) => f !== undefined);
      leaves(pair.flatMap((f) => f.lobes).slice(0, LOBES_PER_PART), k % plan.leaf.length);
    }
  } else {
    const tiers = crownTiers(plan.crown, Math.min(CROWN_TIERS, plan.crown.length));
    tiers.forEach((lobes, i) => leaves(lobes, Math.floor((i / tiers.length) * plan.leaf.length)));
  }
  const max = Math.max(frame.W, frame.H, frame.D);
  return ObjectRecipeSchema.parse({
    proportions: {
      w: Math.max(0.01, frame.W / max),
      h: Math.max(0.01, frame.H / max),
      d: Math.max(0.01, frame.D / max),
    },
    parts,
    source: 'views',
    dimStatus: { depth: 'measured', scale: 'estimated' },
  });
}
