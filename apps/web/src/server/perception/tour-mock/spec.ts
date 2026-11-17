import type { PlantHints } from '../tree/plant-build';
import type { PartSpec } from '../furniture/part-spec';

/**
 * Hand-built models of the 360° tour objects (VS-T41): what the AI answers for them in mock mode.
 * The part model and `compileSpec` live in `furniture/part-spec.ts` (PQ-T88, shared with the real
 * path); colours are a first guess, `make tour-mock` measures each part on the photo and keeps the
 * measured ones (`fixed` parts keep theirs).
 */

export * from '../furniture/part-spec';

export interface TourPartsSpec {
  kind: 'parts';
  parts: PartSpec[];
  /** Turn of the front away from the camera (rad, + = right end farther), as seen on the photo. */
  yaw?: number;
}

/**
 * A plant, read the way the real pipeline reads one (PQ-T82): its outlined photo is the front view
 * measured by `reconstructTree`, and `hints` is what the plant team would answer (habit, leaves,
 * limbs traced on the front, image fractions of the outline's box).
 */
export interface TourPlantSpec {
  kind: 'plant';
  label: string;
  hints: PlantHints;
}

export type TourSpec = TourPartsSpec | TourPlantSpec;
