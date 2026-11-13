import 'server-only';

import { randomUUID } from 'node:crypto';
import { type NextRequest } from 'next/server';
import { ShapeTargetSchema } from '@/lib/object-shape';
import { getShapeStepModels } from '@/server/db/neon';
import { getPerceptionClient } from '@/server/perception';
import { shapeWithCritic } from '@/server/perception/spark-critic';
import {
  jsonField,
  jsonResponse,
  photoSize,
  readVisionRequest,
  sseResponse,
} from '@/server/perception/vision-request';

/**
 * 3D shape of one detected object (PV-T9), Meta models only. Multipart: `image` (same photo as
 * `/api/vision`), `target` (JSON `ShapeTarget`: id, label, category, box), `sessionId?`.
 * → `text/event-stream`: `shape_step { step: crop|model|fit }` as the work goes,
 * `shape_timing { phase, ms }` per finished phase (PQ-T42), then
 * `shape_result { shape: ObjectShape }` (`recipe` or `silhouette` + reason), `done`.
 * 400 (JSON) missing / invalid target. The crop is sent inline: nothing is stored.
 * One Spark critic round when the match scores below 70 with time left (PR-0.6).
 * Houses and objects: `shape_stage` events for the code rounds (PQ-T60); the 3D model is written
 * and refined as code only (no JSON-ops stage loop, no background job).
 */
/** Vercel request limit (s) = `SHAPE_FUNCTION_MS`. */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const read = await readVisionRequest(req);
  if (read instanceof Response) return read;
  const target = jsonField(read.form, 'target', ShapeTargetSchema);
  if (!target) return jsonResponse({ error: 'Invalid target' }, 400);
  const { photo, sessionId } = read;
  const stepModels = await getShapeStepModels(sessionId ?? 'global').catch(() => null);
  const perception = getPerceptionClient(sessionId, stepModels ?? undefined);
  const size = await photoSize(photo.buffer);
  const fullUrl = `data:${photo.contentType};base64,${photo.buffer.toString('base64')}`;
  return sseResponse(async (send) => {
    const jobId = randomUUID();
    const shape = await shapeWithCritic(perception, size, fullUrl, target, {
      signal: req.signal,
      onStep: (step) => send('shape_step', { step }),
      onTiming: (phase, ms) => send('shape_timing', { phase, ms }),
      onStage: (e) => send('shape_stage', { ...e, jobId }),
      withViews: true,
    });
    send('shape_result', { shape });
  });
}
