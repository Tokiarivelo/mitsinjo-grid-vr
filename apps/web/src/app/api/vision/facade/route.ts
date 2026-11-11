import 'server-only';

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { ShapeTargetSchema } from '@/lib/object-shape';
import { generateFacadeImage } from '@/server/perception/facade-specialist';
import { deleteObjectFromR2 } from '@/server/storage/r2';
import {
  jsonField,
  jsonResponse,
  photoSize,
  readVisionRequest,
} from '@/server/perception/vision-request';

const CleanFrontSchema = z.object({
  hiddenBy: z.array(z.string().max(40)).max(6).default([]),
  visibleParts: z.array(z.string().max(40)).max(12).default([]),
});

/**
 * 2D Facade Imagination endpoint (Muse Image 1.0 + Specialist Skill).
 * Generates an unoccluded orthographic architectural elevation before 3D reconstruction.
 */
export async function POST(req: NextRequest) {
  const read = await readVisionRequest(req);
  if (read instanceof Response) return read;

  const target = jsonField(read.form, 'target', ShapeTargetSchema);
  if (!target) return jsonResponse({ error: 'Invalid target' }, 400);

  const userPrompt = read.form.get('userPrompt')?.toString();
  // Clean front of a hidden object (PQ-T23): what the kit saw, from the operator's request.
  const cleanFront = jsonField(read.form, 'cleanFront', CleanFrontSchema) ?? undefined;
  const { sessionId } = read;

  try {
    const result = await generateFacadeImage({
      target,
      // The object as photographed goes along as reference (drawn as itself, not a generic one).
      photo: await photoSize(read.photo.buffer),
      userPrompt,
      ...(cleanFront ? { cleanFront } : {}),
      sessionId,
      signal: req.signal,
    });

    return jsonResponse({
      ok: true,
      detectionId: target.id,
      ...result,
    });
  } catch (err) {
    console.error('[vision/facade] Generation failed:', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Facade generation failed' },
      500
    );
  }
}

/**
 * Deletes an imagined 2D facade image from Cloudflare R2 / local storage.
 * Call with ?key=... or JSON body { key: string }.
 */
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  let key = req.nextUrl?.searchParams?.get('key') ?? url.searchParams.get('key');

  if (!key) {
    try {
      const body = (await req.json()) as { key?: string };
      key = body.key ?? null;
    } catch {
      // not JSON
    }
  }

  if (!key) {
    return jsonResponse({ error: 'Missing key parameter' }, 400);
  }

  try {
    await deleteObjectFromR2(key);
    return jsonResponse({ ok: true, deleted: key });
  } catch (err) {
    console.error('[vision/facade] Deletion failed:', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Failed to delete facade image' },
      500
    );
  }
}
