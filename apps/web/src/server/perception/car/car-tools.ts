import { z } from 'zod';
import { CAR_KINDS, type CarKind } from '@/lib/car-plan';
import { answerJson } from '../house/house-tools';

/**
 * The car team (PQ-T76): a pilot and part specialists that read the validated drawings of ONE car,
 * on the pattern of the house team (`house/house-tools.ts`) but with their own prompts, schemas
 * and merge. The pilot says what kind of car it is and which parts it has, then each specialist
 * reads its part:
 *
 * - `body`: the profile's stations (nose, windscreen base and top, roof end, tail) and heights
 *   (bonnet, belt line, roof, tail) on the side drawing; the roof and shoulder widths on the front;
 *   the cargo bed or the canopy of a pick-up;
 * - `glazing`: every window as a polygon on the drawing it is on (windscreen, rear, side, quarter);
 * - `lights`: lamps, grille, bumpers, plates, mirrors, steps, as boxes with their colour;
 * - `finishes`: the paint (and a second paint of a two-tone car), trims, glass, with a clean
 *   sample box each.
 *
 * Wheels are not asked: they are measured on the pixels (`car-wheels.ts`). Pure: prompts, schemas,
 * parsers, the merge.
 */

export const CAR_TOOLS_PROMPT_VERSION = 1;

export const CAR_TOOLS = ['body', 'glazing', 'lights', 'finishes'] as const;
export type CarTool = (typeof CAR_TOOLS)[number];
/** Every car needs all four; the pilot only adds notes. */
export const CAR_TOOLS_ALWAYS: ReadonlyArray<CarTool> = CAR_TOOLS;
/** Without these after a retry the reading is not used (the measured plan stays). */
export const CAR_TOOLS_REQUIRED: ReadonlyArray<CarTool> = ['body', 'glazing'];

export type CarView = 'front' | 'right' | 'back' | 'left' | 'top';
const CAR_VIEWS = ['front', 'right', 'back', 'left', 'top'] as const;

export const CAR_PARTS = [
  'twoTone',
  'roofRack',
  'spareWheel',
  'cargoBed',
  'canopy',
  'sunroof',
  'bullBar',
  'chromeTrim',
  'sideSteps',
] as const;
export type CarPart = (typeof CAR_PARTS)[number];

export const CAR_WINDOWS = ['windscreen', 'rear', 'side', 'quarter', 'sunroof'] as const;
export const CAR_DETAILS = [
  'headlight',
  'taillight',
  'indicator',
  'foglight',
  'grille',
  'bumper',
  'plate',
  'mirror',
  'badge',
  'step',
  'handle',
] as const;
export const CAR_FINISHES = [
  'paint',
  'paint2',
  'trim',
  'bumper',
  'grille',
  'glass',
  'canopy',
] as const;
export const CAR_MATERIALS = [
  'metal',
  'chrome',
  'plastic',
  'glass',
  'rubber',
  'fabric',
  'wood',
] as const;

/** Frame every tool measures in. */
const FRAME = [
  'Every image is cropped exactly to the car: x = 0 at the left edge of the image, 1 at the right edge; y = 0 at the top of the car (roof, rack or canopy), 1 at the ground. Give every number as a share 0–1 of the image, with 2 or 3 decimals.',
  'On the RIGHT side image the FRONT of the car is at the LEFT edge; on the LEFT side image it is at the RIGHT edge.',
  'Report only what the drawings show. Answer with the JSON only.',
].join('\n');

const share = { type: 'number', minimum: 0, maximum: 1 } as const;
const box = { type: 'array', items: share, minItems: 4, maxItems: 4 } as const;
const hex = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } as const;
const view = { type: 'string', enum: [...CAR_VIEWS] } as const;

// ---------------------------------------------------------------- pilot

export const CAR_PILOT_SYSTEM_PROMPT = [
  'You are the lead designer of a 3D modelling team. You look at the orthographic drawings of ONE car or road vehicle and brief the specialists who will model it.',
  `Say what kind of vehicle it is (${CAR_KINDS.join(', ')}), how many doors, which parts it has, and give each specialist a short focus note.`,
  'Specialists: body (the side profile: nose, bonnet, windscreen, roof, tail, belt line; a pick-up bed or canopy), glazing (every window and its shape), lights (lamps, grille, bumpers, plates, mirrors, steps), finishes (paint, second paint of a two-tone car, chrome or black trims, glass tint).',
  'A focus note names what this specialist must not miss on THIS car, with positions in plain words (e.g. "two-tone: dark green roof over a mint body; chrome strip along the flank; wraparound rear window").',
  'Answer with the JSON only.',
].join('\n');

export const CAR_PILOT_JSON_SCHEMA = {
  name: 'CarBrief',
  schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...CAR_KINDS] },
      doors: { type: 'integer', minimum: 1, maximum: 6 },
      parts: {
        type: 'object',
        properties: Object.fromEntries(CAR_PARTS.map((p) => [p, { type: 'boolean' }])),
      },
      calls: {
        type: 'array',
        items: {
          type: 'object',
          properties: { tool: { type: 'string', enum: [...CAR_TOOLS] }, focus: { type: 'string' } },
          required: ['tool'],
        },
      },
    },
    required: ['kind', 'calls'],
  },
} as const;

/** The pilot's brief. */
export interface CarBrief {
  kind: CarKind;
  doors: number | null;
  parts: Partial<Record<CarPart, boolean>>;
  /** One call per tool, every tool present (a car needs all four). */
  calls: Array<{ tool: CarTool; focus: string }>;
}

const BriefSchema = z.object({
  kind: z.enum(CAR_KINDS).catch('other'),
  doors: z.number().int().min(1).max(6).nullable().optional().catch(null),
  parts: z.record(z.string(), z.unknown()).optional().catch(undefined),
  calls: z.array(z.unknown()).catch([]),
});
const CallSchema = z.object({
  tool: z.enum(CAR_TOOLS),
  focus: z.string().optional().catch(undefined),
});

/** The pilot's answer as a brief; null only when it is not JSON at all. */
export function parseCarBrief(content: string): CarBrief | null {
  const raw = BriefSchema.safeParse(answerJson(content));
  if (!raw.success) return null;
  const parts: CarBrief['parts'] = {};
  for (const p of CAR_PARTS) if (raw.data.parts?.[p] === true) parts[p] = true;
  const notes = new Map<CarTool, string[]>();
  for (const c of raw.data.calls) {
    const call = CallSchema.safeParse(c);
    if (!call.success) continue;
    const list = notes.get(call.data.tool) ?? [];
    if (call.data.focus?.trim()) list.push(call.data.focus.trim());
    notes.set(call.data.tool, list);
  }
  return {
    kind: raw.data.kind,
    doors: raw.data.doors ?? null,
    parts,
    calls: CAR_TOOLS_ALWAYS.map((tool) => ({ tool, focus: (notes.get(tool) ?? []).join(' ') })),
  };
}

// ---------------------------------------------------------------- specialists

export interface CarToolSpec {
  system: string;
  schema: { name: string; schema: object };
  /** The one-line task closing the question. */
  task: string;
  /** The list (or object) its answer must hold to count as one. */
  key: 'body' | 'windows' | 'details' | 'finishes';
}

export const CAR_TOOL_SPECS: Readonly<Record<CarTool, CarToolSpec>> = {
  body: {
    system: [
      'You are the body specialist of a 3D modelling team. You read the shape of ONE car on its orthographic drawings.',
      'On the SIDE image (the right side when given), give the stations along the car as x shares: nose (frontmost point of the bumper), cowl (base of the windscreen), roofFront (top of the windscreen), roofRear (where the roof ends at the back), tail (top rear corner of the boot or tailgate), rear (rearmost point).',
      'And the heights as y shares on the same image: bonnet (top of the bonnet near the windscreen), belt (the sill line under the side windows), roof (top of the roof itself, not a rack), tail (top of the boot or tailgate), sill (bottom of the body between the wheels).',
      'On the FRONT image give roofWidth (width of the roof) and shoulderWidth (widest body below the windows, mirrors excluded) as shares of the image width.',
      'For a pick-up or a van with a cargo bed or a canopy, give bed: { x0, x1 } along the side image and its top y, and whether it is open (a bed) or closed (a canopy).',
      FRAME,
    ].join('\n'),
    schema: {
      name: 'CarBody',
      schema: {
        type: 'object',
        properties: {
          body: {
            type: 'object',
            properties: {
              view: view,
              stations: {
                type: 'object',
                properties: Object.fromEntries(
                  ['nose', 'cowl', 'roofFront', 'roofRear', 'tail', 'rear'].map((k) => [k, share])
                ),
              },
              heights: {
                type: 'object',
                properties: Object.fromEntries(
                  ['bonnet', 'belt', 'roof', 'tail', 'sill'].map((k) => [k, share])
                ),
              },
              roofWidth: share,
              shoulderWidth: share,
              bed: {
                type: 'object',
                properties: { x0: share, x1: share, top: share, closed: { type: 'boolean' } },
              },
            },
            required: ['stations', 'heights'],
          },
        },
        required: ['body'],
      },
    },
    task: 'Read the body: stations, heights, widths, and the bed if any.',
    key: 'body',
  },
  glazing: {
    system: [
      'You are the glazing specialist of a 3D modelling team. You find every window of ONE car on its orthographic drawings.',
      'For each window give the image it is on, its kind (windscreen on the front, rear on the back, side for door windows, quarter for small fixed windows behind them, sunroof on the view from above) and its outline as 3 to 8 points [x, y] in order round it.',
      'Give every side window separately (front door, rear door, quarter), on each side image.',
      FRAME,
    ].join('\n'),
    schema: {
      name: 'CarGlazing',
      schema: {
        type: 'object',
        properties: {
          windows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                view,
                kind: { type: 'string', enum: [...CAR_WINDOWS] },
                points: {
                  type: 'array',
                  items: { type: 'array', items: share, minItems: 2, maxItems: 2 },
                  minItems: 3,
                  maxItems: 8,
                },
              },
              required: ['view', 'kind', 'points'],
            },
          },
        },
        required: ['windows'],
      },
    },
    task: 'List every window with its outline.',
    key: 'windows',
  },
  lights: {
    system: [
      'You are the details specialist of a 3D modelling team. You find the small parts of ONE car on its orthographic drawings.',
      `For each part give the image it is on, its kind (${CAR_DETAILS.join(', ')}), its box [x0, y0, x1, y1] and its colour as #rrggbb as drawn.`,
      'Give each lamp separately (left and right headlights are two parts). Bumpers span the width of the front or back image.',
      FRAME,
    ].join('\n'),
    schema: {
      name: 'CarDetails',
      schema: {
        type: 'object',
        properties: {
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                view,
                kind: { type: 'string', enum: [...CAR_DETAILS] },
                box,
                color: hex,
              },
              required: ['view', 'kind', 'box'],
            },
          },
        },
        required: ['details'],
      },
    },
    task: 'List the lamps, grille, bumpers, plates, mirrors and other details.',
    key: 'details',
  },
  finishes: {
    system: [
      'You are the finishes specialist of a 3D modelling team. You name the materials and colours of ONE car on its orthographic drawings.',
      `For each finish (${CAR_FINISHES.join(', ')}) the car has, give its material (${CAR_MATERIALS.join(', ')}), its colour #rrggbb as drawn (the flat colour, not a reflection or a highlight) and a sample box [x0, y0, x1, y1] on one image where only that finish shows.`,
      'paint = the main body colour; paint2 = the second colour of a two-tone car (roof, lower body); trim = strips and frames (chrome or black).',
      FRAME,
    ].join('\n'),
    schema: {
      name: 'CarFinishes',
      schema: {
        type: 'object',
        properties: {
          finishes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                finish: { type: 'string', enum: [...CAR_FINISHES] },
                material: { type: 'string', enum: [...CAR_MATERIALS] },
                color: hex,
                view,
                box,
              },
              required: ['finish', 'color'],
            },
          },
        },
        required: ['finishes'],
      },
    },
    task: 'Name each finish, its colour and where to sample it.',
    key: 'finishes',
  },
};

/** Which image is which, as every call says it. */
export function carImageNames(order: ReadonlyArray<CarView>): string {
  return order
    .map((v, i) => {
      const what =
        v === 'top'
          ? 'the VIEW FROM ABOVE (the front of the car at the bottom of the image)'
          : v === 'front'
            ? 'the FRONT view'
            : v === 'right'
              ? 'the RIGHT side (the front of the car at its LEFT edge)'
              : v === 'left'
                ? 'the LEFT side (the front of the car at its RIGHT edge)'
                : 'the BACK view';
      return `image ${i + 1} = ${what}`;
    })
    .join('; ');
}

export const carPilotQuestion = (label: string, order: ReadonlyArray<CarView>) =>
  `Vehicle: ${label}. ${carImageNames(order)}. Brief the specialists.`;

/** A specialist's question: the images, the brief's kind and parts, its own focus note. */
export function carToolQuestion(
  tool: CarTool,
  label: string,
  order: ReadonlyArray<CarView>,
  brief: CarBrief | null
): string {
  const seen = brief
    ? CAR_PARTS.filter((p) => brief.parts[p]).map((p) =>
        p.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)
      )
    : [];
  const focus = brief?.calls.find((c) => c.tool === tool)?.focus;
  return [
    `Vehicle: ${label}${brief ? ` (${brief.kind}${brief.doors ? `, ${brief.doors} doors` : ''})` : ''}. ${carImageNames(order)}.`,
    seen.length ? `The lead designer saw: ${seen.join(', ')}.` : '',
    focus ? `Lead designer's note for you: ${focus}` : '',
    CAR_TOOL_SPECS[tool].task,
  ]
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------- reading

const Share = z.number().min(0).max(1);
const Box = z.tuple([Share, Share, Share, Share]);
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const View = z.enum(CAR_VIEWS);
const opt = <T extends z.ZodTypeAny>(t: T) => t.optional().catch(undefined);

const StationsSchema = z.object({
  nose: opt(Share),
  cowl: opt(Share),
  roofFront: opt(Share),
  roofRear: opt(Share),
  tail: opt(Share),
  rear: opt(Share),
});
const HeightsSchema = z.object({
  bonnet: opt(Share),
  belt: opt(Share),
  roof: opt(Share),
  tail: opt(Share),
  sill: opt(Share),
});
export const CarBodyReadingSchema = z.object({
  view: View.catch('right'),
  stations: StationsSchema.catch({}),
  heights: HeightsSchema.catch({}),
  roofWidth: opt(Share),
  shoulderWidth: opt(Share),
  bed: opt(z.object({ x0: Share, x1: Share, top: Share, closed: opt(z.boolean()) })),
});
export const CarWindowSchema = z.object({
  view: View,
  kind: z.enum(CAR_WINDOWS),
  points: z
    .array(z.tuple([Share, Share]))
    .min(3)
    .max(8),
});
export const CarDetailSchema = z.object({
  view: View,
  kind: z.enum(CAR_DETAILS),
  box: Box,
  color: opt(Hex),
});
export const CarFinishSchema = z.object({
  finish: z.enum(CAR_FINISHES),
  material: opt(z.enum(CAR_MATERIALS)),
  color: Hex,
  view: opt(View),
  box: opt(Box),
});

/** What the car team read on the drawings (saved by `onCarReading`, replayable). */
export const CarReadingSchema = z.object({
  kind: z.enum(CAR_KINDS).optional(),
  doors: z.number().int().optional(),
  parts: z.array(z.enum(CAR_PARTS)).optional(),
  body: CarBodyReadingSchema.optional(),
  windows: z.array(CarWindowSchema),
  details: z.array(CarDetailSchema),
  finishes: z.array(CarFinishSchema),
});
export type CarReading = z.infer<typeof CarReadingSchema>;

/** Items of a list that parse, the others dropped (one bad window never loses the rest). */
const items = <T extends z.ZodTypeAny>(schema: T, list: unknown): Array<z.infer<T>> =>
  Array.isArray(list)
    ? list.flatMap((x) => {
        const r = schema.safeParse(x);
        return r.success ? [r.data] : [];
      })
    : [];

/** The answer of one tool as JSON with its key; null when it has none. */
function answerOf(
  tool: CarTool,
  content: string | null | undefined
): Record<string, unknown> | null {
  if (!content) return null;
  const json = answerJson(content);
  if (!json || typeof json !== 'object') return null;
  const key = CAR_TOOL_SPECS[tool].key;
  return key in json ? (json as Record<string, unknown>) : null;
}

/** Whether a tool answered: its key present, and a body with at least two stations. */
export function carToolAnswered(tool: CarTool, content: string | null | undefined): boolean {
  const json = answerOf(tool, content);
  if (!json) return false;
  if (tool !== 'body') return Array.isArray(json[CAR_TOOL_SPECS[tool].key]);
  const body = CarBodyReadingSchema.safeParse(json.body);
  return (
    body.success && Object.values(body.data.stations).filter((v) => v !== undefined).length >= 2
  );
}

/** The team's answers merged into one reading; null without a usable body. */
export function mergeCarAnswers(
  answers: Partial<Record<CarTool, string | null>>,
  brief: CarBrief | null
): CarReading | null {
  const body = CarBodyReadingSchema.safeParse(answerOf('body', answers.body)?.body);
  if (!body.success) return null;
  const parts = brief ? CAR_PARTS.filter((p) => brief.parts[p]) : [];
  return {
    ...(brief ? { kind: brief.kind } : {}),
    ...(brief?.doors ? { doors: brief.doors } : {}),
    ...(parts.length ? { parts } : {}),
    body: body.data,
    windows: items(CarWindowSchema, answerOf('glazing', answers.glazing)?.windows),
    details: items(CarDetailSchema, answerOf('lights', answers.lights)?.details),
    finishes: items(CarFinishSchema, answerOf('finishes', answers.finishes)?.finishes),
  };
}
