import 'server-only';

import sharp from 'sharp';
import { archetypeOf, type KitArchetype } from '@/lib/object-kit';
import type { FaceName, ShapeTarget } from '@/lib/object-shape';
import { isR2Configured, uploadBufferToR2 } from '@/server/storage/r2';
import { createSyntheticFacadeSvg, museImage, museImageReady } from './facade-specialist';

/**
 * The other faces of a validated 2D front (PQ-T68): right side, back, left side, each drawn by
 * Muse Image from the front AND from the faces already drawn, so the four views agree (same
 * width, height, roof, materials, colours). Best effort: the mock draws a placeholder.
 */

const FACE_LABEL: Record<FaceName, string> = {
  side: 'RIGHT SIDE',
  back: 'BACK',
  left: 'LEFT SIDE',
};

/** What each face shows, in plain words (the prompt names the view and what it must match). */
const FACE_DETAIL: Record<FaceName, string> = {
  side: 'the wall seen from the right of the front: as deep as such an object really is, usually a bit more than half the front width',
  back: 'the wall opposite the front, same width as the front',
  left: 'the wall seen from the left of the front, mirror of the right side in depth',
};

/** Ordered faces: each one is drawn knowing the previous ones. */
export const FACE_ORDER: ReadonlyArray<FaceName> = ['side', 'back', 'left'];

/**
 * Prompt of one face. `known` = how many other views of the same object ride along as references
 * (the front first, then the faces already drawn); `userPrompt` = the operator's own details.
 */
export function buildFacePrompt(
  face: FaceName,
  label: string,
  archetype: KitArchetype,
  { known = 1, userPrompt }: { known?: number; userPrompt?: string } = {}
): string {
  const house = archetype === 'house' || archetype === 'building';
  const same = house
    ? 'same drawing style, same scale, same width and depth proportions, same storeys and eave height, same roof, same chimneys, same wall and roof materials and colours'
    : 'same drawing style, same scale, same proportions, same materials and colours, same details';
  const refs =
    known > 1
      ? `The ${known} reference images are the other elevations of the very same ${label}: all four views must agree.`
      : 'The reference image is the front elevation of the object.';
  let prompt = `${refs} Draw the ${FACE_LABEL[face]} elevation of the very same ${label} (${FACE_DETAIL[face]}): ${same}. Straight-on orthographic view at eye level, the whole object centred on a plain white background, no perspective, no text, no dimension lines.`;
  if (face === 'side' && house)
    prompt +=
      ' Show the windows a house of this size has on its side wall (at least one per storey).';
  const extra = userPrompt?.trim();
  if (extra) prompt += ` Additional required features: ${extra}.`;
  return prompt;
}

export interface GenerateFaceOptions {
  target: Pick<ShapeTarget, 'id' | 'label' | 'category' | 'scenery' | 'archetype'>;
  face: FaceName;
  /** The validated front, then the faces already drawn (images the new face must agree with). */
  references: ReadonlyArray<string>;
  userPrompt?: string;
  signal?: AbortSignal;
}

export interface FaceResult {
  face: FaceName;
  imageUrl: string;
  fileKey: string;
  prompt: string;
  source: 'meta' | 'mock';
}

/** One face → PNG (Muse Image, else a placeholder), stored like the front (R2 or a data URL). */
export async function generateFaceImage(options: GenerateFaceOptions): Promise<FaceResult> {
  const { target, face, references, userPrompt, signal } = options;
  const archetype = archetypeOf(target as ShapeTarget);
  const prompt = buildFacePrompt(face, target.label, archetype, {
    known: references.length,
    ...(userPrompt ? { userPrompt } : {}),
  });
  let png: Buffer;
  let source: 'meta' | 'mock' = 'mock';
  if (museImageReady() && references.length > 0) {
    console.info(
      `[facade-faces] Muse Image ${face} of "${target.label}" from ${references.length} view(s)`
    );
    try {
      png = await museImage(prompt, references, signal);
      source = 'meta';
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn(
        '[facade-faces] Muse Image failed, placeholder:',
        err instanceof Error ? err.message : err
      );
      png = await sharp(Buffer.from(createSyntheticFacadeSvg(archetype, target.label)))
        .png()
        .toBuffer();
    }
  } else {
    png = await sharp(Buffer.from(createSyntheticFacadeSvg(archetype, target.label)))
      .png()
      .toBuffer();
  }
  const fileKey = `vision/facades/${target.id}_${face}_${Date.now()}.png`;
  const uploaded = await uploadBufferToR2(fileKey, png, 'image/png');
  const imageUrl = isR2Configured() ? uploaded : `data:image/png;base64,${png.toString('base64')}`;
  return { face, imageUrl, fileKey, prompt, source };
}
