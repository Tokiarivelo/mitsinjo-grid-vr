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

export const CarPlanSchema = z.object({
  kind: z.enum(CAR_KINDS).optional(),
  /** Axles back → front, as measured on the profile. */
  wheels: z.array(CarWheelSchema).max(6),
  /** Outer edges of the tyres on the front view, and one tyre's width (shares of the box width). */
  track: z.object({ x0: share, x1: share, tyre: share }).optional(),
  /** Height of the body's underside between the wheels. */
  clearance: share.optional(),
  /** Colours measured on the drawings. */
  look: z.object({ tyre: hex.optional(), rim: hex.optional() }).optional(),
});
export type CarPlan = z.infer<typeof CarPlanSchema>;
