import { bed, box, WOOD, type PartSpec } from '../../furniture';
import {
  FURNITURE_FRAME,
  finishColor,
  footprint,
  furnitureTeam,
  intField,
  legHeight,
  ownObject,
  profileOn,
  type FurnitureReading,
} from './furniture';

/**
 * The bed team (PQ-T89): beds, daybeds, cots. Shared profile, legs and finishes, and its own
 * bedding specialist (pillows, headboard, blanket). `bedParts` turns a reading into the bed
 * builder's dimensions (`furniture/seating.ts`), a headboard added when there is one.
 */

export const BED_KINDS = ['double', 'single', 'daybed', 'bunk', 'cot'] as const;
export type BedKind = (typeof BED_KINDS)[number];
export const BED_PARTS = [
  'headboard',
  'footboard',
  'mattress',
  'blanket',
  'pillows',
  'legs',
  'frame',
] as const;

export interface Bedding {
  pillows: number;
  headboard: boolean;
  blanket: boolean;
}

const BEDDING_DEFAULT: Bedding = { pillows: 2, headboard: false, blanket: true };

export const BEDDING_SPEC = {
  key: 'bedding',
  task: 'Count the pillows and say whether it has a headboard and a blanket.',
  system: [
    'You are the bedding specialist of a 3D modelling team. On the orthographic drawings of ONE bed, you read what lies on it and what stands at its head.',
    FURNITURE_FRAME,
    'bedding: pillows = how many pillows and cushions at the head; headboard = true when a board or a padded panel rises at the head above the mattress; blanket = true when a blanket or a duvet covers part of it.',
  ].join('\n'),
  schema: {
    name: 'Bedding',
    schema: {
      type: 'object',
      properties: {
        bedding: {
          type: 'object',
          properties: {
            pillows: { type: 'integer', minimum: 0, maximum: 8 },
            headboard: { type: 'boolean' },
            blanket: { type: 'boolean' },
          },
          required: ['pillows', 'headboard'],
        },
      },
      required: ['bedding'],
    },
  },
};

/** The bedding of an answer, every field defaulted. */
export function parseBedding(content: string | null | undefined): Bedding {
  const o = ownObject(content, 'bedding');
  if (!o) return BEDDING_DEFAULT;
  return {
    pillows: intField(o.pillows, 0, 8, 2),
    headboard: o.headboard === true,
    blanket: o.blanket !== false,
  };
}

/** 1: first version. */
export const BED_PROMPT_VERSION = 1;

export const BED_TEAM = furnitureTeam({
  id: 'bed',
  promptVersion: BED_PROMPT_VERSION,
  subject: 'ONE bed',
  kinds: BED_KINDS,
  parts: BED_PARTS,
  lines: [['mattress', 'top of the mattress']],
  finishes: [
    ['frame', 'the bed frame and the legs'],
    ['sheet', 'the sheet or the mattress cover'],
    ['blanket', 'the blanket or the duvet'],
    ['pillow', 'the pillows'],
    ['headboard', 'the headboard'],
  ],
  materials: ['wood', 'fabric', 'metal'],
  own: {
    bedding: {
      spec: BEDDING_SPEC,
      answered: (c: string | null | undefined) => ownObject(c, 'bedding') !== null,
    },
  },
  parseOwn: (a) => parseBedding(a.bedding),
  ownSummary: (b) =>
    `${b.pillows} pillows${b.headboard ? ', headboard' : ''}${b.blanket ? ', blanket' : ''}`,
});

export type BedReading = FurnitureReading<Bedding>;

/** Height of the frame top of a bed (metres) when the drawings give no legs. */
const BED_FRAME = 0.25;

/** A bed reading on its measured proportions (largest side = 1) → the bed builder's parts. */
export function bedParts(r: BedReading, p: { w: number; h: number; d: number }): PartSpec[] {
  const b = r.own;
  // A bed is long: its height comes from its length (about 2 m) and the proportions.
  const long = Math.max(p.w, p.d);
  const h = (2.05 * p.h) / Math.max(1e-6, long);
  const { w, d } = footprint(h, p);
  // The bed runs along the longer side: the builder lays it along z.
  const [bw, bl] = p.d >= p.w ? [w, d] : [d, w];
  const frameTop = Math.max(0.12, Math.min(0.45, legHeight(r, h) + 0.1 || BED_FRAME));
  const frameColor = finishColor(r, ['frame'], WOOD);
  const pillow = finishColor(r, ['pillow', 'sheet'], '#e6e1d8');
  // `bed` builds [frame, mattress, blanket, ...pillows]: no blanket read → none drawn.
  const out = bed(
    bw,
    bl,
    frameTop,
    frameColor,
    finishColor(r, ['sheet'], '#ece8e0'),
    finishColor(r, ['blanket', 'sheet'], '#b9a58c'),
    Array.from({ length: b.pillows }, () => pillow)
  ).filter((_, i) => b.blanket || i !== 2);
  if (b.headboard) {
    const top = Math.max(frameTop + 0.5, (1 - profileOn(r, 'side').body[1]) * h);
    out.push(
      box(
        [0, top / 2, -bl / 2 - 0.03],
        [bw + 0.04, top, 0.06],
        finishColor(r, ['headboard', 'frame'], frameColor),
        {
          material: 'wood',
          kind: 'frame',
          concept: 'frame',
        }
      )
    );
  }
  // Turned a quarter when the drawings show it across (its length on the front).
  return p.d >= p.w
    ? out
    : out.map((x) => ({
        ...x,
        at: [x.at[2], x.at[1], -x.at[0]],
        size: [x.size[2], x.size[1], x.size[0]],
      }));
}
