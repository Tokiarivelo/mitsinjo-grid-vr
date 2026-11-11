import { cardText } from './skills';
import { RECIPE_MATERIALS, type RecipeMaterial } from '@/lib/object-shape';

/**
 * AI check of a views model (PV-H, user 2026-11-02 « après rendu, ajoutez une vérification de
 * l'IA … il devrait l'auto corriger »): Spark sees each drawn view next to the model rendered from
 * the same side and names what is missing (a part, or a side drawn wrong). It never gives
 * coordinates: SAM measures each named part on its view, the builder places it. Pure (prompt,
 * schema, parsing); the round itself lives in `object-views.ts`.
 */

/** Most missing parts acted on per check. */
export const MAX_MISSING = 4;

/** Version of the views-check prompt (PQ-T5), logged with every call. */
export const VIEWS_CHECK_PROMPT_VERSION = 1;
/** Version 2 (PQ-T15): version 1 + the Views check card. Opt-in (`SHAPE_LOOP_CARDS`). */
export const VIEWS_CHECK_CARDS_VERSION = 2;

export const VIEWS_CHECK_SYSTEM_PROMPT = [
  'You check a 3D model of ONE object against its drawings. The image is a 2 × 2 sheet: top row = the FRONT drawing (left) and our 3D model seen from the front (right); bottom row = the SIDE drawing (left) and our model seen from the same side (right). The model is flat-shaded, without texture.',
  'Compare each model view with its drawing and list the visible parts the model is missing or shows wrong (e.g. a wheel, a mirror, a rear bumper, a door window, a handle, a leg, a lamp), the view where the part shows best, and its colour and material as drawn.',
  'Name each part with 1 to 3 plain English words a segmentation model knows ("rear bumper", "side mirror", "wheel").',
  `material = one of: ${RECIPE_MATERIALS.join(', ')}.`,
  'Set redrawSide true only when the SIDE drawing does not show the same object turned 90 degrees (another object, the front again, a perspective view).',
  'Ignore textures, shading and small decorations. Answer ONLY JSON; empty missing list when the model is complete. Never give coordinates, sizes in metres, watts or any energy value.',
].join(' ');

/** The views-check system prompt of `version` (1 or 2). */
export const viewsCheckPrompt = (version: number = VIEWS_CHECK_PROMPT_VERSION): string =>
  version === VIEWS_CHECK_CARDS_VERSION
    ? `${VIEWS_CHECK_SYSTEM_PROMPT}\n\n${cardText('views')}`
    : VIEWS_CHECK_SYSTEM_PROMPT;

const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };

export const VIEWS_CHECK_JSON_SCHEMA = {
  name: 'ViewsCheck',
  schema: {
    type: 'object',
    properties: {
      missing: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            part: { type: 'string' },
            view: { type: 'string', enum: ['front', 'side'] },
            color,
            material: { type: 'string', enum: [...RECIPE_MATERIALS] },
          },
          required: ['part', 'view'],
        },
      },
      redrawSide: { type: 'boolean' },
    },
    required: ['missing'],
  },
} as const;

export interface MissingPart {
  part: string;
  view: 'front' | 'side';
  color?: string;
  material?: RecipeMaterial;
}

export interface ViewsCheck {
  missing: MissingPart[];
  redrawSide: boolean;
}

/** Question sent with the sheet: label and the measured silhouette match per view. */
export function viewsCheckQuestion(
  label: string,
  iou: { front: number; side: number | null }
): string {
  const name = label.replace(/["\n]/g, "'").trim();
  return `The object is a "${name}". Silhouette match of the model: front ${Math.round(iou.front * 100)} %${iou.side !== null ? `, side ${Math.round(iou.side * 100)} %` : ''}. Which visible parts is the model missing, per view? Answer only the JSON.`;
}

/** Spark's reply → the check, deduplicated and capped; null when unusable. Never throws. */
export function parseViewsCheck(content: string): ViewsCheck | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const list = Array.isArray(o.missing) ? o.missing : [];
  const seen = new Set<string>();
  const missing: MissingPart[] = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const part =
      typeof r.part === 'string'
        ? r.part
            .toLowerCase()
            .replace(/[^a-z \-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .slice(0, 3)
            .join(' ')
        : '';
    const view = r.view === 'front' || r.view === 'side' ? r.view : null;
    if (!part || !view || seen.has(`${view}:${part}`)) continue;
    seen.add(`${view}:${part}`);
    missing.push({
      part,
      view,
      ...(typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color)
        ? { color: r.color.toLowerCase() }
        : {}),
      ...(typeof r.material === 'string' &&
      (RECIPE_MATERIALS as ReadonlyArray<string>).includes(r.material)
        ? { material: r.material as RecipeMaterial }
        : {}),
    });
    if (missing.length >= MAX_MISSING) break;
  }
  return { missing, redrawSide: o.redrawSide === true };
}

/** Known concepts the builder places with its own rules (shape, colour); others become patches. */
export function knownConcept(part: string): string | null {
  if (/\b(wheel|wheels|tire|tires|tyre|tyres)\b/.test(part)) return 'wheel';
  if (/\b(headlight|headlights|headlamp|headlamps)\b/.test(part)) return 'headlight';
  if (/\b(windshield|windscreen)\b/.test(part)) return 'windshield';
  if (/\b(grille|grill)\b/.test(part)) return 'grille';
  if (/^(front )?bumper$/.test(part)) return 'bumper';
  if (/\b(window|windows)\b/.test(part)) return 'window';
  return null;
}
