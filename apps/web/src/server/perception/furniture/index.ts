import type { ObjectRecipe } from '@/lib/object-shape';
import { compileSpec, type PartSpec } from './part-spec';

/**
 * Furniture builders (PQ-T88): dimensions in metres → named parts → recipe. Shared by the real
 * path (a team's reading turned into these dimensions, PQ-T89/T90) and the 360° tour mock
 * (`tour-mock/specs-extra.ts`), never copied.
 */

export * from './part-spec';
export * from './materials';
export * from './seating';
export * from './openings';
export * from './soft';
export * from './storage';
export * from './structure';
export * from './silhouette';

/** A built piece as a recipe (proportions from its parts' bounds, largest side = 1). */
export const furnitureRecipe = (parts: PartSpec[], yaw?: number): ObjectRecipe =>
  compileSpec({ parts, ...(yaw ? { yaw } : {}) }).recipe;
