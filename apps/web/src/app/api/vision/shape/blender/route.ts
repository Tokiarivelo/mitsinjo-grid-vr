import 'server-only';

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { ObjectRecipeSchema } from '@/lib/object-shape';
import { recipeToBlender } from '@/server/perception/blender-export';
import { jsonResponse } from '@/server/perception/vision-request';

/**
 * Blender export of a 3D model: `POST { recipe, label? }` → a Python script (`text/x-python`,
 * attachment) that rebuilds the model exactly as the viewer draws it (`recipeToBlender`), to
 * test and refine it in Blender. Pure conversion: no model call, nothing stored. 400 on a bad body.
 */

const BodySchema = z.object({
  recipe: ObjectRecipeSchema,
  label: z.string().max(80).optional(),
});

/** File-safe stem of the object's label. */
const stemOf = (label: string | undefined): string =>
  (label ?? 'model')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'model';

export async function POST(req: NextRequest) {
  let raw: unknown = null;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    raw = null;
  }
  const body = BodySchema.safeParse(raw);
  if (!body.success) return jsonResponse({ error: 'Invalid recipe' }, 400);
  const { recipe, label } = body.data;
  let script: string;
  try {
    script = recipeToBlender(recipe, { label: label ?? 'model' });
  } catch {
    return jsonResponse({ error: 'Could not export' }, 500);
  }
  return new Response(script, {
    headers: {
      'Content-Type': 'text/x-python; charset=utf-8',
      'Content-Disposition': `attachment; filename="${stemOf(label)}.py"`,
      'Cache-Control': 'no-store',
    },
  });
}
