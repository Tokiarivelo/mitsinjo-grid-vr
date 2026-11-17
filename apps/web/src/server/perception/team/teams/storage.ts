import { cabinet, shelving, WOOD, type PartSpec } from '../../furniture';
import {
  openingsAnswered,
  openingsSpec,
  parseOpenings,
  type ReadOpening,
} from '../shared/openings';
import {
  FURNITURE_FRAME,
  FURNITURE_VIEWS,
  enumField,
  finishColor,
  footprint,
  furnitureTeam,
  intField,
  ownObject,
  type FurnitureReading,
} from './furniture';

/**
 * The storage team (PQ-T89): wardrobes, cabinets, sideboards, shelves, counters, chests. Shared
 * profile, legs, openings (its fronts: doors, drawers, glazed doors, open bays) and finishes, and
 * its own shelves specialist. `storageParts` turns a reading into the cabinet or shelving builder
 * (`furniture/storage.ts`).
 */

export const STORAGE_KINDS = [
  'wardrobe',
  'cabinet',
  'sideboard',
  'shelf',
  'counter',
  'chest',
] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];
export const STORAGE_PARTS = [
  'doors',
  'drawers',
  'glass',
  'open_shelves',
  'worktop',
  'legs',
  'plinth',
] as const;
export const STORAGE_FRONTS = ['door', 'drawer', 'glass_door', 'open_bay'] as const;

const FRONTS_CFG = {
  subject: 'ONE piece of storage furniture',
  frame: FURNITURE_FRAME,
  what: 'every front of the piece: each door, drawer, glazed door and open bay',
  key: 'fronts',
  kinds: STORAGE_FRONTS,
  views: FURNITURE_VIEWS,
  shape: 'box' as const,
  schemaName: 'StorageFronts',
  task: 'List its fronts: doors, drawers, glazed doors and open bays.',
};

export interface StorageInside {
  shelves: number;
  open: boolean;
  fronts: ReadOpening[];
}

export const SHELVES_SPEC = {
  key: 'shelves',
  task: 'Count its shelves and say whether it is open.',
  system: [
    'You are the shelves specialist of a 3D modelling team. On the orthographic drawings of ONE piece of storage furniture, you read its inside.',
    FURNITURE_FRAME,
    'shelves: count = the horizontal shelves you see or can tell behind glass (not the top and the bottom); open = true when it has no doors at all (open shelving).',
  ].join('\n'),
  schema: {
    name: 'StorageShelves',
    schema: {
      type: 'object',
      properties: {
        shelves: {
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 0, maximum: 12 },
            open: { type: 'boolean' },
          },
          required: ['count', 'open'],
        },
      },
      required: ['shelves'],
    },
  },
};

/** 1: first version. */
export const STORAGE_PROMPT_VERSION = 2;

export const STORAGE_TEAM = furnitureTeam({
  id: 'storage',
  promptVersion: STORAGE_PROMPT_VERSION,
  subject: 'ONE piece of storage furniture (wardrobe, cabinet, sideboard, shelf, counter or chest)',
  kinds: STORAGE_KINDS,
  parts: STORAGE_PARTS,
  lines: [['worktop', 'top of a worktop or a top board']],
  finishes: [
    ['carcass', 'the body and the sides'],
    ['front', 'the doors and drawer fronts'],
    ['worktop', 'a worktop of another finish'],
    ['handle', 'handles and knobs'],
    ['frame', 'the posts of an open rack'],
  ],
  materials: ['wood', 'metal', 'glass', 'stone', 'plastic'],
  own: {
    fronts: {
      spec: openingsSpec(FRONTS_CFG),
      answered: (c: string | null | undefined) => openingsAnswered(c, FRONTS_CFG),
    },
    shelves: {
      spec: SHELVES_SPEC,
      answered: (c: string | null | undefined) => ownObject(c, 'shelves') !== null,
    },
  },
  parseOwn: (a): StorageInside => {
    const s = ownObject(a.shelves, 'shelves');
    return {
      shelves: intField(s?.count, 0, 12, 0),
      open: s?.open === true,
      fronts: parseOpenings(a.fronts, FRONTS_CFG),
    };
  },
  ownSummary: (i) => `${i.fronts.length} fronts, ${i.shelves} shelves${i.open ? ', open' : ''}`,
});

export type StorageReading = FurnitureReading<StorageInside>;

const STORAGE_HEIGHT: Record<StorageKind, number> = {
  wardrobe: 2.1,
  cabinet: 0.9,
  sideboard: 0.85,
  shelf: 1.8,
  counter: 0.92,
  chest: 0.6,
};

/** A storage reading on its measured proportions (largest side = 1) → the cabinet or shelving parts. */
/** An open rack on posts: the supports read as a frame of thin posts reaching the floor. */
export const hasPosts = (r: StorageReading): boolean =>
  r.legs.some((l) => l.kind === 'frame' && l.section !== 'flat' && l.box[3] >= 0.95);

export function storageParts(
  r: StorageReading,
  p: { w: number; h: number; d: number }
): PartSpec[] {
  const kind = enumField(r.kind, STORAGE_KINDS, 'cabinet');
  const h = STORAGE_HEIGHT[kind];
  const { w, d } = footprint(h, p);
  const color = finishColor(r, ['carcass', 'front'], WOOD);
  const front = r.own.fronts.filter((f) => f.view === 'front' && f.kind !== 'open_bay');
  if (r.own.open || (kind === 'shelf' && !front.length))
    return shelving(w, h, d, color, Math.max(1, r.own.shelves), {
      ...(hasPosts(r) ? { posts: finishColor(r, ['frame'], '#2b2b2d') } : {}),
    });
  // Doors side by side: the fronts in the upper half of the front drawing, at least one.
  const doors = Math.max(1, Math.min(8, front.filter((f) => (f.box?.[1] ?? 0) < 0.5).length));
  const top = r.finishes.find((f) => f.finish === 'worktop');
  return cabinet(w, h, d, color, doors, {
    glass: front.some((f) => f.kind === 'glass_door'),
    ...(top || kind === 'counter' ? { top: finishColor(r, ['worktop'], color) } : {}),
  });
}
