import 'server-only';

import { z } from 'zod';
import { env } from '@/lib/env';
import { PART_KINDS, RECIPE_MATERIALS, type ObjectRecipe } from '@/lib/object-shape';
import { CODE_MAX_BYTES } from './code-sandbox';

/**
 * Route-B writer (PQ-T45, §8bis): the prompt Wonder answers with a `build()` body, the schema of
 * that answer, and its parser. First case: the house — overhang, openings on the four faces and
 * the roof/wall joint come from the code, not the template draft passed along.
 */

/** Current writer prompt; bumped only with a measured eval behind it (PQ-T5). */
export const CODE_PROMPT_VERSION = 1;

/** The construction `api` the guest sees, as Wonder must know it (single source: the prompt). */
const CODE_API_SPEC = [
  'API (JavaScript, synchronous, deterministic):',
  '- Primitives, each takes an options object and returns the part: api.box, api.cylinder, api.sphere, api.cone, api.prism, api.extrude, api.lathe, api.hip, api.hull.',
  '- api.material(name): one of ' + RECIPE_MATERIALS.join(', ') + ' (anything else fails the run).',
  '- api.rng(): deterministic random in [0, 1), same sequence for the same seed.',
  '- params: { seed, proportions { w, h, d }, colors { main, secondary, accent }, measures { ... } }.',
  'Coordinates: object centred at the origin, x right, y up, z toward the camera. `at` = part centre, `size` = part extent, both fractions of the object (each within ±0.6, extent 0.01–1).',
  'Part fields: shape, at, size, color (#rrggbb, from params.colors only), material, kind (one of ' +
    PART_KINDS.join(', ') +
    '), front (main body), axis (cylinder/cone: x/y/z), apex (prism ridge x, 0–1), ridge/clip (hip), points (extrude/hull ring), section (hull side ring), profile (lathe radius-vs-height), grid/leaves/glazed/panels/sill/lintel/cap/bulge/rim (assemblies), overhang (roof eave, object units each side).',
  'Limits: ≤ 64 api calls, ≤ 32 parts returned, ≈ 5 000 triangles. Invalid parts are dropped with their reason; no valid part fails the run.',
].join('\n');

export const CODE_SYSTEM_PROMPT = [
  'You write the body of build(api, params), JavaScript that constructs ONE 3D object for a SIMULATED rural microgrid editor. It must return an array of parts.',
  CODE_API_SPEC,
  'OBSERVE, DO NOT GUESS: every value you choose cites the measure or the photo zone that justifies it in a short comment (e.g. // overhang: roofline measured 6 % wider than the wall). A face the photo does not show is imagined from the object kind (thatch overhangs more than tile) and stays plausible and symmetric.',
  'Rebuild the draft for THIS object: keep what the photo confirms, fix what the score and the current render prove wrong (silhouette, part counts and places, colours per part). Small, exact parts beat many approximate ones.',
  'House rules: the roof overhang and slope come from the measured roofline; windows and doors sit on all four faces where the photo or the drawing shows them; the roof foot overlaps the wall top (no groove at the joint); gable ends are wall, not roof.',
  'Never output an energy value (no watt, kW, kWh). Never invent colours: main/secondary/accent roles only. Answer only the JSON schema: { "code": "<build() body>" }.',
].join('\n');

/** Every writer prompt still comparable by version (current = `CODE_PROMPT_VERSION`). */
export const CODE_PROMPTS: Readonly<Record<number, string>> = { 1: CODE_SYSTEM_PROMPT };

/** The writer system prompt of `version` (default: current); throws on a version not kept. */
export function codePrompt(version: number = CODE_PROMPT_VERSION): string {
  const text = CODE_PROMPTS[version];
  if (!text) throw new Error(`unknown code prompt version ${version}`);
  return text;
}

export const CODE_JSON_SCHEMA = {
  name: 'BuildCode',
  schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Body of build(api, params), returns the parts array' },
    },
    required: ['code'],
  },
};

const CodeReplySchema = z.object({ code: z.string() });

/** Wonder's answer → the `build()` body, or null when unusable (bad JSON, empty, over 64 Ko). */
export function parseBuildCode(content: string): string | null {
  try {
    const parsed = CodeReplySchema.safeParse(JSON.parse(content));
    if (!parsed.success) return null;
    const code = parsed.data.code.trim();
    if (!code || Buffer.byteLength(code, 'utf8') > CODE_MAX_BYTES) return null;
    return code;
  } catch {
    return null;
  }
}

/** Model that writes the construction code (§8bis): `META_CODE_MODEL`, else the refine model. */
export function codeModel(): string {
  return env.META_CODE_MODEL ?? env.META_REFINE_MODEL;
}

export interface CodeQuestionInput {
  label: string;
  /** The template draft to rebuild for this object (its proportions win). */
  draft: ObjectRecipe;
  /** One-line score of the draft (`0.83 (iou 0.91, edge 0.55, ΔE 6.2)`). */
  scoreText: string;
  /** Detail lines when known (`recall 0.7 · precision 1.0 · interior F1 0.2 · part ΔE 5`). */
  detailText?: string;
  /** `name value` measure lines the code must cite (`overhang 0.04`). */
  measuresText?: string;
  /** Current winning body on a patch round (the full body is re-sent each round). */
  currentCode?: string;
  /** Dropped-part reasons of the last execution to fix (`2: color: Invalid`). */
  droppedText?: string;
}

/** The writer question: draft + score + measures (+ current code on a patch round). */
export function buildCodeQuestion(q: CodeQuestionInput): string {
  const draft = JSON.stringify({
    proportions: q.draft.proportions,
    parts: q.draft.parts.map((p) => ({
      shape: p.shape,
      at: p.at.map((v) => +v.toFixed(3)),
      size: p.size.map((v) => +v.toFixed(3)),
      color: p.color,
      ...(p.material ? { material: p.material } : {}),
      ...(p.kind ? { kind: p.kind } : {}),
      ...(p.overhang !== undefined ? { overhang: p.overhang } : {}),
    })),
  });
  const lines = [
    `Object: ${q.label}. Draft score ${q.scoreText}${q.detailText ? ` (${q.detailText})` : ''}.`,
    `Draft: ${draft}`,
  ];
  if (q.measuresText) lines.push(`Measured: ${q.measuresText}. Cite these in comments.`);
  if (q.currentCode) lines.push(`Current code (beat it or keep it):\n${q.currentCode}`);
  if (q.droppedText) lines.push(`Fix these dropped parts: ${q.droppedText}.`);
  lines.push('Write the build() body.');
  return lines.join('\n');
}
