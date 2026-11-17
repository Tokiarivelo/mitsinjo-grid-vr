import 'server-only';

import { type NextRequest } from 'next/server';
import { defaultArchetype, kitToRecipe } from '@/lib/object-kit';
import { fitRecipe, ShapeTargetSchema } from '@/lib/object-shape';
import { measureKitColors } from '@/server/perception/color-measure';
import { sampleObjectPixels } from '@/server/perception/shape-colors';
import { tourMockEntry } from '@/server/perception/tour-mock';
import { generateImaginedViews } from '@/server/perception/views-generation';
import {
  jsonField,
  jsonResponse,
  photoSize,
  readVisionRequest,
} from '@/server/perception/vision-request';

/** Preview colours when the box holds too few measurable pixels. */
const FALLBACK_COLORS = { main: '#9aa0a8', secondary: '#e3e5e8', accent: '#2b2e33' };

/**
 * 6-Angle 2D Imagined Views endpoint (cheap preview, no Spark call).
 * Renders the archetype template with the object's measured colours from the
 * 6 canonical angles (front, back, left, right, top, 3/4), so the operator can
 * inspect the AI's imagination and validate it before the full 3D generation.
 */
export async function POST(req: NextRequest) {
  const read = await readVisionRequest(req);
  if (read instanceof Response) return read;
  const target = jsonField(read.form, 'target', ShapeTargetSchema);
  if (!target) return jsonResponse({ error: 'Invalid target' }, 400);

  const photo = await photoSize(read.photo.buffer);
  const photoAspect = photo && photo.height > 0 ? photo.width / photo.height : 1;

  // A 360° tour object (VS-T41): its hand-built model, from every angle.
  const tour = tourMockEntry(target.id);
  if (tour) {
    const views = await generateImaginedViews(tour.recipe, target, 1, 256);
    return jsonResponse({ ok: true, views, detectionId: target.id });
  }

  // What the detection implies (archetype), how the pixels look (colours), how big it is (box).
  const archetype = defaultArchetype(target.category, target.scenery, target.label);
  let colors = FALLBACK_COLORS;
  if (photo) {
    try {
      const measured = measureKitColors(
        await sampleObjectPixels(photo, target.box, target.outline),
        archetype
      );
      if (measured) colors = measured;
    } catch (err) {
      console.warn('[vision] 6-angle views colour measure failed:', err);
    }
  }
  const boxW = target.box.w * (photo?.width ?? 1);
  const boxH = target.box.h * (photo?.height ?? 1);
  const aspect = boxW > 0 && boxH > 0 ? boxW / boxH : 1 / 0.6;
  const proportions = {
    w: aspect >= 1 ? 1 : Math.max(0.01, aspect),
    h: aspect >= 1 ? Math.max(0.01, 1 / aspect) : 1,
    d: 0.5,
  };
  const fitted = fitRecipe(kitToRecipe({ archetype, proportions, colors }), photoAspect);

  try {
    const views = await generateImaginedViews(fitted, target, photoAspect, 256);
    return jsonResponse({ ok: true, views, detectionId: target.id });
  } catch (err) {
    console.error('[vision] Failed to generate 6-angle views:', err);
    return jsonResponse({ error: 'Failed to generate views' }, 500);
  }
}
