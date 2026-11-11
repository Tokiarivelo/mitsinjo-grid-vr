import 'server-only';

import type { KitArchetype } from '@/lib/object-kit';
import type { PartMask } from '@/lib/object-shape';
import type { NormBox } from '@/lib/vision';
import type { PerceptionClient } from './client';
import type { MaskMapGeom } from './mask-geometry';
import { samBoxToNorm } from './outline';
import { timeoutSignal } from './abort';
import { fetchPartMasks, PART_MASKS_TIMEOUT_MS } from './part-masks';

/**
 * Concepts segmented on the validated 2D facade, per archetype. Only houses: the facade is
 * their front elevation, the face `withMaskPanels` dresses. A vehicle's facade is its nose,
 * not the side glass the photo shows, so vehicles keep the photo masks.
 */
export const FACADE_CONCEPTS: Partial<Record<KitArchetype, ReadonlyArray<string>>> = {
  house: ['window', 'door'],
};

/** An object box smaller than this (image fraction) is a SAM miss: the whole image is used. */
export const FACADE_OBJECT_MIN_AREA = 0.15;

/** Windows and doors measured on the facade, in the facade's own frame. */
export interface FacadeMasks {
  masks: PartMask[];
  geom: MaskMapGeom;
}

/**
 * The object on the facade image: the largest SAM box, else the whole image (the elevation is
 * drawn centred and filling the frame). Pure.
 */
export function facadeObjectBox(boxes: ReadonlyArray<NormBox>): NormBox {
  let best: NormBox | null = null;
  for (const b of boxes) if (!best || b.w * b.h > best.w * best.h) best = b;
  return best && best.w * best.h >= FACADE_OBJECT_MIN_AREA ? best : { x: 0, y: 0, w: 1, h: 1 };
}

/**
 * Mask geometry for the facade: the facade image plays the crop and the photo at once, and
 * the object's box on it plays the detection box. Mask fractions then map to front-face
 * object fractions with no perspective (the elevation is drawn straight on). Pure.
 */
export function facadeMaskGeom(width: number, height: number, box: NormBox): MaskMapGeom {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return {
    photoW: w,
    photoH: h,
    box,
    crop: { left: 0, top: 0, width: w, height: h, outWidth: w, outHeight: h },
  };
}

/**
 * SAM on the validated facade (user, 2026-11-02): the object itself (for its box) and its
 * windows and doors, in parallel. Best effort like `fetchPartMasks`: null when the archetype
 * has no facade concepts, SAM answers nothing usable or only the mock answers. Never throws.
 */
export async function fetchFacadeMasks(
  segmentImage: PerceptionClient['segmentImage'],
  facadeUrl: string,
  archetype: KitArchetype,
  objectConcept: string,
  { timeoutMs = PART_MASKS_TIMEOUT_MS }: { timeoutMs?: number | null } = {}
): Promise<FacadeMasks | null> {
  const concepts = FACADE_CONCEPTS[archetype];
  if (!concepts?.length) return null;
  const signal = timeoutSignal(timeoutMs);
  const [object, masks] = await Promise.all([
    segmentImage(facadeUrl, objectConcept, signal).catch(() => null),
    fetchPartMasks(segmentImage, facadeUrl, archetype, { timeoutMs, concepts }),
  ]);
  if (masks.length === 0) return null;
  const real = object && object.source === 'meta' && !object.fallback ? object : null;
  const boxes = real
    ? real.instances
        .map((i) => samBoxToNorm(i.box, real.imageWidth, real.imageHeight))
        .filter((b): b is NormBox => b !== null)
    : [];
  // Without the object's answer the image size is unknown: unit pixels keep the fractions right.
  const width = real?.imageWidth || 1;
  const height = real?.imageHeight || 1;
  return { masks, geom: facadeMaskGeom(width, height, facadeObjectBox(boxes)) };
}
