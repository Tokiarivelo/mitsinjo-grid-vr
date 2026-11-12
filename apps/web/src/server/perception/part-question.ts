import 'server-only';

import sharp from 'sharp';

/**
 * Short question per part (PQ-T52, universal pipeline E9/E11 « gros plan par pièce manquante »):
 * for each anatomy part the model should show but does not, one tight crop of its zone and one
 * yes/no question (Spark, `low` effort): is it there, where on the crop, what colour. Asked in
 * parallel; a denied part corrects the kit inventory, a confirmed one is SAM-chased and rebuilt
 * when a builder places it (`spark-critic.ts`). Never throws: every failure answers null.
 */

/** Most parts questioned per round (like the views check's `MAX_MISSING`). */
export const MAX_PART_QUESTIONS = 4;

export const PART_QUESTION_SYSTEM_PROMPT = [
  'You answer about ONE part of an object on a cropped photo.',
  'Say whether the part shows on this crop, where on the crop in plain words (for example "lower left", "top centre"), and its colour as seen.',
  'Answer ONLY JSON. Never give coordinates, sizes in metres, watts or any energy value.',
].join(' ');

/** The question for one part; `where` is the kit's hint (« rear », « lower left ») when it gave one. */
export function partQuestion(part: string, where?: string): string {
  const name = part.trim().replace(/\s+/g, ' ');
  const hint = where?.trim().replace(/\s+/g, ' ');
  return (
    `Is there a ${name} visible on this crop` +
    (hint ? ` (expected ${hint})` : '') +
    '? Answer whether it shows, where on the crop, and its colour. Answer only the JSON.'
  );
}

const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };

export const PART_QUESTION_JSON_SCHEMA = {
  name: 'PartAnswer',
  schema: {
    type: 'object',
    properties: {
      present: { type: 'boolean' },
      where: { type: 'string' },
      color,
    },
    required: ['present'],
  },
} as const;

export interface PartAnswer {
  present: boolean;
  where?: string;
  color?: string;
}

/** A short answer, lenient: `present` must be a boolean; a bad colour is dropped, never greyed. */
export function parsePartAnswer(content: string): PartAnswer | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (typeof o.present !== 'boolean') return null;
  const where =
    typeof o.where === 'string' && o.where.trim()
      ? o.where.trim().replace(/\s+/g, ' ').slice(0, 80)
      : undefined;
  const color =
    typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color)
      ? o.color.toLowerCase()
      : undefined;
  return { present: o.present, ...(where ? { where } : {}), ...(color ? { color } : {}) };
}

/** Sub-rectangle of the crop, fractions 0–1. */
export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const VERTICAL: ReadonlyArray<{ words: ReadonlyArray<string>; y: number; h: number }> = [
  { words: ['top', 'upper', 'above', 'roof', 'head'], y: 0, h: 0.55 },
  {
    words: ['bottom', 'lower', 'below', 'under', 'ground', 'base', 'foot', 'feet'],
    y: 0.45,
    h: 0.55,
  },
  { words: ['middle', 'centre', 'center', 'mid'], y: 0.25, h: 0.5 },
];
const HORIZONTAL: ReadonlyArray<{ words: ReadonlyArray<string>; x: number; w: number }> = [
  { words: ['left'], x: 0, w: 0.55 },
  { words: ['right'], x: 0.45, w: 0.55 },
  { words: ['middle', 'centre', 'center', 'mid'], x: 0.25, w: 0.5 },
];

/**
 * Plain-words place → the zone to crop (halves overlap in the middle, so a centred part is never
 * cut). Words that place along the object's depth (« front », « rear », « back », « side ») carry
 * no crop direction without the yaw, so they keep the whole frame. Pure.
 */
export function zoneRect(where?: string): ZoneRect {
  const words = new Set(
    (where ?? '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean)
  );
  let [x, w] = [0, 1];
  let [y, h] = [0, 1];
  for (const band of VERTICAL)
    if (band.words.some((k) => words.has(k))) {
      y = band.y;
      h = band.h;
      break;
    }
  for (const band of HORIZONTAL)
    if (band.words.some((k) => words.has(k))) {
      x = band.x;
      w = band.w;
      break;
    }
  return { x, y, w, h };
}

/** Long side of a zone crop sent to the model (a yes/no question needs no more pixels). */
export const ZONE_CROP_MAX_PX = 512;

/**
 * The zone of a data-URL crop, re-encoded (JPEG, long side ≤ 512 px). The original URL back when
 * the zone is the whole frame or anything fails. Never throws.
 */
export async function zoneCropUrl(cropUrl: string, rect: ZoneRect): Promise<string> {
  try {
    if (rect.x <= 0 && rect.y <= 0 && rect.w >= 1 && rect.h >= 1) return cropUrl;
    const m = /^data:image\/\w+;base64,(.*)$/s.exec(cropUrl);
    if (!m) return cropUrl;
    const src = sharp(Buffer.from(m[1]!, 'base64'));
    const meta = await src.metadata();
    const [W, H] = [meta.width ?? 0, meta.height ?? 0];
    if (!(W > 0 && H > 0)) return cropUrl;
    const left = Math.max(0, Math.min(W - 1, Math.floor(rect.x * W)));
    const top = Math.max(0, Math.min(H - 1, Math.floor(rect.y * H)));
    const width = Math.max(8, Math.min(W - left, Math.round(rect.w * W)));
    const height = Math.max(8, Math.min(H - top, Math.round(rect.h * H)));
    const out = await src
      .extract({ left, top, width, height })
      .resize({ width: ZONE_CROP_MAX_PX, height: ZONE_CROP_MAX_PX, fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (err) {
    console.warn('[vision] 3D zone crop failed:', err instanceof Error ? err.message : err);
    return cropUrl;
  }
}

export interface PartToAsk {
  part: string;
  where?: string;
}

export interface PartAsked {
  part: string;
  answer: PartAnswer | null;
}

/**
 * One short question per part, all in parallel on their zone crops (E11: « en parallèle »).
 * Capped at `MAX_PART_QUESTIONS`; a part whose ask fails answers null. Never throws.
 */
export async function askPartQuestions(
  ask: (imageUrl: string, question: string, signal?: AbortSignal) => Promise<PartAnswer | null>,
  cropUrl: string,
  parts: ReadonlyArray<PartToAsk>,
  { signal, maxParts = MAX_PART_QUESTIONS }: { signal?: AbortSignal; maxParts?: number } = {}
): Promise<PartAsked[]> {
  const slice = parts.slice(0, Math.max(0, maxParts));
  return Promise.all(
    slice.map(async ({ part, where }): Promise<PartAsked> => {
      try {
        const zone = await zoneCropUrl(cropUrl, zoneRect(where));
        return { part, answer: await ask(zone, partQuestion(part, where), signal) };
      } catch (err) {
        console.warn(
          `[vision] 3D part question for "${part}" failed:`,
          err instanceof Error ? err.message : err
        );
        return { part, answer: null };
      }
    })
  );
}
