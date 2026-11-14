import 'server-only';

import sharp from 'sharp';
import { archetypeOf, type KitArchetype } from '@/lib/object-kit';
import type { FaceName, ShapeTarget } from '@/lib/object-shape';
import { isR2Configured, uploadBufferToR2 } from '@/server/storage/r2';
import { buildCarFacePrompt, CAR_FACES, type CarFace } from './car/car-views';
import {
  createSyntheticFacadeSvg,
  DRAWING_BACKGROUND,
  museImage,
  museImageReady,
} from './facade-specialist';

/**
 * The other faces of a validated 2D front (PQ-T68): right side, back, left side, each drawn by
 * Muse Image from the front AND from the faces already drawn, so the four views agree (same
 * width, height, roof, materials, colours). A vehicle (PQ-T76): front, back, view from above and
 * underside of its validated profile (`car/car-views.ts`). Best effort: the mock draws a placeholder.
 */

const FACE_LABEL: Record<FaceName, string> = {
  side: 'RIGHT SIDE',
  back: 'BACK',
  left: 'LEFT SIDE',
  top: 'TOP',
  front: 'FRONT',
  bottom: 'UNDERSIDE',
};

/** What each face shows, in plain words (the prompt names the view and what it must match). */
const FACE_DETAIL: Record<FaceName, string> = {
  side: 'the wall seen from the right of the front: as deep as such an object really is, usually a bit more than half the front width',
  back: 'the wall opposite the front, same width as the front',
  left: 'the wall seen from the left of the front, mirror of the right side in depth',
  top: 'the roof plan seen from directly above, the front at the bottom',
  front: 'the main face, seen straight on',
  bottom: 'the underside seen from directly below, the front at the bottom',
};

/**
 * Roof coherence between the elevations (PQ-T70): side views came back with the roof as a plain
 * rectangle beside a front that showed its slope, and the hull of the two was a block.
 */
export const ROOF_AGREEMENT =
  'It is one and the same roof seen from another side: same eave height, same ridge height and same total height as on the other elevations, the ground at the same level. A roof slope that faces the viewer on one elevation shows its triangular gable end (or its hipped end, sloping in from both sides) on the elevation at right angles to it: never draw a pitched roof as a plain rectangle on two adjacent elevations. A flat roof stays flat on every elevation. Chimneys keep their height and stand where the other elevations put them.';

/**
 * Prompt of the view from above (PQ-T70): the footprint (an L-shaped plan is not a rectangle) and
 * the drawing of everything that faces the sky. `known` = elevations sent as references.
 */
export function buildTopPrompt(label: string, known: number): string {
  return `The ${known} reference image${known > 1 ? 's are' : ' is'} the elevation${known > 1 ? 's' : ''} of one ${label}, the front first. Draw the very same ${label} seen from directly above, looking straight down (roof plan, orthographic, no perspective). The front of the object (the side shown on the first reference image) is at the BOTTOM of the image, its back at the top, its left and right as on the front elevation. Same width as the front elevation, same depth as the side elevations, the same outline of wings and recesses, the same roof with its ridges, slopes and chimneys, same materials and colours, same drawing style. The whole object centred on a ${DRAWING_BACKGROUND}: no garden, no text, no dimension lines.`;
}

/** Ordered faces: each one is drawn knowing the previous ones. */
export const FACE_ORDER = ['side', 'back', 'left'] as const satisfies ReadonlyArray<FaceName>;

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
  const details = userPrompt?.trim();
  // A vehicle is drawn from its profile (PQ-T76): its own prompts, the left side never drawn.
  if (archetype === 'vehicle' && (CAR_FACES as readonly string[]).includes(face))
    return buildCarFacePrompt(face as CarFace, label, {
      known,
      ...(details ? { userPrompt: details } : {}),
    });
  // The view from above has its own prompt (the plan, not an elevation).
  if (face === 'top')
    return `${buildTopPrompt(label, known)}${details ? ` Additional required features: ${details}.` : ''}`;
  const house = archetype === 'house' || archetype === 'building';
  const same = house
    ? 'same drawing style, same scale, same width and depth proportions, same storeys and eave height, same roof, same chimneys, same wall and roof materials and colours'
    : 'same drawing style, same scale, same proportions, same materials and colours, same details';
  const refs =
    known > 1
      ? `The ${known} reference images are the other elevations of the very same ${label}: all four views must agree.`
      : 'The reference image is the front elevation of the object.';
  let prompt = `${refs} Draw the ${FACE_LABEL[face]} elevation of the very same ${label} (${FACE_DETAIL[face]}): ${same}. Straight-on orthographic view at eye level, the whole object centred on a ${DRAWING_BACKGROUND} (the same background as the reference), no perspective, no text, no dimension lines.`;
  if (house) prompt += ` ${ROOF_AGREEMENT}`;
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
