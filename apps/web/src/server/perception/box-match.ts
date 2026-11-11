import type { NormBox } from './schemas';

/** Minimum box overlap (IoU) for a SAM instance to belong to a Muse detection. */
export const MATCH_MIN_IOU = 0.3;

/** Intersection over union of two image-fraction boxes (0–1). */
export function iou(a: NormBox, b: NormBox): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
