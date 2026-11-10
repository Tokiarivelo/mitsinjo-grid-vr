import 'server-only';

import { type NextRequest } from 'next/server';
import { ExpectedDetectionsSchema, VisionRegionsSchema } from '@/lib/vision';
import { getPerceptionClient } from '@/server/perception';
import { runVisionPipeline, withExpectedDetections } from '@/server/perception/vision-pipeline';
import { runRegionPipeline } from '@/server/perception/region';
import {
  jsonField,
  jsonResponse,
  photoSize,
  readVisionRequest,
  sseResponse,
} from '@/server/perception/vision-request';
import { hostVisionImage } from '@/server/storage/media';

export { MAX_VISION_BYTES } from '@/server/perception/vision-request';

/**
 * Appliance detection on a photo (PV). Multipart: `image` (JPEG/PNG/WebP ≤ MAX_VISION_BYTES), `sessionId`,
 * `regions?` (JSON `VisionRegion[]`, PV-T8: identify only the drawn shapes),
 * `expected?` (JSON `ApplianceDetection[]`, VS-T14: labelled objects of the 360° test tour, used by mock answers).
 * → `text/event-stream`: `vision_detections` (boxes, then outlines on Meta) or, with regions,
 * `vision_regions` (same two phases) · `vision_error` · `done`.
 * Meta + R2: the photo is kept under `vision/` and sent by link. Mock: not stored, sample-room fixture.
 */
export async function POST(req: NextRequest) {
  const read = await readVisionRequest(req);
  if (read instanceof Response) return read;
  const { form, sessionId, photo } = read;
  // Optional (PV-T8): shapes drawn by the operator → identify only those, not the whole photo.
  const regions = jsonField(form, 'regions', VisionRegionsSchema);
  if (regions === null) return jsonResponse({ error: 'Invalid regions' }, 400);
  const expected = jsonField(form, 'expected', ExpectedDetectionsSchema);
  if (expected === null) return jsonResponse({ error: 'Invalid expected' }, 400);

  const perception = getPerceptionClient(sessionId);
  // Meta: one R2 upload, then a short link for Muse and every SAM call (base64 when R2 is off).
  const visionImage = perception.callsMeta
    ? await hostVisionImage(photo.buffer, photo.contentType)
    : { url: `data:${photo.contentType};base64,${photo.buffer.toString('base64')}` };
  return sseResponse(async (send) => {
    if (regions) {
      await runRegionPipeline(
        perception,
        await photoSize(photo.buffer),
        visionImage.url,
        regions,
        send,
        req.signal
      );
    } else {
      await runVisionPipeline(
        withExpectedDetections(perception, expected),
        visionImage,
        send,
        req.signal
      );
    }
  });
}
