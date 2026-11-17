import type { FurnitureTeamId } from '../../team/teams';

/**
 * Recorded answers of the furniture teams (PQ-T89) on the validated front and side drawings of
 * 360° tour objects (`tour-data.ts`): what each specialist answered, replayed offline. The tour's
 * hand-built model of each object is the shape target (`tour-mock/specs-extra.ts`).
 */
export interface FurnitureFixture {
  id: string;
  team: FurnitureTeamId;
  label: string;
  answers: Record<string, unknown>;
  /** Concepts the built model must have. */
  concepts: string[];
  /** Least front and side IoU against the tour model; below 0.85 the limit is written in `limit`. */
  minIou: number;
  limit?: string;
}

const j = (o: unknown) => o;

export const FURNITURE_FIXTURES: FurnitureFixture[] = [
  // ------------------------------------------------------------------ seat
  {
    id: 'loft-sofa',
    team: 'seat',
    label: 'Sofa',
    answers: {
      pilot: j({ kind: 'sofa', parts: ['back', 'arms', 'seat_cushions', 'back_cushions', 'legs'] }),
      profile: j({
        profile: [
          {
            view: 'front',
            body: [0, 0, 1, 0.84],
            top: 'flat',
            sides: 'straight',
            symmetric: true,
            lines: { seat: 0.46, arm: 0.27 },
          },
          { view: 'side', body: [0, 0, 1, 0.84], top: 'sloped', sides: 'straight' },
        ],
      }),
      legs: j({
        legs: [
          { kind: 'leg', view: 'front', box: [0.03, 0.84, 0.05, 1], count: 4, section: 'round' },
        ],
      }),
      upholstery: j({
        upholstery: { seatCushions: 2, backCushions: 2, arms: 'both', back: 'straight', chaise: 1 },
      }),
      finishes: j({
        finishes: [
          {
            finish: 'upholstery',
            material: 'fabric',
            color: '#33333a',
            view: 'front',
            box: [0.3, 0.5, 0.45, 0.7],
          },
          { finish: 'frame', material: 'wood', color: '#6b4f36' },
        ],
      }),
    },
    concepts: ['seat', 'backrest', 'arm', 'leg'],
    minIou: 0.85,
  },
  {
    id: 'bedroom-chair-black',
    team: 'seat',
    label: 'Chair',
    answers: {
      pilot: j({ kind: 'chair', parts: ['back', 'legs'] }),
      profile: j({
        profile: [
          {
            view: 'front',
            body: [0, 0, 1, 0.38],
            top: 'rounded',
            sides: 'tapered',
            symmetric: true,
            lines: { seat: 0.35 },
          },
          { view: 'side', body: [0, 0, 1, 0.38], top: 'rounded', sides: 'straight' },
        ],
      }),
      legs: j({
        legs: [
          {
            kind: 'leg',
            view: 'front',
            box: [0.08, 0.38, 0.15, 1],
            count: 4,
            section: 'round',
            splay: true,
          },
        ],
      }),
      upholstery: j({
        upholstery: { seatCushions: 0, backCushions: 0, arms: 'none', back: 'shell' },
      }),
      finishes: j({
        finishes: [
          { finish: 'upholstery', material: 'plastic', color: '#1e1e20' },
          { finish: 'frame', material: 'wood', color: '#c9a679' },
        ],
      }),
    },
    concepts: ['seat', 'backrest', 'leg'],
    minIou: 0.4,
    limit:
      'The shell chair builder back is a flat plate: the moulded shell curves forward on the side view.',
  },
  {
    id: 'bedroom-stool',
    team: 'seat',
    label: 'Bar stool',
    answers: {
      pilot: j({ kind: 'stool', parts: ['legs', 'frame'] }),
      profile: j({
        profile: [
          {
            view: 'front',
            body: [0.1, 0, 0.9, 0.07],
            top: 'rounded',
            sides: 'straight',
            symmetric: true,
          },
          { view: 'side', body: [0.1, 0, 0.9, 0.07], top: 'rounded', sides: 'straight' },
        ],
      }),
      legs: j({
        legs: [
          {
            kind: 'leg',
            view: 'front',
            box: [0.05, 0.07, 0.12, 1],
            count: 4,
            section: 'round',
            splay: true,
          },
        ],
      }),
      upholstery: j({
        upholstery: { seatCushions: 0, backCushions: 0, arms: 'none', back: 'none' },
      }),
      finishes: j({
        finishes: [
          { finish: 'upholstery', material: 'wood', color: '#7b5a3c' },
          { finish: 'frame', material: 'metal', color: '#2b2b2d' },
        ],
      }),
    },
    concepts: ['seat', 'leg', 'frame'],
    minIou: 0.35,
    limit: 'Thin legs: a one-cell shift of a leg halves the IoU on a 64 px grid.',
  },
  // ------------------------------------------------------------------ table
  {
    id: 'salon-side-table',
    team: 'table',
    label: 'Side table',
    answers: {
      pilot: j({ kind: 'side', parts: ['top', 'legs'] }),
      profile: j({
        profile: [
          {
            view: 'front',
            body: [0, 0, 1, 0.08],
            top: 'rounded',
            sides: 'straight',
            symmetric: true,
            lines: { top_under: 0.08 },
          },
          { view: 'side', body: [0, 0, 1, 0.08], top: 'rounded', sides: 'straight' },
        ],
      }),
      legs: j({
        legs: [
          { kind: 'leg', view: 'front', box: [0.1, 0.08, 0.16, 1], count: 4, section: 'round' },
        ],
      }),
      finishes: j({
        finishes: [
          { finish: 'top', material: 'wood', color: '#8a7a65' },
          { finish: 'frame', material: 'metal', color: '#b8955a' },
        ],
      }),
    },
    concepts: ['table', 'leg'],
    minIou: 0.85,
  },
  {
    id: 'loft-island',
    team: 'table',
    label: 'Kitchen island',
    answers: {
      pilot: j({ kind: 'island', parts: ['top', 'legs'] }),
      profile: j({
        profile: [
          {
            view: 'front',
            body: [0, 0, 1, 0.06],
            top: 'flat',
            sides: 'straight',
            symmetric: true,
            lines: { top_under: 0.06 },
          },
          { view: 'side', body: [0, 0, 1, 0.06], top: 'flat', sides: 'straight' },
        ],
      }),
      legs: j({
        legs: [
          { kind: 'frame', view: 'front', box: [0, 0.06, 0.03, 1], count: 2, section: 'flat' },
        ],
      }),
      finishes: j({
        finishes: [
          { finish: 'top', material: 'wood', color: '#f2f0ec' },
          { finish: 'frame', material: 'wood', color: '#f2f0ec' },
        ],
      }),
    },
    concepts: ['table', 'leg'],
    minIou: 0.05,
    limit:
      'A waterfall island (top running down both ends): the table builder only knows a top on legs or a pedestal.',
  },
  {
    id: 'bath-side-table',
    team: 'table',
    label: 'Side table',
    answers: {
      pilot: j({ kind: 'side', parts: ['top', 'pedestal'] }),
      profile: j({
        profile: [
          {
            view: 'front',
            body: [0, 0, 1, 0.06],
            top: 'rounded',
            sides: 'straight',
            symmetric: true,
          },
        ],
      }),
      legs: j({
        legs: [
          { kind: 'pedestal', view: 'front', box: [0.4, 0.06, 0.6, 1], count: 1, section: 'round' },
        ],
      }),
      finishes: j({ finishes: [{ finish: 'top', material: 'wood', color: '#9a8466' }] }),
    },
    concepts: ['table', 'stand', 'foot'],
    minIou: 0.45,
    limit:
      'The tour model is a vase-shaped turned table: the pedestal table has a flat top and a cross foot.',
  },
  // ---------------------------------------------------------------- storage
  {
    id: 'loft-wardrobe',
    team: 'storage',
    label: 'Wardrobe',
    answers: {
      pilot: j({ kind: 'wardrobe', parts: ['doors'] }),
      profile: j({
        profile: [
          { view: 'front', body: [0, 0, 1, 1], top: 'flat', sides: 'straight', symmetric: true },
        ],
      }),
      legs: j({ legs: [] }),
      fronts: j({
        fronts: Array.from({ length: 8 }, (_, i) => ({
          view: 'front',
          kind: 'door',
          box: [i / 8 + 0.005, 0.02, (i + 1) / 8 - 0.005, 0.98],
        })),
      }),
      shelves: j({ shelves: { count: 0, open: false } }),
      finishes: j({ finishes: [{ finish: 'carcass', material: 'wood', color: '#d6d0c8' }] }),
    },
    concepts: ['frame', 'door', 'handle'],
    minIou: 0.85,
  },
  {
    id: 'loft-wall-cabinet',
    team: 'storage',
    label: 'Wall cabinet',
    answers: {
      pilot: j({ kind: 'cabinet', parts: ['doors'] }),
      profile: j({
        profile: [
          { view: 'front', body: [0, 0, 1, 1], top: 'flat', sides: 'straight', symmetric: true },
        ],
      }),
      legs: j({ legs: [] }),
      fronts: j({
        fronts: [
          { view: 'front', kind: 'door', box: [0.02, 0.03, 0.49, 0.97] },
          { view: 'front', kind: 'door', box: [0.51, 0.03, 0.98, 0.97] },
        ],
      }),
      shelves: j({ shelves: { count: 1, open: false } }),
      finishes: j({ finishes: [{ finish: 'carcass', material: 'wood', color: '#e9e6e1' }] }),
    },
    concepts: ['frame', 'door', 'handle'],
    minIou: 0.85,
  },
  {
    id: 'loft-shelf',
    team: 'storage',
    label: 'Wall shelves',
    answers: {
      pilot: j({ kind: 'shelf', parts: ['open_shelves'] }),
      profile: j({
        profile: [
          { view: 'front', body: [0, 0, 1, 1], top: 'flat', sides: 'straight', symmetric: true },
        ],
      }),
      legs: j({ legs: [] }),
      fronts: j({ fronts: [] }),
      shelves: j({ shelves: { count: 2, open: true } }),
      finishes: j({ finishes: [{ finish: 'carcass', material: 'wood', color: '#6e5440' }] }),
    },
    concepts: ['shelf', 'frame'],
    minIou: 0.05,
    limit:
      'The tour model is the shelves and their plants as one filled outline; the open shelving builder shows the boards only.',
  },
  // -------------------------------------------------------------------- bed
  {
    id: 'bedroom-bed',
    team: 'bed',
    label: 'Bed',
    answers: {
      pilot: j({ kind: 'double', parts: ['mattress', 'blanket', 'pillows', 'frame'] }),
      profile: j({
        profile: [
          {
            view: 'front',
            body: [0, 0, 1, 1],
            top: 'flat',
            sides: 'straight',
            symmetric: true,
            lines: { mattress: 0.4 },
          },
          { view: 'side', body: [0, 0, 1, 1], top: 'stepped', sides: 'straight' },
        ],
      }),
      legs: j({ legs: [] }),
      bedding: j({ bedding: { pillows: 3, headboard: false, blanket: true } }),
      finishes: j({
        finishes: [
          { finish: 'frame', material: 'wood', color: '#4b3a2b' },
          { finish: 'sheet', material: 'fabric', color: '#7d6655' },
          { finish: 'blanket', material: 'fabric', color: '#bba58a' },
          { finish: 'pillow', material: 'fabric', color: '#d9d2c6' },
        ],
      }),
    },
    concepts: ['frame', 'mattress', 'cushion'],
    minIou: 0.7,
    limit:
      'Side view: the tour bed pillows stand upright against the wall, the bed builder lays them on the mattress.',
  },
  {
    id: 'loft-bed',
    team: 'bed',
    label: 'Bed',
    answers: {
      pilot: j({ kind: 'double', parts: ['headboard', 'mattress', 'blanket', 'pillows'] }),
      profile: j({
        profile: [
          { view: 'front', body: [0, 0, 1, 1], top: 'flat', sides: 'straight', symmetric: true },
          { view: 'side', body: [0, 0, 1, 1], top: 'stepped', sides: 'straight' },
        ],
      }),
      legs: j({ legs: [] }),
      bedding: j({ bedding: { pillows: 2, headboard: true, blanket: true } }),
      finishes: j({
        finishes: [
          { finish: 'frame', material: 'wood', color: '#5a4636' },
          { finish: 'sheet', material: 'fabric', color: '#e8e4dc' },
        ],
      }),
    },
    concepts: ['frame', 'mattress', 'cushion'],
    minIou: 0.6,
    limit: 'The tour model has four tall pillows standing above the headboard.',
  },
];
