import 'server-only';

import { z } from 'zod';
import { env } from '@/lib/env';
import { PART_KINDS, RECIPE_MATERIALS, type ObjectRecipe } from '@/lib/object-shape';
import { CODE_MAX_BYTES } from './code-sandbox';
import type { Elevation } from './facade-house';
import type { ModelScore } from './model-score';

/**
 * Route-B writer (PQ-T45, §8bis): the prompt Wonder answers with a `build()` body, the schema of
 * that answer, and its parser. First case: the house — overhang, openings on the four faces and
 * the roof/wall joint come from the code, not the template draft passed along.
 */

/** Current writer prompt; bumped only with a measured eval behind it (PQ-T5). */
export const CODE_PROMPT_VERSION = 1;
/**
 * Generic writer prompt (PQ-T55): v1 only knew houses, so the B-vs-A eval on willow, car and
 * appliances asks v2. Opt-in until the eval backs it (`writeBuildCode(…, version)`); the live
 * house path stays on v1.
 */
export const CODE_PROMPT_GENERIC_VERSION = 2;

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
  'House rules: the roof overhang and slope come from the measured roofline; windows and doors sit on all four faces where the photo or the drawing shows them; the roof foot overlaps the wall top (no groove at the joint); gable ends are wall, not roof. Front openings go at the measured elevation boxes (image fractions [x,y,w,h], y down → part at/size, y up), never spread evenly.',
  'Never output an energy value (no watt, kW, kWh). Never invent colours: main/secondary/accent roles only. Answer only the JSON schema: { "code": "<build() body>" }.',
].join('\n');

/**
 * Grown-geometry options a part may carry (PQ-T50/51 §7.3, `sdf` PQ-T53 §8): the guest passes
 * them inside the `api.*` options object and the recipe schema validates them like the rest.
 * Field names mirror the Zod schemas; an invalid part is dropped with its reason, not fatal.
 */
const CODE_GROWN_OPTIONS = [
  'Grown options (inside any part object; same validation as the recipe):',
  "- generator {op:'sweep', seed, points (2-8 [x,y,z] centres within ±0.6), r0, r1, flare?} — trunks, pipes, rails.",
  "- generator {op:'branch', seed, at, dir, length, radius, levels 1-3, count 2-5, angle, droop, decay} — limbs.",
  "- generator {op:'scatter', seed, volume {shape box|ellipsoid, at, size}, count ≤ 60, size, orientation flat|upright|random, colors[1-4]} — leaves, thatch.",
  "- generator {op:'drape', seed, points 1-12, strands 1-4, length, waviness, thickness} — hanging strands.",
  "- generator {op:'loft', axis x|y|z, stations 3-6 {width, height, radius}} — bodies along the host extent.",
  "- generator {op:'inset', face front|back|left|right|top, u, v, w, h, depth -0.3 to 0.05} — hollows and reliefs on a face.",
  '- sdf shape: blobs [{kind sphere|capsule|ellipsoid|box, c (centre within ±0.5), r|radii|size, axis?+halfLen?, k? blend ≤ 0.1}], 1-12 blobs, radii ≥ 0.04.',
].join('\n');

/** Per-kind rules (PQ-T55 v2): the question names the kind, the matching section applies. */
const CODE_KIND_RULES = [
  'Follow the section for this object kind:',
  'HOUSE: the roof overhang and slope come from the measured roofline; windows and doors sit on all four faces where the photo or the drawing shows them; the roof foot overlaps the wall top (no groove at the joint); gable ends are wall, not roof. Front openings go at the measured elevation boxes (image fractions [x,y,w,h], y down → part at/size, y up), never spread evenly.',
  'VEHICLE: a lofted body along x with a tapered nose and tail beats a box; the glasshouse (windscreen, side glass, rear window) is dark glass proud of the cabin; wheels sit in arches at the four corners, lights and bumpers at both ends.',
  'PLANT: trunk by sweep with base flare, limbs by branch, crown by scatter inside the measured outline volume, hanging strands by drape; the crown underside is hollow (trunk visible into it), never a solid dome.',
  'TECHNICAL (cabinet, machine, screen, tank, fan, lamp, pole, other): one hull box first, then door leaves, handles, vents, feet and displays as thin proud parts; symmetric unless the photo shows otherwise.',
].join('\n');

export const CODE_SYSTEM_PROMPT_V2 = [
  'You write the body of build(api, params), JavaScript that constructs ONE 3D object for a SIMULATED rural microgrid editor. It must return an array of parts.',
  CODE_API_SPEC,
  CODE_GROWN_OPTIONS,
  'OBSERVE, DO NOT GUESS: every value you choose cites the measure or the photo zone that justifies it in a short comment (e.g. // overhang: roofline measured 6 % wider than the wall). A face the photo does not show is imagined from the object kind (thatch overhangs more than tile) and stays plausible and symmetric.',
  'Rebuild the draft for THIS object: keep what the photo confirms, fix what the score and the current render prove wrong (silhouette, part counts and places, colours per part). Small, exact parts beat many approximate ones.',
  CODE_KIND_RULES,
  'Never output an energy value (no watt, kW, kWh). Never invent colours: main/secondary/accent roles only. Answer only the JSON schema: { "code": "<build() body>" }.',
].join('\n');

/** Every writer prompt still comparable by version (current = `CODE_PROMPT_VERSION`). */
export const CODE_PROMPTS: Readonly<Record<number, string>> = {
  1: CODE_SYSTEM_PROMPT,
  [CODE_PROMPT_GENERIC_VERSION]: CODE_SYSTEM_PROMPT_V2,
};

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
  /** Kit archetype (`tree`, `vehicle`, …): selects the v2 kind section, shown beside the label. */
  archetype?: string;
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
    `Object: ${q.label}${q.archetype ? ` (${q.archetype})` : ''}. Draft score ${q.scoreText}${q.detailText ? ` (${q.detailText})` : ''}.`,
    `Draft: ${draft}`,
  ];
  if (q.measuresText) lines.push(`Measured: ${q.measuresText}. Cite these in comments.`);
  if (q.currentCode) lines.push(`Current code (beat it or keep it):\n${q.currentCode}`);
  if (q.droppedText) lines.push(`Fix these dropped parts: ${q.droppedText}.`);
  lines.push('Write the build() body.');
  return lines.join('\n');
}

const f2 = (n: number) => n.toFixed(2);
const boxText = (b: { x: number; y: number; w: number; h: number }) =>
  `[${f2(b.x)},${f2(b.y)},${f2(b.w)},${f2(b.h)}]`;
const boxesText = (
  name: string,
  boxes: ReadonlyArray<{ x: number; y: number; w: number; h: number }>
) =>
  boxes.length
    ? `${name} ${boxes.length}: ${boxes.slice(0, 16).map(boxText).join(' ')}`
    : `${name} 0`;

/**
 * The measured 2D elevation as writer input (PQ-T56): roof edges, ridge, eave, ground and every
 * opening box, image fractions (x right, y down, boxes [x,y,w,h]). Without it the writer only
 * saw counts and spread the windows evenly, so every house looked alike.
 */
export function elevationMeasuresText(e: Elevation): string {
  return [
    `elevation image aspect ${f2(e.aspect)} (w/h)`,
    `roof x ${f2(e.left)}–${f2(e.right)}, walls x ${f2(e.wallLeft)}–${f2(e.wallRight)}`,
    `ridge y ${f2(e.top)}, eave y ${f2(e.eave)}, ground y ${f2(e.bottom)}`,
    e.ridge === null ? 'ridge flat share n/a' : `ridge flat share ${f2(e.ridge)}`,
    boxesText('windows', e.windows),
    boxesText('doors', e.doors),
    boxesText('chimneys', e.chimneys),
    boxesText('panes', e.panes),
    boxesText('beams', e.beams),
    e.plinth ? `plinth ${boxText(e.plinth)}` : 'plinth none',
    boxesText('steps', e.steps),
  ].join('; ');
}

/** Draft detail line for the writer question (`recall 0.70 · …`), from the fields measured. */
export function detailTextOf(score: ModelScore): string | undefined {
  const d = score.detail;
  if (!d) return undefined;
  const cells: string[] = [];
  if (d.partRecall !== undefined) cells.push(`recall ${d.partRecall.toFixed(2)}`);
  if (d.partPrecision !== undefined) cells.push(`precision ${d.partPrecision.toFixed(2)}`);
  if (d.interiorEdgeF1 !== undefined) cells.push(`interior F1 ${d.interiorEdgeF1.toFixed(2)}`);
  if (d.partDeltaE !== undefined) cells.push(`part ΔE ${d.partDeltaE.toFixed(1)}`);
  if (d.anatomyRecall !== undefined) cells.push(`ana ${d.anatomyRecall.toFixed(2)}`);
  return cells.length ? cells.join(' · ') : undefined;
}
