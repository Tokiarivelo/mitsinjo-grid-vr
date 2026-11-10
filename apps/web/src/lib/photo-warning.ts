import type { PhotoConditions } from './object-shape';

/** Long side under this many pixels: too small to read parts (hint shown, PQ-T7). */
export const SMALL_OBJECT_PX = 150;

/** Why the 3D panel should warn: the photo is too small or too blurred for the parts to be read. */
export function photoWarning(c: PhotoConditions | undefined): 'small' | 'blurred' | null {
  if (!c) return null;
  if (Math.max(c.widthPx, c.heightPx) < SMALL_OBJECT_PX) return 'small';
  return c.sharpness === 'low' ? 'blurred' : null;
}
