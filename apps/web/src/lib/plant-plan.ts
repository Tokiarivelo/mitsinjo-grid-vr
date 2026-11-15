import { z } from 'zod';

/**
 * Plan of a plant (PQ-T82): a tree, a palm, a bush, a clump of grass, a rosette, a cactus or a
 * bamboo, as its woody skeleton (stems), its foliage (masses, hanging strands, conifer tiers) and
 * its single leaves (fronds, blades). Measured on the validated drawing, named by the plant team.
 * Shared by the server (which fits it) and the 3D views (`plant-mesh.ts` builds it). Pure.
 *
 * Every coordinate is a share of the object's box, as in `car-plan.ts`: x 0 → 1 left → right as
 * seen on the front, y 0 → 1 ground → top, z 0 → 1 back → front. A radius or a width is a share of
 * the box's largest side (a tube stays round whatever the box).
 */

/** How the plant grows: picks how its foliage is built. */
export const PLANT_HABITS = [
  /** Rounded crown of clumps on a trunk (mango, oak, lychee). */
  'round',
  /** Wide flat crown on a few spreading limbs (acacia, flamboyant, baobab). */
  'spreading',
  /** A dome with a curtain of hanging strands (weeping willow, weeping fig). */
  'weeping',
  /** Narrow and tall (cypress, poplar). */
  'columnar',
  /** Stacked skirts of needles (pine, fir, araucaria). */
  'conical',
  /** Arched feather fronds round the top of a bare trunk (coconut, date palm). */
  'palm',
  /** Huge paddle leaves in a fan or a spiral (banana, traveller's palm). */
  'fan',
  /** Clumps down to the ground, no visible trunk (bougainvillea, hibiscus, hedge). */
  'shrub',
  /** Thin blades from one tuft (grass, reed, lemongrass, papyrus). */
  'grass',
  /** Thick pointed leaves from the ground (agave, aloe, sisal, pineapple). */
  'rosette',
  /** Green columns or pads, no leaves (cactus, euphorbia, opuntia). */
  'cactus',
  /** Several straight canes topped with leaves (bamboo). */
  'bamboo',
] as const;
export type PlantHabit = (typeof PLANT_HABITS)[number];

/** `frond` = a feather leaf (coconut), `palmate` = a fan leaf (satrana, latania, fan palms). */
export const LEAF_TYPES = [
  'broad',
  'needle',
  'frond',
  'palmate',
  'blade',
  'scale',
  'none',
] as const;
export type LeafType = (typeof LEAF_TYPES)[number];

const share = z.number().min(0).max(1);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const point = z.tuple([share, share, share]);

/** Most of each element: they bound the triangles (`plant-mesh.ts` budgets). */
export const PLANT_STEMS_MAX = 32;
export const PLANT_MASSES_MAX = 48;
export const PLANT_STRANDS_MAX = 160;
export const PLANT_LEAVES_MAX = 64;
export const PLANT_TIERS_MAX = 12;
/** Longest skin (data URL): a 512² JPEG is well under. */
export const PLANT_SKIN_MAX_CHARS = 800_000;
/** Points of a stem's centre line. */
export const STEM_POINTS_MAX = 16;

/** A trunk, a limb or a cane: a tube along its centre line, base first. */
export const PlantStemSchema = z
  .object({
    points: z.array(point).min(2).max(STEM_POINTS_MAX),
    /** Radius at each point (same count), share of the box's largest side. */
    r: z.array(z.number().min(0.001).max(0.25)).min(2).max(STEM_POINTS_MAX),
    kind: z.enum(['trunk', 'branch', 'cane']),
    /** A green stem (cactus, bamboo cane, banana pseudo-stem): wears the leaf colour, not bark. */
    green: z.boolean().optional(),
  })
  .refine((s) => s.r.length === s.points.length, { message: 'one radius per point' });
export type PlantStem = z.infer<typeof PlantStemSchema>;

/** A clump of foliage: an ellipsoid, lumpy when built. */
export const PlantMassSchema = z.object({
  c: point,
  /** Radii on x, y, z, shares of the box on that axis. */
  r: z.tuple([share, share, share]),
  /** The darker leaf colour (inner, lower clumps). */
  shade: z.boolean().optional(),
});
export type PlantMass = z.infer<typeof PlantMassSchema>;

/** A hanging strand of leaves (a weeping curtain): from its top down to `bottom`. */
export const PlantStrandSchema = z.object({
  top: point,
  bottom: share,
  /** Width of the ribbon, share of the box's largest side. */
  width: z.number().min(0.002).max(0.1),
});
export type PlantStrand = z.infer<typeof PlantStrandSchema>;

/** One leaf drawn whole: a palm frond, a banana paddle, a blade of grass, an agave spike. */
export const PlantLeafSchema = z.object({
  base: point,
  tip: point,
  /** Widest width, share of the box's largest side (a fan leaf: its fan's diameter). */
  width: z.number().min(0.002).max(0.5),
  /** How much it arches down past its middle (0 = straight, 1 = hangs). */
  droop: z.number().min(0).max(1),
  /** A frond's edge is cut into leaflets; a paddle or a blade is whole. */
  cut: z.boolean().optional(),
  /**
   * A palmate leaf (fan palm, satrana, latania): `base` → `tip` is its bare stalk and the leaf is a
   * pleated fan of pointed blades round `tip`, facing out.
   */
  fan: z.boolean().optional(),
  /**
   * How far the two halves bend from the midrib, share of the half width: + hangs down (a banana
   * paddle, a frond's leaflets), − rises into a channel (an agave, an aloe), 0 or absent = flat.
   */
  fold: z.number().min(-1).max(1).optional(),
  /** How high it rises before it bends out and down to its tip (0 = along its chord, 1 = high). */
  arch: z.number().min(0).max(1).optional(),
  /** A strap (agave, aloe, grass): even width, tapered in its last third; else it swells. */
  strap: z.boolean().optional(),
  /**
   * The midrib's inner points between `base` and `tip` as traced on the drawing (PQ-T82): the
   * centre line runs through them (smoothed) instead of `arch` and `droop`.
   */
  mid: z.array(point).max(6).optional(),
  /** A cactus pad (prickly pear): an oval, round at both ends. */
  pad: z.boolean().optional(),
  /** Lies facing the front (traced on the drawing): its width runs across the drawing. */
  facing: z.boolean().optional(),
});
export type PlantLeaf = z.infer<typeof PlantLeafSchema>;

/** One skirt of a conifer: a cone from `y1` (its tip) down to `y0` where it is `r` wide. */
export const PlantTierSchema = z.object({
  y0: share,
  y1: share,
  /** Radius at the skirt, share of the box's largest side. */
  r: z.number().min(0.005).max(0.5),
});
export type PlantTier = z.infer<typeof PlantTierSchema>;

export const PlantPlanSchema = z.object({
  habit: z.enum(PLANT_HABITS),
  leaf: z.enum(LEAF_TYPES),
  stems: z.array(PlantStemSchema).max(PLANT_STEMS_MAX),
  masses: z.array(PlantMassSchema).max(PLANT_MASSES_MAX),
  strands: z.array(PlantStrandSchema).max(PLANT_STRANDS_MAX).optional(),
  leaves: z.array(PlantLeafSchema).max(PLANT_LEAVES_MAX).optional(),
  tiers: z.array(PlantTierSchema).max(PLANT_TIERS_MAX).optional(),
  /** Colours measured on the drawing: bark, leaves (light, dark), flowers or fruit. */
  look: z.object({
    bark: hex,
    leaf: hex,
    leafDark: hex,
    flower: hex.optional(),
  }),
  /** Share of the foliage's leaf cards that are flowers (0 = none). */
  bloom: z.number().min(0).max(0.6).optional(),
  /**
   * The validated front drawing cut to the plant's box (paper bled to the nearest drawn colour),
   * projected from the front on the whole plant: its leaves, its light, its colours.
   */
  skin: z.string().startsWith('data:image/').max(PLANT_SKIN_MAX_CHARS).optional(),
  /** Seed of the leaf cards and the lumps: same plan, same mesh. */
  seed: z.number().int().min(0).max(2147483647),
});
export type PlantPlan = z.infer<typeof PlantPlanSchema>;
