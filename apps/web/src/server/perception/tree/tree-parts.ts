import {
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
 * draw (PQ-T79): the trunk and each tier of the crown are `sdf` parts, ellipsoid lobes fused by a
 * smooth union, so a crown reads as rounded foliage and a trunk as one tapered column, never as a
 * stack of boxes. Pure.
 */

/** Blend of the smooth union between lobes, unit space of the part. */
export const LOBE_BLEND = Math.min(0.05, SDF_BLEND_MAX);
/** The recipe's box is this much larger than the drawn tree: each part's box keeps its blend margin inside. */
export const FRAME_MARGIN = 1 / (1 - 2 * LOBE_BLEND) + 0.002;
/** Lobes per part (the schema's blob limit). */
export const LOBES_PER_PART = SDF_BLOBS_MAX;
/** Crown tiers, each with its own leaf colour. */
export const CROWN_TIERS = 2;

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
      lobePart(plan.trunk.map(shift), frame, { color: plan.bark, material: 'wood', kind: 'trunk' })
    );
  const tiers = crownTiers(plan.crown.map(shift), Math.min(CROWN_TIERS, plan.crown.length));
  tiers.forEach((lobes, i) => {
    const tier = Math.min(plan.leaf.length - 1, Math.floor((i / tiers.length) * plan.leaf.length));
    parts.push(
      lobePart(lobes, frame, { color: plan.leaf[tier]!, material: 'foliage', kind: 'crown' })
    );
  });
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
