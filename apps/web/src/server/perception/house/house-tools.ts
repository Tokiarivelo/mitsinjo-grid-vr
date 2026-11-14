import { z } from 'zod';
import {
  HOUSE_FINISHES,
  HOUSE_HEADS,
  HOUSE_MATERIALS,
  HOUSE_OPENINGS,
  HOUSE_ROOF_FINISHES,
  HOUSE_ROOFS,
  HOUSE_VOLUMES,
  HOUSE_WALL_FINISHES,
  HOUSE_WALLS,
} from '@/lib/house-plan';
import { parseHouseReading, type HouseReading } from './house-prompt';

/**
 * Part specialists of a house, driven by a pilot (PQ-T73). One Spark reading of a whole house
 * (PQ-T72) missed what it was not asked about closely: arcades, stone piers, the layout of several
 * roofs, which roof is metal. Here a pilot looks at the drawings first, says what kind of building
 * it is and which parts it has, and calls the specialists it needs, each a tool with its own short
 * prompt and schema and the pilot's notes for it:
 *
 * - `massing`: blocks, their roofs (kind, axis, which roofing), arcades, trusses;
 * - `openings`: every window and door of every elevation, with its head (flat, arch, segment);
 * - `structure`: masonry piers and chimneys;
 * - `finishes`: each finish's material and colour, and a clean sample box on a drawing.
 *
 * Their answers merge into one `HouseReading` (the PQ-T72 shape plus piers and finishes), fitted
 * by `fitHouse` like a single reading. Pure: prompts, schemas, parsers, the merge.
 */

export const HOUSE_TOOLS_PROMPT_VERSION = 1;

export const HOUSE_TOOLS = ['massing', 'openings', 'structure', 'finishes'] as const;
export type HouseTool = (typeof HOUSE_TOOLS)[number];
/** Tools always run: a house needs its blocks, its openings and its colours. */
export const HOUSE_TOOLS_ALWAYS: ReadonlyArray<HouseTool> = ['massing', 'openings', 'finishes'];

/** Frame every tool measures in (the PQ-T72 convention). */
const FRAME = [
  'Every image is cropped exactly to the building: x = 0 at the left edge of the image, 1 at the right edge; y = 0 at the top of the highest point (chimney or ridge), 1 at the ground line. Give every number as a share 0–1 of the image, with 2 or 3 decimals.',
  'On the VIEW FROM ABOVE, x runs left → right as on the front drawing and y runs from the BACK of the building (0, top of the image) to the FRONT facade (1, bottom of the image).',
  'Report only what the drawings show. Answer with the JSON only.',
].join('\n');

const share = { type: 'number', minimum: 0, maximum: 1 } as const;
const quad = { type: 'array', items: share, minItems: 4, maxItems: 4 } as const;
const hex = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } as const;
const views = [...HOUSE_WALLS, 'top'] as const;

// ---------------------------------------------------------------- pilot

export const PILOT_SYSTEM_PROMPT = [
  'You are the lead architect of a 3D modelling team. You look at the orthographic drawings of ONE building and brief the specialists who will model it.',
  'Say what kind of building it is (lodge, bungalow, villa with arcades, apartment block, shop, school, farmhouse…), how many storeys, which parts it has, and call the specialists you need with a short focus note each.',
  `Specialists: massing (blocks and the layout of every roof: which block has which roof, its axis, which roofing material, projecting gables, timber trusses, arcades), openings (every window and door, arched or flat heads), structure (masonry piers / pillars standing on the ground, chimneys), finishes (each material and colour: main cladding, second cladding, stone, main roofing, second roofing such as metal sheets, timber, glass, doors).`,
  'A focus note names what this specialist must not miss on THIS building, with positions in plain words (e.g. "two metal shed roofs left and right of the main shingled hip roof; the central gable projects forward over the porch with a timber truss").',
  'Answer with the JSON only.',
].join('\n');

export const PILOT_JSON_SCHEMA = {
  name: 'HouseBrief',
  schema: {
    type: 'object',
    properties: {
      type: { type: 'string' },
      storeys: { type: 'integer', minimum: 1, maximum: 12 },
      parts: {
        type: 'object',
        properties: {
          verandas: { type: 'boolean' },
          balconies: { type: 'boolean' },
          arcades: { type: 'boolean' },
          piers: { type: 'boolean' },
          trusses: { type: 'boolean' },
          chimneys: { type: 'boolean' },
          secondCladding: { type: 'boolean' },
          secondRoofing: { type: 'boolean' },
        },
      },
      calls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', enum: [...HOUSE_TOOLS] },
            focus: { type: 'string' },
          },
          required: ['tool'],
        },
      },
    },
    required: ['type', 'calls'],
  },
} as const;

export const HOUSE_PARTS = [
  'verandas',
  'balconies',
  'arcades',
  'piers',
  'trusses',
  'chimneys',
  'secondCladding',
  'secondRoofing',
] as const;
export type HousePart = (typeof HOUSE_PARTS)[number];

/** The pilot's brief: the building type, its parts and the specialists to call with their notes. */
export interface HouseBrief {
  type: string;
  storeys: number | null;
  parts: Partial<Record<HousePart, boolean>>;
  calls: Array<{ tool: HouseTool; focus: string }>;
}

const BriefSchema = z.object({
  type: z.string().catch('house'),
  storeys: z.number().int().min(1).max(12).nullable().optional().catch(null),
  parts: z.record(z.string(), z.unknown()).optional().catch(undefined),
  calls: z.array(z.unknown()).catch([]),
});
const CallSchema = z.object({
  tool: z.enum(HOUSE_TOOLS),
  focus: z.string().optional().catch(undefined),
});

/** JSON of an answer, fenced or wrapped in prose; null when there is none. */
export function answerJson(content: string): unknown {
  const text = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(text);
  } catch {
    const at = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (at < 0 || end <= at) return null;
    try {
      return JSON.parse(text.slice(at, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * The pilot's answer as a brief: unknown tools dropped, one call per tool (notes joined), and the
 * tools a house always needs added. Null only when the answer is not JSON at all.
 */
export function parseBrief(content: string): HouseBrief | null {
  const raw = BriefSchema.safeParse(answerJson(content));
  if (!raw.success) return null;
  const parts: HouseBrief['parts'] = {};
  for (const p of HOUSE_PARTS)
    if (typeof raw.data.parts?.[p] === 'boolean') parts[p] = raw.data.parts[p] as boolean;
  const notes = new Map<HouseTool, string[]>();
  for (const c of raw.data.calls) {
    const call = CallSchema.safeParse(c);
    if (!call.success) continue;
    const list = notes.get(call.data.tool) ?? [];
    if (call.data.focus?.trim()) list.push(call.data.focus.trim().slice(0, 400));
    notes.set(call.data.tool, list);
  }
  for (const t of HOUSE_TOOLS_ALWAYS) if (!notes.has(t)) notes.set(t, []);
  // Piers or chimneys seen: the structure specialist is needed even when the pilot forgot it.
  if ((parts.piers || parts.chimneys) && !notes.has('structure')) notes.set('structure', []);
  return {
    type: raw.data.type.trim().slice(0, 60) || 'house',
    storeys: raw.data.storeys ?? null,
    parts,
    calls: HOUSE_TOOLS.filter((t) => notes.has(t)).map((tool) => ({
      tool,
      focus: notes.get(tool)!.join(' '),
    })),
  };
}

// ---------------------------------------------------------------- the specialists

const MASSING_PROMPT = [
  'You are the massing and roof specialist of a 3D modelling team. From the orthographic drawings of ONE building, you split it into simple blocks and give each its own roof.',
  FRAME,
  'BLOCKS: the main body, each wing, each projecting gable bay, a garage, a tower, and every OPEN space: a veranda or porch (roofed, open on its sides, on posts or piers), a balcony (slab at an upper floor, with a railing). A veranda under the main roof is still its own block inside the body plan.',
  '- plan = [x0, x1, y0, y1] on the VIEW FROM ABOVE (without it, deduce x from the front and the depth from the side drawings).',
  '- eave = y where the walls of that block stop and its roof starts; ridge = y of the top of its roof (= eave for a flat roof), measured on an elevation.',
  `- roof: one of ${HOUSE_ROOFS.join(', ')} ("none" for a balcony with no roof of its own). ridgeAxis = "x" when the ridge runs left–right on the front drawing, "z" when it runs front–back (a gable facing the front has "z"). For a shed roof, fall = the side it slopes down toward.`,
  'ROOF LAYOUT: look at the view from above first. Every roof surface with its own ridge, its own slope or its own material is its own block: a main hip, a cross gable projecting to the front or the back, a lower shed roof on a side wing, a porch roof. Never merge roofs of different materials.',
  `- roofFinish: "roof" for the main roofing, "roof2" for a second roofing (metal sheets next to shingles, for example). wallFinish: ${HOUSE_WALL_FINISHES.join(', ')} ("wall2" = a second cladding, "stone" = a stone block).`,
  `- open: the sides of a veranda, porch or balcony with no wall (${HOUSE_WALLS.join(', ')}); columns = posts along one open side, corners included (0 when masonry piers carry it); floor = y of its deck or slab (a balcony at an upper floor has its slab high up); rail = true with a railing.`,
  `- arcade: the head of the bays between its posts or piers: ${HOUSE_HEADS.join(', ')} ("arch" = round arches, "segment" = flat arches, "bracket" = curved timber knee braces under the beam).`,
  '- truss = true when a gable end shows exposed timber trusses (king post, collar, struts).',
  '- bands: y of horizontal bands or floor lines across its walls.',
].join('\n');

const volumeItem = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    kind: { type: 'string', enum: [...HOUSE_VOLUMES] },
    plan: quad,
    eave: share,
    ridge: share,
    roof: { type: 'string', enum: [...HOUSE_ROOFS] },
    ridgeAxis: { type: 'string', enum: ['x', 'z'] },
    fall: { type: 'string', enum: [...HOUSE_WALLS] },
    roofFinish: { type: 'string', enum: [...HOUSE_ROOF_FINISHES] },
    wallFinish: { type: 'string', enum: [...HOUSE_WALL_FINISHES] },
    open: { type: 'array', items: { type: 'string', enum: [...HOUSE_WALLS] } },
    columns: { type: 'integer', minimum: 0, maximum: 12 },
    floor: share,
    rail: { type: 'boolean' },
    arcade: { type: 'string', enum: [...HOUSE_HEADS] },
    truss: { type: 'boolean' },
    bands: { type: 'array', items: share },
  },
  required: ['kind', 'plan', 'eave', 'ridge', 'roof', 'ridgeAxis'],
} as const;

const OPENINGS_PROMPT = [
  'You are the openings specialist of a 3D modelling team. On the orthographic drawings of ONE building, you list every window, door, glazed wall, garage door, arched opening and vent of every elevation.',
  FRAME,
  'One entry each (a row of 4 windows = 4 entries). view = the elevation it is on; box = [x0, y0, x1, y1] of its OUTER frame on that drawing, including an arched top; panes = [columns, rows] of glass panes.',
  `head: ${HOUSE_HEADS.slice(0, 3).join(', ')} — "arch" when the top is a round arch, "segment" when it is a flat curve, else "flat".`,
  'A glazed door, a French window or a sliding glass door is a "door" with its panes; a solid door has no panes. A tall glazed gable or a curtain wall is one window with many panes. Openings seen through an open veranda belong to the wall behind it: list them too.',
  'Never put an opening on a roof: a window high in a gable belongs to the gable wall. Never list the bays between posts or piers as openings.',
].join('\n');

const openingItem = {
  type: 'object',
  properties: {
    view: { type: 'string', enum: [...HOUSE_WALLS] },
    kind: { type: 'string', enum: [...HOUSE_OPENINGS] },
    box: quad,
    panes: {
      type: 'array',
      items: { type: 'integer', minimum: 1, maximum: 8 },
      minItems: 2,
      maxItems: 2,
    },
    head: { type: 'string', enum: ['flat', 'arch', 'segment'] },
  },
  required: ['view', 'kind', 'box'],
} as const;

const STRUCTURE_PROMPT = [
  'You are the structure specialist of a 3D modelling team. On the orthographic drawings of ONE building, you find the masonry piers and the chimneys.',
  FRAME,
  "PIERS: every stone or brick pillar standing from the ground (at the corners and along the front of a veranda, under a balcony). plan = [x0, x1, y0, y1] of its square on the VIEW FROM ABOVE (its cap shows there; without that view, x from the front elevation and y from a side elevation, where the front facade is the side drawing's edge it faces); top = y of its top on an elevation; band = y of a stone course or a change of stone across it, if any. One entry per pier: a pier seen on the front and on a side is one pier.",
  'CHIMNEYS: plan on the view from above, top = y of its top on an elevation.',
  'Timber posts are not piers: leave them out.',
].join('\n');

const FINISHES_PROMPT = [
  'You are the materials specialist of a 3D modelling team. On the orthographic drawings of ONE building, you name each finish, its true colour as drawn, and where to sample it.',
  FRAME,
  `Finishes: wall (the main cladding of the walls), wall2 (a second cladding, if any), stone (masonry of piers, plinths, chimneys, if any), roof (the main roofing), roof2 (a second roofing, such as metal sheets next to shingles, if any), timber (posts, beams, brackets, trusses, if any). Materials: ${HOUSE_MATERIALS.join(', ')}.`,
  'For each finish present: material, color (hex of its average colour in plain light, not in shadow), view (front, right, back, left or top for a roofing) and box = [x0, y0, x1, y1] of a sample on that drawing that shows ONLY this finish: no window, no frame, no post, no shadow, no edge, as large as possible (a roofing is best sampled on the view from above).',
  'Also: trim (frames, fascias), glass, door, base (deck, plinth) as hex colours.',
].join('\n');

const lookItem = {
  type: 'object',
  properties: {
    finish: { type: 'string', enum: [...HOUSE_FINISHES] },
    material: { type: 'string', enum: [...HOUSE_MATERIALS] },
    color: hex,
    view: { type: 'string', enum: [...views] },
    box: quad,
  },
  required: ['finish', 'material', 'color', 'view', 'box'],
} as const;

/** One specialist: its system prompt, its JSON schema and what it is asked. */
export interface HouseToolSpec {
  system: string;
  schema: { name: string; schema: object };
  task: string;
}

export const HOUSE_TOOL_SPECS: Readonly<Record<HouseTool, HouseToolSpec>> = {
  massing: {
    system: MASSING_PROMPT,
    schema: {
      name: 'HouseMassing',
      schema: {
        type: 'object',
        properties: { volumes: { type: 'array', items: volumeItem } },
        required: ['volumes'],
      },
    },
    task: 'Split it into blocks with their roofs.',
  },
  openings: {
    system: OPENINGS_PROMPT,
    schema: {
      name: 'HouseOpenings',
      schema: {
        type: 'object',
        properties: { openings: { type: 'array', items: openingItem } },
        required: ['openings'],
      },
    },
    task: 'List every opening of every elevation.',
  },
  structure: {
    system: STRUCTURE_PROMPT,
    schema: {
      name: 'HouseStructure',
      schema: {
        type: 'object',
        properties: {
          piers: {
            type: 'array',
            items: {
              type: 'object',
              properties: { plan: quad, top: share, band: share },
              required: ['plan', 'top'],
            },
          },
          chimneys: {
            type: 'array',
            items: {
              type: 'object',
              properties: { plan: quad, top: share },
              required: ['plan', 'top'],
            },
          },
        },
        required: ['piers', 'chimneys'],
      },
    },
    task: 'Find its masonry piers and its chimneys.',
  },
  finishes: {
    system: FINISHES_PROMPT,
    schema: {
      name: 'HouseFinishes',
      schema: {
        type: 'object',
        properties: {
          finishes: { type: 'array', items: lookItem },
          trim: hex,
          glass: hex,
          door: hex,
          base: hex,
        },
        required: ['finishes'],
      },
    },
    task: 'Name its finishes and where to sample each.',
  },
};

/** Which image is which, as every call says it (the PQ-T72 wording). */
export function imageNames(order: ReadonlyArray<'front' | 'right' | 'back' | 'left' | 'top'>) {
  return order
    .map((v, i) => {
      const what =
        v === 'top'
          ? 'the VIEW FROM ABOVE (the front facade at the bottom of the image)'
          : v === 'front'
            ? 'the FRONT elevation'
            : v === 'right'
              ? 'the RIGHT side elevation (the front facade is at its left edge)'
              : v === 'left'
                ? 'the LEFT side elevation (the front facade is at its right edge)'
                : 'the BACK elevation (the right side of the building is at its left edge)';
      return `image ${i + 1} = ${what}`;
    })
    .join('; ');
}

/** The pilot's question. */
export function pilotQuestion(label: string, order: Parameters<typeof imageNames>[0]): string {
  return `Building: ${label}. ${imageNames(order)}. Brief the specialists.`;
}

/** A specialist's question: the images, the brief's type and parts, its own focus note. */
export function toolQuestion(
  tool: HouseTool,
  label: string,
  order: Parameters<typeof imageNames>[0],
  brief: HouseBrief | null
): string {
  const seen = brief
    ? HOUSE_PARTS.filter((p) => brief.parts[p]).map((p) =>
        p.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)
      )
    : [];
  const focus = brief?.calls.find((c) => c.tool === tool)?.focus;
  return [
    `Building: ${label}${brief ? ` (${brief.type}${brief.storeys ? `, ${brief.storeys} storeys` : ''})` : ''}. ${imageNames(order)}.`,
    seen.length ? `The lead architect saw: ${seen.join(', ')}.` : '',
    focus ? `Lead architect's note for you: ${focus}` : '',
    HOUSE_TOOL_SPECS[tool].task,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The specialists' answers merged into one reading (the shape `parseHouseReading` reads, so a
 * saved merge replays like a single reading). Null without a usable massing.
 */
export function mergeToolAnswers(
  answers: Partial<Record<HouseTool, string | null>>,
  brief: HouseBrief | null
): HouseReading | null {
  const json = (t: HouseTool) => {
    const a = answers[t];
    const j = a ? answerJson(a) : null;
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
  };
  const massing = json('massing');
  const openings = json('openings');
  const structure = json('structure');
  const finishes = json('finishes');
  const list = (o: Record<string, unknown>, key: string) =>
    Array.isArray(o[key]) ? (o[key] as unknown[]) : [];
  const finishList = list(finishes, 'finishes');
  const lookOf = (name: 'wall' | 'roof') => {
    const f = finishList.find(
      (x): x is { material: unknown; color: unknown } =>
        Boolean(x) && typeof x === 'object' && (x as { finish?: unknown }).finish === name
    );
    return f ? { material: f.material, color: f.color } : undefined;
  };
  const merged = {
    volumes: list(massing, 'volumes'),
    openings: list(openings, 'openings'),
    chimneys: list(structure, 'chimneys'),
    piers: list(structure, 'piers'),
    finishes: finishList,
    walls: lookOf('wall'),
    roof: lookOf('roof'),
    ...Object.fromEntries(
      (['trim', 'glass', 'door', 'base'] as const).flatMap((k) =>
        typeof finishes[k] === 'string' ? [[k, finishes[k]]] : []
      )
    ),
    ...(brief ? { type: brief.type } : {}),
  };
  return parseHouseReading(JSON.stringify(merged));
}
