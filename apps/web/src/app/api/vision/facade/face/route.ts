import 'server-only';

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { FACE_NAMES, FACADE_URL_MAX, ShapeTargetSchema } from '@/lib/object-shape';
import { generateFaceImage } from '@/server/perception/facade-faces';
import { jsonResponse } from '@/server/perception/vision-request';

/**
 * One face of the 2D views (PQ-T68). `POST { target, face, references, userPrompt? }` →
 * `{ ok, face, imageUrl, fileKey, prompt, source }`. `references` = the validated front, then the
 * faces already drawn: the new face is drawn from all of them so the four views agree (1 to 3).
 * 400 on a bad body. Regenerating or modifying a face is the same call with `userPrompt`.
 */
export const maxDuration = 120;

const viewUrl = z
  .string()
  .max(FACADE_URL_MAX)
  .regex(/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/);

const BodySchema = z.object({
  target: ShapeTargetSchema.pick({
    id: true,
    label: true,
    category: true,
    scenery: true,
    archetype: true,
  }),
  face: z.enum(FACE_NAMES),
  references: z.array(viewUrl).min(1).max(3),
  userPrompt: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  let raw: unknown = null;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    raw = null;
  }
  const body = BodySchema.safeParse(raw);
  if (!body.success) return jsonResponse({ error: 'Invalid face request' }, 400);
  try {
    const result = await generateFaceImage({ ...body.data, signal: req.signal });
    return jsonResponse({ ok: true, ...result });
  } catch (err) {
    console.error('[vision/facade/face] Generation failed:', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Face generation failed' },
      500
    );
  }
}
