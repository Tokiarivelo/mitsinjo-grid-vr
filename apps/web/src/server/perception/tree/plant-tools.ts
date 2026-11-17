import { z } from 'zod';
import { teamSpecs, type SpecialistTeam } from '../team/team';
import { LEAF_TYPES, PLANT_HABITS, type LeafType, type PlantHabit } from '@/lib/plant-plan';
import { answerJson } from '../team/shared/common';
import type { PlantHints } from './plant-build';

/**
 * The plant team (PQ-T82): a pilot and part specialists that read the validated front drawing of
 * ONE plant (tree, palm, bush, grass, rosette, cactus, bamboo), on the pattern of the car team
 * (`car/car-tools.ts`). The pilot names the plant and how it grows, then each specialist reads its
 * part:
 *
 * - `trunk`: every trunk or stem from the ground, as a centre line and a width;
 * - `branches`: the limbs that show through the leaves, as centre lines;
 * - `foliage`: how the leaves are carried (clumps, curtain, skirts, a crown of big leaves, a tuft),
 *   the leaf type, and the count of big leaves (palm fronds, banana paddles, agave spikes);
 * - `flowers`: whether it flowers or fruits, and how much of the foliage it covers;
 * - `leaves`: each big leaf traced on the drawing (a frond, a paddle, a spike, a cactus pad): its
 *   midrib and width, so the 3D leaves lie where the drawn ones do.
 *
 * The models name and locate; the pixels measure (the outline, the trunk's width, every colour stay
 * `tree-fit.ts`'s). Pure: prompts, schemas, parsers, the merge into `PlantHints`.
 */

export const PLANT_TOOLS_PROMPT_VERSION = 1;

export const PLANT_TOOLS = ['trunk', 'branches', 'foliage', 'flowers', 'leaves'] as const;
export type PlantTool = (typeof PLANT_TOOLS)[number];
/** Without it after a retry the reading is not used (the label and the outline decide). */
export const PLANT_TOOLS_REQUIRED: ReadonlyArray<PlantTool> = ['foliage'];

export const FOLIAGE_ARRANGEMENTS = [
  'clumps',
  'curtain',
  'skirts',
  'crown',
  'tuft',
  'canes',
  'none',
] as const;

/** Frame every tool locates in. */
const FRAME = [
  'The image is cropped exactly to the plant: x = 0 at the left edge, 1 at the right edge; y = 0 at the top of the plant, 1 at the ground. Give every number as a share 0–1 of the image, with 2 or 3 decimals.',
  'Report only what the drawing shows. Answer with the JSON only.',
].join('\n');

const share = { type: 'number', minimum: 0, maximum: 1 } as const;
const line = {
  type: 'object',
  properties: {
    points: {
      type: 'array',
      items: { type: 'array', items: share, minItems: 2, maxItems: 2 },
      minItems: 2,
      maxItems: 8,
    },
    width: share,
  },
  required: ['points', 'width'],
} as const;

const HABIT_WORDS = [
  'round (a rounded crown of clumps on a trunk: mango, oak, lychee)',
  'spreading (a wide flat crown on spreading limbs: acacia, flamboyant, baobab)',
  'weeping (a dome with a curtain of hanging branches: weeping willow)',
  'columnar (narrow and tall: cypress, poplar)',
  'conical (stacked skirts of needles: pine, fir, araucaria)',
  'palm (big leaves round the top of a bare trunk: coconut, date palm, fan palms)',
  'fan (huge paddle leaves from a green stem: banana, traveller’s palm)',
  'shrub (leaves down to the ground, no trunk: bougainvillea, hibiscus, hedge)',
  'grass (thin blades from one tuft: grass, reed, lemongrass)',
  'rosette (thick pointed leaves from the ground: agave, aloe, sisal)',
  'cactus (green columns or pads, no leaves)',
  'bamboo (several straight canes topped with leaves)',
];
const LEAF_WORDS = [
  'broad (ordinary flat leaves)',
  'needle (pine needles)',
  'frond (a feather leaf: coconut, date palm)',
  'palmate (a fan leaf on a long stalk: fan palms, satrana, latania)',
  'blade (long strap leaves: grass, banana, agave)',
  'scale (tiny scales: cypress, thuja)',
  'none (no leaves: cactus)',
];

// ---------------------------------------------------------------- pilot

export const PLANT_PILOT_SYSTEM_PROMPT = [
  'You are the lead botanist of a 3D modelling team. You look at the front drawing of ONE plant and brief the specialists who will model it.',
  `Name the plant (its common name, and its genus when you can tell), how it grows (habit), one of: ${HABIT_WORDS.join('; ')}.`,
  `And its leaf type, one of: ${LEAF_WORDS.join('; ')}.`,
  'Specialists: trunk (every trunk or stem from the ground), branches (limbs that show through the leaves), foliage (how the leaves are carried, big leaves counted), flowers (flowers or fruit and how much of the foliage they cover), leaves (traces each big leaf one by one: fronds, paddles, spikes, cactus pads).',
  'Give each specialist a short focus note naming what it must not miss on THIS plant, with positions in plain words (e.g. "two trunks forking at a third of the height; the curtain reaches the ground on the left").',
  'Answer with the JSON only.',
].join('\n');

export const PLANT_PILOT_JSON_SCHEMA = {
  name: 'PlantBrief',
  schema: {
    type: 'object',
    properties: {
      species: { type: 'string' },
      habit: { type: 'string', enum: [...PLANT_HABITS] },
      leaf: { type: 'string', enum: [...LEAF_TYPES] },
      calls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', enum: [...PLANT_TOOLS] },
            focus: { type: 'string' },
          },
          required: ['tool'],
        },
      },
    },
    required: ['habit', 'leaf', 'calls'],
  },
} as const;

/** The pilot's brief. */
export interface PlantBrief {
  species: string | null;
  habit: PlantHabit;
  leaf: LeafType;
  /** One call per tool, every tool present. */
  calls: Array<{ tool: PlantTool; focus: string }>;
}

const BriefSchema = z.object({
  species: z.string().max(120).nullable().optional().catch(null),
  habit: z.enum(PLANT_HABITS),
  leaf: z.enum(LEAF_TYPES).catch('broad'),
  calls: z.array(z.unknown()).catch([]),
});
const CallSchema = z.object({
  tool: z.enum(PLANT_TOOLS),
  focus: z.string().optional().catch(undefined),
});

/** The pilot's answer as a brief; null when it is not JSON or names no habit. */
export function parsePlantBrief(content: string): PlantBrief | null {
  const raw = BriefSchema.safeParse(answerJson(content));
  if (!raw.success) return null;
  const notes = new Map<PlantTool, string[]>();
  for (const c of raw.data.calls) {
    const call = CallSchema.safeParse(c);
    if (!call.success) continue;
    const list = notes.get(call.data.tool) ?? [];
    if (call.data.focus?.trim()) list.push(call.data.focus.trim());
    notes.set(call.data.tool, list);
  }
  return {
    species: raw.data.species?.trim() || null,
    habit: raw.data.habit,
    leaf: raw.data.leaf,
    calls: PLANT_TOOLS.map((tool) => ({ tool, focus: (notes.get(tool) ?? []).join(' ') })),
  };
}

// ---------------------------------------------------------------- specialists

export interface PlantToolSpec {
  system: string;
  schema: { name: string; schema: object };
  /** The one-line task closing the question. */
  task: string;
  /** The key its answer must hold to count as one. */
  key: 'trunks' | 'branches' | 'foliage' | 'flowers' | 'leaves';
}

export const PLANT_TOOL_SPECS: Readonly<Record<PlantTool, PlantToolSpec>> = {
  trunk: {
    system: [
      'You are the trunk specialist of a 3D modelling team. You trace the trunks of ONE plant on its front drawing.',
      'Give every trunk or stem that rises from the ground (a clump of bamboo or banana has several; most trees have one; a shrub or a grass may have none): its centre line from the ground up to where it disappears into the leaves or ends, 2 to 8 points, ground first; and its width at the ground.',
      'Follow a lean or a curve with the points; a fork is the trunk up to the fork, its arms are branches (not yours).',
      FRAME,
    ].join('\n'),
    schema: {
      name: 'PlantTrunks',
      schema: {
        type: 'object',
        properties: { trunks: { type: 'array', items: line, maxItems: 12 } },
        required: ['trunks'],
      },
    },
    task: 'Trace every trunk from the ground.',
    key: 'trunks',
  },
  branches: {
    system: [
      'You are the branch specialist of a 3D modelling team. You trace the limbs of ONE plant on its front drawing.',
      'Give every limb that SHOWS (bare wood between the leaves, or the clear line of a limb under them): its centre line from where it leaves the trunk or a larger limb out to where it disappears, 2 to 8 points, base first, and its width at its base. Up to 16 limbs, the largest first.',
      'Not the trunk itself, not twigs thinner than a hundredth of the image, not palm leaf stalks.',
      FRAME,
    ].join('\n'),
    schema: {
      name: 'PlantBranches',
      schema: {
        type: 'object',
        properties: { branches: { type: 'array', items: line, maxItems: 16 } },
        required: ['branches'],
      },
    },
    task: 'Trace the limbs that show.',
    key: 'branches',
  },
  foliage: {
    system: [
      'You are the foliage specialist of a 3D modelling team. You read how ONE plant carries its leaves on its front drawing.',
      `Habit, one of: ${HABIT_WORDS.join('; ')}.`,
      `Leaf type, one of: ${LEAF_WORDS.join('; ')}.`,
      `Arrangement, one of: ${FOLIAGE_ARRANGEMENTS.join(', ')} (clumps = leafy masses; curtain = hanging strands; skirts = stacked conifer tiers; crown = big single leaves round one top; tuft = blades from one base; canes = leaves along straight canes; none = no leaves).`,
      'bigLeaves: when the leaves are big enough to count one by one (palm fronds or fans, banana paddles, agave spikes), how many you see; else 0.',
      'drape: the lowest point the hanging foliage reaches, as a y share (only for a curtain; else omit).',
      FRAME,
    ].join('\n'),
    schema: {
      name: 'PlantFoliage',
      schema: {
        type: 'object',
        properties: {
          foliage: {
            type: 'object',
            properties: {
              habit: { type: 'string', enum: [...PLANT_HABITS] },
              leaf: { type: 'string', enum: [...LEAF_TYPES] },
              arrangement: { type: 'string', enum: [...FOLIAGE_ARRANGEMENTS] },
              bigLeaves: { type: 'integer', minimum: 0, maximum: 64 },
              drape: share,
            },
            required: ['habit', 'leaf', 'arrangement'],
          },
        },
        required: ['foliage'],
      },
    },
    task: 'Say how the leaves are carried.',
    key: 'foliage',
  },
  flowers: {
    system: [
      'You are the flower specialist of a 3D modelling team. You look for flowers and fruit on ONE plant on its front drawing.',
      'Say whether it shows flowers, whether it shows fruit, and what share of the foliage they cover together (0 = none, 0.6 = nearly all of it, a tree in full bloom).',
      'Coconuts, mangoes or bananas hanging under the leaves are fruit. Dry or dead leaves are neither.',
      'Answer with the JSON only.',
    ].join('\n'),
    schema: {
      name: 'PlantFlowers',
      schema: {
        type: 'object',
        properties: {
          flowers: {
            type: 'object',
            properties: {
              flowers: { type: 'boolean' },
              fruit: { type: 'boolean' },
              share: { type: 'number', minimum: 0, maximum: 0.6 },
            },
            required: ['flowers', 'fruit', 'share'],
          },
        },
        required: ['flowers'],
      },
    },
    task: 'Say whether it flowers or fruits, and how much.',
    key: 'flowers',
  },
  leaves: {
    system: [
      'You are the leaf specialist of a 3D modelling team. You trace the big leaves of ONE plant on its front drawing, one by one.',
      'Big leaves are the ones you can follow alone: palm fronds or fans, banana paddles, agave or aloe spikes, long grass blades, the flat pads of a prickly pear. Trace each one you see, up to 40, the most visible first: its midrib from where it leaves the stem, the trunk top or the ground, out to its tip, 2 to 6 points, base first, following its curve (a frond arching over and down, a spike rising then bending out); and its widest width.',
      "A fan leaf: its stalk from the trunk to the fan's centre, width = the fan's diameter. A pad: from where it sits on the pad below to its far edge, width = its width across.",
      'A plant of small leaves (a tree crown, a conifer, a hedge) has none to trace: answer {"leaves": []}.',
      FRAME,
    ].join('\n'),
    schema: {
      name: 'PlantLeaves',
      schema: {
        type: 'object',
        properties: { leaves: { type: 'array', items: line, maxItems: 40 } },
        required: ['leaves'],
      },
    },
    task: 'Trace every big leaf, base to tip.',
    key: 'leaves',
  },
};

export const plantPilotQuestion = (label: string) =>
  `Plant: ${label}. The image is its front drawing. Brief the specialists.`;

/** A specialist's question: the plant, the pilot's naming, its own focus note. */
export function plantToolQuestion(
  tool: PlantTool,
  label: string,
  brief: PlantBrief | null
): string {
  const focus = brief?.calls.find((c) => c.tool === tool)?.focus;
  return [
    `Plant: ${label}${brief ? ` (${brief.species ? `${brief.species}, ` : ''}${brief.habit}, ${brief.leaf} leaves)` : ''}. The image is its front drawing.`,
    focus ? `Lead botanist's note for you: ${focus}` : '',
    PLANT_TOOL_SPECS[tool].task,
  ]
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------- reading

const Share = z.number().min(0).max(1);
const opt = <T extends z.ZodTypeAny>(t: T) => t.optional().catch(undefined);
export const PlantLineSchema = z.object({
  points: z
    .array(z.tuple([Share, Share]))
    .min(2)
    .max(8),
  width: Share,
});
export type PlantLine = z.infer<typeof PlantLineSchema>;
export const PlantFoliageSchema = z.object({
  habit: z.enum(PLANT_HABITS),
  leaf: z.enum(LEAF_TYPES).catch('broad'),
  arrangement: z.enum(FOLIAGE_ARRANGEMENTS).catch('clumps'),
  bigLeaves: opt(z.number().int().min(0).max(64)),
  drape: opt(Share),
});
export const PlantFlowersSchema = z.object({
  flowers: z.boolean(),
  fruit: z.boolean().catch(false),
  share: z.number().min(0).max(0.6).catch(0),
});

/** What the plant team read on the drawing (saved by `onPlantReading`, replayable). */
export const PlantReadingSchema = z.object({
  species: z.string().optional(),
  habit: z.enum(PLANT_HABITS).optional(),
  leaf: z.enum(LEAF_TYPES).optional(),
  trunks: z.array(PlantLineSchema),
  branches: z.array(PlantLineSchema),
  foliage: PlantFoliageSchema.optional(),
  flowers: PlantFlowersSchema.optional(),
  /** The big leaves traced one by one (the leaf specialist), base first. */
  leaves: z.array(PlantLineSchema).optional(),
});
export type PlantReading = z.infer<typeof PlantReadingSchema>;

/** Items of a list that parse, the others dropped (one bad limb never loses the rest). */
const items = <T extends z.ZodTypeAny>(schema: T, list: unknown): Array<z.infer<T>> =>
  Array.isArray(list)
    ? list.flatMap((x) => {
        const r = schema.safeParse(x);
        return r.success ? [r.data] : [];
      })
    : [];

/** The answer of one tool as JSON with its key; null when it has none. */
function answerOf(
  tool: PlantTool,
  content: string | null | undefined
): Record<string, unknown> | null {
  if (!content) return null;
  const json = answerJson(content);
  if (!json || typeof json !== 'object') return null;
  return PLANT_TOOL_SPECS[tool].key in json ? (json as Record<string, unknown>) : null;
}

/** Whether a tool answered: its key present and of the right shape. */
export function plantToolAnswered(tool: PlantTool, content: string | null | undefined): boolean {
  const json = answerOf(tool, content);
  if (!json) return false;
  const key = PLANT_TOOL_SPECS[tool].key;
  if (tool === 'foliage') return PlantFoliageSchema.safeParse(json[key]).success;
  if (tool === 'flowers') return PlantFlowersSchema.safeParse(json[key]).success;
  return Array.isArray(json[key]);
}

/**
 * The team's answers merged into one reading; null without a usable foliage answer. The foliage
 * specialist names the habit and the leaf over the pilot (it looked at nothing else).
 */
export function mergePlantAnswers(
  answers: Partial<Record<PlantTool, string | null>>,
  brief: PlantBrief | null
): PlantReading | null {
  const foliage = PlantFoliageSchema.safeParse(answerOf('foliage', answers.foliage)?.foliage);
  if (!foliage.success) return null;
  const flowers = PlantFlowersSchema.safeParse(answerOf('flowers', answers.flowers)?.flowers);
  const leaves = items(PlantLineSchema, answerOf('leaves', answers.leaves)?.leaves).slice(0, 40);
  return {
    ...(brief?.species ? { species: brief.species } : {}),
    habit: foliage.data.habit,
    leaf: foliage.data.leaf,
    trunks: items(PlantLineSchema, answerOf('trunk', answers.trunk)?.trunks),
    branches: items(PlantLineSchema, answerOf('branches', answers.branches)?.branches),
    foliage: foliage.data,
    ...(flowers.success ? { flowers: flowers.data } : {}),
    ...(leaves.length ? { leaves } : {}),
  };
}

/** Limbs thinner than this (share of the image width) are twigs: not modelled. */
const LIMB_MIN_WIDTH = 0.008;

/** A reading → the hints the plant builder takes (`buildPlant`). */
export function plantHints(reading: PlantReading | null): PlantHints {
  if (!reading) return {};
  const habit = reading.foliage?.habit ?? reading.habit;
  const leaf = reading.foliage?.leaf ?? reading.leaf;
  const branches = reading.branches.filter((b) => b.width >= LIMB_MIN_WIDTH);
  const flowers = reading.flowers;
  return {
    ...(reading.species ? { species: reading.species } : {}),
    ...(habit ? { habit } : {}),
    ...(leaf ? { leaf } : {}),
    ...(branches.length ? { branches } : {}),
    ...(reading.trunks.length ? { trunks: reading.trunks } : {}),
    ...(reading.foliage?.bigLeaves ? { leafCount: reading.foliage.bigLeaves } : {}),
    ...(reading.leaves?.length ? { traces: reading.leaves } : {}),
    ...(flowers ? { bloom: flowers.flowers || flowers.fruit ? flowers.share : 0 } : {}),
  };
}

// ---------------------------------------------------------------- team

/** Longest wait for one call: one drawing, shorter answers than a car's. */
export const PLANT_TOOL_TIMEOUT_MS = 5 * 60_000;

/** The plant team as a `SpecialistTeam` (PQ-T84): run by `runTeam`, one front drawing. */
export const PLANT_TEAM: SpecialistTeam<PlantTool, PlantBrief, PlantReading, 'front'> = {
  id: 'plant',
  promptVersion: PLANT_TOOLS_PROMPT_VERSION,
  tools: PLANT_TOOLS,
  required: PLANT_TOOLS_REQUIRED,
  timeoutMs: PLANT_TOOL_TIMEOUT_MS,
  pilot: {
    system: PLANT_PILOT_SYSTEM_PROMPT,
    schema: PLANT_PILOT_JSON_SCHEMA,
    question: (label) => plantPilotQuestion(label),
    parse: parsePlantBrief,
  },
  specs: teamSpecs(
    PLANT_TOOLS,
    (t) => PLANT_TOOL_SPECS[t],
    (t, label, _views, brief) => plantToolQuestion(t, label, brief)
  ),
  answered: plantToolAnswered,
  merge: mergePlantAnswers,
  briefSummary: (b) => `${b.species ?? 'unnamed'}, ${b.habit}, ${b.leaf} leaves`,
  summary: (r) =>
    `${r.habit}, ${r.leaf} leaves, ${r.foliage?.arrangement}, ${r.trunks.length} trunks, ${r.branches.length} limbs, ${r.foliage?.bigLeaves ?? 0} big leaves, ${r.flowers ? `flowers ${r.flowers.flowers} fruit ${r.flowers.fruit} ${r.flowers.share}` : 'no flower answer'}`,
};
