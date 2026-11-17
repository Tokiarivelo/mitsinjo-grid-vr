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
    minIou: 0.85,
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
    minIou: 0.85,
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
      pilot: j({ kind: 'island', parts: ['top', 'waterfall', 'modesty_panel'] }),
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
          { finish: 'panel', material: 'wood', color: '#7a5a3f' },
        ],
      }),
    },
    concepts: ['table', 'leg'],
    minIou: 0.85,
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
      'The tour model counts the vase of flowers standing on the table (another object): the table team builds the table only.',
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
    minIou: 0.85,
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
    minIou: 0.85,
  },
];

/** A seat as its team reads it: lines and the legs' top as shares of the drawing height (top = 0). */
interface SeatRead {
  id: string;
  label: string;
  kind: 'sofa' | 'armchair' | 'chair' | 'stool' | 'pouf';
  seat?: number;
  arm?: number;
  /** Top of the legs on the drawing (0–1), none = sits on its body. */
  leg?: number;
  top?: 'flat' | 'rounded';
  up: { seatCushions: number; backCushions: number; arms: string; back: string; chaise?: number };
  upholstery: [material: string, color: string];
  frame: [material: string, color: string];
  parts: string[];
  concepts: string[];
  minIou?: number;
  limit?: string;
}

const seatFixture = (f: SeatRead): FurnitureFixture => {
  const lines = {
    ...(f.seat !== undefined ? { seat: f.seat } : {}),
    ...(f.arm !== undefined ? { arm: f.arm } : {}),
  };
  const top = f.top ?? 'flat';
  return {
    id: f.id,
    team: 'seat',
    label: f.label,
    answers: {
      pilot: { kind: f.kind, parts: f.parts },
      profile: {
        profile: [
          { view: 'front', body: [0, 0, 1, 1], top, sides: 'straight', symmetric: true, lines },
          { view: 'side', body: [0, 0, 1, 1], top, sides: 'straight' },
        ],
      },
      legs: {
        legs:
          f.leg === undefined
            ? []
            : [
                {
                  kind: 'leg',
                  view: 'front',
                  box: [0.03, f.leg, 0.08, 1],
                  count: 4,
                  section: 'round',
                },
              ],
      },
      upholstery: { upholstery: { chaise: 1, ...f.up } },
      finishes: {
        finishes: [
          { finish: 'upholstery', material: f.upholstery[0], color: f.upholstery[1] },
          { finish: 'frame', material: f.frame[0], color: f.frame[1] },
        ],
      },
    },
    concepts: f.concepts,
    minIou: f.minIou ?? 0.85,
    ...(f.limit ? { limit: f.limit } : {}),
  };
};

const SOFA = ['seat', 'backrest', 'arm', 'leg'];
const NO_ARM_SOFA = ['seat', 'backrest', 'leg'];
const CHAIR = ['seat', 'backrest', 'leg'];

/** The other seats of the tour, read on their drawings (lines = tour heights over the back's top). */
export const SEAT_TOUR_FIXTURES: FurnitureFixture[] = [
  seatFixture({
    id: 'loft-pouf',
    label: 'Pouf',
    kind: 'pouf',
    top: 'rounded',
    up: { seatCushions: 0, backCushions: 0, arms: 'none', back: 'none' },
    upholstery: ['fabric', '#d9d2c3'],
    frame: ['fabric', '#d9d2c3'],
    parts: [],
    concepts: ['seat'],
  }),
  seatFixture({
    id: 'hall-armchair',
    label: 'Armchair',
    kind: 'armchair',
    seat: 0.571,
    arm: 0.381,
    leg: 0.886,
    up: { seatCushions: 1, backCushions: 0, arms: 'both', back: 'straight' },
    upholstery: ['fabric', '#5b4752'],
    frame: ['wood', '#efefef'],
    parts: ['back', 'arms', 'legs'],
    concepts: SOFA,
  }),
  seatFixture({
    id: 'hall-sofa',
    label: 'Sofa',
    kind: 'sofa',
    seat: 0.526,
    arm: 0.316,
    leg: 0.842,
    up: { seatCushions: 0, backCushions: 0, arms: 'both', back: 'arched' },
    upholstery: ['fabric', '#6a95a8'],
    frame: ['metal', '#c8d6dc'],
    parts: ['back', 'arms', 'legs'],
    concepts: SOFA,
  }),
  seatFixture({
    id: 'bedroom-chair-director',
    label: 'Chair',
    kind: 'chair',
    seat: 0.348,
    leg: 0.4,
    up: { seatCushions: 0, backCushions: 0, arms: 'both', back: 'canvas' },
    upholstery: ['fabric', '#1b1b1d'],
    frame: ['wood', '#7a6a5a'],
    parts: ['back', 'arms', 'legs'],
    concepts: CHAIR,
  }),
  seatFixture({
    id: 'bedroom-chair-red',
    label: 'Chair',
    kind: 'chair',
    seat: 0.471,
    leg: 0.5,
    up: { seatCushions: 0, backCushions: 0, arms: 'both', back: 'straight' },
    upholstery: ['metal', '#c23a22'],
    frame: ['metal', '#c23a22'],
    parts: ['back', 'arms', 'legs'],
    concepts: CHAIR,
  }),
  seatFixture({
    id: 'bedroom-chair-blue',
    label: 'Chair',
    kind: 'chair',
    seat: 0.435,
    leg: 0.5,
    up: { seatCushions: 0, backCushions: 0, arms: 'both', back: 'straight' },
    upholstery: ['fabric', '#1f2e3d'],
    frame: ['metal', '#1c1c1e'],
    parts: ['back', 'arms', 'legs'],
    concepts: CHAIR,
  }),
  seatFixture({
    id: 'bedroom-stool-2',
    label: 'Stool',
    kind: 'stool',
    leg: 0.07,
    up: { seatCushions: 0, backCushions: 0, arms: 'none', back: 'none' },
    upholstery: ['wood', '#5a3d29'],
    frame: ['wood', '#5a3d29'],
    parts: ['legs', 'frame'],
    concepts: ['seat', 'leg', 'frame'],
  }),
  seatFixture({
    id: 'bath-sofa',
    label: 'Sofa',
    kind: 'sofa',
    seat: 0.543,
    arm: 0.381,
    leg: 0.829,
    up: { seatCushions: 0, backCushions: 0, arms: 'both', back: 'arched' },
    upholstery: ['fabric', '#9b7f69'],
    frame: ['wood', '#efeee8'],
    parts: ['back', 'arms', 'legs'],
    concepts: SOFA,
  }),
  seatFixture({
    id: 'bath-armchair',
    label: 'Armchair',
    kind: 'armchair',
    seat: 0.52,
    arm: 0.35,
    leg: 0.85,
    up: { seatCushions: 1, backCushions: 0, arms: 'both', back: 'straight' },
    upholstery: ['fabric', '#8e8b80'],
    frame: ['wood', '#efeee8'],
    parts: ['back', 'arms', 'seat_cushions', 'legs'],
    concepts: [...SOFA, 'cushion'],
  }),
  seatFixture({
    id: 'bath-chair',
    label: 'Chair',
    kind: 'chair',
    seat: 0.545,
    leg: 0.57,
    up: { seatCushions: 0, backCushions: 0, arms: 'none', back: 'straight' },
    upholstery: ['fabric', '#121214'],
    frame: ['wood', '#c79a5c'],
    parts: ['back', 'legs'],
    concepts: CHAIR,
  }),
  seatFixture({
    id: 'salon-sofa',
    label: 'Sofa',
    kind: 'sofa',
    seat: 0.526,
    arm: 0.368,
    leg: 0.874,
    up: { seatCushions: 0, backCushions: 0, arms: 'both', back: 'straight' },
    upholstery: ['fabric', '#b58b86'],
    frame: ['wood', '#b38b55'],
    parts: ['back', 'arms', 'legs'],
    concepts: SOFA,
  }),
  seatFixture({
    id: 'salon-sofa-2',
    label: 'Sofa',
    kind: 'sofa',
    seat: 0.44,
    leg: 0.813,
    up: { seatCushions: 0, backCushions: 0, arms: 'none', back: 'straight', chaise: 0.55 },
    upholstery: ['fabric', '#8fb1c4'],
    frame: ['wood', '#a57a48'],
    parts: ['back', 'legs'],
    concepts: NO_ARM_SOFA,
  }),
  seatFixture({
    id: 'salon-stool',
    label: 'Stool',
    kind: 'stool',
    leg: 0.07,
    top: 'rounded',
    up: { seatCushions: 0, backCushions: 0, arms: 'none', back: 'none' },
    upholstery: ['wood', '#c49a64'],
    frame: ['wood', '#c49a64'],
    parts: ['legs', 'frame'],
    concepts: ['seat', 'leg', 'frame'],
  }),
  seatFixture({
    id: 'lounge-chaise',
    label: 'Sofa',
    kind: 'sofa',
    seat: 0.526,
    leg: 0.842,
    up: { seatCushions: 0, backCushions: 0, arms: 'none', back: 'arched', chaise: 0.6 },
    upholstery: ['fabric', '#d4c8b8'],
    frame: ['wood', '#efeee8'],
    parts: ['back', 'legs'],
    concepts: NO_ARM_SOFA,
  }),
  seatFixture({
    id: 'lounge-chair',
    label: 'Chair',
    kind: 'armchair',
    seat: 0.471,
    arm: 0.294,
    leg: 0.824,
    up: { seatCushions: 0, backCushions: 0, arms: 'both', back: 'arched' },
    upholstery: ['fabric', '#c9c5b5'],
    frame: ['wood', '#d4b083'],
    parts: ['back', 'arms', 'legs'],
    concepts: SOFA,
  }),
];

/** The other tables and storage of the tour. */
export const TABLE_STORAGE_TOUR_FIXTURES: FurnitureFixture[] = [
  {
    id: 'loft-crate',
    team: 'table',
    label: 'Crate table',
    answers: {
      pilot: { kind: 'side', parts: ['top'] },
      profile: {
        profile: [
          { view: 'front', body: [0, 0, 1, 1], top: 'flat', sides: 'straight', symmetric: true },
          { view: 'side', body: [0, 0, 1, 1], top: 'flat', sides: 'straight' },
        ],
      },
      legs: {
        legs: [
          { kind: 'plinth', view: 'front', box: [0, 0.05, 1, 1], count: 1, section: 'square' },
        ],
      },
      finishes: {
        finishes: [
          { finish: 'top', material: 'wood', color: '#8d8273' },
          { finish: 'frame', material: 'wood', color: '#a29886' },
        ],
      },
    },
    concepts: ['table', 'frame'],
    minIou: 0.85,
  },
  {
    id: 'bedroom-shelf',
    team: 'storage',
    label: 'Shelves',
    answers: {
      pilot: { kind: 'shelf', parts: ['open_shelves'] },
      profile: {
        profile: [
          { view: 'front', body: [0, 0, 1, 1], top: 'flat', sides: 'straight', symmetric: true },
          { view: 'side', body: [0, 0, 1, 1], top: 'flat', sides: 'straight' },
        ],
      },
      legs: {
        legs: [{ kind: 'frame', view: 'front', box: [0, 0, 0.02, 1], count: 4, section: 'square' }],
      },
      fronts: { fronts: [] },
      shelves: { shelves: { count: 3, open: true } },
      finishes: {
        finishes: [
          { finish: 'carcass', material: 'wood', color: '#9a7550' },
          { finish: 'frame', material: 'metal', color: '#2b2b2d' },
        ],
      },
    },
    concepts: ['shelf', 'frame'],
    minIou: 0.15,
    limit:
      'Open rack (pitfall § 8): its boards are one cell of the 64 px grid; the tour rack has middle posts and no top board (posts rise above it), the builder four corner posts and boards evenly from floor to top.',
  },
];
