import { z } from 'zod';

/**
 * Plan of a house read by the house specialist (PQ-T72): the drawings described room by room —
 * volumes (body, wings, veranda, porch, garage…), each with its own walls and roof, the openings
 * of every wall, the chimneys and the colours. `lib/house-mesh.ts` builds the model from it: walls
 * with real openings (reveal, frame, sill, glass, panes), one roof per volume, an open veranda on
 * posts. Shared by the server (which reads and fits it) and the 3D views (which build it). Pure.
 *
 * Every coordinate is a share of the object's box: x 0 → 1 left → right as seen on the front,
 * y 0 → 1 ground → top, z 0 → 1 back → front (the grid of `lib/face-hull.ts`, y flipped).
 */

/** Materials a house is made of (a subset of `RECIPE_MATERIALS`, kept here to avoid an import cycle). */
export const HOUSE_MATERIALS = [
  'brick',
  'plaster',
  'stone',
  'concrete',
  'wood',
  'tile',
  'slate',
  'metal',
  'thatch',
] as const;
export type HouseMaterial = (typeof HOUSE_MATERIALS)[number];

export const HOUSE_ROOFS = ['hip', 'gable', 'shed', 'flat', 'none'] as const;
export type HouseRoof = (typeof HOUSE_ROOFS)[number];

/**
 * What a volume is: a veranda or a porch is open (posts, no walls on its `open` sides); a balcony
 * is an open slab at its `floor`, railed, carried by posts only when it has `columns`.
 */
export const HOUSE_VOLUMES = [
  'body',
  'wing',
  'veranda',
  'porch',
  'balcony',
  'garage',
  'bay',
  'annex',
  'tower',
] as const;
export type HouseVolumeKind = (typeof HOUSE_VOLUMES)[number];

export const HOUSE_WALLS = ['front', 'right', 'back', 'left'] as const;
export type HouseWall = (typeof HOUSE_WALLS)[number];

export const HOUSE_OPENINGS = ['window', 'door', 'arch', 'garage', 'vent'] as const;
export type HouseOpeningKind = (typeof HOUSE_OPENINGS)[number];

/**
 * Head of an opening or of the bays of an arcade (PQ-T73): flat (lintel), a half-round arch, a
 * segmental (flat) arch, or two timber brackets curving down from the beam into the posts.
 */
export const HOUSE_HEADS = ['flat', 'arch', 'segment', 'bracket'] as const;
export type HouseHead = (typeof HOUSE_HEADS)[number];

/**
 * Finishes (PQ-T73): the main wall and roof, a second cladding and a second roofing (a metal
 * shed next to a shingled hip), the masonry of piers and bases, the timber of posts and trusses.
 * Each has its own measured colour and its own swatch cut on the drawings.
 */
export const HOUSE_FINISHES = ['wall', 'wall2', 'stone', 'roof', 'roof2', 'timber'] as const;
export type HouseFinish = (typeof HOUSE_FINISHES)[number];
export const HOUSE_WALL_FINISHES = ['wall', 'wall2', 'stone'] as const;
export const HOUSE_ROOF_FINISHES = ['roof', 'roof2'] as const;

/** Most volumes / openings / chimneys a plan holds (a large house, never a city block). */
export const HOUSE_VOLUMES_MAX = 20;
export const HOUSE_OPENINGS_MAX = 96;
export const HOUSE_CHIMNEYS_MAX = 6;
/** Most masonry piers a plan holds. */
export const HOUSE_PIERS_MAX = 24;
/** Most posts along one open side of a veranda. */
export const HOUSE_COLUMNS_MAX = 12;

const share = z.number().min(0).max(1);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const span = z.tuple([share, share]).refine(([a, b]) => b > a, 'empty span');

export const HouseVolumeSchema = z.object({
  kind: z.enum(HOUSE_VOLUMES),
  /** Plan rectangle: x0, x1, z0 (back), z1 (front). */
  plan: z
    .tuple([share, share, share, share])
    .refine(([x0, x1, z0, z1]) => x1 > x0 && z1 > z0, 'empty plan'),
  /** Height of the walls (the eave), and of the roof's ridge (= eave for a flat roof). */
  eave: share,
  ridge: share,
  roof: z.enum(HOUSE_ROOFS),
  /** Axis the ridge runs along (gable, hip); a shed roof falls toward the front when 'x'. */
  ridgeAxis: z.enum(['x', 'z']),
  /** Side a shed roof falls toward (default: front for ridge axis x, right for z). */
  fall: z.enum(HOUSE_WALLS).optional(),
  /** Sides with no wall (veranda, porch): posts carry the roof there. */
  open: z.array(z.enum(HOUSE_WALLS)).max(4).optional(),
  /** Posts along each open side, corners included. */
  columns: z.number().int().min(0).max(HOUSE_COLUMNS_MAX).optional(),
  /** Floor of a raised veranda or porch (deck height), of a balcony (its slab). */
  floor: share.optional(),
  /** A railing along the open sides (always on a balcony). */
  rail: z.boolean().optional(),
  /** Heights of the horizontal bands (string courses) drawn across its walls. */
  bands: z.array(share).max(4).optional(),
  /** Finish of its walls and of its roof (PQ-T73; default: the main wall, the main roof). */
  wallFinish: z.enum(HOUSE_WALL_FINISHES).optional(),
  roofFinish: z.enum(HOUSE_ROOF_FINISHES).optional(),
  /** Bays of its open sides between posts or piers: arched, bracketed (PQ-T73; default flat). */
  arcade: z.enum(HOUSE_HEADS).optional(),
  /** A timber truss in the gable ends of its roof (king post, collar, struts). */
  truss: z.boolean().optional(),
});
export type HouseVolume = z.infer<typeof HouseVolumeSchema>;

export const HouseOpeningSchema = z.object({
  /** Index of the volume whose wall holds it. */
  volume: z
    .number()
    .int()
    .min(0)
    .max(HOUSE_VOLUMES_MAX - 1),
  wall: z.enum(HOUSE_WALLS),
  kind: z.enum(HOUSE_OPENINGS),
  /** Along the wall's axis (x for front / back, z for the sides), and in height. */
  along: span,
  rise: span,
  /** Glazing bars: panes across and up (1 × 1 = none). */
  panes: z.tuple([z.number().int().min(1).max(8), z.number().int().min(1).max(8)]).optional(),
  /** Its head: an arched or segmental top (PQ-T73; default flat, an 'arch' opening is arched). */
  head: z.enum(HOUSE_HEADS).optional(),
});
export type HouseOpening = z.infer<typeof HouseOpeningSchema>;

/**
 * A masonry pier (PQ-T73): a stone or brick pillar standing from the ground to `top`, carrying a
 * veranda or a balcony, with a cap; `band` = height of a stone course across it.
 */
export const HousePierSchema = z.object({
  plan: z
    .tuple([share, share, share, share])
    .refine(([x0, x1, z0, z1]) => x1 > x0 && z1 > z0, 'empty plan'),
  top: share,
  band: share.optional(),
});
export type HousePier = z.infer<typeof HousePierSchema>;

export const HouseChimneySchema = z.object({
  plan: z
    .tuple([share, share, share, share])
    .refine(([x0, x1, z0, z1]) => x1 > x0 && z1 > z0, 'empty plan'),
  top: share,
});
export type HouseChimney = z.infer<typeof HouseChimneySchema>;

/** A swatch: a JPEG data URL and its side as a share of the house width. */
export const HouseSwatchSchema = z.object({
  image: z.string().startsWith('data:image/').max(200_000),
  size: z.number().min(0.005).max(1),
});
export type HouseSwatch = z.infer<typeof HouseSwatchSchema>;
export const HOUSE_SWATCH_SLOTS = HOUSE_FINISHES;
export type HouseSwatchSlot = HouseFinish;
const FinishLookSchema = z.object({ material: z.enum(HOUSE_MATERIALS), color: hex });

export const HouseLookSchema = z.object({
  wall: z.object({ material: z.enum(HOUSE_MATERIALS), color: hex }),
  roof: z.object({ material: z.enum(HOUSE_MATERIALS), color: hex }),
  /** Frames, sills, fascias, posts, bands. */
  trim: hex,
  glass: hex,
  door: hex,
  /** Plinth, veranda deck, steps. */
  base: hex,
  /**
   * Samples of the drawings (PQ-T72): a clean square of a wall or of the roof, cut on the
   * validated drawing (never the photo), repeated over the whole surface. `size` = the square's
   * side as a share of the house width.
   */
  swatches: z
    .object({
      wall: HouseSwatchSchema.optional(),
      wall2: HouseSwatchSchema.optional(),
      stone: HouseSwatchSchema.optional(),
      roof: HouseSwatchSchema.optional(),
      roof2: HouseSwatchSchema.optional(),
      timber: HouseSwatchSchema.optional(),
    })
    .optional(),
  /** The other finishes (PQ-T73), each measured on its own zone of the drawings. */
  wall2: FinishLookSchema.optional(),
  stone: FinishLookSchema.optional(),
  roof2: FinishLookSchema.optional(),
  timber: FinishLookSchema.optional(),
});
export type HouseLook = z.infer<typeof HouseLookSchema>;

export const HousePlanSchema = z.object({
  volumes: z.array(HouseVolumeSchema).min(1).max(HOUSE_VOLUMES_MAX),
  openings: z.array(HouseOpeningSchema).max(HOUSE_OPENINGS_MAX),
  chimneys: z.array(HouseChimneySchema).max(HOUSE_CHIMNEYS_MAX),
  piers: z.array(HousePierSchema).max(HOUSE_PIERS_MAX).optional(),
  look: HouseLookSchema,
  /** What the pilot read the building as (PQ-T73: lodge, bungalow, apartment block…). */
  type: z.string().max(60).optional(),
});
export type HousePlan = z.infer<typeof HousePlanSchema>;

/** Side a shed roof falls toward. */
export const shedFall = (v: Pick<HouseVolume, 'fall' | 'ridgeAxis'>): HouseWall =>
  v.fall ?? (v.ridgeAxis === 'x' ? 'front' : 'right');

/** True when a volume is open (veranda, porch with open sides). */
export const isOpenVolume = (v: Pick<HouseVolume, 'open'>) => Boolean(v.open?.length);

/**
 * Look of a finish: its own when read, else the closest one (a second cladding falls back on the
 * wall, a second roofing on the roof, stone on the wall, timber on the trim).
 */
export function finishLook(
  look: HouseLook,
  finish: HouseFinish
): { material: HouseMaterial; color: string } {
  switch (finish) {
    case 'wall':
    case 'roof':
      return look[finish];
    case 'wall2':
    case 'stone':
      return look[finish] ?? look.wall;
    case 'roof2':
      return look.roof2 ?? look.roof;
    case 'timber':
      return look.timber ?? { material: 'wood', color: look.trim };
  }
}
