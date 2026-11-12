import type { ApplianceCategory } from '@mitsinjo/engine';
import type { SceneryType } from '@/lib/vision';
import { z } from 'zod';
import {
  ANATOMY,
  ANATOMY_STATES,
  clampEstimatedDepth,
  EVIDENCE_VIEWS,
  KIT_ARCHETYPES,
  MAX_ANATOMY_PARTS,
  MAX_VISIBLE_PARTS,
  ObjectKitSchema,
  PART_MATERIAL_KEYS,
  type AnatomyState,
  type KitAnatomy,
  type KitArchetype,
  type KitConfidence,
  type KitEvidence,
  type ObjectKit,
} from '@/lib/object-kit';
import { RECIPE_MATERIALS, type ObjectRecipe, type RecipePart } from '@/lib/object-shape';
import { archetypeCard, skillFor } from './skills';

/**
 * Prompts and parsing for the Spark 3D « kit » of one object (PV-T9b). Spark only classifies and reads
 * colours; `kitToRecipe` builds the parts. The old free 12-part recipe took Spark more than 60 s on a
 * building (2026-11-01).
 */

/**
 * Version of the kit prompt (PQ-T5): bump it with every change of `SHAPE_SYSTEM_PROMPT` and keep the old
 * text in `KIT_PROMPTS`, so `make eval-shape PROMPT=1,4` compares them on the same captures.
 */
export const KIT_PROMPT_VERSION = 4;

export const SHAPE_SYSTEM_PROMPT = [
  'You describe ONE object seen on a photo crop so a SIMULATED rural microgrid editor can build a 3D model with high fidelity.',
  'Answer fast and short: do not plan 3D coordinates, the editor has the templates.',
  'IMAGINE and INTERPOLATE the complete 3D object even if partially hidden, occluded (by hedges, wireframes, fences, shadows, people), cropped, or seen from only one angle.',
  'Reconstruct the unseen sides, symmetric features, depth, roof, and undercarriage with strong 3D imagination.',
  `archetype = the closest of: ${KIT_ARCHETYPES.join(', ')}.`,
  'For vehicles (cars, vintage cars, compacts, sedans, hatchbacks, trucks, vans, carts, vehicle topiary/sculptures): recognize as "vehicle" and imagine full vehicle anatomy (hood, windshield angle, cabin roof, trunk/rear, 4 wheels, bumpers, lights).',
  'subtype = optional specific subtype: for vehicle: hatchback, sedan, vintage, compact, suv, van, truck, bus, cart, motorbike; for house: cottage, gable, hip, flat; for tree: round, conifer, palm.',
  'proportions = real width, height, depth of the object, largest = 1 (guess the depth from what it is, e.g. car depth is typically 0.45-0.65 of its width).',
  'colors: main = the biggest surface (walls, body, canopy), secondary = roof, stand, trunk or frame,',
  'accent = glass, windows, handle, lamp or wheels; each #rrggbb as seen or inferred.',
  `materials: what main, secondary and accent are made of, each one of: ${RECIPE_MATERIALS.join(', ')} (e.g. stone walls, slate roof, glass windows, metal body, rubber wheels).`,
  'details (optional, small integers): windows on the front face, doors, wheels, legs, floors, chimney, units (houses side by side in a row).',
  'For buildings also: plinth (true when a stone or concrete base band runs along the foot of the walls), timberFrame (true when timber posts and rails show on the walls), panes ([across, down] glass panes of one front window, e.g. [4, 4] for two casements of 2 × 4).',
  `partMaterials (buildings, optional): what the roof, walls, frame (window and door frames), plinth, chimney and door are made of, each one of the materials above; read them on the drawing when there is one (labels, hatching: « REED THATCH » = thatch, brick courses = brick, stone base = stone).`,
  'Never give watts, kW or any energy value.',
].join(' ');

/** Every kit prompt still comparable by version (current = `KIT_PROMPT_VERSION`). */
export const KIT_PROMPTS: Readonly<Record<number, string>> = { 1: SHAPE_SYSTEM_PROMPT };

/**
 * Version 2 (PQ-T12): the Muse cards, `skills/` Base + Look + Kit + the card of the detection hint's family.
 * It depends on the hint, so it is built per call and is not in `KIT_PROMPTS`.
 */
export const KIT_PROMPT_CARDS_VERSION = 2;

/**
 * Version 3 (PQ-T13): version 1 + only the card of the hint's family (no Look card, no evidence): the
 * short card prompt, switched on per family (`SHAPE_KIT_CARD_FAMILIES`) after its own eval.
 */
export const KIT_PROMPT_FAMILY_VERSION = 3;

/**
 * Version 4 (PQ-T46): version 1 + the closed anatomy inventory of the hint's family. The list is
 * dynamic per call, so like versions 2 and 3 it is built by `kitPrompt`, not kept in `KIT_PROMPTS`.
 */
export const KIT_PROMPT_ANATOMY_VERSION = 4;

/** One closed-inventory line: short (PQ-T12: long prompts double the latency), list from `ANATOMY`. */
export function anatomyLine(hint?: KitArchetype): string {
  const parts = hint ? ANATOMY[hint] : [];
  const states =
    'present (you see it), hidden (it exists but you cannot see it) or absent (this object has none)';
  return parts.length
    ? `anatomy (required, answer first): for each of these parts say ${states}, and where it is: ${parts.join(', ')}.`
    : `anatomy (required, answer first): for each part this family always has, say ${states}, and where it is.`;
}

/** Kit prompt version of a call that named none: the family-card one when that family is switched on. */
export function kitVersionFor(
  hint: KitArchetype | undefined,
  families: ReadonlyArray<string>
): number {
  return hint && families.includes(hint) && archetypeCard(hint)
    ? KIT_PROMPT_FAMILY_VERSION
    : KIT_PROMPT_VERSION;
}

/** The kit system prompt of `version` (default: current); throws on a version that was not kept. */
export function kitPrompt(version: number = KIT_PROMPT_VERSION, hint?: KitArchetype): string {
  if (version === KIT_PROMPT_CARDS_VERSION) return skillFor('kit', hint).text;
  if (version === KIT_PROMPT_FAMILY_VERSION) {
    const card = archetypeCard(hint);
    return card ? `${SHAPE_SYSTEM_PROMPT}\n\n${card}` : SHAPE_SYSTEM_PROMPT;
  }
  if (version === KIT_PROMPT_ANATOMY_VERSION)
    return `${SHAPE_SYSTEM_PROMPT}\n\n${anatomyLine(hint)}`;
  const text = KIT_PROMPTS[version];
  if (!text)
    throw new Error(
      `unknown kit prompt version ${version} (kept: ${[...Object.keys(KIT_PROMPTS), KIT_PROMPT_CARDS_VERSION, KIT_PROMPT_FAMILY_VERSION, KIT_PROMPT_ANATOMY_VERSION].join(', ')})`
    );
  return text;
}

/**
 * User turn; the label is the detection name (from a model or typed by the operator), quoted.
 * `aspect` = width / height on the photo; `hint` = archetype the detection implies (Spark may change it).
 */
/** Told to Spark when the validated 2D facade comes as the second image. */
export const FACADE_REFERENCE_LINE =
  'The second image is the validated front elevation of this same object, drawn unoccluded: use it for the windows, doors, floors, roof shape, materials and part layout; the photo crop (first image) still gives the size, pose and colours.';

export function shapeQuestion(
  label: string,
  aspect?: number,
  hint?: KitArchetype,
  withFacade = false,
  facts: readonly string[] = []
): string {
  const name = label.slice(0, 40).replace(/"/g, "'");
  const seen =
    aspect && aspect > 0 && Number.isFinite(aspect)
      ? ` On the photo it is ${aspect.toFixed(2)} times as wide as it is high.`
      : '';
  const guess = hint ? ` It is probably a "${hint}".` : '';
  const facade = withFacade ? ` ${FACADE_REFERENCE_LINE}` : '';
  const measured = facts.length ? ` Measured: ${facts.join(' · ')}.` : '';
  return `Describe the full 3D "${name}" in the clear rectangle in the middle of this crop with strong 3D imagination and interpolation, even if partially occluded.${seen}${guess}${measured}${facade}`;
}

const color = { type: 'string' };
const int = { type: 'integer' };
const material = { type: 'string', enum: [...RECIPE_MATERIALS] };

export const SHAPE_JSON_SCHEMA = {
  name: 'ObjectKit',
  schema: {
    type: 'object',
    properties: {
      archetype: { type: 'string', enum: [...KIT_ARCHETYPES] },
      subtype: { type: 'string' },
      proportions: {
        type: 'object',
        properties: { w: { type: 'number' }, h: { type: 'number' }, d: { type: 'number' } },
        required: ['w', 'h', 'd'],
      },
      colors: {
        type: 'object',
        properties: { main: color, secondary: color, accent: color },
        required: ['main', 'secondary', 'accent'],
      },
      materials: {
        type: 'object',
        properties: { main: material, secondary: material, accent: material },
      },
      partMaterials: {
        type: 'object',
        properties: Object.fromEntries(PART_MATERIAL_KEYS.map((k) => [k, material])),
      },
      details: {
        type: 'object',
        properties: {
          subtype: { type: 'string' },
          windows: int,
          doors: int,
          wheels: int,
          legs: int,
          floors: int,
          chimney: { type: 'boolean' },
          units: int,
          plinth: { type: 'boolean' },
          timberFrame: { type: 'boolean' },
          panes: { type: 'array', items: int },
        },
      },
    },
    required: ['archetype', 'proportions', 'colors'],
  },
};

/** The closed inventory answers (PQ-T46): one state per part, before the decision (E5). */
const ANATOMY_JSON = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      part: { type: 'string' },
      state: { type: 'string', enum: [...ANATOMY_STATES] },
      where: { type: 'string' },
    },
    required: ['part', 'state'],
  },
  maxItems: MAX_ANATOMY_PARTS,
};

/**
 * Schema of kit prompt 2 (PQ-T12): `evidence` first, so the answer is written in the order of the Look card
 * (look, then answer), and `confidence`. Kept apart from `SHAPE_JSON_SCHEMA`: under prompt 1 the model is
 * not offered these fields, so its answers (and their length) stay what the baseline measured.
 */
export const SHAPE_JSON_SCHEMA_CARDS = {
  ...SHAPE_JSON_SCHEMA,
  schema: {
    ...SHAPE_JSON_SCHEMA.schema,
    properties: {
      evidence: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: [...EVIDENCE_VIEWS] },
          outline: { type: 'string' },
          hiddenBy: { type: 'array', items: { type: 'string' } },
          volumes: { type: 'array', items: { type: 'string' } },
          visibleParts: { type: 'array', items: { type: 'string' }, maxItems: MAX_VISIBLE_PARTS },
          repeats: { type: 'object', additionalProperties: int },
          unsure: { type: 'array', items: { type: 'string' } },
        },
      },
      anatomy: ANATOMY_JSON,
      ...SHAPE_JSON_SCHEMA.schema.properties,
      confidence: {
        type: 'object',
        properties: {
          archetype: { type: 'number' },
          proportions: { type: 'number' },
          colors: { type: 'number' },
          counts: { type: 'number' },
        },
      },
    },
  },
};

/**
 * Schema of kit prompts 3 and 4 (PQ-T46): the base fields with the closed inventory answered first.
 * Prompt 3 needs it too: its family card carries the Anatomy line since PQ-T46.
 */
export const SHAPE_JSON_SCHEMA_ANATOMY = {
  ...SHAPE_JSON_SCHEMA,
  schema: {
    ...SHAPE_JSON_SCHEMA.schema,
    properties: {
      anatomy: ANATOMY_JSON,
      ...SHAPE_JSON_SCHEMA.schema.properties,
    },
  },
};

/** The JSON schema sent with kit prompt `version`. */
export const kitJsonSchema = (version: number = KIT_PROMPT_VERSION) =>
  version === KIT_PROMPT_CARDS_VERSION
    ? SHAPE_JSON_SCHEMA_CARDS
    : version === KIT_PROMPT_FAMILY_VERSION || version === KIT_PROMPT_ANATOMY_VERSION
      ? SHAPE_JSON_SCHEMA_ANATOMY
      : SHAPE_JSON_SCHEMA;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const NEUTRAL = '#9aa3ad';
const HEX = /^#[0-9a-f]{6}$/i;

const ReplySchema = z.object({
  archetype: z.string(),
  subtype: z.string().optional(),
  proportions: z.object({ w: z.number(), h: z.number(), d: z.number() }),
  colors: z.record(z.string(), z.unknown()).optional(),
  materials: z.record(z.string(), z.unknown()).optional(),
  partMaterials: z.record(z.string(), z.unknown()).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  evidence: z.unknown().optional(),
  anatomy: z.unknown().optional(),
  confidence: z.unknown().optional(),
});

/**
 * Reads `evidence` leniently (PQ-T12): a wrong type drops that field only, an unknown view is dropped, the
 * part list is cut at `MAX_VISIBLE_PARTS`. `undefined` when nothing usable is left (answers of prompt 1).
 */
export function parseEvidence(raw: unknown): KitEvidence | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const words = (v: unknown, max: number, len: number): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out = v
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim().toLowerCase().slice(0, len));
    return out.length ? [...new Set(out)].slice(0, max) : undefined;
  };
  const out: KitEvidence = {};
  if (typeof o.view === 'string' && (EVIDENCE_VIEWS as readonly string[]).includes(o.view))
    out.view = o.view as KitEvidence['view'] & string;
  if (typeof o.outline === 'string' && o.outline.trim())
    out.outline = o.outline.trim().slice(0, 160);
  const hiddenBy = words(o.hiddenBy, 6, 40);
  if (hiddenBy) out.hiddenBy = hiddenBy;
  const volumes = words(o.volumes, 3, 60);
  if (volumes) out.volumes = volumes;
  const visibleParts = words(o.visibleParts, MAX_VISIBLE_PARTS, 40);
  if (visibleParts) out.visibleParts = visibleParts;
  if (o.repeats && typeof o.repeats === 'object' && !Array.isArray(o.repeats)) {
    const repeats: Record<string, number> = {};
    for (const [k, v] of Object.entries(o.repeats as Record<string, unknown>))
      if (typeof v === 'number' && Number.isFinite(v))
        repeats[k.slice(0, 32)] = clamp(Math.round(v), 0, 50);
    if (Object.keys(repeats).length) out.repeats = repeats;
  }
  const unsure = words(o.unsure, 12, 40);
  if (unsure) out.unsure = unsure;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Reads `anatomy` leniently (PQ-T46): entries without a part name or with an unknown state are
 * dropped, names are lowercased, repeats keep the first answer, the list is cut at
 * `MAX_ANATOMY_PARTS`. `undefined` when nothing usable is left (answers of prompt 1).
 */
export function parseAnatomy(raw: unknown): KitAnatomy | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: KitAnatomy = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (out.length >= MAX_ANATOMY_PARTS) break;
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.part !== 'string') continue;
    const part = o.part.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 32);
    if (!part || seen.has(part)) continue;
    if (typeof o.state !== 'string') continue;
    const state = o.state.trim().toLowerCase() as AnatomyState;
    if (!(ANATOMY_STATES as readonly string[]).includes(state)) continue;
    seen.add(part);
    out.push({
      part,
      state,
      ...(typeof o.where === 'string' && o.where.trim()
        ? { where: o.where.trim().replace(/\s+/g, ' ').slice(0, 80) }
        : {}),
    });
  }
  return out.length ? out : undefined;
}

/** `confidence` of the answer, each value clamped to 0..1; `undefined` when none is a number. */
export function parseKitConfidence(raw: unknown): KitConfidence | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: KitConfidence = {};
  for (const k of ['archetype', 'proportions', 'colors', 'counts'] as const) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(v, 0, 1);
  }
  return Object.keys(out).length ? out : undefined;
}

const LIMITS = { windows: 8, doors: 3, wheels: 6, legs: 4, floors: 4, units: 8 } as const;

/** Version of the critic prompt (PQ-T5), logged with every critic call. */
export const CRITIC_PROMPT_VERSION = 1;

export const CRITIC_SYSTEM_PROMPT = [
  'You are the visual critic of a 3D reconstruction loop. The image shows the PHOTO of one object (left) and OUR 3D MODEL seen from the same view (right).',
  'List what differs (shape, sub-type, counts, proportions, colours of each part), then answer ONLY a JSON patch of the kit: the fields to change, nothing else.',
  `Allowed fields: archetype (one of: ${KIT_ARCHETYPES.join(', ')}), subtype, proportions {w,h,d} (largest = 1), colors {main,secondary,accent} (#rrggbb each), materials, details {windows,doors,wheels,legs,floors,chimney,units}.`,
  'Counts, sub-type, proportions and part colour roles only: never metres, watts, or geometry numbers.',
  'Empty patch ({}) when the model already matches.',
].join(' ');

/** Version 2 (PQ-T14): Base + Critic card + the family's card, for the 2 × 2 sheet. Built per call. */
export const CRITIC_PROMPT_CARDS_VERSION = 2;
/** Version 3 (PQ-T52, E11): version 1 + the closed anatomy list; the critic names missing parts. */
export const CRITIC_ANATOMY_VERSION = 3;

/**
 * One closed-inventory line for the critic (PQ-T52): the §5 ids it may name in `missingParts`.
 * Generic without a family (the parser then keeps nothing: ids are verified per family).
 */
export function criticAnatomyLine(archetype?: KitArchetype): string {
  const ids = archetype ? ANATOMY[archetype] : [];
  return ids.length
    ? `Also list, in "missingParts", the parts of this closed list that show on the photo but are missing or wrong in the model, using exactly these ids: ${ids.join(', ')}.`
    : 'Also list, in "missingParts", the closed-list parts that show on the photo but are missing or wrong in the model.';
}

/** The critic system prompt of `version`; throws on an unknown one. */
export function criticPrompt(
  version: number = CRITIC_PROMPT_VERSION,
  archetype?: KitArchetype
): string {
  if (version === CRITIC_PROMPT_CARDS_VERSION) return skillFor('critic', archetype).text;
  if (version === CRITIC_ANATOMY_VERSION)
    return `${CRITIC_SYSTEM_PROMPT} ${criticAnatomyLine(archetype)}`;
  if (version === CRITIC_PROMPT_VERSION) return CRITIC_SYSTEM_PROMPT;
  throw new Error(`unknown critic prompt version ${version}`);
}

/** Fields of one patch at most (PQ-T14): the largest red / blue areas first, the model's list order. */
export const CRITIC_MAX_FIELDS = 4;

/** Order the fields are kept in when a patch names too many: family, volumes, counts, then paint. */
const PATCH_PRIORITY = [
  'archetype',
  'subtype',
  'proportions',
  'details',
  'colors',
  'materials',
] as const;

/** A patch cut to `max` fields, by priority (PQ-T14: a long patch is a guess). */
export function capPatchFields(
  patch: Partial<ObjectKit>,
  max: number = CRITIC_MAX_FIELDS
): Partial<ObjectKit> {
  const keys = PATCH_PRIORITY.filter((k) => patch[k] !== undefined).slice(0, max);
  return Object.fromEntries(keys.map((k) => [k, patch[k]])) as Partial<ObjectKit>;
}

/** The `reasons` of a critic reply: one short line per changed field, at most 6 lines of 160 characters. */
export function parseKitReasons(content: string): string[] {
  try {
    const r = (JSON.parse(content) as { reasons?: unknown }).reasons;
    const lines = Array.isArray(r) ? r : r && typeof r === 'object' ? Object.values(r) : [];
    return lines
      .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
      .slice(0, 6)
      .map((l) => l.trim().slice(0, 160));
  } catch {
    return [];
  }
}

/** Partial kit: every field optional, nothing required (patches only change what they name). */
export const CRITIC_JSON_SCHEMA = {
  name: 'KitPatch',
  schema: {
    type: 'object',
    properties: {
      archetype: { type: 'string', enum: [...KIT_ARCHETYPES] },
      subtype: { type: 'string' },
      proportions: {
        type: 'object',
        properties: { w: { type: 'number' }, h: { type: 'number' }, d: { type: 'number' } },
        required: ['w', 'h', 'd'],
      },
      colors: {
        type: 'object',
        properties: { main: color, secondary: color, accent: color },
      },
      materials: {
        type: 'object',
        properties: { main: material, secondary: material, accent: material },
      },
      details: {
        type: 'object',
        properties: {
          subtype: { type: 'string' },
          windows: int,
          doors: int,
          wheels: int,
          legs: int,
          floors: int,
          chimney: { type: 'boolean' },
          units: int,
        },
      },
    },
  },
};

/** The critic schema of version 2: the patch fields plus `reasons` and `missingParts` (PQ-T52). */
export const criticJsonSchema = (version: number = CRITIC_PROMPT_VERSION) =>
  version === CRITIC_PROMPT_CARDS_VERSION
    ? {
        name: CRITIC_JSON_SCHEMA.name,
        schema: {
          ...CRITIC_JSON_SCHEMA.schema,
          properties: {
            ...CRITIC_JSON_SCHEMA.schema.properties,
            reasons: { type: 'array', items: { type: 'string' } },
            missingParts: { type: 'array', items: { type: 'string' } },
          },
        },
      }
    : version === CRITIC_ANATOMY_VERSION
      ? {
          name: CRITIC_JSON_SCHEMA.name,
          schema: {
            ...CRITIC_JSON_SCHEMA.schema,
            properties: {
              ...CRITIC_JSON_SCHEMA.schema.properties,
              missingParts: { type: 'array', items: { type: 'string' } },
            },
          },
        }
      : CRITIC_JSON_SCHEMA;

/** User turn: current kit JSON + the score numbers the patch must raise. */
export function criticQuestion(
  kit: ObjectKit,
  score: { score: number; iou: number; edgeF1: number; deltaE: number },
  version: number = CRITIC_PROMPT_VERSION
): string {
  if (version === CRITIC_PROMPT_CARDS_VERSION) {
    return (
      `Current kit: ${JSON.stringify(kit)}. ` +
      `Scores: ${score.score}/100 (silhouette IoU ${score.iou}, edge F1 ${score.edgeF1}, colour ΔE ${score.deltaE}). ` +
      `Answer the JSON patch of the kit (at most ${CRITIC_MAX_FIELDS} fields) and "reasons".`
    );
  }
  // Version 3 asks the version-1 question: the closed ids ride in the system prompt, like cards do.
  return (
    `Left is the photo of the selected object, right is our 3D model seen from the same view. ` +
    `Current kit: ${JSON.stringify(kit)}. ` +
    `Scores: ${score.score}/100 (silhouette IoU ${score.iou}, edge F1 ${score.edgeF1}, colour ΔE ${score.deltaE}). ` +
    `What differs (shape, sub-type, counts, proportions, colours of each part)? Answer only the JSON patch of the kit.`
  );
}

/** Most anatomy ids kept per critic answer (like the views check's `MAX_MISSING`). */
export const MAX_CRITIC_MISSING = 4;

/**
 * The critic's `missingParts` (PQ-T52, version 3): kept only when the id is on the family's
 * closed list (`ANATOMY`), lowercased and deduplicated; anything else is the critic guessing
 * outside the inventory and is dropped. Empty without a family. Never throws.
 */
export function parseMissingParts(content: string, archetype?: KitArchetype): string[] {
  try {
    if (!archetype) return [];
    const raw = (JSON.parse(content) as { missingParts?: unknown }).missingParts;
    if (!Array.isArray(raw)) return [];
    const ids = new Set(ANATOMY[archetype].map((s) => s.toLowerCase()));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const m of raw) {
      if (typeof m !== 'string') continue;
      const name = m.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!name || !ids.has(name) || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
      if (out.length >= MAX_CRITIC_MISSING) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Critic reply → kit patch, or null when it is not JSON or names nothing usable. Lenient like
 * `parseKit` (counts rounded and clamped, unknown values dropped), but strict where a patch must
 * be: bad colours are dropped, never greyed (grey would overwrite measured paint); `roof` is
 * always dropped (measured on the outline, never from the LLM); proportions need the full triple.
 */
export function parseKitPatch(content: string): Partial<ObjectKit> | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const patch: Partial<ObjectKit> = {};
  if (
    typeof o.archetype === 'string' &&
    (KIT_ARCHETYPES as readonly string[]).includes(o.archetype)
  ) {
    patch.archetype = o.archetype as KitArchetype;
  }
  const rawSubtype =
    typeof o.subtype === 'string'
      ? o.subtype
      : (o.details as Record<string, unknown> | undefined)?.subtype;
  if (typeof rawSubtype === 'string' && rawSubtype.trim()) {
    patch.subtype = rawSubtype
      .trim()
      .toLowerCase()
      .slice(0, 32)
      .replace(/[\s-]+/g, '_');
  }
  const pr = o.proportions as Record<string, unknown> | undefined;
  if (
    pr &&
    typeof pr.w === 'number' &&
    typeof pr.h === 'number' &&
    typeof pr.d === 'number' &&
    pr.w > 0 &&
    pr.h > 0 &&
    pr.d > 0
  ) {
    const max = Math.max(pr.w, pr.h, pr.d);
    patch.proportions = {
      w: clamp(pr.w / max, 0.01, 1),
      h: clamp(pr.h / max, 0.01, 1),
      d: clamp(pr.d / max, 0.01, 1),
    };
  }
  const co = o.colors as Record<string, unknown> | undefined;
  if (co) {
    const colors: Partial<ObjectKit['colors']> = {};
    for (const k of ['main', 'secondary', 'accent'] as const) {
      if (typeof co[k] === 'string' && HEX.test(co[k] as string)) colors[k] = co[k] as string;
    }
    if (Object.keys(colors).length > 0) patch.colors = colors as ObjectKit['colors'];
  }
  const ma = o.materials as Record<string, unknown> | undefined;
  if (ma) {
    const materials: NonNullable<ObjectKit['materials']> = {};
    for (const k of ['main', 'secondary', 'accent'] as const) {
      const m = RECIPE_MATERIALS.find((x) => x === ma[k]);
      if (m) materials[k] = m;
    }
    if (Object.keys(materials).length > 0) patch.materials = materials;
  }
  const de = o.details as Record<string, unknown> | undefined;
  if (de) {
    const details: NonNullable<ObjectKit['details']> = {};
    for (const [k, lim] of Object.entries(LIMITS) as Array<[keyof typeof LIMITS, number]>) {
      const v = de[k];
      if (typeof v === 'number' && Number.isFinite(v)) details[k] = clamp(Math.round(v), 0, lim);
    }
    if (de.chimney === true) details.chimney = true;
    if (Object.keys(details).length > 0) patch.details = details;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Patch over kit (per-key merge for the nested objects). Validated: a merged kit that fails the
 * schema keeps the original (a patch never corrupts the kit).
 */
export function mergeKitPatch(kit: ObjectKit, patch: Partial<ObjectKit>): ObjectKit {
  const merged = {
    ...kit,
    ...patch,
    ...(patch.proportions
      ? {
          proportions: clampEstimatedDepth(patch.archetype ?? kit.archetype, {
            ...kit.proportions,
            ...patch.proportions,
          }),
        }
      : {}),
    ...(patch.colors ? { colors: { ...kit.colors, ...patch.colors } } : {}),
    ...(patch.materials ? { materials: { ...kit.materials, ...patch.materials } } : {}),
    ...(patch.details ? { details: { ...kit.details, ...patch.details } } : {}),
  };
  const ok = ObjectKitSchema.safeParse(merged);
  return ok.success ? ok.data : kit;
}

/**
 * Spark reply → kit, or null when it is not JSON or misses the archetype / proportions.
 * Lenient: unknown archetype → `fallback`, proportions rescaled (largest = 1), bad colour → grey,
 * counts rounded and clamped, unknown details and materials dropped.
 */
export function parseKit(content: string, fallback: KitArchetype = 'other'): ObjectKit | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const reply = ReplySchema.safeParse(json);
  if (!reply.success) return null;
  const { w, h, d } = reply.data.proportions;
  const max = Math.max(w, h, d);
  if (!(max > 0)) return null;
  const archetype = KIT_ARCHETYPES.find((a) => a === reply.data.archetype) ?? fallback;
  const rawSubtype =
    typeof reply.data.subtype === 'string'
      ? reply.data.subtype
      : typeof reply.data.details?.subtype === 'string'
        ? reply.data.details.subtype
        : undefined;
  const subtype = rawSubtype
    ? rawSubtype
        .trim()
        .toLowerCase()
        .slice(0, 32)
        .replace(/[\s-]+/g, '_')
    : undefined;
  const pick = (k: string) => {
    const v = reply.data.colors?.[k];
    return typeof v === 'string' && HEX.test(v) ? v : NEUTRAL;
  };
  const details: NonNullable<ObjectKit['details']> = {};
  for (const [k, lim] of Object.entries(LIMITS) as Array<[keyof typeof LIMITS, number]>) {
    const v = reply.data.details?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) details[k] = clamp(Math.round(v), 0, lim);
  }
  if (reply.data.details?.chimney === true) details.chimney = true;
  if (reply.data.details?.plinth === true) details.plinth = true;
  if (reply.data.details?.timberFrame === true) details.timberFrame = true;
  const panes = reply.data.details?.panes;
  if (
    Array.isArray(panes) &&
    panes.length === 2 &&
    panes.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
    details.panes = [clamp(Math.round(panes[0]), 1, 6), clamp(Math.round(panes[1]), 1, 6)];
  const materials: NonNullable<ObjectKit['materials']> = {};
  for (const k of ['main', 'secondary', 'accent'] as const) {
    const v = reply.data.materials?.[k];
    const m = RECIPE_MATERIALS.find((x) => x === v);
    if (m) materials[k] = m;
  }
  const partMaterials: NonNullable<ObjectKit['partMaterials']> = {};
  for (const k of PART_MATERIAL_KEYS) {
    const m = RECIPE_MATERIALS.find((x) => x === reply.data.partMaterials?.[k]);
    if (m) partMaterials[k] = m;
  }
  const evidence = parseEvidence(reply.data.evidence);
  const anatomy = parseAnatomy(reply.data.anatomy);
  const kitConfidence = parseKitConfidence(reply.data.confidence);
  const kit = ObjectKitSchema.safeParse({
    ...(evidence ? { evidence } : {}),
    ...(anatomy ? { anatomy } : {}),
    ...(kitConfidence ? { confidence: kitConfidence } : {}),
    archetype,
    ...(subtype ? { subtype } : {}),
    // Spark only estimates the depth: keep it within the archetype's real size range (PT-8).
    proportions: clampEstimatedDepth(archetype, {
      w: clamp(w / max, 0.01, 1),
      h: clamp(h / max, 0.01, 1),
      d: clamp(d / max, 0.01, 1),
    }),
    colors: { main: pick('main'), secondary: pick('secondary'), accent: pick('accent') },
    ...(Object.keys(materials).length ? { materials } : {}),
    ...(Object.keys(partMaterials).length ? { partMaterials } : {}),
    ...(Object.keys(details).length ? { details } : {}),
  });
  return kit.success ? kit.data : null;
}

const body = (color: string): RecipePart => ({
  shape: 'box',
  at: [0, 0, 0],
  size: [1, 1, 1],
  color,
  front: true,
});

/** Offline recipes (mock mode), so the demo always shows a shaped object. Unknown category → a plain box. */
const MOCK_RECIPES: Partial<Record<ApplianceCategory, ObjectRecipe>> = {
  fridge: {
    proportions: { w: 0.5, h: 1, d: 0.5 },
    parts: [
      body('#e6e9ec'),
      { shape: 'box', at: [0.38, 0.12, 0.51], size: [0.04, 0.35, 0.04], color: '#8a939c' },
      { shape: 'box', at: [0, 0.18, 0.5], size: [0.98, 0.01, 0.02], color: '#b9c0c7' },
    ],
  },
  tv: {
    proportions: { w: 1, h: 0.62, d: 0.12 },
    parts: [
      { ...body('#1d2329'), at: [0, 0.08, 0], size: [1, 0.84, 0.4] },
      { shape: 'box', at: [0, -0.46, 0], size: [0.3, 0.08, 1], color: '#2b3239' },
    ],
  },
  fan: {
    proportions: { w: 0.45, h: 1, d: 0.35 },
    parts: [
      { ...body('#d8dde2'), shape: 'cylinder', axis: 'z', at: [0, 0.28, 0], size: [1, 0.45, 0.3] },
      { shape: 'cylinder', at: [0, -0.15, 0], size: [0.08, 0.45, 0.1], color: '#a7afb7' },
      { shape: 'cylinder', at: [0, -0.47, 0], size: [0.7, 0.06, 0.9], color: '#a7afb7' },
    ],
  },
  lamp: {
    proportions: { w: 0.4, h: 1, d: 0.4 },
    parts: [
      { ...body('#f2d27a'), shape: 'cone', at: [0, 0.32, 0], size: [1, 0.35, 1] },
      { shape: 'cylinder', at: [0, -0.1, 0], size: [0.08, 0.6, 0.08], color: '#6f7780' },
      { shape: 'cylinder', at: [0, -0.46, 0], size: [0.6, 0.08, 0.6], color: '#6f7780' },
    ],
  },
};

const part = (
  shape: RecipePart['shape'],
  at: RecipePart['at'],
  size: RecipePart['size'],
  color: string,
  axis?: RecipePart['axis'],
  apex?: number
): RecipePart => ({
  shape,
  at,
  size,
  color,
  ...(axis ? { axis } : {}),
  ...(apex !== undefined ? { apex } : {}),
});

/** Offline recipes for scenery (no load), so houses, trees or cars also show in 3D. */
const MOCK_SCENERY: Partial<Record<SceneryType, ObjectRecipe>> = {
  building: {
    proportions: { w: 1, h: 0.75, d: 0.8 },
    parts: [
      { ...body('#c9b79c'), at: [0, -0.15, 0], size: [1, 0.7, 1] },
      part('box', [0, 0.32, 0], [1, 0.25, 1], '#8a5a44'),
      part('box', [-0.2, -0.3, 0.5], [0.16, 0.38, 0.02], '#5b3b2a'),
      part('box', [0.22, -0.12, 0.5], [0.18, 0.16, 0.02], '#9cc3d5'),
    ],
  },
  tree: {
    proportions: { w: 0.7, h: 1, d: 0.7 },
    parts: [
      { ...body('#4f8a4b'), shape: 'sphere', at: [0, 0.18, 0], size: [1, 0.64, 1] },
      part('cylinder', [0, -0.3, 0], [0.14, 0.4, 0.14], '#6b4a32'),
    ],
  },
  plant: {
    proportions: { w: 0.6, h: 1, d: 0.6 },
    parts: [
      { ...body('#5c9b55'), shape: 'sphere', at: [0, 0.15, 0], size: [1, 0.7, 1] },
      part('cylinder', [0, -0.35, 0], [0.6, 0.3, 0.6], '#a0603d'),
    ],
  },
  vehicle: {
    proportions: { w: 1, h: 0.45, d: 0.45 },
    parts: [
      { ...body('#3f6fa8'), at: [0, -0.08, 0], size: [1.0, 0.42, 0.9] },
      part('box', [-0.04, 0.29, 0], [0.52, 0.32, 0.82], '#2f5585'),
      part('prism', [0.29, 0.29, 0], [0.14, 0.32, 0.82], '#7ea8cf', undefined, 0),
      part('prism', [-0.36, 0.29, 0], [0.12, 0.32, 0.82], '#7ea8cf', undefined, 1),
      part('box', [0.5, -0.2, 0], [0.04, 0.12, 0.88], '#222831'),
      part('box', [-0.5, -0.2, 0], [0.04, 0.12, 0.88], '#222831'),
      part('cylinder', [0.3, -0.38, 0.44], [0.24, 0.24, 0.14], '#222831', 'z'),
      part('cylinder', [0.3, -0.38, -0.44], [0.24, 0.24, 0.14], '#222831', 'z'),
      part('cylinder', [-0.3, -0.38, 0.44], [0.24, 0.24, 0.14], '#222831', 'z'),
      part('cylinder', [-0.3, -0.38, -0.44], [0.24, 0.24, 0.14], '#222831', 'z'),
      part('cylinder', [0.49, 0.02, 0.28], [0.03, 0.09, 0.09], '#f0eed8', 'x'),
      part('cylinder', [0.49, 0.02, -0.28], [0.03, 0.09, 0.09], '#f0eed8', 'x'),
    ],
  },
  person: {
    proportions: { w: 0.35, h: 1, d: 0.25 },
    parts: [
      { ...body('#4f6d8f'), shape: 'cylinder', at: [0, -0.12, 0], size: [0.8, 0.75, 0.8] },
      part('sphere', [0, 0.38, 0], [0.55, 0.22, 0.75], '#c99a73'),
    ],
  },
  animal: {
    proportions: { w: 1, h: 0.6, d: 0.4 },
    parts: [
      { ...body('#8b6b4a'), at: [0, 0.05, 0], size: [0.75, 0.45, 1] },
      part('box', [0.42, 0.28, 0], [0.22, 0.3, 0.6], '#7a5c3f'),
      part('cylinder', [-0.28, -0.32, 0], [0.1, 0.36, 0.2], '#6b4f36'),
      part('cylinder', [0.25, -0.32, 0], [0.1, 0.36, 0.2], '#6b4f36'),
    ],
  },
  water: {
    proportions: { w: 1, h: 0.08, d: 0.7 },
    parts: [{ ...body('#4c8fb8'), shape: 'cylinder' }],
  },
};

export function mockRecipe(category: ApplianceCategory, scenery?: SceneryType): ObjectRecipe {
  return (
    (scenery ? MOCK_SCENERY[scenery] : MOCK_RECIPES[category]) ?? {
      proportions: { w: 1, h: 1, d: 0.6 },
      parts: [body(NEUTRAL)],
    }
  );
}
