import type { KitArchetype } from '@/lib/object-kit';
import type { PhotoConditions, RepresentationFamily } from '@/lib/object-shape';
import { ASK_CONFIDENCE_MAX } from './kit-ask';
import { HIDDEN_MIN } from './photo-conditions';

/**
 * Routing (PQ-T47, universal pipeline §4 + E2): the first decision, before any geometry. Answers two
 * questions — _what kind of image?_ and _what representation family?_ — then routes: full pipeline,
 * ask the operator, or motivated refusal. Pure.
 */

/** What the picture holds (§4.2 rows). */
export const IMAGE_TYPES = [
  'photo_single',
  'photo_multi',
  'hidden_object',
  'drawing',
  'none',
] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** What the pipeline should do with the image. */
export const ROUTE_ACTIONS = ['pipeline', 'ask', 'refuse'] as const;
export type RouteAction = (typeof ROUTE_ACTIONS)[number];

/** Why the pixels were refused (§4.2 last row): cause + shooting advice in the panel. */
export const REFUSAL_CAUSES = ['no_object', 'too_small', 'too_blurry'] as const;
export type RefusalCause = (typeof REFUSAL_CAUSES)[number];

/** Object long side under this: the crop holds no readable edge (§4.2 « minuscule »). */
export const REFUSE_MIN_PX = 64;

export interface RouteInput {
  /** Objects the detection listed (0 = nothing to model). */
  detections: number;
  /** Archetype of the selected object, once known (kit answer or operator pick). */
  archetype?: KitArchetype;
  /** Archetype confidence (PQ-T12), 0–1; 1 when the kit call did not answer one. */
  confidence?: number;
  /** Measured conditions of the object, when a photo is behind the request. */
  conditions?: PhotoConditions | null;
  /** What the detection call said the image is (E2 `image_type`); drawings take the 2D path. */
  imageKind?: 'photo' | 'drawing';
}

export interface ImageRoute {
  imageType: ImageType;
  family: RepresentationFamily;
  action: RouteAction;
  /** Set only when refused: the cause the panel explains. */
  cause?: RefusalCause;
}

/**
 * Archetype → representation family (§4.1, §4.2 routes): template archetypes reuse the tested
 * library, the living will grow procedurally (PQ-T50), people and animals go smooth (SDF, later),
 * the template-less rest is built from free parts (parametric).
 */
export function familyOf(archetype: KitArchetype): RepresentationFamily {
  if (archetype === 'tree' || archetype === 'bush') return 'procedural';
  if (archetype === 'person' || archetype === 'animal') return 'sdf';
  if (archetype === 'other') return 'parametric';
  return 'library';
}

/**
 * Route one image (§4.2): refusal first (nothing usable), then doubt (ask the operator under
 * 0.82), else the full pipeline in the archetype's family. A hidden object stays on the pipeline:
 * the « clean front » offer (PQ-T23) already rides on the conditions.
 */
export function routeImage(input: RouteInput): ImageRoute {
  const {
    detections,
    archetype = 'other',
    confidence = 1,
    conditions = null,
    imageKind = 'photo',
  } = input;
  const family = familyOf(archetype);
  const hidden = conditions?.hidden ?? 0;
  const imageType: ImageType =
    detections === 0
      ? 'none'
      : imageKind === 'drawing'
        ? 'drawing'
        : hidden >= HIDDEN_MIN
          ? 'hidden_object'
          : detections > 1
            ? 'photo_multi'
            : 'photo_single';
  let cause: RefusalCause | undefined;
  // Unusable pixels explain an empty list better than « nothing found » (E2 always routes 0 here).
  if (conditions && Math.max(conditions.widthPx, conditions.heightPx) < REFUSE_MIN_PX)
    cause = 'too_small';
  else if (conditions?.sharpness === 'low') cause = 'too_blurry';
  else if (detections === 0) cause = 'no_object';
  if (cause) return { imageType, family, action: 'refuse', cause };
  if (archetype === 'other' || confidence < ASK_CONFIDENCE_MAX)
    return { imageType, family, action: 'ask' };
  return { imageType, family, action: 'pipeline' };
}
