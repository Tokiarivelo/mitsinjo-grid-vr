import 'server-only';

import { randomUUID } from 'node:crypto';
import { type NextRequest } from 'next/server';
import { ShapeTargetSchema } from '@/lib/object-shape';
import { getPerceptionClient } from '@/server/perception';
import { shapeWithCritic } from '@/server/perception/spark-critic';
import { createJob, followJob } from '@/server/perception/shape-jobs';
import { runStagesSlice } from '@/server/perception/stage-slices';
import type { StagesContinuation } from '@/server/perception/shape-stages-spark';
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
 * Facade houses (PG-T17/T18): `shape_stage` events for the staged loop; stages that did not fit
 * the first answer go on in a background job (`jobId` on `shape_result`) streamed here until
 * `shape_stages_done`, or `shape_stages_checkpoint` when this request runs out of time (the
 * browser resumes it with `POST /api/vision/shape/stages`); a dropped stream resumes on
 * `GET /api/vision/shape/stages`.
 */
/** Vercel request limit (s) = `SHAPE_FUNCTION_MS`: the stages stop before it with a checkpoint. */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const requestStart = Date.now();
  const read = await readVisionRequest(req);
  if (read instanceof Response) return read;
  const target = jsonField(read.form, 'target', ShapeTargetSchema);
  if (!target) return jsonResponse({ error: 'Invalid target' }, 400);
  const { photo, sessionId } = read;
  const perception = getPerceptionClient(sessionId);
  const size = await photoSize(photo.buffer);
  const fullUrl = `data:${photo.contentType};base64,${photo.buffer.toString('base64')}`;
  return sseResponse(async (send) => {
    const jobId = randomUUID();
    const left: { rest: StagesContinuation | null } = { rest: null };
    const shape = await shapeWithCritic(perception, size, fullUrl, target, {
      signal: req.signal,
      onStep: (step) => send('shape_step', { step }),
      onTiming: (phase, ms) => send('shape_timing', { phase, ms }),
      onStage: (e) => send('shape_stage', { ...e, jobId }),
      onStagesLeft: (rest) => {
        left.rest = rest;
      },
      withViews: true,
    });
    const rest = shape.mode === 'recipe' ? left.rest : null;
    send('shape_result', { shape, ...(rest ? { jobId } : {}) });
    if (!rest) return;
    // Not tied to this request: the stages go on if the tab drops, a reconnect follows them.
    const signal = createJob(jobId);
    void runStagesSlice({ jobId, rest, requestStart, signal });
    await followJob(jobId, 0, send, req.signal);
  });
}
