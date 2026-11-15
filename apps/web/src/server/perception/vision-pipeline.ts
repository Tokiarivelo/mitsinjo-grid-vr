import type { ApplianceDetection } from '@/lib/vision';
import { formatDuration, type PhotoConditions } from '@/lib/object-shape';
import type { VisionImage } from '@/server/storage/media';
import type { PerceptionClient } from './client';
import { refineDetections } from './outline';
import { laplacianVariance, sharpnessLevel } from './photo-conditions';
import type { PhotoForRegions } from './region';
import { routeImage, type ImageRoute } from './routing';
import { sampleNativeGray } from './shape-colors';

export type VisionEmit = (
  event: 'vision_detections' | 'vision_regions' | 'vision_error',
  data: Record<string, unknown>
) => void;

/**
 * Size + sharpness of the whole frame (PQ-T47): only what the refusal needs. Null without pixels
 * or when the sample fails (the refusal then carries the generic cause).
 */
async function wholePhotoConditions(
  photo: PhotoForRegions | null
): Promise<PhotoConditions | null> {
  if (!photo) return null;
  try {
    const grid = await sampleNativeGray(photo, { x: 0, y: 0, w: 1, h: 1 });
    return {
      widthPx: photo.width,
      heightPx: photo.height,
      sharpness: sharpnessLevel(laplacianVariance(grid)),
    };
  } catch {
    return null;
  }
}

/**
 * Photo → appliances (PV-T6). Emits `vision_detections` twice: `phase: 'boxes'` as soon as Muse
 * answers, then `phase: 'outlines'` once SAM refined them (Meta only; the mock fixture is final).
 * Nothing listed → the boxes event also carries the routed refusal (`route`, PQ-T47 §4.2).
 * Hosted link first; on a Meta failure the inline photo is tried once. Never throws: an unexpected
 * error becomes `vision_error`.
 */
export async function runVisionPipeline(
  perception: Pick<PerceptionClient, 'detectAppliances' | 'segmentImage'>,
  image: string | VisionImage,
  emit: VisionEmit,
  signal?: AbortSignal,
  photo: PhotoForRegions | null = null
): Promise<void> {
  const { url, inlineUrl } =
    typeof image === 'string' ? { url: image, inlineUrl: undefined } : image;
  try {
    let imageUrl = url;
    const boxesStart = Date.now();
    let found = await perception.detectAppliances(imageUrl, signal);
    // Meta could not use the hosted link (e.g. media_url_origin_error): resend the photo inline once.
    if (found.fallback === 'provider_error' && inlineUrl && !signal?.aborted) {
      console.warn('[vision] hosted photo failed on Meta, retrying with base64');
      imageUrl = inlineUrl;
      found = await perception.detectAppliances(imageUrl, signal);
    }
    const boxesMs = Date.now() - boxesStart;
    console.info(`[vision] detections (boxes): ${formatDuration(boxesMs)}`);
    const source = {
      source: found.source,
      model: found.model,
      ...(found.fallback ? { fallback: found.fallback } : {}),
    };
    // PQ-T47 (§4.2 last row): nothing listed → motivated refusal, cause measured on the frame.
    let route: ImageRoute | null = null;
    if (found.detections.length === 0) {
      route = routeImage({
        detections: 0,
        conditions: await wholePhotoConditions(photo),
        ...(found.imageType ? { imageKind: found.imageType } : {}),
      });
      console.info(`[vision] detections refused: ${route.cause}`);
    }
    emit('vision_detections', {
      phase: 'boxes',
      detections: found.detections,
      ...(found.imageType ? { imageType: found.imageType } : {}),
      ...(route ? { route } : {}),
      ms: boxesMs,
      ...source,
    });

    if (found.source !== 'meta' || found.detections.length === 0) return;
    const outlinesStart = Date.now();
    const refined = await refineDetections(perception, imageUrl, found.detections);
    const outlinesMs = Date.now() - outlinesStart;
    console.info(`[vision] detections (outlines): ${formatDuration(outlinesMs)}`);
    emit('vision_detections', {
      phase: 'outlines',
      detections: refined.detections,
      refined: refined.refined,
      ms: outlinesMs,
      ...source,
    });
  } catch (err) {
    console.warn('[vision] pipeline failed:', err instanceof Error ? err.message : err);
    emit('vision_error', { code: 'VISION_FAILED', message: 'Appliance detection failed' });
  }
}

type Detector = Pick<PerceptionClient, 'detectAppliances' | 'segmentImage'>;

/**
 * Mock answers + 360° test tour (VS-T14): the client sends the hand-labelled objects in view
 * (`expected`); a mock answer (mock mode or Meta fallback) returns them instead of the sample-room
 * fixture, so offline boxes land on the real objects. Meta answers are never touched.
 */
export function withExpectedDetections<P extends Detector>(
  perception: P,
  expected: ApplianceDetection[] | undefined
): Detector {
  if (!expected) return perception;
  return {
    segmentImage: (...args) => perception.segmentImage(...args),
    detectAppliances: async (...args) => {
      const found = await perception.detectAppliances(...args);
      return found.source === 'mock' ? { ...found, detections: expected } : found;
    },
  };
}
