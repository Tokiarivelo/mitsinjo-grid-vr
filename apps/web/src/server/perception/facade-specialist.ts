import 'server-only';

import sharp from 'sharp';
import { archetypeOf, type KitArchetype } from '@/lib/object-kit';
import type { ShapeTarget } from '@/lib/object-shape';
import { env } from '@/lib/env';
import { isR2Configured, uploadBufferToR2 } from '@/server/storage/r2';
import { DEFAULT_META_BASE_URL } from '@/server/copilot/providers/meta';
import type { PhotoForRegions } from './region';
import { cropForShape } from './shape-crop';
import { inlineImageUrl } from './inline-image';
import { imageCard } from './skills';
import { buildCarProfilePrompt } from './car/car-views';

/**
 * Sent with the photo crop as reference (user 2026-11-05): without it Muse Image drew a generic
 * object of the label (an ornate Victorian lamp for a plain lantern post).
 */
/**
 * Background asked of every drawing the reconstruction reads (PQ-T70): on white paper a white
 * wall is paper, and the silhouette of a white building came back with holes.
 */
export const DRAWING_BACKGROUND =
  'plain flat pale blue background (one uniform colour, no gradient, no ground, no shadow; walls, even white ones, stay clearly different from it)';

/** What a drawn plant must leave out (PQ-T79): the model would otherwise build the roots and the dead leaves. */
export const PLANT_CLEAN =
  'Nothing below the ground line: no roots, no soil, no grass. No dead, dry, fallen or hanging leaves, no fruit on the ground, no other plant beside it.';

export const FACADE_FROM_PHOTO =
  'Draw exactly the object inside the clear rectangle of the reference photo: same type, shape, proportions, colours, materials and details, with the same number and placement of doors, windows, wings, gables, chimneys and roof slopes, even when the object is not symmetrical (never mirror one half onto the other). Complete the parts hidden by people, plants or other objects. The photo may be taken from an angle: redraw the object straight on all the same, as a flat elevation of its main face only, with every horizontal line of the object perfectly horizontal in the image, no vanishing point and no second face receding to the side. Do not draw the background or anything else from the photo.';

/**
 * Builds a strict orthographic architectural elevation prompt for Meta Muse Image.
 * `fromPhoto`: the photo crop goes along as reference (`FACADE_FROM_PHOTO`).
 */
export function buildFacadePrompt(
  archetype: KitArchetype,
  label: string,
  userPrompt?: string,
  { fromPhoto = false }: { fromPhoto?: boolean } = {}
): string {
  let basePrompt: string;

  switch (archetype) {
    case 'house':
    case 'building':
      basePrompt = `Architectural orthographic front elevation drawing of a complete rural building facade, ${label}. Perfectly straight-on eye-level view, 0 degree perspective tilt, sharp edges, unoccluded, centered on a ${DRAWING_BACKGROUND}, architectural elevation illustration style, crisp daylight.`;
      break;
    case 'vehicle':
      // A vehicle is drawn from its profile first (PQ-T76): the 2D view to validate is its side.
      return withUserDetails(buildCarProfilePrompt(label, fromPhoto), userPrompt);
    case 'panel':
      basePrompt = `Direct front elevation view of a complete solar panel installation, ${label}. Clean industrial elevation, mounting frame, photovoltaic cells, unoccluded, ${DRAWING_BACKGROUND}.`;
      break;
    case 'lamp_post':
    case 'pole':
      basePrompt = `Direct front elevation view of a complete utility pole or lamp post, ${label}. Straight-on vertical elevation, unoccluded, ${DRAWING_BACKGROUND}.`;
      break;
    case 'tree':
      // PQ-T79: roots, dead leaves and bare twigs came back drawn, and were read as part of the model.
      basePrompt = `Direct front elevation view of a complete ${label}, botanical illustration. Straight-on eye-level view of the whole plant from the ground to its top, clear silhouette of one full, dense, leafy crown and the trunk standing on the ground line, unoccluded, centered on a ${DRAWING_BACKGROUND}. ${PLANT_CLEAN}`;
      break;
    case 'bush':
      // No trunk asked (user 2026-11-05: a low flower bed came back as a flowering tree).
      basePrompt = `Direct front elevation view of a complete ${label}, botanical illustration. Straight-on eye-level view of the whole low plant from the ground to its top, as wide and as low as it grows, no trunk unless one is visible, unoccluded, centered on a ${DRAWING_BACKGROUND}. ${PLANT_CLEAN}`;
      break;
    case 'cabinet':
    case 'machine':
    case 'fan':
    case 'screen':
    case 'tank':
      basePrompt = `Direct front orthographic product elevation of a complete ${label}. Clean appliance casing, control elements, unoccluded, centered on a ${DRAWING_BACKGROUND}.`;
      break;
    default:
      basePrompt = `Direct front orthographic elevation of a complete ${label}. Centered, unoccluded, straight-on view, ${DRAWING_BACKGROUND}.`;
      break;
  }

  if (fromPhoto) basePrompt += ` ${FACADE_FROM_PHOTO}`;

  return withUserDetails(basePrompt, userPrompt);
}

/** The operator's own details (« Retry with details »), appended to any 2D-view prompt. */
function withUserDetails(prompt: string, userPrompt?: string): string {
  const extra = userPrompt?.trim();
  return extra ? `${prompt} Additional required architectural features: ${extra}.` : prompt;
}

/** What the kit saw of a hidden object (`evidence`): the Clean front card's two blanks. */
export interface CleanFrontEvidence {
  hiddenBy: ReadonlyArray<string>;
  visibleParts: ReadonlyArray<string>;
}

/** The Clean front card (skills §12.2) filled with the object's name and what the kit saw. */
export function buildCleanFrontPrompt(
  label: string,
  evidence: Partial<CleanFrontEvidence> = {},
  userPrompt?: string
) {
  const list = (v: ReadonlyArray<string> | undefined, none: string) =>
    v && v.length ? v.join(', ') : none;
  const card = imageCard('cleanFront')
    .replaceAll('{name}', label)
    .replaceAll('{hiddenBy}', list(evidence.hiddenBy, 'other objects'))
    .replaceAll('{visibleParts}', list(evidence.visibleParts, 'the visible parts'));
  // « Retry with details » on a clean front: the operator's words ride along, as on the elevation prompt.
  return withUserDetails(card, userPrompt);
}

/**
 * Generates synthetic architectural facade SVG for mock/offline mode.
 */
export function createSyntheticFacadeSvg(archetype: KitArchetype, label: string): string {
  const cleanLabel = label.replace(/[<>&"']/g, '');

  switch (archetype) {
    case 'house':
    case 'building':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#f8fafc"/>
  <!-- Ground line -->
  <line x1="32" y1="460" x2="480" y2="460" stroke="#94a3b8" stroke-width="4"/>
  <!-- Building body -->
  <rect x="96" y="220" width="320" height="240" fill="#e2e8f0" stroke="#475569" stroke-width="6"/>
  <!-- Pitched Roof -->
  <polygon points="64,220 256,90 448,220" fill="#dc2626" stroke="#991b1b" stroke-width="6"/>
  <!-- Ridge capping -->
  <polygon points="240,90 256,76 272,90" fill="#991b1b"/>
  <!-- Front Door -->
  <rect x="216" y="320" width="80" height="140" fill="#78350f" stroke="#451a03" stroke-width="4"/>
  <circle cx="284" cy="390" r="5" fill="#f59e0b"/>
  <!-- Windows -->
  <rect x="128" y="260" width="64" height="64" fill="#38bdf8" stroke="#0284c7" stroke-width="4"/>
  <line x1="160" y1="260" x2="160" y2="324" stroke="#0284c7" stroke-width="2"/>
  <line x1="128" y1="292" x2="192" y2="292" stroke="#0284c7" stroke-width="2"/>
  <rect x="320" y="260" width="64" height="64" fill="#38bdf8" stroke="#0284c7" stroke-width="4"/>
  <line x1="352" y1="260" x2="352" y2="324" stroke="#0284c7" stroke-width="2"/>
  <line x1="320" y1="292" x2="384" y2="292" stroke="#0284c7" stroke-width="2"/>
  <!-- Label badge -->
  <text x="256" y="492" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#64748b">${cleanLabel}</text>
</svg>`;

    case 'vehicle':
      // A profile (PQ-T76): the front to the right, both wheels on the ground line.
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#f8fafc"/>
  <line x1="16" y1="380" x2="496" y2="380" stroke="#94a3b8" stroke-width="4"/>
  <!-- Body and cabin -->
  <path d="M40 330 L40 270 Q44 250 70 246 L150 240 L200 190 Q210 180 230 180 L330 180 Q350 180 362 194 L400 240 L452 248 Q474 254 474 276 L474 330 Z" fill="#2563eb" stroke="#1d4ed8" stroke-width="5"/>
  <!-- Side windows -->
  <polygon points="214,196 270,196 270,238 170,240" fill="#bae6fd" stroke="#0284c7" stroke-width="3"/>
  <polygon points="282,196 330,196 376,238 282,238" fill="#bae6fd" stroke="#0284c7" stroke-width="3"/>
  <!-- Lamps -->
  <rect x="456" y="262" width="16" height="14" rx="3" fill="#fef08a"/>
  <rect x="42" y="262" width="12" height="14" rx="3" fill="#ef4444"/>
  <!-- Tyres and rims -->
  <circle cx="128" cy="330" r="48" fill="#1e293b"/>
  <circle cx="128" cy="330" r="24" fill="#94a3b8"/>
  <circle cx="390" cy="330" r="48" fill="#1e293b"/>
  <circle cx="390" cy="330" r="24" fill="#94a3b8"/>
  <text x="256" y="492" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#64748b">${cleanLabel}</text>
</svg>`;

    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#f8fafc"/>
  <line x1="32" y1="460" x2="480" y2="460" stroke="#94a3b8" stroke-width="4"/>
  <!-- General cabinet / appliance body -->
  <rect x="136" y="140" width="240" height="300" rx="8" fill="#e2e8f0" stroke="#475569" stroke-width="6"/>
  <rect x="156" y="160" width="200" height="120" rx="4" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>
  <rect x="156" y="300" width="200" height="120" rx="4" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>
  <circle cx="340" cy="220" r="6" fill="#64748b"/>
  <circle cx="340" cy="360" r="6" fill="#64748b"/>
  <text x="256" y="492" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#64748b">${cleanLabel}</text>
</svg>`;
  }
}

/**
 * One Muse Image call → PNG. `references` (image URLs, data or https) go beside the prompt:
 * Muse Image redraws from them (the side elevation of a validated front, user 2026-11-02).
 * Throws on any API error or missing image; callers fall back.
 */
export async function museImage(
  prompt: string,
  references: ReadonlyArray<string> = [],
  signal?: AbortSignal
): Promise<Buffer> {
  const baseUrl = (env.META_BASE_URL || DEFAULT_META_BASE_URL).replace(/\/$/, '');
  const inlined = await Promise.all(references.map((url) => inlineImageUrl(url)));
  const input =
    references.length === 0
      ? prompt
      : [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              ...inlined.map((url) => ({ type: 'input_image', image_url: url })),
            ],
          },
        ];
  const res = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.META_API_KEY}` },
    body: JSON.stringify({ model: env.META_IMAGE_MODEL, input }),
    signal,
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Meta Image API error (${res.status}): ${errorText.slice(0, 200)}`);
  }
  const data = (await res.json()) as { output?: Array<{ type: string; result?: string }> };
  const base64 = data.output?.findLast(
    (o) => o.type === 'image_generation_call' && o.result
  )?.result;
  if (!base64) throw new Error('Meta Image API did not return image data');
  return sharp(Buffer.from(base64, 'base64')).png().toBuffer();
}

/** True when Muse Image can be called (Meta provider with a key). */
export const museImageReady = () => env.LLM_PROVIDER === 'meta' && Boolean(env.META_API_KEY);

export interface GenerateFacadeOptions {
  target: ShapeTarget;
  /** The detection photo: its crop around the target goes to Muse Image as reference. */
  photo?: PhotoForRegions | null;
  userPrompt?: string;
  sessionId?: string;
  signal?: AbortSignal;
  /** Clean front of a hidden object (PQ-T23): the Clean front card replaces the elevation prompt. */
  cleanFront?: Partial<CleanFrontEvidence>;
}

export interface FacadeResult {
  /**
   * True when a clean front was asked for (PQ-T23): whatever drew it (the card, the elevation prompt after
   * a refused photo, the mock), the drawing imagines what the photo hides, so its parts are inferred.
   */
  clean?: boolean;
  imageUrl: string;
  fileKey: string;
  prompt: string;
  archetype: KitArchetype;
  source: 'meta' | 'mock';
}

/**
 * Generates an orthographic 2D facade image with Meta Muse Image (or mock),
 * uploads it to R2 (or server storage), and returns the consultable result.
 */
export async function generateFacadeImage(options: GenerateFacadeOptions): Promise<FacadeResult> {
  const { target, userPrompt, signal, photo } = options;
  const archetype = archetypeOf(target);
  const isMeta = museImageReady();
  const reference =
    isMeta && photo
      ? await cropForShape(photo, target.box).catch((err) => {
          console.warn(
            '[facade-specialist] photo crop failed:',
            err instanceof Error ? err.message : err
          );
          return null;
        })
      : null;
  // The card speaks of « this photo »: without the photo as reference it falls back to the elevation prompt.
  const clean = options.cleanFront && reference !== null ? options.cleanFront : null;
  let prompt = clean
    ? buildCleanFrontPrompt(target.label, clean, userPrompt)
    : buildFacadePrompt(archetype, target.label, userPrompt, { fromPhoto: reference !== null });

  let pngBuffer: Buffer;
  let source: 'meta' | 'mock' = 'mock';

  if (isMeta) {
    console.info(`[facade-specialist] Requesting Muse Image for "${target.label}"...`);

    try {
      try {
        pngBuffer = await museImage(prompt, reference ? [reference] : [], signal);
      } catch (err) {
        if (!reference || signal?.aborted) throw err;
        // A refused reference must not cost the 2D view: once more from the label alone.
        console.warn(
          '[facade-specialist] Muse Image with the photo failed, retrying without it:',
          err instanceof Error ? err.message : err
        );
        prompt = buildFacadePrompt(archetype, target.label, userPrompt);
        pngBuffer = await museImage(prompt, [], signal);
      }
      source = 'meta';
      console.info(`[facade-specialist] Muse Image generated successfully for "${target.label}"`);
    } catch (err) {
      console.warn(
        `[facade-specialist] Muse Image call failed, falling back to mock elevation:`,
        err instanceof Error ? err.message : err
      );
      const svg = createSyntheticFacadeSvg(archetype, target.label);
      pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
      source = 'mock';
    }
  } else {
    console.info(
      `[facade-specialist] Mock mode: generating synthetic elevation for "${target.label}"`
    );
    const svg = createSyntheticFacadeSvg(archetype, target.label);
    pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    source = 'mock';
  }

  // Upload to R2 under vision/facades/
  const fileKey = `vision/facades/${target.id}_${Date.now()}.png`;
  const uploadedUrl = await uploadBufferToR2(fileKey, pngBuffer, 'image/png');

  // Fallback: If R2 is not configured, return base64 data URL so client can display it directly
  const imageUrl = isR2Configured()
    ? uploadedUrl
    : `data:image/png;base64,${pngBuffer.toString('base64')}`;

  return {
    imageUrl,
    fileKey,
    prompt,
    archetype,
    source,
    ...(options.cleanFront ? { clean: true } : {}),
  };
}
