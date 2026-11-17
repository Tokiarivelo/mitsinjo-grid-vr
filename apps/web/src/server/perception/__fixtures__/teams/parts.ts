import type { FurnitureFixture } from './furniture';

/**
 * Replayed answers of the PQ-T90 teams (textile, fixture, structure, terrain, appliance, light) on
 * the validated drawings of the 360° tour objects of each class, the tour's model as shape target.
 * Every answer is what the team's specialists read: kinds and closed names, shares of the drawing.
 */

type Finish = [finish: string, material: string, color: string];

/** One fixture: the pilot, a full-frame profile (with its lines), the supports, own tools, finishes. */
export function partsFixture(f: {
  id: string;
  team: FurnitureFixture['team'];
  label: string;
  kind: string;
  parts?: string[];
  lines?: Record<string, number>;
  top?: string;
  legs?: object[];
  own: Record<string, unknown>;
  finishes: Finish[];
  concepts: string[];
  outline?: boolean;
  minIou?: number;
  limit?: string;
}): FurnitureFixture {
  const top = f.top ?? 'flat';
  return {
    id: f.id,
    team: f.team,
    label: f.label,
    answers: {
      pilot: { kind: f.kind, parts: f.parts ?? [] },
      profile: {
        profile: [
          {
            view: 'front',
            body: [0, 0, 1, 1],
            top,
            sides: 'straight',
            symmetric: true,
            ...(f.lines ? { lines: f.lines } : {}),
          },
          { view: 'side', body: [0, 0, 1, 1], top, sides: 'straight' },
        ],
      },
      legs: { legs: f.legs ?? [] },
      ...f.own,
      finishes: {
        finishes: f.finishes.map(([finish, material, color]) => ({ finish, material, color })),
      },
    },
    concepts: f.concepts,
    ...(f.outline ? { outline: true } : {}),
    minIou: f.minIou ?? 0.85,
    ...(f.limit ? { limit: f.limit } : {}),
  };
}

const curtainFx = (id: string, color: string, hang = 'track') =>
  partsFixture({
    id,
    team: 'textile',
    label: 'Curtain',
    kind: 'curtain',
    parts: ['track'],
    own: { drape: { drape: { hang, rods: 0, folds: 'soft', pool: false, tied: false } } },
    finishes: [['fabric', 'fabric', color]],
    concepts: ['curtain'],
    outline: true,
  });

const rugFx = (id: string, color: string) =>
  partsFixture({
    id,
    team: 'textile',
    label: 'Rug',
    kind: 'rug',
    own: { drape: { drape: { hang: 'floor', rods: 0, folds: 'flat', pool: false } } },
    finishes: [['fabric', 'fabric', color]],
    concepts: ['cushion'],
  });

export const TEXTILE_FIXTURES: FurnitureFixture[] = [
  curtainFx('loft-curtain', '#e6e6e4'),
  curtainFx('hall-curtain-1', '#ecedef'),
  curtainFx('hall-curtain-2', '#ecedef'),
  curtainFx('salon-curtain-1', '#e9c9cc'),
  curtainFx('salon-curtain-2', '#e3c4c4'),
  {
    ...curtainFx('bedroom-drape', '#c4321e', 'rod'),
    minIou: 0.6,
    limit:
      'The tour model adds a gold panel standing beside the red drape (a second cloth): one cloth on the outline here.',
  },
  partsFixture({
    id: 'bedroom-backdrop',
    team: 'textile',
    label: 'Photo backdrop',
    kind: 'backdrop',
    parts: ['rolls'],
    own: { drape: { drape: { hang: 'stand', rods: 3, folds: 'flat', pool: false } } },
    finishes: [
      ['fabric', 'paper', '#141518'],
      ['roll', 'paper', '#2e6f9e'],
      ['roll', 'paper', '#b6382c'],
      ['roll', 'paper', '#1c1c1c'],
    ],
    concepts: ['curtain', 'rail'],
    outline: true,
  }),
  partsFixture({
    id: 'salon-backdrop',
    team: 'textile',
    label: 'Photo backdrop',
    kind: 'backdrop',
    own: { drape: { drape: { hang: 'stand', rods: 0, folds: 'flat', pool: true } } },
    finishes: [['fabric', 'paper', '#73574a']],
    concepts: ['curtain'],
    outline: true,
  }),
  {
    ...rugFx('loft-rug', '#b9b2a3'),
    minIou: 0,
    limit:
      'Side view of a 4 cm rug 2.8 m long: thinner than one cell of the 64 px grid, both masks hit or miss a row by rounding (front view 1.00).',
  },
  rugFx('lounge-rug', '#a9adae'),
];

type Box = [number, number, number, number];
const op = (kind: string, box: Box, panes?: [number, number], head?: string) => ({
  view: 'front',
  kind,
  box,
  ...(panes ? { panes } : {}),
  ...(head ? { head } : {}),
});
const FULL: Box = [0.02, 0.03, 0.98, 0.97];

const fixtureFx = (
  id: string,
  label: string,
  kind: string,
  openings: object[],
  finishes: Finish[],
  concepts: string[],
  more: Partial<Parameters<typeof partsFixture>[0]> = {}
) =>
  partsFixture({
    id,
    team: 'fixture',
    label,
    kind,
    own: { openings: { openings } },
    finishes,
    concepts,
    ...more,
  });

const WINDOW = ['window', 'window_pane'];
const MIRROR = ['frame', 'mirror'];
const DOOR = ['frame', 'door', 'handle'];

export const FIXTURE_FIXTURES: FurnitureFixture[] = [
  fixtureFx(
    'loft-window',
    'Window',
    'window',
    [op('glass', FULL, [4, 3])],
    [
      ['frame', 'wood', '#f0efea'],
      ['glass', 'glass', '#a9c3d6'],
    ],
    WINDOW
  ),
  fixtureFx(
    'hall-door',
    'Door',
    'door',
    [
      op('glass_leaf', [0.04, 0.03, 0.5, 1], [2, 6]),
      op('glass_leaf', [0.5, 0.03, 0.96, 1], [2, 6]),
    ],
    [['frame', 'wood', '#efefec']],
    ['frame', 'window_pane', 'handle']
  ),
  fixtureFx(
    'bedroom-vanity',
    'Vanity mirror lights',
    'vanity',
    [
      op('mirror', [0.164, 0.19, 0.836, 0.881]),
      op('bulb', [0.166, 0.026, 0.234, 0.116]),
      op('bulb', [0.366, 0.003, 0.434, 0.093]),
      op('bulb', [0.566, 0.003, 0.634, 0.093]),
      op('bulb', [0.766, 0.026, 0.834, 0.116]),
      op('bulb', [0.039, 0.241, 0.107, 0.331]),
      op('bulb', [0.039, 0.491, 0.107, 0.581]),
      op('bulb', [0.039, 0.741, 0.107, 0.831]),
      op('bulb', [0.893, 0.241, 0.961, 0.331]),
      op('bulb', [0.893, 0.491, 0.961, 0.581]),
      op('bulb', [0.893, 0.776, 0.961, 0.866]),
    ],
    [
      ['frame', 'wood', '#4b3a2c'],
      ['glass', 'glass', '#c8b49a'],
      ['bulb', 'glass', '#dedad2'],
    ],
    ['frame', 'screen', 'lamp']
  ),
  fixtureFx(
    'bedroom-door',
    'Door',
    'door',
    [op('leaf', [0.05, 0.03, 0.95, 1])],
    [['frame', 'wood', '#e19d26']],
    DOOR
  ),
  fixtureFx(
    'bedroom-window',
    'Window',
    'window',
    [op('glass', FULL, [1, 1])],
    [
      ['frame', 'wood', '#e8e8e4'],
      ['glass', 'glass', '#f2f4f5'],
    ],
    WINDOW
  ),
  fixtureFx(
    'bath-mirror-2',
    'Mirror',
    'mirror',
    [op('mirror', FULL, [3, 4], 'arch')],
    [
      ['frame', 'wood', '#efede7'],
      ['glass', 'glass', '#7b7a72'],
    ],
    MIRROR
  ),
  fixtureFx(
    'bath-mirror',
    'Mirror',
    'mirror',
    [op('mirror', FULL, [4, 6], 'arch')],
    [
      ['frame', 'wood', '#e9e6de'],
      ['glass', 'glass', '#8d8a80'],
    ],
    MIRROR
  ),
  fixtureFx(
    'bath-door',
    'Door',
    'window',
    [op('glass', [0.08, 0.1, 0.92, 1], [2, 4])],
    [
      ['frame', 'wood', '#efefec'],
      ['glass', 'glass', '#e9eff3'],
    ],
    WINDOW
  ),
  fixtureFx(
    'lounge-door',
    'Door',
    'door',
    [op('leaf', [0.05, 0.03, 0.95, 1])],
    [['frame', 'wood', '#d9dadb']],
    DOOR
  ),
  fixtureFx(
    'lounge-mirror-1',
    'Mirror',
    'mirror',
    [op('mirror', FULL, [2, 4])],
    [
      ['frame', 'wood', '#d7d6d1'],
      ['glass', 'glass', '#9c9a93'],
    ],
    MIRROR
  ),
  fixtureFx(
    'lounge-mirror-2',
    'Mirror',
    'mirror',
    [op('mirror', FULL, [2, 4])],
    [
      ['frame', 'wood', '#d7d6d1'],
      ['glass', 'glass', '#9c9a93'],
    ],
    MIRROR
  ),
  fixtureFx(
    'lounge-window-1',
    'Window',
    'window',
    [op('glass', FULL, [4, 7])],
    [
      ['frame', 'wood', '#efefef'],
      ['glass', 'glass', '#d6e6ee'],
    ],
    WINDOW
  ),
  fixtureFx(
    'lounge-window-2',
    'Window',
    'window',
    [op('glass', FULL, [4, 7])],
    [
      ['frame', 'wood', '#efefef'],
      ['glass', 'glass', '#d6e6ee'],
    ],
    WINDOW
  ),
  fixtureFx(
    'lounge-painting',
    'Painting',
    'painting',
    [op('canvas', [0, 0.105, 0.409, 1]), op('canvas', [0.539, 0, 1, 1])],
    [['canvas', 'fabric', '#c9bfb6']],
    ['sign']
  ),
];

const latticeFx = (
  id: string,
  label: string,
  kind: string,
  lattice: object,
  finishes: Finish[],
  concepts: string[],
  more: Partial<Parameters<typeof partsFixture>[0]> = {}
) =>
  partsFixture({
    id,
    team: 'structure',
    label,
    kind,
    own: { lattice: { lattice } },
    finishes,
    concepts,
    ...more,
  });

export const STRUCTURE_FIXTURES: FurnitureFixture[] = [
  latticeFx(
    'terrace-railing-1',
    'Railing',
    'railing',
    { pattern: 'scroll', bars: 30, posts: [0.01, 0.42, 0.72, 0.99] },
    [['frame', 'metal', '#2c2e33']],
    ['rail', 'pole']
  ),
  latticeFx(
    'terrace-railing-2',
    'Railing',
    'railing',
    { pattern: 'scroll', bars: 28, posts: [0.01, 0.5, 0.99] },
    [['frame', 'metal', '#2c2e33']],
    ['rail', 'pole']
  ),
  latticeFx(
    'terrace-pylon',
    'Power pylon',
    'pylon',
    {
      pattern: 'lattice',
      bars: 0,
      levels: 9,
      top: 0.233,
      foot: 0.882,
      arms: [
        [0.32, 1],
        [0.12, 0.706],
      ],
    },
    [['frame', 'metal', '#8d939a']],
    ['pole', 'rail']
  ),
  latticeFx(
    'street-fence',
    'Fence',
    'fence',
    { pattern: 'boards', bars: 35, pillars: 3 },
    [
      ['frame', 'wood', '#6a5545'],
      ['pillar', 'stone', '#9c8670'],
    ],
    ['timber_beam', 'rail', 'stone_foundation']
  ),
  latticeFx(
    'street-gate',
    'Gate',
    'gate',
    { pattern: 'boards', bars: 4, pillars: 2 },
    [
      ['frame', 'wood', '#5d4a3c'],
      ['pillar', 'stone', '#9c8670'],
    ],
    ['timber_beam', 'stone_foundation']
  ),
  latticeFx(
    'street-fence-2',
    'Fence',
    'fence',
    { pattern: 'boards', bars: 30, base: true },
    [
      ['frame', 'wood', '#ecedee'],
      ['base', 'stone', '#9a8b78'],
    ],
    ['timber_beam', 'stone_foundation']
  ),
];
