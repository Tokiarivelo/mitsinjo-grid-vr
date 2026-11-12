import 'server-only';

import type { KitArchetype } from '@/lib/object-kit';
import type { ShapeTarget } from '@/lib/object-shape';
import type { PerceptionClient } from './client';
import type { PhotoForRegions } from './region';
import { measureFacadeElevations, type FacadeElevations } from './facade-views';
import { generateFacadeImage, museImageReady } from './facade-specialist';

/**
 * Default 2D route for houses (PQ-T44, §7.4 remedy 1): when the photo has no validated
 * drawing, draw a clean facade (the PQ-T23 action), measure it, and let the elevations path
 * build from it. The template stays the fallback when the drawing fails. Called before the
 * kit answer, on the detection hint; the drawing runs in parallel with Spark.
 */

type Segment = PerceptionClient['segmentImage'];

export interface HouseFacadeRouteInput {
  hint: KitArchetype;
  target: ShapeTarget;
  photo: PhotoForRegions;
  segment: Segment;
  signal?: AbortSignal;
  onSideView?: (png: Buffer) => void;
}

/**
 * Draw + measure + gate. Null when Muse Image is down (a mock drawing must never feed the
 * measured path), the drawing fails, SAM cannot read it, or it shows no measurable opening
 * (a blind drawing gives the facade path nothing to be precise about — the template guess
 * serves better). Never throws.
 */
export async function routeHouseFacade({
  hint,
  target,
  photo,
  segment,
  signal,
  onSideView,
}: HouseFacadeRouteInput): Promise<FacadeElevations | null> {
  if (!museImageReady()) return null;
  let url: string;
  try {
    // Empty evidence: the kit answer (hidden parts) is still in flight; the photo reference
    // carries what the text cannot name.
    const drawn = await generateFacadeImage({
      target,
      photo,
      cleanFront: {},
      ...(signal ? { signal } : {}),
    });
    url = drawn.imageUrl;
  } catch (err) {
    console.warn(
      '[vision] 3D house facade drawing failed, template fallback:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
  const elev = await measureFacadeElevations(segment, url, hint, {
    ...(signal ? { signal } : {}),
    ...(onSideView ? { onSideView } : {}),
    sideCards: true,
  }).catch(() => null);
  if (!elev) {
    console.info('[vision] 3D house facade drawing unreadable, template fallback');
    return null;
  }
  if (elev.front.windows.length + elev.front.doors.length === 0) {
    console.info('[vision] 3D house facade drawing has no openings, template fallback');
    return null;
  }
  return elev;
}
