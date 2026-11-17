import { table, WOOD, type PartSpec } from '../../furniture';
import {
  enumField,
  finishColor,
  footprint,
  furnitureTeam,
  lineHeight,
  profileOn,
  type FurnitureReading,
} from './furniture';

/**
 * The table team (PQ-T89): dining, coffee and side tables, desks, islands, consoles. Shared
 * profile (its top line), legs and finishes only: a table is a top on supports. `tableParts`
 * turns a reading into the table builder's dimensions (`furniture/seating.ts`).
 */

export const TABLE_KINDS = ['dining', 'coffee', 'side', 'desk', 'island', 'console'] as const;
export type TableKind = (typeof TABLE_KINDS)[number];
export const TABLE_PARTS = ['top', 'legs', 'pedestal', 'apron', 'shelf', 'drawer'] as const;

/** 1: first version. */
export const TABLE_PROMPT_VERSION = 1;

export const TABLE_TEAM = furnitureTeam({
  id: 'table',
  promptVersion: TABLE_PROMPT_VERSION,
  subject: 'ONE table (dining, coffee, side, desk, kitchen island or console)',
  kinds: TABLE_KINDS,
  parts: TABLE_PARTS,
  lines: [['top_under', 'underside of the table top']],
  finishes: [
    ['top', 'the table top'],
    ['frame', 'legs, pedestal and apron'],
  ],
  materials: ['wood', 'stone', 'glass', 'metal', 'plastic'],
  own: {},
  parseOwn: () => ({}),
  ownSummary: () => 'top on supports',
});

export type TableReading = FurnitureReading<Record<string, never>>;

const TABLE_HEIGHT: Record<TableKind, number> = {
  dining: 0.75,
  coffee: 0.42,
  side: 0.55,
  desk: 0.75,
  island: 0.92,
  console: 0.8,
};

const TOP_MATERIAL = ['wood', 'stone', 'glass', 'metal', 'plastic'] as const;

/** A table reading on its measured proportions (largest side = 1) → the table builder's parts. */
export function tableParts(r: TableReading, p: { w: number; h: number; d: number }): PartSpec[] {
  const kind = enumField(r.kind, TABLE_KINDS, 'dining');
  const h = TABLE_HEIGHT[kind];
  const { w, d } = footprint(h, p);
  const under = lineHeight(r, 'top_under', h);
  const topT = under !== null ? Math.min(0.12, Math.max(0.02, h - under)) : 0.04;
  const top = r.finishes.find((f) => f.finish === 'top');
  return table(h, w, d, finishColor(r, ['top'], WOOD), finishColor(r, ['frame', 'top'], WOOD), {
    round: profileOn(r).top === 'rounded' || profileOn(r, 'side').top === 'rounded',
    pedestal: r.legs.some((l) => l.kind === 'pedestal'),
    topT,
    material: enumField(top?.material, TOP_MATERIAL, 'wood'),
  });
}
