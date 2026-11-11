import { z } from 'zod';
import type { KitArchetype } from '@/lib/object-kit';
import { FACADE_REFERENCE_LINE, KIT_PROMPT_CARDS_VERSION, KIT_PROMPT_VERSION } from './shape';
import { skillFor } from './skills';
import {
  MAX_RECIPE_PARTS,
  ObjectRecipeSchema,
  RECIPE_MATERIALS,
  RecipePartSchema,
  type ObjectRecipe,
} from '@/lib/object-shape';

/** Prompt version of the free part-list. Bumped whenever the wording changes. */
export const FREE_PARTS_PROMPT_VERSION = 'v1';

/**
 * Archetypes whose kits are crude placeholders (box/stick-figure guesses): the
 * LLM imagines a real part list for them instead of reusing the placeholder.
 * Archetypes with a real template are never routed here.
 */
const FREE_PARTS_ARCHETYPES: ReadonlySet<KitArchetype> = new Set([
  'other',
  'water',
  'person',
  'animal',
  'bush',
]);

export function needsFreeParts(archetype: KitArchetype): boolean {
  return FREE_PARTS_ARCHETYPES.has(archetype);
}

/**
 * What the box may show: the whole object or one cut off at the photo edges.
 * The LLM must always imagine the WHOLE object — the visibility line only
 * tells it which sides to measure and which to invent.
 */
export type BoxVisibility =
  { kind: 'whole' } | { kind: 'cut'; edges: Array<'left' | 'right' | 'top' | 'bottom'> };

/** A box edge this close to the photo border counts as cut off. */
const CUT_EDGE_EPS = 0.02;

/**
 * Which photo edges cut the object box (`cut off at the left and bottom`),
 * or undefined when the box shows the object whole. Needs the photo size;
 * without a photo there is nothing honest to say, so whole is assumed.
 */
export function coverageForBox(
  box: { x: number; y: number; w: number; h: number },
  photo: { width: number; height: number } | null
): string | undefined {
  if (!photo || photo.width <= 0 || photo.height <= 0) return undefined;
  const edges: Array<'left' | 'right' | 'top' | 'bottom'> = [];
  if (box.x <= CUT_EDGE_EPS) edges.push('left');
  if (box.x + box.w >= 1 - CUT_EDGE_EPS) edges.push('right');
  if (box.y <= CUT_EDGE_EPS) edges.push('top');
  if (box.y + box.h >= 1 - CUT_EDGE_EPS) edges.push('bottom');
  if (edges.length === 0) return undefined;
  return `cut off at the ${edgeList(edges)}`;
}

/** `left`, `left and bottom`, `left, right, top and bottom`. */
function edgeList(edges: ReadonlyArray<string>): string {
  return edges.join(', ').replace(/, ([^,]*)$/, ' and $1');
}

/** Parse the coverage accepted by `describeParts` into a BoxVisibility. */
export function visibilityFromCoverage(coverage: string | undefined): BoxVisibility {
  const match = coverage?.match(/cut off at the ([a-z, ]+)/i);
  const raw = match?.[1];
  if (!raw) return { kind: 'whole' };
  const edges = raw
    .split(/,| and /)
    .map((e) => e.trim().toLowerCase())
    .filter(
      (e): e is 'left' | 'right' | 'top' | 'bottom' =>
        e === 'left' || e === 'right' || e === 'top' || e === 'bottom'
    );
  if (edges.length === 0) return { kind: 'whole' };
  return { kind: 'cut', edges };
}

function visibilityLine(visibility: BoxVisibility): string {
  if (visibility.kind === 'whole') {
    return 'The box shows the whole object. Model the WHOLE object as seen.';
  }
  return (
    `The object is cut off at the ${edgeList(visibility.edges)} of the photo: only part of it is visible in the box. ` +
    'Model the WHOLE object anyway: measure what you see, and imagine (guess from the object type) the size, position and colour of every part the photo hides.'
  );
}

/** Shapes the LLM may use: plain solids only, never extrude/lathe (those need point lists the server builds). */
const FREE_PART_SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'prism'] as const;

export const PARTS_SYSTEM_PROMPT = [
  'You describe ONE object seen on a photo crop as a short list of solid parts so a 3D editor can build it.',
  'IMAGINE the complete object even if partially hidden, occluded, cropped, or seen from only one angle: reconstruct the unseen sides, symmetric features and depth with strong 3D imagination.',
  'proportions = real width, height, depth of the object, largest = 1 (relative sizes, never meters).',
  `Each part: a plain solid, shape one of: ${FREE_PART_SHAPES.join(', ')}.`,
  'at = centre of the part in object units (object centre is 0, faces at -0.5 and +0.5); size = its width/height/depth as fractions of the full object (0..1); a part may stick out a little (handles, feet).',
  'color = #rrggbb as seen or inferred.',
  `material = what the part is made of, one of: ${RECIPE_MATERIALS.join(', ')}.`,
  'front = true on the single main body part.',
  `Answer with at most ${MAX_RECIPE_PARTS} parts covering the whole object. Never give watts, kW or any energy value.`,
].join(' ');

/**
 * System prompt of the free-parts call (PQ-T12): the first prompt, or from kit prompt version 2 the Muse cards
 * Base + Look + Free parts, so both calls look first with the same words.
 */
export function partsPrompt(version: number = KIT_PROMPT_VERSION): string {
  return version === KIT_PROMPT_CARDS_VERSION ? skillFor('free').text : PARTS_SYSTEM_PROMPT;
}

/** User turn; the label is the detection name, quoted. The crop is the image. */
export function shapePartsQuestion(
  label: string,
  archetype: KitArchetype,
  visibility: BoxVisibility,
  withFacade = false
): string {
  const name = label.slice(0, 40).replace(/"/g, "'");
  const facade = withFacade ? ` ${FACADE_REFERENCE_LINE}` : '';
  return `List the solid parts of the full "${name}" (${archetype}) in the clear rectangle in the middle of this crop. ${visibilityLine(visibility)}${facade}`;
}

const number = { type: 'number' };
const vector3 = { type: 'array', items: number, minItems: 3, maxItems: 3 };

export const PARTS_JSON_SCHEMA = {
  name: 'ObjectParts',
  schema: {
    type: 'object',
    properties: {
      proportions: {
        type: 'object',
        properties: { w: number, h: number, d: number },
        required: ['w', 'h', 'd'],
      },
      parts: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_RECIPE_PARTS,
        items: {
          type: 'object',
          properties: {
            shape: { type: 'string', enum: [...FREE_PART_SHAPES] },
            at: vector3,
            size: vector3,
            axis: { type: 'string', enum: ['x', 'y', 'z'] },
            apex: number,
            color: { type: 'string' },
            material: { type: 'string', enum: [...RECIPE_MATERIALS] },
            front: { type: 'boolean' },
          },
          required: ['shape', 'at', 'size', 'color'],
        },
      },
    },
    required: ['proportions', 'parts'],
  },
};

const FreePartsResponseSchema = z.object({
  // Loose on purpose: Spark sometimes answers meters (a person h = 1.82); ratios still
  // normalise correctly below. The strict recipe schema validates the final result.
  proportions: z.object({
    w: z.number().finite().positive(),
    h: z.number().finite().positive(),
    d: z.number().finite().positive(),
  }),
  parts: z.array(RecipePartSchema).min(1).max(MAX_RECIPE_PARTS),
});

/** Parse + normalise one free part-list answer. Returns null when unusable. */
export function parseFreeParts(text: string): ObjectRecipe | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      raw = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  const parsed = FreePartsResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { w, h, d } = parsed.data.proportions;
  const max = Math.max(w, h, d);
  if (!Number.isFinite(max) || max <= 0) return null;
  const recipe = {
    proportions: {
      w: Math.max(0.01, w / max),
      h: Math.max(0.01, h / max),
      d: Math.max(0.01, d / max),
    },
    parts: parsed.data.parts,
    source: 'free' as const,
  };
  return ObjectRecipeSchema.safeParse(recipe).success ? recipe : null;
}

/**
 * What the orchestrator receives: the LLM part list, or the kit fallback
 * when the LLM call fails, is refused, or answers garbage.
 */
export type FreePartsOutcome =
  | { ok: true; recipe: ObjectRecipe }
  | { ok: false; reason: 'skipped' | 'empty' | 'refused' | 'bad-json' | 'failed' };

export function toFreePartsOutcome(
  recipe: ObjectRecipe | null,
  refused: boolean
): FreePartsOutcome {
  if (recipe) return { ok: true, recipe };
  return { ok: false, reason: refused ? 'refused' : 'bad-json' };
}
