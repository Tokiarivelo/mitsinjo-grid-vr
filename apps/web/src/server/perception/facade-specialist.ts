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

/**
 * Sent with the photo crop as reference (user 2026-11-05): without it Muse Image drew a generic
 * object of the label (an ornate Victorian lamp for a plain lantern post).
 */
export const FACADE_FROM_PHOTO =
  'Draw exactly the object inside the clear rectangle of the reference photo: same type, shape, proportions, colours, materials and details. Complete the parts hidden by people, plants or other objects. Do not draw the background or anything else from the photo.';

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
      basePrompt = `Architectural orthographic front elevation drawing of a complete rural building facade, ${label}. Perfectly straight-on eye-level view, 0 degree perspective tilt, symmetrical, sharp edges, unoccluded, centered on a solid clean neutral background, architectural blueprint illustration style, crisp daylight.`;
      break;
    case 'vehicle':
      basePrompt = `Direct front orthographic elevation view of a complete vehicle, ${label}. Straight-on eye-level view, symmetrical headlights, front grille, windshield, unoccluded, centered on a clean solid neutral background.`;
      break;
    case 'panel':
      basePrompt = `Direct front elevation view of a complete solar panel installation, ${label}. Clean industrial elevation, mounting frame, photovoltaic cells, unoccluded, clean solid neutral background.`;
      break;
    case 'lamp_post':
    case 'pole':
      basePrompt = `Direct front elevation view of a complete utility pole or lamp post, ${label}. Straight-on vertical elevation, unoccluded, clean solid neutral background.`;
      break;
    case 'tree':
      basePrompt = `Direct front elevation view of a complete ${label}, botanical illustration. Straight-on eye-level view of the whole plant from the ground to its top, clear silhouette of the crown and the trunk, unoccluded, centered on a solid clean neutral background.`;
      break;
    case 'bush':
      // No trunk asked (user 2026-11-05: a low flower bed came back as a flowering tree).
      basePrompt = `Direct front elevation view of a complete ${label}, botanical illustration. Straight-on eye-level view of the whole low plant from the ground to its top, as wide and as low as it grows, no trunk unless one is visible, unoccluded, centered on a solid clean neutral background.`;
      break;
    case 'cabinet':
    case 'machine':
    case 'fan':
    case 'screen':
    case 'tank':
      basePrompt = `Direct front orthographic product elevation of a complete ${label}. Clean appliance casing, control elements, unoccluded, centered on a solid clean neutral background.`;
      break;
    default:
      basePrompt = `Direct front orthographic elevation of a complete ${label}. Centered, unoccluded, straight-on view, solid clean neutral background.`;
      break;
  }

  if (fromPhoto) basePrompt += ` ${FACADE_FROM_PHOTO}`;

  if (userPrompt && userPrompt.trim()) {
    basePrompt += ` Additional required architectural features: ${userPrompt.trim()}.`;
  }

  return basePrompt;
}

/**
 * Generates synthetic architectural facade SVG for mock/offline mode.
 */
function createSyntheticFacadeSvg(archetype: KitArchetype, label: string): string {
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
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#f8fafc"/>
  <line x1="32" y1="460" x2="480" y2="460" stroke="#94a3b8" stroke-width="4"/>
  <!-- Tires -->
  <rect x="100" y="380" width="50" height="70" rx="8" fill="#1e293b"/>
  <rect x="362" y="380" width="50" height="70" rx="8" fill="#1e293b"/>
  <!-- Cabin Greenhouse -->
  <polygon points="150,230 180,140 332,140 362,230" fill="#38bdf8" stroke="#0284c7" stroke-width="5"/>
  <!-- Main Body -->
  <rect x="110" y="230" width="292" height="160" rx="16" fill="#2563eb" stroke="#1d4ed8" stroke-width="6"/>
  <!-- Windshield -->
  <polygon points="160,225 186,150 326,150 352,225" fill="#bae6fd" stroke="#0284c7" stroke-width="3"/>
  <!-- Grille -->
  <rect x="180" y="280" width="152" height="60" rx="6" fill="#0f172a"/>
  <!-- Headlights -->
  <circle cx="140" cy="270" r="18" fill="#fef08a" stroke="#ca8a04" stroke-width="3"/>
  <circle cx="372" cy="270" r="18" fill="#fef08a" stroke="#ca8a04" stroke-width="3"/>
  <!-- Bumper -->
  <rect x="130" y="355" width="252" height="25" rx="4" fill="#64748b"/>
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
}

export interface FacadeResult {
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
  let prompt = buildFacadePrompt(archetype, target.label, userPrompt, {
    fromPhoto: reference !== null,
  });

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
  };
}
