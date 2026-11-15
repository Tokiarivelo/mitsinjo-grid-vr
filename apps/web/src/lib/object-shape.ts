import { ApplianceCategorySchema } from '@mitsinjo/engine';
import { z } from 'zod';
import { ATLAS_VIEWS } from './face-atlas';
import { HULL_BOXES_MAX, type HullSurface } from './face-hull';
import { HousePlanSchema } from './house-plan';
import type { ObjectKit } from './object-kit';
import {
  boxPath,
  NormBoxSchema,
  pathToRings,
  SceneryTypeSchema,
  type ApplianceDetection,
} from './vision';

/**
 * 3D shape of one detected object (PV-T9), Meta models only. Shared by `/api/vision/shape` and the 3D editor.
 * `recipe` = Muse Spark describes the object as a few primitive parts, coloured with the colours measured on the photo.
 * `silhouette` = fallback when Spark fails or its recipe is poor: the SAM outline (or the box) extruded,
 * plain. The photo itself is never pasted on the model. Geometry and colors only: never a power value.
 */

/**
 * `prism` = triangle extruded along z (gable roof, PF-T3), apex at `apex` of its width.
 * `hip` = hipped roof, ridge along x of `ridge` × its width (0 = pyramid, 1 = side gable); `clip` > 0
 * = half-hip: the ends stand as vertical gables up to that share of the roof height, hipped above.
 * `hull` = visual hull (PV-H): front ring `points` (x, y) extruded along z ∩ side ring `section`
 * (z toward the front, y) extruded along x, both measured on the validated 2D view and its side.
 * `sdf` = smooth union (§8, PQ-T53) of ≤ 12 `blobs`, meshed at fixed resolution.
 */
export const RECIPE_SHAPES = [
  'box',
  'cylinder',
  'sphere',
  'cone',
  'prism',
  'extrude',
  'lathe',
  'hip',
  'hull',
  'sdf',
] as const;
/** Polygon points of an `extrude` part (PR-2.1): closed ring, simplified before storing. */
export const EXTRUDE_POINTS_MAX = 64;
/** Profile points of a `lathe` part (PR-2.3): radius-vs-height, non-decreasing y. */
export const LATHE_PROFILE_MAX = 32;
export const MAX_RECIPE_PARTS = 12;
/** Hidden share (PQ-T7) from which the panel offers « draw a clean front » (PQ-T23). */
export const CLEAN_FRONT_MIN_HIDDEN = 0.3;
/** Highest half-hip gable share: above it the end is a plain gable (ridge 1). */
export const HIP_CLIP_MAX = 0.9;
/**
 * Components of a recipe the server builds from measured views (PV-H: body, wheels, glass and lamp
 * skin patches, the AI check's additions; PG-T10: facade house assemblies). A component may be an
 * assembly (window, door, chimney, roof) the 3D view expands into several boxes; triangles stay
 * ≤ `MAX_TRIANGLES`. The LLM and photo paths keep `MAX_RECIPE_PARTS`.
 */
export const MAX_COMPONENTS = 32;
/**
 * Parts of a recipe computed from the drawn views (PQ-T69, `source: 'views'`): mostly boxes and
 * thin slabs (12 triangles each), so more of them fit the triangle budget. The schema accepts up
 * to this many; every other builder enforces `MAX_COMPONENTS` itself.
 */
export const MAX_VIEW_PARTS = 96;
/** Alias kept for the PV-H builders. */
export const MAX_BUILT_PARTS = MAX_COMPONENTS;
/** Triangle budget of one object's mesh (assemblies drop their details past it). */
export const MAX_TRIANGLES = 5_000;
/** Most raised panels on one door leaf (PG-T10). */
export const MAX_DOOR_PANELS = 4;
/** Largest glazed share of a door, from its top (PG-T10). */
export const MAX_DOOR_GLAZED = 0.8;
/** Largest eave roll of a roof, share of its height (PG-T10). */
export const MAX_ROOF_BULGE = 0.3;
/** Largest roof overhang the schema accepts, object units each side (PQ-T43; bounds are tighter). */
export const MAX_ROOF_OVERHANG = 0.12;
/**
 * What a part is on the object (PV-G): set by the builders that know it (facade house), read by the
 * elevation score and the 3D view (opening look). Absent = guessed from shape and material.
 */
export const PART_KINDS = [
  'wall',
  'roof',
  'chimney',
  'door',
  'window',
  'plinth',
  'step',
  'frame',
  // PG-T20: parts of objects built from their 2D view (stages per archetype).
  'body',
  'wheel',
  'light',
  'bumper',
  'grille',
  'handle',
  'display',
  'cell',
  'trunk',
  'crown',
  'head',
] as const;
export const PartKindSchema = z.enum(PART_KINDS);
/**
 * Small parts a host part carries (PQ-T20, PQ-T48 §7.2), expanded by the viewer and drawn by the flat
 * render, never template parts: `handle`, `seam` (door line), `vent` on a body; `mirror`, `arch` /
 * `wheel_arch` and `rim` on a vehicle; `windscreen`, `rear_window`, `grille`, `door_line`, `bumper` on a
 * hull; `gutter`, `fascia`, `ridge_cap` on a roof; `reveal` (embrasure shadow gap) around an opening;
 * `step` before a door; `foot` under a body. Dropped first past `MAX_TRIANGLES`.
 */
export const DETAIL_KINDS = [
  'handle',
  'seam',
  'mirror',
  'arch',
  'rim',
  'gutter',
  'vent',
  'foot',
  'rear_window',
  'windscreen',
  'grille',
  'door_line',
  'fascia',
  'ridge_cap',
  'reveal',
  'step',
  'wheel_arch',
  'bumper',
] as const;
export const DetailKindSchema = z.enum(DETAIL_KINDS);
export type DetailKind = z.infer<typeof DetailKindSchema>;
/** Most timber posts or rails on one wall (PV-G). */
export const MAX_TIMBER = 12;
/** Most glass panes across or down one window (PG-T8). */
export const MAX_PANES = 6;
export type PartKind = z.infer<typeof PartKindSchema>;
/**
 * Faces of a box part, shared by the `attach` / `cut` ShapeScript ops and the §7.3 `inset`
 * generator (PQ-T51): u runs left → right seen from outside, v runs ground → top (front → back
 * on the top face). Moved here from `shape-script.ts` so the growth code uses the same mapping.
 */
export const FACES = ['front', 'back', 'left', 'right', 'top'] as const;
export type Face = (typeof FACES)[number];
export const WALL_FACES = ['front', 'back', 'left', 'right'] as const;
/** Axis name → tuple index, shared by `repeat` and the `loft` growth. */
export const AXIS = { x: 0, y: 1, z: 2 } as const;
/** A part may stick out of the object box by this much (handles, feet) before the recipe counts as poor. */
export const RECIPE_BOUND = 0.6;
/**
 * Smallest total volume of all parts (share of the object box) for a fitted recipe to be usable.
 * Low on purpose: a lamp post or a pole is mostly empty space around a thin cylinder.
 */
export const MIN_FILL_VOLUME = 0.005;

/**
 * What a part is made of, named by Spark (the AI): the 3D view gives each its own surface (rough stone,
 * shiny glass, metal…). Absent = a neutral painted surface.
 */
export const RECIPE_MATERIALS = [
  'stone',
  'brick',
  'plaster',
  'concrete',
  'wood',
  'thatch',
  'tile',
  'slate',
  'metal',
  'glass',
  'plastic',
  'fabric',
  'rubber',
  'foliage',
  'water',
] as const;
export const RecipeMaterialSchema = z.enum(RECIPE_MATERIALS);
export type RecipeMaterial = z.infer<typeof RecipeMaterialSchema>;
/**
 * Roof overhang bound per roofing material, object units each side (PQ-T43, §7.1): it limits a
 * chosen (draft or §8bis-code) value, never a measurement — measured overhangs stay baked in the
 * part size (2D path). Builders clamp drafts with `boundForRoof`; the 3D view applies the option
 * raw. Thatched tropical eaves run deepest, flat slabs shallowest.
 */
export const ROOF_OVERHANG_BOUNDS: Partial<Record<RecipeMaterial, number>> = {
  thatch: 0.07,
  tile: 0.04,
  slate: 0.04,
  metal: 0.03,
  concrete: 0.02,
};
/** Default bound: the eave every prism had before PQ-T43 (legacy `ROOF_OVERHANG`). */
export const DEFAULT_ROOF_OVERHANG = 0.03;
/** Overhang bound for a roof part's material (PQ-T43). */
export function boundForRoof(material: RecipeMaterial | undefined): number {
  return (material && ROOF_OVERHANG_BOUNDS[material]) ?? DEFAULT_ROOF_OVERHANG;
}

/** Largest measured yaw (60°). */
export const MAX_YAW = Math.PI / 3;

const coord = z.number().min(-RECIPE_BOUND).max(RECIPE_BOUND);
/** Smallest part extent the schema accepts. */
export const MIN_EXTENT = 0.01;
const extent = z.number().min(MIN_EXTENT).max(1);

/**
 * One primitive. Object centred at the origin, x right, y up, z toward the camera.
 * `at` = part centre and `size` = part extent, both in fractions of the object's own width / height / depth.
 */
/** Closed ring in unit space (fractions of the part size, centred, y up), extruded along z. */
const unitPoint = z.tuple([z.number().min(-0.5).max(0.5), z.number().min(-0.5).max(0.5)]);
/** Lathe profile point: [radius 0–0.5, height −0.5–0.5], revolved around y. */
const unitProfilePoint = z.tuple([z.number().min(0).max(0.5), z.number().min(-0.5).max(0.5)]);

/**
 * How a part or dimension was determined (PR-2.14, stored PR-2.15): measured from the photo
 * (outline, masks), estimated from the fitted template, inferred without direct measurement
 * (mirrored far sides), or unknown (no photo evidence). Computed, never from the LLM.
 */
export const DimStatusSchema = z.enum(['measured', 'estimated', 'inferred', 'unknown']);
export type DimStatus = z.infer<typeof DimStatusSchema>;

/**
 * Generator params (§7.3, PQ-T50/51): seeded, bounded; same input, same parts. A part that
 * carries one expands through `expandGenerators`, identically in the viewer and the judge render.
 * `sweep` / `branch` / `scatter` / `drape` place their growth in absolute recipe units and the
 * host only bounds it; `loft` spans the host's extent and `inset` sits on a host face, so their
 * params are host-relative. `inset` adds its slab to the host (a wall keeps rendering); every
 * other generator replaces the host with its growth.
 */
const genCoord = z.number().min(-RECIPE_BOUND).max(RECIPE_BOUND);
const genVec = z.tuple([genCoord, genCoord, genCoord]);
/** A direction, normalised by the expansion (components up to 1, unlike positions). */
const genDir = z.tuple([
  z.number().min(-1).max(1),
  z.number().min(-1).max(1),
  z.number().min(-1).max(1),
]);
const genSeed = z.number().int().min(0).max(2147483647);
const genColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .optional();
/** Most scatter instances: thin boxes cost 12 triangles, so 60 keeps the ≤ 800 budget (§7.3 counts 2-tri cards, which need the future `plane` shape). */
export const SCATTER_COUNT_MAX = 60;

export const SweepParamsSchema = z.object({
  op: z.literal('sweep'),
  seed: genSeed,
  /** Centre line, 2–8 points, base first; near-vertical runs become tapered cylinders. */
  points: z.array(genVec).min(2).max(8),
  /** Base and tip radius; the tube tapers across its segments. */
  r0: z.number().min(0.005).max(0.5),
  r1: z.number().min(0.005).max(0.5),
  /** Base flare ×(1–3): trunk feet, pipe flanges. */
  flare: z.number().min(0).max(2).optional(),
  color: genColor,
  material: RecipeMaterialSchema.optional(),
});
export const BranchParamsSchema = z.object({
  op: z.literal('branch'),
  seed: genSeed,
  /** Stem start, direction (normalised by the expansion), length and radius. */
  at: genVec,
  dir: genDir,
  length: z.number().min(0.05).max(1),
  radius: z.number().min(0.005).max(0.2),
  /** Depth 1–3, children per node 2–5: at most 31 segments. */
  levels: z.number().int().min(1).max(3),
  count: z.number().int().min(2).max(5),
  /** Child tilt off the parent (radians), downward pull, shrink per level. */
  angle: z.number().min(0).max(1.2),
  droop: z.number().min(0).max(1),
  decay: z.number().min(0.4).max(0.9),
  color: genColor,
  material: RecipeMaterialSchema.optional(),
});
export const ScatterParamsSchema = z.object({
  op: z.literal('scatter'),
  seed: genSeed,
  volume: z.object({
    shape: z.enum(['box', 'ellipsoid']),
    at: genVec,
    size: z.tuple([extent, extent, extent]),
  }),
  count: z.number().int().min(1).max(SCATTER_COUNT_MAX),
  /** Card size; each card is jittered 0.7–1.3 by the seed. */
  size: z.number().min(0.01).max(0.3),
  orientation: z.enum(['flat', 'upright', 'random']),
  /** Leaf palette, picked by the seed. */
  colors: z
    .array(z.string().regex(/^#[0-9a-f]{6}$/i))
    .min(1)
    .max(4),
});
export const DrapeParamsSchema = z.object({
  op: z.literal('drape'),
  seed: genSeed,
  /** Hang points, 1–12 (branch tips, eaves, rails). */
  points: z.array(genVec).min(1).max(12),
  /** Strands per point (1–4, ≤ 48 strands), each three wavy boxes. */
  strands: z.number().int().min(1).max(4),
  length: z.number().min(0.05).max(1),
  waviness: z.number().min(0).max(0.3),
  thickness: z.number().min(0.005).max(0.05),
  color: genColor,
  material: RecipeMaterialSchema.optional(),
});
/**
 * One `loft` cross section (PQ-T51 §7.3): width and height in recipe units, corner roundness in
 * recipe units (0 = box; ≥ 0.4 of the smaller side = elliptical cylinder between the stations).
 */
export const LoftStationSchema = z.object({
  width: extent,
  height: extent,
  radius: z.number().min(0).max(0.5),
});
/** Stations of one `loft`: 3–6, the spec table's count. */
export const LOFT_STATIONS_MIN = 3;
export const LOFT_STATIONS_MAX = 6;
export const LoftParamsSchema = z.object({
  op: z.literal('loft'),
  seed: genSeed,
  /** Loft axis; the stations spread evenly along the host's extent on it (first = low end). */
  axis: z.enum(['x', 'y', 'z']),
  /** 3–6 cross sections; each pair grows one box or cylinder segment between them. */
  stations: z.array(LoftStationSchema).min(LOFT_STATIONS_MIN).max(LOFT_STATIONS_MAX),
  color: genColor,
  material: RecipeMaterialSchema.optional(),
});
export const InsetParamsSchema = z.object({
  op: z.literal('inset'),
  seed: genSeed,
  /** Host face carrying the pocket. */
  face: z.enum(FACES),
  /** Centre of the rect, shares of the face (clamped to fit). */
  u: z.number().min(0).max(1),
  v: z.number().min(0).max(1),
  /** Size of the rect, shares of the face (under 2 % is noise in the judge render). */
  w: z.number().min(0.02).max(1),
  h: z.number().min(0.02).max(1),
  /** Object units out of the face: < 0 hollow (dark recess), 0 flush skin, > 0 relief. */
  depth: z.number().min(-0.3).max(0.05),
  color: genColor,
  material: RecipeMaterialSchema.optional(),
  /** What the pocket is (a grille on a body): stamped on the slab, the host keeps its kind. */
  kind: PartKindSchema.optional(),
});
/**
 * One blob of an `sdf` part (§8, PQ-T53): a smooth primitive in the part's unit space
 * (fractions of the part size, centred, y up — the `extrude` / `lathe` convention). The
 * model lists ≤ 12 of them with their position, relative size and blend radius `k`
 * (bounded numbers, never code); the smooth-min union fuses them, marching cubes meshes
 * the field at fixed resolution (`sdf-field.ts`, `sdf-mesh.ts`).
 */
export const SDF_BLOBS_MAX = 12;
/**
 * Smallest blob radius / half-extent: under one 24³ cell (1/24 ≈ 0.042) a blob can fall
 * between grid vertices and vanish (measured: r = 0.04 survives its worst offset, 0.035
 * does not). Boxes keep twice this on every side (their thinnest side is the dropout risk).
 */
export const SDF_RADIUS_MIN = 0.04;
/** Largest blend radius: past it, features melt instead of fuse. */
export const SDF_BLEND_MAX = 0.1;
const sdfCenter = z.tuple([
  z.number().min(-0.5).max(0.5),
  z.number().min(-0.5).max(0.5),
  z.number().min(-0.5).max(0.5),
]);
const sdfRadius = z.number().min(SDF_RADIUS_MIN).max(0.5);
const sdfBlend = z.number().min(0).max(SDF_BLEND_MAX).optional();
export const SphereBlobSchema = z.object({
  kind: z.literal('sphere'),
  c: sdfCenter,
  r: sdfRadius,
  /** Blend radius with the union so far (0 = hard union); the first blob's is unused. */
  k: sdfBlend,
});
export const CapsuleBlobSchema = z.object({
  kind: z.literal('capsule'),
  c: sdfCenter,
  /** Segment axis through the centre; half-length 0 = a sphere. */
  axis: z.enum(['x', 'y', 'z']),
  halfLen: z.number().min(0).max(0.5),
  r: sdfRadius,
  k: sdfBlend,
});
export const EllipsoidBlobSchema = z.object({
  kind: z.literal('ellipsoid'),
  c: sdfCenter,
  radii: z.tuple([sdfRadius, sdfRadius, sdfRadius]),
  k: sdfBlend,
});
export const BoxBlobSchema = z.object({
  kind: z.literal('box'),
  c: sdfCenter,
  size: z.tuple([
    z
      .number()
      .min(2 * SDF_RADIUS_MIN)
      .max(1),
    z
      .number()
      .min(2 * SDF_RADIUS_MIN)
      .max(1),
    z
      .number()
      .min(2 * SDF_RADIUS_MIN)
      .max(1),
  ]),
  /** Corner radius (0 = sharp box; past half the thinnest side is refused below). */
  r: z.number().min(0).max(0.25),
  k: sdfBlend,
});
export const SdfBlobSchema = z.discriminatedUnion('kind', [
  SphereBlobSchema,
  CapsuleBlobSchema,
  EllipsoidBlobSchema,
  BoxBlobSchema,
]);
export type SdfBlob = z.infer<typeof SdfBlobSchema>;

export const GeneratorParamsSchema = z.discriminatedUnion('op', [
  SweepParamsSchema,
  BranchParamsSchema,
  ScatterParamsSchema,
  DrapeParamsSchema,
  LoftParamsSchema,
  InsetParamsSchema,
]);
export type GeneratorParams = z.infer<typeof GeneratorParamsSchema>;
export type SweepParams = z.infer<typeof SweepParamsSchema>;
export type BranchParams = z.infer<typeof BranchParamsSchema>;
export type ScatterParams = z.infer<typeof ScatterParamsSchema>;
export type DrapeParams = z.infer<typeof DrapeParamsSchema>;
export type LoftParams = z.infer<typeof LoftParamsSchema>;
export type InsetParams = z.infer<typeof InsetParamsSchema>;

export const RecipePartSchema = z
  .object({
    shape: z.enum(RECIPE_SHAPES),
    at: z.tuple([coord, coord, coord]),
    size: z.tuple([extent, extent, extent]),
    /** How this part's placement was determined (PR-2.15); absent on older shapes. */
    status: DimStatusSchema.optional(),
    /** Axis of a cylinder or cone (default `y`). */
    axis: z.enum(['x', 'y', 'z']).optional(),
    /** Prism only: x of the ridge, share of the part width from its left edge (default 0.5). */
    apex: z.number().min(0).max(1).optional(),
    /** Hip only: ridge length, share of the part width (default 0.5). Measured on the 2D facade. */
    ridge: z.number().min(0).max(1).optional(),
    /** Hip only (PG-T22): half-hip gable height, share of the roof height from the eave (0 = full hip). */
    clip: z.number().min(0).max(HIP_CLIP_MAX).optional(),
    /** Extrude only (PR-2.1): the profile ring, 3–64 points, built server-side (never from Spark). */
    points: z.array(unitPoint).min(3).max(EXTRUDE_POINTS_MAX).optional(),
    /** Hull only (PV-H): side silhouette ring [z, y] in unit space (z + = front), 3–64 points. */
    section: z.array(unitPoint).min(3).max(EXTRUDE_POINTS_MAX).optional(),
    /** Lathe only (PR-2.3): radius-vs-height profile, 2–32 points, y never decreases. */
    profile: z.array(unitProfilePoint).min(2).max(LATHE_PROFILE_MAX).optional(),
    /** Sdf only (§8, PQ-T53): the smooth primitives, 1–12, fused by the smooth-min union. */
    blobs: z.array(SdfBlobSchema).min(1).max(SDF_BLOBS_MAX).optional(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    /** What the part is made of (AI), sets its surface in the 3D view. */
    material: RecipeMaterialSchema.optional(),
    /** Main body of the object (walls, cabinet). */
    front: z.boolean().optional(),
    /** What the part is (PV-G); absent on older shapes. */
    kind: PartKindSchema.optional(),
    /**
     * Wall only (PV-G): exposed timber frame on its front face, read on the drawing — post x and
     * rail y as shares of the wall (0 = left / ground, 1 = right / eave). The 3D view draws the beams.
     */
    timber: z
      .object({
        posts: z.array(z.number().min(0).max(1)).max(MAX_TIMBER),
        rails: z.array(z.number().min(0).max(1)).max(MAX_TIMBER),
      })
      .optional(),
    /**
     * Window / door (PG-T8): glass panes across × down, read on the drawing; the 3D view adds the
     * bars. Solar cells (`kind: 'cell'`, PG-T21): cell columns × rows, drawn as thin grid lines.
     */
    grid: z
      .tuple([z.number().int().min(1).max(MAX_PANES), z.number().int().min(1).max(MAX_PANES)])
      .optional(),
    /**
     * Assembly options (PG-T10), read by the 3D view's expansion; absent = the part's default.
     * Door: `leaves` (1 | 2), `glazed` top share with `grid` panes, `panels` per leaf below it.
     * Window / door: `sill` (window default on), `lintel` above. Chimney: `cap` slab on top.
     * Roof: `bulge` = eave roll radius, share of the roof height (thatch default 0.08, 0 = none).
     * Wheel (PG-T21): `rim` = a metal rim disc on its outer face.
     */
    leaves: z.number().int().min(1).max(2).optional(),
    glazed: z.number().min(0).max(MAX_DOOR_GLAZED).optional(),
    panels: z.number().int().min(0).max(MAX_DOOR_PANELS).optional(),
    sill: z.boolean().optional(),
    lintel: z.boolean().optional(),
    cap: z.boolean().optional(),
    bulge: z.number().min(0).max(MAX_ROOF_BULGE).optional(),
    /**
     * Roof only (PQ-T43): chosen overhang, object units each side, added by the 3D view to prisms
     * and hips (0 = flush, e.g. gable ends). Builders clamp drafts to `boundForRoof`; absent on
     * older shapes = the legacy eave (0.03 on prisms, 0 on hips, which had none).
     */
    overhang: z.number().min(0).max(MAX_ROOF_OVERHANG).optional(),
    rim: z.boolean().optional(),
    /** Detail kinds this part carries (PQ-T20); `rim` here equals `rim: true` on a wheel. */
    details: z.array(DetailKindSchema).max(DETAIL_KINDS.length).optional(),
    /**
     * Generator (§7.3, PQ-T50/51): grown detail expanded by `expandGenerators`, identically in
     * the viewer and the judge render. The part's own box bounds the growth; expansion stays
     * inside it, clamped. `inset` keeps its host (wall + pocket); the rest replace it.
     */
    generator: GeneratorParamsSchema.optional(),
  })
  .superRefine((p, ctx) => {
    if ((p.shape === 'extrude' || p.shape === 'hull') && !p.points)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${p.shape} needs points` });
    if (p.shape !== 'extrude' && p.shape !== 'hull' && p.points)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'points need extrude or hull' });
    if (p.shape === 'hull' && !p.section)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'hull needs section' });
    if (p.shape !== 'hull' && p.section)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'section needs hull' });
    if (p.shape === 'lathe' && !p.profile)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'lathe needs profile' });
    if (p.shape !== 'lathe' && p.profile)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'profile needs lathe' });
    if (p.profile && !p.profile.every((pt, i) => i === 0 || pt[1] >= p.profile![i - 1]![1]))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'profile y must not fall' });
    if (p.shape === 'sdf' && !p.blobs)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sdf needs blobs' });
    if (p.shape !== 'sdf' && p.blobs)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'blobs need sdf' });
    // Extent rule: each blob's outer box plus its blend margin stays in unit space, so the
    // meshed surface never reaches the grid boundary (a smooth-min bulge stays under k / 4).
    p.blobs?.forEach((blob, i) => {
      const { half, k } = sdfBlobOuter(blob);
      const out = ([0, 1, 2] as const).some((a) => Math.abs(blob.c[a]) + half[a] + k > 0.5 + 1e-9);
      if (out)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `blobs[${i}] reaches past unit space`,
        });
      // A refined box schema cannot join the discriminated union: the corner rule lives here.
      if (blob.kind === 'box' && blob.r * 2 > Math.min(blob.size[0], blob.size[1], blob.size[2]))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `blobs[${i}] r past half its thinnest side`,
        });
    });
  });
export type RecipePart = z.infer<typeof RecipePartSchema>;

/**
 * Outer half-extent of one SDF blob on each axis, blend margin included: the schema's
 * extent rule keeps it inside the part's unit box, so the meshed surface never touches the
 * grid boundary (a clipped field would leave the mesh open).
 */
export function sdfBlobOuter(blob: SdfBlob): { half: [number, number, number]; k: number } {
  const k = blob.k ?? 0;
  switch (blob.kind) {
    case 'sphere':
      return { half: [blob.r, blob.r, blob.r], k };
    case 'capsule': {
      const axial = blob.halfLen + blob.r;
      return {
        half: [
          blob.axis === 'x' ? axial : blob.r,
          blob.axis === 'y' ? axial : blob.r,
          blob.axis === 'z' ? axial : blob.r,
        ],
        k,
      };
    }
    case 'ellipsoid':
      return { half: [...blob.radii], k };
    case 'box':
      return { half: [blob.size[0] / 2, blob.size[1] / 2, blob.size[2] / 2], k };
  }
}

/** Face geometry of a box: normal axis, its sign, and the in-face u axis. */
export function faceAxes(face: Face): { n: 0 | 1 | 2; sign: 1 | -1; u: 0 | 2; uSign: 1 | -1 } {
  switch (face) {
    case 'front':
      return { n: 2, sign: 1, u: 0, uSign: 1 };
    case 'back':
      return { n: 2, sign: -1, u: 0, uSign: -1 };
    case 'right':
      return { n: 0, sign: 1, u: 2, uSign: -1 };
    case 'left':
      return { n: 0, sign: -1, u: 2, uSign: 1 };
    case 'top':
      return { n: 1, sign: 1, u: 0, uSign: 1 };
  }
}

/**
 * Centre (recipe units) of the point (u, v) on a face of `parent`, plus the normal axis and the
 * v axis (up a wall face, front → back across the top face).
 */
export function facePoint(parent: RecipePart, face: Face, u: number, v: number) {
  const ax = faceAxes(face);
  const at = [...parent.at] as [number, number, number];
  at[ax.n] = parent.at[ax.n] + (ax.sign * parent.size[ax.n]) / 2;
  at[ax.u] = parent.at[ax.u] + ax.uSign * (u - 0.5) * parent.size[ax.u];
  // v runs up a wall face, front → back across the top face.
  const vAxis = face === 'top' ? 2 : 1;
  const vSign = face === 'top' ? -1 : 1;
  at[vAxis] = parent.at[vAxis] + vSign * (v - 0.5) * parent.size[vAxis];
  return { at, ax, vAxis: vAxis as 1 | 2, vSign: vSign as 1 | -1 };
}

/** Longest face atlas accepted (base64 data URL, ≈ 1.5 MB of JPEG). */
export const FACE_ATLAS_MAX_CHARS = 2_000_000;

/** One restyled surface of a model that wears its drawings (`ObjectRecipe.faces.surfaces`). */
export const FaceSurfaceSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  material: RecipeMaterialSchema.optional(),
  /**
   * The drawing even where the model's own look is a material (PQ-T72: a house's roof shows its
   * specialist's material until the operator asks for the view from above).
   */
  drawing: z.literal(true).optional(),
});
export type FaceSurface = z.infer<typeof FaceSurfaceSchema>;
/** A hull coordinate, grid cells. */
const hullCell = z.number().int().min(0).max(1024);

export const ObjectRecipeSchema = z.object({
  /** Real proportions of the object, largest side = 1. */
  proportions: z.object({ w: extent, h: extent, d: extent }),
  parts: z.array(RecipePartSchema).min(1).max(MAX_VIEW_PARTS),
  /**
   * Where the parts came from: a kit template (`kit`, the default when absent), the LLM-imagined
   * part list (`free`, archetypes without a real template), the measured 2D elevations
   * (`facade`: validated front + Muse Image side, SAM boxes on both; `views`: any other object,
   * hull of the validated 2D view and its drawn side, PV-H) or Wonder-written construction code
   * run in the §8bis sandbox (`code`, PQ-T45; parts stamped `estimated`).
   */
  source: z.enum(['kit', 'free', 'facade', 'views', 'code']).optional(),
  /** Measured turn of the front away from the camera (PF-T5), radians, + = right end farther. */
  yaw: z.number().min(-MAX_YAW).max(MAX_YAW).optional(),
  /** One tileable 64 px photo swatch per material (PR-1.5), base64 data URL (≤ 8 kB each). */
  swatches: z.record(RecipeMaterialSchema, z.string()).optional(),
  /**
   * The house as its specialist read it (PQ-T72, houses and buildings of the `views` source):
   * volumes with their own roofs, open verandas and balconies, every opening, the chimneys and
   * the colours (`lib/house-plan.ts`). The 3D views build it (`lib/house-mesh.ts`) instead of the
   * hull; its walls still wear `faces` drawings where a drawing sees them.
   */
  house: HousePlanSchema.optional(),
  /**
   * Drawn views projected on the model (PQ-T70, `views` source only): `atlas` is one image (data
   * URL, layout in `lib/face-atlas.ts`) of the validated drawings cut to the object, `views` the
   * drawings in it, `hull` the silhouette hull they are projected on (`lib/face-hull.ts`). The
   * 3D view draws the hull wearing the drawings instead of the parts. Never the photo.
   */
  faces: z
    .object({
      atlas: z.string().startsWith('data:image/').max(FACE_ATLAS_MAX_CHARS),
      views: z.array(z.enum(ATLAS_VIEWS)).min(1).max(ATLAS_VIEWS.length),
      hull: z.object({
        grid: z.tuple([hullCell.min(1), hullCell.min(1), hullCell.min(1)]),
        boxes: z
          .array(z.tuple([hullCell, hullCell, hullCell, hullCell, hullCell, hullCell]))
          .min(1)
          .max(HULL_BOXES_MAX),
      }),
      /**
       * The operator's own look per surface (roof, each wall): no entry = the drawing as it is;
       * `color` alone tints the drawing; `material` replaces the drawing by that material in
       * `color`. Set in the surface editor of the 3D view, never by a model.
       */
      surfaces: z
        .object({
          roof: FaceSurfaceSchema,
          front: FaceSurfaceSchema,
          right: FaceSurfaceSchema,
          back: FaceSurfaceSchema,
          left: FaceSurfaceSchema,
        } satisfies Record<HullSurface, typeof FaceSurfaceSchema>)
        .partial()
        .optional(),
    })
    .optional(),
  /**
   * Measured wall tints per face (PQ-T44 remedy 4): medians on the photo's wall regions,
   * yawed views only (straight views keep the role colour). Absent faces fall back to the
   * part colour; the rear mirrors the front. The 3D view and the flat render tint by face
   * normal; the village and VR ignore it.
   */
  wallTints: z
    .object({
      front: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
      left: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
      right: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
    })
    .optional(),
  /** How the key dims were determined (PR-2.15); eave on houses only, absent on older shapes. */
  dimStatus: z
    .object({
      eave: DimStatusSchema.optional(),
      depth: DimStatusSchema.optional(),
      yaw: DimStatusSchema.optional(),
      scale: DimStatusSchema.optional(),
    })
    .optional(),
});
export type ObjectRecipe = z.infer<typeof ObjectRecipeSchema>;

/** What the browser sends to `/api/vision/shape` about the selected object. */
/** Longest SAM outline sent with a shape request (characters). */
export const SHAPE_OUTLINE_MAX = 20_000;

/** Longest facade URL accepted: an inline PNG elevation is ≈ 1–3 MB of base64. */
export const FACADE_URL_MAX = 8_000_000;

/**
 * The views drawn beside the front (PQ-T68): right side, back, left side, then the view from
 * above (PQ-T71: the plan, validated like the faces).
 */
export const FACE_NAMES = ['side', 'back', 'left', 'top'] as const;
export type FaceName = (typeof FACE_NAMES)[number];

/** An image URL accepted for a 2D view: inline image or https link, at most `FACADE_URL_MAX` characters. */
const viewUrl = z
  .string()
  .max(FACADE_URL_MAX)
  .regex(/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/);

export const ShapeTargetSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(40),
  category: ApplianceCategorySchema,
  /** Scenery type (house, tree, car…): every object can be modelled, not only appliances. */
  scenery: SceneryTypeSchema.optional(),
  box: NormBoxSchema,
  /** SAM outline (photo fractions path): colours are measured inside it (PF-T2). Too long → not sent. */
  outline: z.string().max(SHAPE_OUTLINE_MAX).optional(),
  /**
   * Validated 2D facade (Muse Image 1.0): sent to Spark as a second image beside the photo crop.
   * Only an inline image or an https link (R2), at most `FACADE_URL_MAX` characters.
   */
  facadeUrl: z
    .string()
    .max(FACADE_URL_MAX)
    .regex(/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/)
    .optional(),
  /** R2 / storage key of the validated 2D facade image. */
  facadeKey: z.string().optional(),
  /**
   * Faces the operator validated in the 2D panel (PQ-T68): drawn from the front and from each other,
   * so the four views agree. A face not listed is drawn by the pipeline itself.
   */
  faceUrls: z
    .object({ side: viewUrl, back: viewUrl, left: viewUrl, top: viewUrl })
    .partial()
    .optional(),
  /** Storage keys of those faces (they make a new validation a new request). */
  faceKeys: z
    .object({ side: z.string(), back: z.string(), left: z.string(), top: z.string() })
    .partial()
    .optional(),
  /** Family the operator picked when asked (PQ-T41): it becomes the kit hint and the kit's archetype. */
  archetype: z.string().max(16).optional(),
  /** The validated 2D view is a clean front drawn from a hidden object (PQ-T23): its parts are inferred. */
  cleanFront: z.boolean().optional(),
});
export type ShapeTarget = z.infer<typeof ShapeTargetSchema>;

export const SHAPE_FALLBACK_REASONS = [
  'provider_error',
  'spend_cap',
  'malformed',
  'no_body',
  /** Spark exceeded an explicit caller budget (routes set none: they wait for the answer). */
  'timeout',
  /** The browser could not reach the app server (offline, server down, bad reply). */
  'network',
] as const;
export type ShapeFallbackReason = (typeof SHAPE_FALLBACK_REASONS)[number];

export const CANONICAL_ANGLES = ['front', 'back', 'left', 'right', 'top', 'three_quarter'] as const;
export type CanonicalAngle = (typeof CANONICAL_ANGLES)[number];

export const ImaginedAngleViewSchema = z.object({
  angle: z.enum(CANONICAL_ANGLES),
  labelKey: z.string(),
  angleDeg: z.number(),
  description: z.string(),
  imageUrl: z.string(),
  features: z.array(z.string()).default([]),
});
export type ImaginedAngleView = z.infer<typeof ImaginedAngleViewSchema>;

/** `/api/vision/views` reply: the 6 canonical 2D imagined angles for one detection. */
export const ImaginedViewsResponseSchema = z.object({
  ok: z.literal(true),
  views: z.array(ImaginedAngleViewSchema).length(CANONICAL_ANGLES.length),
  detectionId: z.string(),
});
export type ImaginedViewsResponse = z.infer<typeof ImaginedViewsResponseSchema>;

/** `/api/vision/shape` reply. `recipe` set only in `recipe` mode; `reason` only in `silhouette` mode. */
/**
 * One segmented part on the object crop (PR-2.5): SAM concept + box in crop fractions, outline
 * when the mask decoded. Wheels / windows / doors feed PR-2.6…2.8; empty when the archetype has
 * no concepts, the client cannot segment, or every call failed.
 */
export const PartMaskSchema = z.object({
  concept: z.string(),
  box: NormBoxSchema,
  outline: z.string().optional(),
});
export type PartMask = z.infer<typeof PartMaskSchema>;

/** One SAM part concept on the object (PQ-T37): parts seen on the photo vs built by the model. Computed. */
export const PartCoverageSchema = z.object({
  concept: z.string(),
  seen: z.number().int().min(0),
  built: z.number().int().min(0),
});
export type PartCoverage = z.infer<typeof PartCoverageSchema>;

/** Message key of a part concept under `model3dPart` (« side mirror » → `side_mirror`). */
export const partLabelKey = (concept: string) => concept.trim().toLowerCase().replace(/\s+/g, '_');

/** How good the photo pixels of the object are (PQ-T7). Measured by code, never by AI. */
export const PHOTO_LEVELS = ['low', 'medium', 'high'] as const;
export type PhotoLevel = (typeof PHOTO_LEVELS)[number];
export const PHOTO_VIEWS = ['front', 'three_quarter', 'side'] as const;
export type PhotoView = (typeof PHOTO_VIEWS)[number];
/**
 * Representation families (PQ-T47, universal pipeline §4.1): how the geometry is built. `library` =
 * a named, tested template chosen by archetype; `parametric` = template-less free parts; `procedural`
 * = generators grown by code (PQ-T50); `sdf` = smooth shapes (later). Recorded on every recipe answer.
 */
export const REPRESENTATION_FAMILIES = ['parametric', 'procedural', 'sdf', 'library'] as const;
export type RepresentationFamily = (typeof REPRESENTATION_FAMILIES)[number];
export const PhotoConditionsSchema = z.object({
  widthPx: z.number().int().min(0),
  heightPx: z.number().int().min(0),
  /** low = blurred. */
  sharpness: z.enum(PHOTO_LEVELS).optional(),
  /** Share of clipped pixels, classed (low = fine). */
  exposure: z.enum(PHOTO_LEVELS).optional(),
  /** Share of the object hidden, 0–1 (needs an outline). */
  hidden: z.number().min(0).max(1).optional(),
  view: z.enum(PHOTO_VIEWS).optional(),
});
export type PhotoConditions = z.infer<typeof PhotoConditionsSchema>;

export const ObjectShapeSchema = z.object({
  detectionId: z.string(),
  mode: z.enum(['recipe', 'silhouette']),
  partMasks: z.array(PartMaskSchema).optional(),
  recipe: ObjectRecipeSchema.optional(),
  reason: z.enum(SHAPE_FALLBACK_REASONS).optional(),
  source: z.enum(['meta', 'mock']),
  model: z.string(),
  fallback: z.enum(['provider_error', 'spend_cap', 'not_configured']).optional(),
  /** How well the model's silhouette matches the SAM outline after the fit (PF-T6), IoU 0–1. Computed, not AI. */
  fit: z.object({ iou: z.number().min(0).max(1) }).optional(),
  /** Short cause with `provider_error` (`http_429`…), shown in the panel and the logs. */
  detail: z.string().max(40).optional(),
  /** 2D imagined views across the 6 canonical angles before or alongside full 3D generation. */
  imaginedViews: z.array(ImaginedAngleViewSchema).optional(),
  /** Spark's kit behind `recipe` (Meta only, PR-0.6): what the critic patches. */
  kit: z.custom<ObjectKit>().optional(),
  /** SAM outline the recipe was fitted and scored against (PR-0.6; fetched ones included). */
  outline: z.string().optional(),
  /** Parts seen on the photo vs built, per SAM concept (PQ-T37); absent without part masks. Computed, not AI. */
  coverage: z.array(PartCoverageSchema).optional(),
  /** Photo conditions of the object (PQ-T7): size, sharpness, exposure, hidden share, view. Computed, not AI. */
  conditions: PhotoConditionsSchema.optional(),
  /** Representation family the recipe was built in (PQ-T47, §4.1). Computed from the archetype. */
  family: z.enum(REPRESENTATION_FAMILIES).optional(),
  /** The model doubts the family (PQ-T41): the two to choose from, best first. Computed from the kit, not AI text. */
  ask: z.object({ archetypes: z.array(z.string().max(16)).length(2) }).optional(),
});
export type ObjectShape = z.infer<typeof ObjectShapeSchema>;

/**
 * Server steps of `/api/vision/shape` (SSE `shape_step`), shown live in the « 3D model » block:
 * `crop` = cut and enlarge the object · `model` = Muse Spark imagines the parts · `fit` = check and fit
 * them to the photo box. The browser adds its own `build` step (geometry) once the answer is in.
 */
/**
 * Default Spark budget for one recipe: none — the answer is awaited until it arrives (measured:
 * Muse needs ≈ 15 s base to ≈ 25 s contributor, more for a 12-part recipe). Callers may still pass
 * an explicit `timeoutMs`; past it the silhouette is used (reason `timeout`).
 */
export const SHAPE_TIMEOUT_MS: number | null = null;

/** `check` = the AI checks the views model against the drawings and fixes it (PV-H). */
/** `code` (PQ-T64): Muse Wonder writes and refines the construction code; joins the list when it starts. */
export const SHAPE_STEPS = ['crop', 'model', 'fit', 'check', 'code'] as const;
export type ShapeStep = (typeof SHAPE_STEPS)[number];
export const ShapeStepEventSchema = z.object({ step: z.enum(SHAPE_STEPS) });

/**
 * Timed phases of `/api/vision/shape` (PQ-T42, E12): one SSE `shape_timing { phase, ms }` per
 * phase that ran, plus a `[vision] 3D <phase> …` log line. `crop` = cut the object · `sam` =
 * on-demand outline (overlaps `kit`) · `kit` = Spark kit + vote · `views` = elevations / views
 * measures and the AI check · `masks` = part + facade masks · `fit` = measures, silhouette fit,
 * reshapes and graph · `stages` = staged loop of the first answer · `score` = final scoring ·
 * `critic` = Spark critic round(s) · `code` = route-B construction-code rounds (PQ-T45).
 * Skipped phases emit nothing.
 */
export const SHAPE_TIMING_PHASES = [
  'crop',
  'kit',
  'sam',
  'masks',
  'fit',
  'views',
  'stages',
  'score',
  'critic',
  'code',
] as const;
export type ShapeTimingPhase = (typeof SHAPE_TIMING_PHASES)[number];
export const ShapeTimingEventSchema = z.object({
  phase: z.enum(SHAPE_TIMING_PHASES),
  ms: z.number().nonnegative(),
});

/** `950` → `950 ms`, `3400` → `3.4 s`: the log form of a phase duration (PQ-T42). */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
}

/**
 * Staged improvement of the model (PG-T17/T18): stage ids of the loop (house: massing → roof →
 * openings → accessories; objects from their 2D view, PG-T20: body, glass, wheels, doors, cells,
 * trunk, crown, head, details), then `final`: Muse Wonder checks the whole model and re-refines
 * it (background only). The first answer runs the stages that fit its budget; the rest go
 * on in the background on the same stream (`shape_stage` events), resumable by job id.
 */
export const SHAPE_STAGE_IDS = [
  'massing',
  'roof',
  'openings',
  'accessories',
  'chimney',
  'body',
  'glass',
  'wheels',
  'doors',
  'cells',
  'trunk',
  'crown',
  'head',
  'details',
  'final',
] as const;
export type ShapeStageId = (typeof SHAPE_STAGE_IDS)[number];
/**
 * Background stages have no overall time limit: they wait for Meta however long it takes and stop
 * only when the operator cancels (user 2026-11-03). A serverless request is cut at
 * `SHAPE_FUNCTION_MS` (Vercel: « Task timed out after 300 seconds », live 2026-11-03), so the loop
 * runs in slices: a round starts only with `STAGE_ROUND_RESERVE_MS` left, a slice ends
 * `STAGE_SLICE_MARGIN_MS` before the cut, and a checkpoint lets the next request go on
 * (`shape_stages_checkpoint`, POST `/api/vision/shape/stages`).
 */
export const SHAPE_FUNCTION_MS = 300_000;
export const STAGE_SLICE_MARGIN_MS = 20_000;
/** Longest Spark stage round seen live (≈ 110 s) plus the sheet render. */
export const STAGE_ROUND_RESERVE_MS = 125_000;
export const SHAPE_STAGE_STOPS = [
  'gate',
  'no_gain',
  'rounds',
  'timeout',
  'error',
  'skipped',
  'repeat',
  'back_and_forth',
] as const;
export type ShapeStageStop = (typeof SHAPE_STAGE_STOPS)[number];

/** `shape_stage`: a stage started (`running`) or ended (`done`, with its scores and the model). */
export const ShapeStageEventSchema = z.object({
  jobId: z.string().max(64).optional(),
  /** `first` = inside the first answer's budget, `background` = after it. */
  phase: z.enum(['first', 'background']),
  /** 1-based position of the stage among `total`. */
  index: z.number().int().min(1),
  total: z.number().int().min(1),
  stage: z.enum(SHAPE_STAGE_IDS),
  state: z.enum(['running', 'done']),
  before: z.number().min(0).max(1).optional(),
  after: z.number().min(0).max(1).optional(),
  stop: z.enum(SHAPE_STAGE_STOPS).optional(),
  /** Part kinds the stage works on: the viewer frames and outlines them while it runs. */
  kinds: z.array(PartKindSchema).max(PART_KINDS.length).optional(),
  /** The model after this stage, when a patch was kept (the viewer swaps it in). */
  recipe: ObjectRecipeSchema.optional(),
});
export type ShapeStageEvent = z.infer<typeof ShapeStageEventSchema>;

const volume = (p: RecipePart) => p.size[0] * p.size[1] * p.size[2];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Repairs a Spark recipe instead of rejecting it (thin objects like lamp posts came back « poor »):
 * - parts are stretched and re-centred so together they fill the object box on each axis
 *   (fixes parts drawn too small, off-centre or sticking out);
 * - width / height come from the photo box (`boxAspect` = its width / height in pixels, 0 = keep the
 *   model's), depth keeps the model's ratio to height. Largest side stays 1.
 * - `yaw` (PF-T5): the box shows the front foreshortened plus the side, `w·cos + d·sin = aspect·h`, so the
 *   true front width is solved from it (≥ 30 % of the box width; the depth shrinks when it cannot fit).
 */
export function fitRecipe(recipe: ObjectRecipe, boxAspect: number, yaw = 0): ObjectRecipe {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of recipe.parts) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, p.at[i]! - p.size[i]! / 2);
      hi[i] = Math.max(hi[i]!, p.at[i]! + p.size[i]! / 2);
    }
  }
  const span = lo.map((l, i) => Math.max(0.01, hi[i]! - l));
  const mid = lo.map((l, i) => (l + hi[i]!) / 2);
  const parts = recipe.parts.map((p) => ({
    ...p,
    at: p.at.map((c, i) =>
      clamp((c - mid[i]!) / span[i]!, -RECIPE_BOUND, RECIPE_BOUND)
    ) as RecipePart['at'],
    size: p.size.map((v, i) => clamp(v / span[i]!, 0.01, 1)) as RecipePart['size'],
  }));
  const { h } = recipe.proportions;
  let { d } = recipe.proportions;
  const turn = clamp(Number.isFinite(yaw) ? yaw : 0, -MAX_YAW, MAX_YAW);
  const known = boxAspect > 0 && Number.isFinite(boxAspect);
  let w = known ? h * boxAspect : recipe.proportions.w;
  if (known && turn !== 0) {
    const cos = Math.cos(turn);
    const sin = Math.abs(Math.sin(turn));
    const seen = h * boxAspect;
    w = Math.max(0.3 * seen, (seen - d * sin) / cos);
    d = Math.max(0.01, Math.min(d, (seen - w * cos) / sin));
  }
  const max = Math.max(w, h, d);
  return {
    proportions: {
      w: clamp(w / max, 0.01, 1),
      h: clamp(h / max, 0.01, 1),
      d: clamp(d / max, 0.01, 1),
    },
    parts,
    ...(turn !== 0 ? { yaw: turn } : {}),
    ...(recipe.source ? { source: recipe.source } : {}),
    ...(recipe.swatches ? { swatches: recipe.swatches } : {}),
    ...(recipe.faces ? { faces: recipe.faces } : {}),
    ...(recipe.house ? { house: recipe.house } : {}),
  };
}

/** Why a (fitted) recipe would look wrong, or null when it is usable: parts with almost no volume. */
export function recipeIssue(recipe: ObjectRecipe): 'no_body' | null {
  const fill = recipe.parts.reduce((s, p) => s + volume(p), 0);
  return fill < MIN_FILL_VOLUME ? 'no_body' : null;
}

/**
 * Last guard before a recipe ships: every part size into [MIN_EXTENT, 1] and every centre into
 * ±RECIPE_BOUND, so a fitting step that squeezes a part flat never breaks the schema. Returns the
 * same recipe when nothing moved, and the indices of the parts it changed (for the log).
 */
/**
 * Wall tint for a vertex normal (PQ-T44 remedy 4): ±z faces read front (the rear mirrors
 * it), ±x faces their side, tops and base keep the part colour. Shared by the 3D view and
 * the flat render so the judge grades what the viewer shows. Null = keep the part colour.
 */
export function wallTintFor(
  part: Pick<RecipePart, 'shape' | 'kind' | 'front'>,
  tints: NonNullable<ObjectRecipe['wallTints']> | undefined,
  normal: readonly [number, number, number]
): string | null {
  if (!tints) return null;
  if (part.shape !== 'box' || (part.kind !== 'wall' && !part.front)) return null;
  const [nx, ny, nz] = normal;
  const [ax, ay, az] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
  if (az >= ax && az >= ay) return tints.front ?? null;
  if (ax >= ay) return (nx > 0 ? tints.right : tints.left) ?? null;
  return null;
}

export function clampParts(recipe: ObjectRecipe): { recipe: ObjectRecipe; clamped: number[] } {
  const clamped: number[] = [];
  const parts = recipe.parts.map((p, i) => {
    const size = p.size.map((v) => clamp(v, MIN_EXTENT, 1)) as RecipePart['size'];
    const at = p.at.map((v) => clamp(v, -RECIPE_BOUND, RECIPE_BOUND)) as RecipePart['at'];
    if (size.every((v, k) => v === p.size[k]) && at.every((v, k) => v === p.at[k])) return p;
    clamped.push(i);
    return { ...p, size, at };
  });
  return { recipe: clamped.length ? { ...recipe, parts } : recipe, clamped };
}

/** Main body part: the one marked `front`, else the biggest. */
export function frontPartIndex(recipe: ObjectRecipe): number {
  const marked = recipe.parts.findIndex((p) => p.front);
  if (marked >= 0) return marked;
  let best = 0;
  recipe.parts.forEach((p, i) => {
    if (volume(p) > volume(recipe.parts[best]!)) best = i;
  });
  return best;
}

/**
 * Silhouette fallback: the object's outline (SAM, else its box) as rings in box fractions
 * (0–1 of the detection box, y down), largest ring first. Ready for a THREE.Shape extrusion.
 */
export function silhouetteRings(
  d: Pick<ApplianceDetection, 'box' | 'outline'>
): Array<Array<readonly [number, number]>> {
  const { x, y, w, h } = d.box;
  if (w <= 0 || h <= 0) return [];
  const rings = pathToRings(d.outline || boxPath(d.box)).map((r) =>
    r.map(([px, py]) => [(px - x) / w, (py - y) / h] as const)
  );
  const area = (r: ReadonlyArray<readonly [number, number]>) =>
    Math.abs(
      r.reduce(
        (s, p, i) => s + p[0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * p[1],
        0
      )
    ) / 2;
  return rings.sort((a, b) => area(b) - area(a));
}

/**
 * The recipe with one surface restyled (PQ-T71): `look` null (or empty) gives the surface back to
 * its drawing. A recipe without drawn faces is returned as it is. Pure, never mutates.
 */
export function restyleSurface(
  recipe: ObjectRecipe,
  surface: HullSurface,
  look: FaceSurface | null
): ObjectRecipe {
  if (!recipe.faces) return recipe;
  const surfaces = { ...recipe.faces.surfaces };
  if (look && (look.color || look.material || look.drawing)) surfaces[surface] = look;
  else delete surfaces[surface];
  const { surfaces: _dropped, ...faces } = recipe.faces;
  void _dropped;
  return {
    ...recipe,
    faces: { ...faces, ...(Object.keys(surfaces).length ? { surfaces } : {}) },
  };
}
