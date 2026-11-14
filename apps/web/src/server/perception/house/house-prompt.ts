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

/**
 * The house specialist (PQ-T72): one Spark call that reads the validated drawings of a house
 * (elevations + view from above, each cropped to the house) and describes it room by room: the
 * volumes with their own roofs, the open verandas and balconies, every window and door with its
 * box on the drawing it shows on, the chimneys and the colours. Measures stay in each image's own
 * shares; `house-fit.ts` turns them into the model's frame and snaps them on the pixels.
 */

export const HOUSE_PROMPT_VERSION = 2;

export const HOUSE_SYSTEM_PROMPT = [
  'You are an architect who reads the orthographic drawings of ONE building and describes it so it can be modelled in 3D, volume by volume, opening by opening.',
  'Every image is cropped exactly to the building: x = 0 at the left edge of the image, 1 at the right edge; y = 0 at the top of the highest point (chimney or ridge), 1 at the ground line. Give every number as a share 0–1 of the image, with 2 or 3 decimals.',
  'VOLUMES: split the building into simple blocks, each a rectangle in plan with its own walls and its own roof: the main body, each wing, each projecting gable bay, a garage, a tower, and every OPEN space: a veranda or porch (roofed, open on its sides, carried by posts), a balcony (slab at an upper floor, with a railing).',
  '- plan = [x0, x1, y0, y1] of the block measured on the VIEW FROM ABOVE (x left → right as on the front drawing, y from the BACK of the building at 0 to the FRONT facade at 1). Without a view from above, deduce the plan from the front (x) and the side drawings (depth).',
  '- eave = y where the walls of that block stop and its roof starts; ridge = y of the top of its roof (equal to eave for a flat roof). Measure them on an elevation where the block shows.',
  `- roof: one of ${HOUSE_ROOFS.join(', ')} ("none" for a balcony with no roof of its own). ridgeAxis = "x" when the ridge runs left–right on the front drawing, "z" when it runs front–back (a gable facing the front has ridgeAxis "z"). A shed (single slope) roof with ridgeAxis "x" falls toward the front, with "z" toward the right.`,
  `- open: the sides of a veranda, porch or balcony that have no wall (${HOUSE_WALLS.join(', ')}); columns = posts along one open side, corners included; floor = y of its deck or slab; rail = true when it has a railing.`,
  '- bands: y of horizontal bands, string courses or floor lines running across its walls.',
  'A veranda or a recessed porch that sits under the main roof is still its own block, inside the plan of the main body. Never merge a veranda into the body, never leave a wing out.',
  'OPENINGS: every window, door, glazed wall, garage door, arched opening and vent of every elevation, one entry each (a row of 4 windows = 4 entries). view = the drawing it is on; box = [x0, y0, x1, y1] of its OUTER frame on that drawing; panes = [columns, rows] of glass panes. A glazed door, a French window or a sliding glass door is a "door" with its panes; a solid door has no panes. A tall glazed gable or a curtain wall is one window with many panes.',
  'Never put an opening on a roof: a window high in a gable belongs to the gable wall. A dormer is a small block with its own roof.',
  'CHIMNEYS: plan on the view from above (same frame as the blocks), top = y of its top on an elevation.',
  `COLOURS (hex, as drawn) and MATERIALS (from: ${HOUSE_MATERIALS.join(', ')}): walls (the main facade), roof, trim (frames, fascias, posts), glass, door, base (deck, plinth).`,
  'Report only what the drawings show. Answer with the JSON only.',
].join('\n');

const share = { type: 'number', minimum: 0, maximum: 1 } as const;
const quad = { type: 'array', items: share, minItems: 4, maxItems: 4 } as const;
const hex = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } as const;
const look = {
  type: 'object',
  properties: { material: { type: 'string', enum: [...HOUSE_MATERIALS] }, color: hex },
  required: ['material', 'color'],
} as const;

export const HOUSE_JSON_SCHEMA = {
  name: 'HouseReading',
  schema: {
    type: 'object',
    properties: {
      volumes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            kind: { type: 'string', enum: [...HOUSE_VOLUMES] },
            plan: quad,
            eave: share,
            ridge: share,
            roof: { type: 'string', enum: [...HOUSE_ROOFS] },
            ridgeAxis: { type: 'string', enum: ['x', 'z'] },
            open: { type: 'array', items: { type: 'string', enum: [...HOUSE_WALLS] } },
            columns: { type: 'integer', minimum: 0, maximum: 12 },
            floor: share,
            rail: { type: 'boolean' },
            bands: { type: 'array', items: share },
          },
          required: ['kind', 'plan', 'eave', 'ridge', 'roof', 'ridgeAxis'],
        },
      },
      openings: {
        type: 'array',
        items: {
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
          },
          required: ['view', 'kind', 'box'],
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
      walls: look,
      roof: look,
      trim: hex,
      glass: hex,
      door: hex,
      base: hex,
    },
    required: ['volumes', 'openings', 'walls', 'roof'],
  },
} as const;

/** The question: the house's name and which image is which. */
export function buildHouseQuestion(
  label: string,
  views: ReadonlyArray<'front' | 'right' | 'back' | 'left' | 'top'>
): string {
  const named = views.map((v, i) => {
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
  });
  return `Building: ${label}. ${named.join('; ')}. Describe its volumes, openings, chimneys, colours and materials.`;
}

const shareIn = z.number().min(-0.05).max(1.05);
const quadIn = z.array(shareIn).length(4);

/** The answer as read: lenient per entry (a bad volume or opening is dropped, not the reading). */
export const HouseReadingSchema = z.object({
  volumes: z.array(z.unknown()),
  openings: z.array(z.unknown()).default([]),
  chimneys: z.array(z.unknown()).default([]),
  walls: z.unknown().optional(),
  roof: z.unknown().optional(),
  trim: z.string().nullish(),
  glass: z.string().nullish(),
  door: z.string().nullish(),
  base: z.string().nullish(),
  // PQ-T73, from the part specialists (absent from a single reading).
  piers: z.array(z.unknown()).default([]),
  finishes: z.array(z.unknown()).default([]),
  type: z.string().nullish(),
});

export const ReadVolumeSchema = z.object({
  kind: z.enum(HOUSE_VOLUMES).catch('wing'),
  plan: quadIn,
  eave: shareIn,
  ridge: shareIn,
  roof: z.enum(HOUSE_ROOFS).catch('gable'),
  ridgeAxis: z.enum(['x', 'z']).catch('x'),
  open: z.array(z.enum(HOUSE_WALLS)).optional().catch(undefined),
  columns: z.number().int().min(0).max(12).optional().catch(undefined),
  floor: shareIn.optional().catch(undefined),
  rail: z.boolean().optional().catch(undefined),
  bands: z.array(shareIn).optional().catch(undefined),
  wallFinish: z.enum(HOUSE_WALL_FINISHES).optional().catch(undefined),
  roofFinish: z.enum(HOUSE_ROOF_FINISHES).optional().catch(undefined),
  arcade: z.enum(HOUSE_HEADS).optional().catch(undefined),
  truss: z.boolean().optional().catch(undefined),
});
export type ReadVolume = z.infer<typeof ReadVolumeSchema>;

export const ReadOpeningSchema = z.object({
  view: z.enum(HOUSE_WALLS),
  kind: z.enum(HOUSE_OPENINGS).catch('window'),
  box: quadIn,
  panes: z.array(z.number().int().min(1).max(8)).length(2).optional().catch(undefined),
  head: z.enum(HOUSE_HEADS).optional().catch(undefined),
});
export type ReadOpening = z.infer<typeof ReadOpeningSchema>;

export const ReadChimneySchema = z.object({ plan: quadIn, top: shareIn });
export type ReadChimney = z.infer<typeof ReadChimneySchema>;

/** A masonry pier (PQ-T73): plan on the view from above, top and stone course on an elevation. */
export const ReadPierSchema = z.object({
  plan: quadIn,
  top: shareIn,
  band: shareIn.optional().catch(undefined),
});
export type ReadPier = z.infer<typeof ReadPierSchema>;

/**
 * A finish (PQ-T73): its material and colour, and a sample box on one drawing that shows only
 * that finish (where its colour is measured and its swatch cut).
 */
export const ReadFinishSchema = z.object({
  finish: z.enum(HOUSE_FINISHES),
  material: z.enum(HOUSE_MATERIALS).catch('wood'),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional()
    .catch(undefined),
  view: z
    .enum([...HOUSE_WALLS, 'top'])
    .optional()
    .catch(undefined),
  box: quadIn.optional().catch(undefined),
  /**
   * PQ-T74: the finish carries a large figure a small sample cannot show (half-timbering, a
   * mural, mixed panels): the walls then wear their whole drawing, not a repeated swatch.
   */
  figured: z.boolean().optional().catch(undefined),
});
export type ReadFinish = z.infer<typeof ReadFinishSchema>;

const LookSchema = z.object({
  material: z.enum(HOUSE_MATERIALS),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});

/** The specialist's reading, entries kept one by one. */
export interface HouseReading {
  volumes: ReadVolume[];
  openings: ReadOpening[];
  chimneys: ReadChimney[];
  walls: z.infer<typeof LookSchema> | null;
  roof: z.infer<typeof LookSchema> | null;
  trim: string | null;
  glass: string | null;
  door: string | null;
  base: string | null;
  /** PQ-T73 (empty from a single reading). */
  piers?: ReadPier[];
  finishes?: ReadFinish[];
  type?: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const hexOr = (v: string | null | undefined) => (v && HEX.test(v) ? v.toLowerCase() : null);

/** Parse the answer (JSON, possibly fenced); null when it holds no usable volume. */
export function parseHouseReading(content: string): HouseReading | null {
  const text = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const at = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (at < 0 || end <= at) return null;
    try {
      json = JSON.parse(text.slice(at, end + 1));
    } catch {
      return null;
    }
  }
  const raw = HouseReadingSchema.safeParse(json);
  if (!raw.success) return null;
  const each = <S extends z.ZodTypeAny>(items: unknown[], schema: S): Array<z.output<S>> =>
    items.flatMap((item) => {
      const r = schema.safeParse(item);
      return r.success ? [r.data] : [];
    });
  const volumes = each(raw.data.volumes, ReadVolumeSchema);
  if (!volumes.length) return null;
  const lookOf = (v: unknown) => {
    const r = LookSchema.safeParse(v);
    return r.success ? { ...r.data, color: r.data.color.toLowerCase() } : null;
  };
  return {
    volumes,
    openings: each(raw.data.openings, ReadOpeningSchema),
    chimneys: each(raw.data.chimneys, ReadChimneySchema),
    walls: lookOf(raw.data.walls),
    roof: lookOf(raw.data.roof),
    trim: hexOr(raw.data.trim),
    glass: hexOr(raw.data.glass),
    door: hexOr(raw.data.door),
    base: hexOr(raw.data.base),
    piers: each(raw.data.piers, ReadPierSchema),
    finishes: each(raw.data.finishes, ReadFinishSchema),
    type: raw.data.type?.trim().slice(0, 60) || null,
  };
}
