import 'server-only';

import { z } from 'zod';
import { env } from '@/lib/env';
import { PART_KINDS, RECIPE_MATERIALS, type ObjectRecipe } from '@/lib/object-shape';
import { CODE_MAX_BYTES } from './code-sandbox';
import { elevationBox } from './elevation-score';
import type { Elevation } from './facade-house';
import type { ModelScore } from './model-score';

/**
 * Route-B writer (PQ-T45, §8bis): the prompt Wonder answers with a `build()` body, the schema of
 * that answer, and its parser. First case: the house — overhang, openings on the four faces and
 * the roof/wall joint come from the code, not the template draft passed along.
 */

/** Current writer prompt; bumped only with a measured eval behind it (PQ-T5). */
export const CODE_PROMPT_VERSION = 3;
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
    '), front (main body), axis (cylinder/cone: x/y/z), apex (prism ridge x, 0–1), ridge/clip (hip), points (extrude/hull ring), section (hull side ring), profile (lathe radius-vs-height), overhang (roof eave, object units each side, number 0–0.12).',
  "Assembly fields, with their exact types (a wrong type is ignored): grid [across, down] integers (window / door panes); leaves 1 or 2 (door / window leaves); glazed NUMBER 0–1 (glass share of a door, not a boolean); panels INTEGER (door panels, not an array); sill, lintel, cap, rim BOOLEAN; bulge number (thatch eave roll). extrude / hull points: closed ring of [x, y] in the part's own box, each within ±0.5, 3–64 points.",
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

/**
 * Modeler prompt (PQ-T58, v3): the method of a human modeller, written for the model that writes the
 * code. It starts from the drawing, not from the template draft: the draft is a floor to beat, never a
 * shape to preserve. Houses with several volumes, shed roofs and stepped heights come from `extrude`
 * rings the host measured on the drawing (`elevationFrameText`).
 */
export const CODE_PROMPT_MODELER_VERSION = 3;

export const CODE_SYSTEM_PROMPT_V3 = [
  'You are a 3D modeller. You turn ONE picture (a photo or a 2D elevation drawing) into a 3D object for a SIMULATED rural microgrid editor by writing the body of build(api, params), JavaScript that returns an array of parts. Work like a modeller, in this order:',
  '1. LOOK. List what you see: the separate VOLUMES (a house is often several blocks of different heights joined together), the roof of each volume and its slope direction, every opening, every beam, balcony, rail, chimney, plinth, garage door. Count them on the picture. Do not simplify a stepped or multi-volume object into one box with a gable roof.',
  '2. COARSE FIRST. One part per volume (api.box for a plain block, api.extrude with a ring for any profile that is not a rectangle: a shed roof is a quadrilateral ring, a stepped silhouette is a polygon). Place them from the measured frame below, never by eye.',
  '3. SECONDARY FORMS. Roofs with their overhang (`overhang`), fascias, balcony slabs, the chimney, the plinth, the porch.',
  '4. DETAILS. Windows and doors as thin proud parts or assemblies at the measured boxes (kind window/door, glazed grid for panes), rails, posts and beams, lights, the garage door panels. Details are parts too: a missing detail is a defect.',
  '5. CHECK against the sheet (drawing | your model | difference: red = drawn but not built, blue = built but not drawn, amber = wrong part). Fix the largest difference first, in small exact changes. Keep what already matches.',
  CODE_API_SPEC,
  CODE_GROWN_OPTIONS,
  'MEASURED FRAME: the question gives the exact object-unit coordinates (at / size) of every opening and the roof outline rings of the drawing. Use those numbers, they are measurements. Where you must choose a value yourself (depth, a hidden face, a missing detail), cite the reason in a comment, and keep it plausible and symmetric.',
  'DEPTH AND FACES: the drawing is the front face (z toward the camera). Give each volume a plausible depth from the object kind; side and back faces repeat the front openings where a real building would have them; never leave a long blank wall without a reason.',
  CODE_KIND_RULES,
  'Budget: ≤ 32 parts and ≈ 5 000 triangles, spend them on the large visible shapes and openings first. Colours only from params.colors roles. Never output an energy value (no watt, kW, kWh). Answer only the JSON schema: { "code": "<build() body>" }.',
].join('\n');

/** Every writer prompt still comparable by version (current = `CODE_PROMPT_VERSION`). */
export const CODE_PROMPTS: Readonly<Record<number, string>> = {
  1: CODE_SYSTEM_PROMPT,
  [CODE_PROMPT_GENERIC_VERSION]: CODE_SYSTEM_PROMPT_V2,
  [CODE_PROMPT_MODELER_VERSION]: CODE_SYSTEM_PROMPT_V3,
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
  /** Measured frame of the drawing in object units (`elevationFrameText`, v3). */
  frameText?: string;
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
    `Template draft (a floor to beat; do not copy its shape if the picture shows more): ${draft}`,
  ];
  if (q.frameText) lines.push(q.frameText);
  if (q.measuresText) lines.push(`Measured: ${q.measuresText}. Cite these in comments.`);
  if (q.currentCode) lines.push(`Current code (beat it or keep it):\n${q.currentCode}`);
  if (q.droppedText) lines.push(`Fix these dropped parts: ${q.droppedText}.`);
  lines.push('Write the build() body.');
  return lines.join('\n');
}

type Pt = readonly [number, number];
const MAX_RING_POINTS = 24;

/** Thin a ring to at most `max` points, keeping the first and spreading the rest evenly. */
function thin(ring: ReadonlyArray<Pt>, max: number): Pt[] {
  if (ring.length <= max) return [...ring];
  const step = ring.length / max;
  return Array.from({ length: max }, (_, i) => ring[Math.floor(i * step)]!);
}

/**
 * The drawing's frame in object units (PQ-T58): image point (x, y down) → object (X = (x − cx) / W,
 * Y = (cy − y) / H), so the writer copies measured numbers instead of converting by eye. Lists every
 * opening as `at [X,Y] size [w,h]` and every roof outline ring as a ready `extrude` part (centre, size
 * and a ring normalised to the part box, y up). The front face is z = +0.5·depth.
 */
export function elevationFrameText(
  e: Elevation,
  rings: ReadonlyArray<ReadonlyArray<Pt>> = e.roofRings ?? []
): string {
  const box = elevationBox(e);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const f3 = (n: number) => n.toFixed(3);
  const at = (b: { x: number; y: number; w: number; h: number }) =>
    `at [${f3((b.x + b.w / 2 - cx) / box.w)}, ${f3((cy - (b.y + b.h / 2)) / box.h)}] size [${f3(b.w / box.w)}, ${f3(b.h / box.h)}]`;
  const list = (
    name: string,
    boxes: ReadonlyArray<{ x: number; y: number; w: number; h: number }>
  ) => (boxes.length ? `${name}: ${boxes.slice(0, 24).map(at).join(' | ')}` : `${name}: none`);
  const lines = [
    `Frame: the object's front face spans the image box x ${f3(box.x)}–${f3(box.x + box.w)}, y ${f3(box.y)}–${f3(box.y + box.h)} (y down). In object units x, y ∈ [−0.5, 0.5], y up; sizes are fractions of the box.`,
    `Wall band (below the eave): ${at({ x: e.wallLeft, y: e.eave, w: e.wallRight - e.wallLeft, h: e.bottom - e.eave })}`,
    `Roof band (ridge to eave): ${at({ x: e.left, y: e.top, w: e.right - e.left, h: e.eave - e.top })}`,
    list('Windows', e.windows),
    list('Doors', e.doors),
    list('Chimneys', e.chimneys),
    list('Glass panes', e.panes),
    list('Beams / posts', e.beams),
    e.plinth ? `Plinth: ${at(e.plinth)}` : 'Plinth: none',
    list('Steps', e.steps),
  ];
  rings.slice(0, 6).forEach((ring, i) => {
    const pts = thin(ring, MAX_RING_POINTS);
    if (pts.length < 3) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const b = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
    if (!(b.w > 0) || !(b.h > 0)) return;
    const unit = pts.map(([x, y]) => [
      +((x - b.x) / b.w - 0.5).toFixed(3),
      +(0.5 - (y - b.y) / b.h).toFixed(3),
    ]);
    lines.push(
      `Roof outline ${i + 1} (extrude part, depth is yours): ${at(b)} points ${JSON.stringify(unit)}`
    );
  });
  return lines.join('\n');
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

/**
 * A measured silhouette as writer input (PQ-T61), any object: the outline ring and the part boxes
 * read on one view, in object units (x right, y up, both within ±0.5 of the object box). On a
 * `side` view the horizontal axis is the depth: the object's front is on the left (z = −x).
 * `ring` = object-box fractions, u right, v up (0–1); part boxes = fractions, y down.
 */
export function silhouetteFrameText(
  view: 'front' | 'side' | 'photo',
  ring: ReadonlyArray<Pt>,
  parts: ReadonlyArray<{ concept: string; box: { x: number; y: number; w: number; h: number } }>
): string {
  const f = (n: number) => +n.toFixed(2);
  const flip = view === 'side' ? -1 : 1;
  const axis = view === 'side' ? '[z, y] (depth, front of the object at z = +0.5)' : '[x, y]';
  const pts = thin(ring, 28).map(([u, v]) => [f(flip * (u - 0.5)), f(v - 0.5)]);
  const lines = [
    `${view === 'photo' ? 'Outline measured on the photo (the object as it is turned there)' : `Outline measured on the ${view} drawing`}, object units ${axis}, y up, box = ±0.5: ${JSON.stringify(pts)}`,
  ];
  if (parts.length) {
    lines.push(
      `Parts measured on the ${view}: ${parts
        .slice(0, 24)
        .map(
          (p) =>
            `${p.concept} at [${f(flip * (p.box.x + p.box.w / 2 - 0.5))}, ${f(0.5 - (p.box.y + p.box.h / 2))}] size [${f(p.box.w)}, ${f(p.box.h)}]`
        )
        .join(' | ')}`
    );
  }
  return lines.join('\n');
}
