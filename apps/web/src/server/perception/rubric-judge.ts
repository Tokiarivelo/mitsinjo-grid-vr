import 'server-only';

import sharp from 'sharp';
import { frontPartIndex, type ObjectRecipe } from '@/lib/object-shape';
import { renderFlat, THREE_QUARTER, type FlatRender } from './flat-render';
import type { RgbGrid } from './model-score';
import type { JudgeResult } from './schemas';
import { fingerprint } from './shape-cache';

/**
 * Rubric judge (PQ-T4, methodology §6.2, Judge card §11 of the skills file): Muse Wonder grades six
 * criteria from 1 to 5 on one sheet (photo | model same view | model from a corner). Offline and
 * background only, never in the first answer. Trusted by the loop only after calibration: damaged
 * models (two parts removed) must grade lower in ≥ `JUDGE_TRUST_SHARE` of the pairs.
 */

/** Version of the judge prompt (PQ-T5 rule: bump with every change). */
export const JUDGE_PROMPT_VERSION = 1;

export const JUDGE_CRITERIA = [
  'silhouette',
  'proportions',
  'parts_present',
  'parts_placed',
  'surfaces',
  'likeness',
] as const;
export type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];

export interface Judgement {
  /** Whole grade 1–5 per criterion. */
  grades: Record<JudgeCriterion, number>;
  /** One sentence per criterion graded under 4 (absent otherwise). */
  notes: Partial<Record<JudgeCriterion, string>>;
}

/** The Judge card, word for word (`docs/vision-to-3d-muse-skills.md` §11). */
export const JUDGE_SYSTEM_PROMPT = [
  'You grade how well OUR 3D MODEL represents the object on the PHOTO.',
  'Sheet: left = photo · middle = our model, same view · right = our model from a corner.',
  'The model is simplified on purpose: no texture detail, no lettering, soft studio light.',
  'Grade what a simplified model can get right.',
  'Give each criterion a whole grade from 1 to 5:',
  '- silhouette: the outline against the background',
  '- proportions: width, height, depth and the size of the big volumes against each other',
  '- parts_present: the recognisable parts of the photo exist in the model',
  '- parts_placed: they sit at the right place with the right size',
  '- surfaces: colours and materials of the big surfaces',
  '- likeness: shown the model alone, would a person name the same object and the same kind?',
  '5 = nothing to fix · 4 = small differences · 3 = recognisable with clear faults ·',
  '2 = same family only · 1 = not this object.',
  'For every grade under 4, one sentence naming the part and what is wrong.',
  'Do not grade the hidden sides of the object. Do not reward detail the photo does not show.',
].join('\n');

const grade = { type: 'integer', minimum: 1, maximum: 5 };
export const JUDGE_JSON_SCHEMA = {
  name: 'ShapeJudgement',
  schema: {
    type: 'object',
    properties: {
      grades: {
        type: 'object',
        properties: Object.fromEntries(JUDGE_CRITERIA.map((c) => [c, grade])),
        required: [...JUDGE_CRITERIA],
      },
      notes: {
        type: 'object',
        properties: Object.fromEntries(JUDGE_CRITERIA.map((c) => [c, { type: 'string' }])),
      },
    },
    required: ['grades'],
  },
} as const;

/** The question sent with the sheet: what the object is. */
export function judgeQuestion(label: string): string {
  return `The object is: ${label}. Grade the model. Answer ONLY JSON.`;
}

/** Answer → judgement: grades rounded and clamped to 1–5, notes kept for criteria under 4; null when unusable. */
export function parseJudge(content: string): Judgement | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  const g = (raw as { grades?: Record<string, unknown> } | null)?.grades;
  if (!g || typeof g !== 'object') return null;
  const grades = {} as Record<JudgeCriterion, number>;
  for (const c of JUDGE_CRITERIA) {
    // A number or a numeric string only: `Number(null)` is 0 and would pass for the grade 1.
    const given = g[c];
    const v =
      typeof given === 'number' ? given : typeof given === 'string' && given.trim() ? +given : NaN;
    if (!Number.isFinite(v)) return null;
    grades[c] = Math.min(5, Math.max(1, Math.round(v)));
  }
  const n = (raw as { notes?: Record<string, unknown> }).notes ?? {};
  const notes: Judgement['notes'] = {};
  for (const c of JUDGE_CRITERIA) {
    const t = n[c];
    if (grades[c] < 4 && typeof t === 'string' && t.trim()) notes[c] = t.trim().slice(0, 300);
  }
  return { grades, notes };
}

/**
 * The judgement only when Muse Wonder gave it: a mock answer or a provider fallback (network, spend cap)
 * grades a fixed 3 and would pass for a real grade in the calibration and the stored replays.
 */
export const liveJudgement = (r: JudgeResult): Judgement | null =>
  r.source === 'meta' && !r.fallback ? r.judgement : null;

/** Mean grade of a judgement, 1–5. */
export const judgeMean = (j: Judgement): number =>
  JUDGE_CRITERIA.reduce((s, c) => s + j.grades[c], 0) / JUDGE_CRITERIA.length;

/**
 * Calibration model (methodology §6.2): the same recipe without its two biggest parts that are not
 * the main body. Deterministic; returns the recipe unchanged when it has fewer than three parts.
 */
export function damage(recipe: ObjectRecipe): ObjectRecipe {
  const main = frontPartIndex(recipe);
  const volume = (i: number) => recipe.parts[i]!.size.reduce((a, b) => a * b, 1);
  const others = recipe.parts.map((_, i) => i).filter((i) => i !== main);
  if (others.length < 2) return recipe;
  const drop = new Set(others.sort((a, b) => volume(b) - volume(a) || a - b).slice(0, 2));
  return { ...recipe, parts: recipe.parts.filter((_, i) => !drop.has(i)) };
}

/**
 * Fingerprint of the recipe a stored judgement graded (PQ-T54): a re-captured model must be judged
 * again, never graded by an answer to its older shape. Stable: same recipe, same print.
 */
export const recipeFingerprint = (recipe: ObjectRecipe): string =>
  fingerprint(JSON.stringify(recipe));

/**
 * A stored `<id>.judge.json` is replayed only when it graded this exact recipe with this prompt and
 * model; anything else (older answer, re-capture, other model) is judged again live.
 */
export function judgeReplayUsable(
  stored: {
    promptVersion?: unknown;
    model?: unknown;
    recipe?: unknown;
    intact?: Judgement;
    damaged?: Judgement;
  } | null,
  recipe: ObjectRecipe,
  model: string
): stored is { intact: Judgement; damaged: Judgement } {
  return (
    !!stored &&
    stored.promptVersion === JUDGE_PROMPT_VERSION &&
    stored.model === model &&
    stored.recipe === recipeFingerprint(recipe)
  );
}

/** Share of pairs where the damaged model grades lower than the intact one, and the trust verdict. */
export const JUDGE_TRUST_SHARE = 0.9;
export function calibration(pairs: ReadonlyArray<{ intact: Judgement; damaged: Judgement }>): {
  share: number;
  trusted: boolean;
} {
  if (!pairs.length) return { share: 0, trusted: false };
  const lower = pairs.filter((p) => judgeMean(p.damaged) < judgeMean(p.intact)).length;
  const share = lower / pairs.length;
  return { share, trusted: share >= JUDGE_TRUST_SHARE };
}

/** Sheet tile height (px). */
export const JUDGE_TILE = 256;

const onWhite = (r: FlatRender): Buffer => {
  const out = Buffer.from(r.rgb);
  for (let i = 0; i < r.mask.data.length; i++) if (!r.mask.data[i]) out.fill(255, i * 3, i * 3 + 3);
  return out;
};

/** Photo | model at the photo view | model from a corner (¾), one PNG data URL for the judge. */
export async function judgeSheet(
  crop: RgbGrid,
  recipe: ObjectRecipe,
  aspect: number
): Promise<string> {
  const h = JUDGE_TILE;
  const w = Math.min(2 * h, Math.max(32, Math.round(h * aspect)));
  const front = renderFlat(recipe, aspect, w, h);
  const corner = renderFlat(recipe, 1, h, h, THREE_QUARTER);
  const raw = (buf: Buffer | Uint8Array, width: number, height: number) =>
    sharp(Buffer.from(buf), { raw: { width, height, channels: 3 } });
  const tiles = await Promise.all([
    raw(Buffer.from(crop.rgb as Uint8Array), crop.cols, crop.rows)
      .resize({ width: w, height: h, fit: 'fill' })
      .png()
      .toBuffer(),
    raw(onWhite(front), w, h).png().toBuffer(),
    raw(onWhite(corner), h, h).png().toBuffer(),
  ]);
  const widths = [w, w, h];
  let left = 0;
  const png = await sharp({
    create: { width: w + w + h, height: h, channels: 3, background: '#ffffff' },
  })
    .composite(
      tiles.map((input, i) => {
        const at = { input, left, top: 0 };
        left += widths[i]!;
        return at;
      })
    )
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}
