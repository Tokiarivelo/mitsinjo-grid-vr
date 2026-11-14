import { z } from 'zod';

/**
 * Plan of a car (PQ-T76): what is measured on the validated drawings (wheels, track, ground
 * clearance, tyre and rim colours) and, later, what the car specialists read (body, glazing,
 * lights, details). Shared by the server (which measures and fits it) and the 3D views (which will
 * build it). Every part is optional: a plan with no wheels is still a plan. Pure.
 *
 * Every coordinate is a share of the object's box, as in `lib/house-plan.ts`: x 0 → 1 left → right
 * as seen on the front, y 0 → 1 ground → top, z 0 → 1 back → front. A wheel's radius is a share of
 * the box height (the profile is drawn with square pixels: its circles stay circles).
 */

export const CAR_KINDS = [
  'sedan',
  'hatchback',
  'estate',
  'suv',
  'offroad',
  'coupe',
  'convertible',
  'pickup',
  'van',
  'minibus',
  'truck',
  'other',
] as const;
export type CarKind = (typeof CAR_KINDS)[number];

const share = z.number().min(0).max(1);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/** One axle seen on the profile: both wheels of it share `z`, `y` and `r`. */
export const CarWheelSchema = z.object({
  /** Centre along the car, back (0) → front (1). */
  z: share,
  /** Centre height above the ground. */
  y: share,
  /** Tyre radius, share of the box height. */
  r: z.number().min(0.01).max(0.6),
  /** Rim radius as a share of the tyre radius (absent when the drawing does not show it). */
  rim: z.number().min(0.1).max(0.95).optional(),
});
export type CarWheel = z.infer<typeof CarWheelSchema>;

/** Stations of the body's profile along the car, and levels of its cross-section. */
export const CAR_STATIONS = 64;
export const CAR_LEVELS = 32;

/**
 * The body measured on the drawings (PQ-T76): its profile on the side (top and underside per
 * station, back → front, the wheel arches cut out), its cross-section on the front (half-width per
 * level, ground → top, the mirrors left out) and, from the view from above, how the width narrows
 * toward the nose and the tail (1 = full width).
 */
export const CarBodySchema = z.object({
  /** Where the profile starts and ends along the car. */
  z0: share,
  z1: share,
  top: z.array(share).min(2).max(256),
  bottom: z.array(share).min(2).max(256),
  /** Half-width per level, share of the box width (0–0.5). */
  half: z.array(z.number().min(0).max(0.5)).min(2).max(256),
  taper: z.array(share).min(2).max(256).optional(),
});
export type CarBody = z.infer<typeof CarBodySchema>;

export const CAR_WINDOW_VIEWS = ['front', 'right', 'back', 'left'] as const;

/**
 * A window in the model's frame: on a side its points are [z, y], on the front or the back [x, y]
 * (shares of the box, y ground → top).
 */
export const CarWindowSchema = z.object({
  view: z.enum(CAR_WINDOW_VIEWS),
  points: z
    .array(z.tuple([share, share]))
    .min(3)
    .max(8),
});
export type CarWindow = z.infer<typeof CarWindowSchema>;

export const CarPlanSchema = z.object({
  kind: z.enum(CAR_KINDS).optional(),
  /** Axles back → front, as measured on the profile. */
  wheels: z.array(CarWheelSchema).max(6),
  /** Outer edges of the tyres on the front view, and one tyre's width (shares of the box width). */
  track: z.object({ x0: share, x1: share, tyre: share }).optional(),
  /** Height of the body's underside between the wheels. */
  clearance: share.optional(),
  /** The body measured on the drawings; without it the model stays the drawn hull. */
  body: CarBodySchema.optional(),
  /** Windows read by the car team, in the model's frame (glass slot). */
  windows: z.array(CarWindowSchema).max(24).optional(),
  /** Colours measured on the drawings. */
  look: z
    .object({
      tyre: hex.optional(),
      rim: hex.optional(),
      paint: hex.optional(),
      glass: hex.optional(),
    })
    .optional(),
});
export type CarPlan = z.infer<typeof CarPlanSchema>;
