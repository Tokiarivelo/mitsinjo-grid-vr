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

const terrainFx = (
  id: string,
  label: string,
  kind: string,
  color: string,
  more: Partial<Parameters<typeof partsFixture>[0]> = {}
) =>
  partsFixture({
    id,
    team: 'terrain',
    label,
    kind,
    top: 'rounded',
    own: {},
    finishes: [['surface', kind === 'tyre' ? 'rubber' : kind === 'log' ? 'wood' : 'stone', color]],
    concepts: [kind === 'tyre' ? 'wheel' : kind === 'log' ? 'tree_trunk' : 'stone_foundation'],
    outline: kind !== 'tyre',
    ...more,
  });

export const TERRAIN_FIXTURES: FurnitureFixture[] = [
  terrainFx('garden-tyre-1', 'Tyre', 'tyre', '#5a5644'),
  terrainFx('garden-tyre-2', 'Tyre', 'tyre', '#5a5644'),
  terrainFx('garden-log', 'Fallen log', 'log', '#6b5f50'),
  terrainFx('forest-log', 'Fallen log', 'log', '#4b4136'),
  terrainFx('forest-rock', 'Rock', 'rock', '#4e4a32', {
    minIou: 0.7,
    limit:
      'The tour model of this rock is three hand-sculpted SDF blobs, not its outline: the team cuts the rock to the traced outline (its other rocks match it at 1.00).',
  }),
  terrainFx('forest-rock-2', 'Rock', 'rock', '#7d786c'),
  terrainFx('forest-rock-3', 'Rock', 'rock', '#8a877e'),
  terrainFx('forest-rock-4', 'Rock', 'rock', '#545a2f'),
  terrainFx('forest-rock-5', 'Rock', 'rock', '#56592f'),
];

const applianceFx = (f: {
  id: string;
  label: string;
  kind: string;
  controls: object[];
  finishes: Finish[];
  concepts: string[];
  parts?: string[];
  lines?: Record<string, number>;
  top?: string;
  legs?: object[];
  minIou?: number;
  limit?: string;
}) =>
  partsFixture({
    ...f,
    team: 'appliance',
    own: { controls: { controls: f.controls } },
  });

const FIREPLACE_LIMIT =
  'Side view: the tour fireplace gives its mantel, jambs, firebox and hearth each their own depth (the mantel runs behind the jambs); the builder has one body depth with the hearth and mantel standing out of it (0.84).';

export const APPLIANCE_FIXTURES: FurnitureFixture[] = [
  applianceFx({
    id: 'loft-fridge',
    label: 'Fridge',
    kind: 'fridge',
    top: 'rounded',
    parts: ['door', 'handle', 'plinth'],
    legs: [
      { kind: 'plinth', view: 'front', box: [0.05, 0.907, 0.95, 1], count: 1, section: 'square' },
    ],
    controls: [
      op('seam', [0.016, 0.726, 0.984, 0.734]),
      op('handle', [0.077, 0.149, 0.133, 0.301]),
    ],
    finishes: [
      ['body', 'metal', '#e7e7e3'],
      ['handle', 'metal', '#b9bcbf'],
      ['grille', 'metal', '#9a9a96'],
      ['base', 'metal', '#dcdcd8'],
    ],
    concepts: ['door', 'handle', 'base'],
  }),
  ...(
    [
      ['loft-ac', 14],
      ['hall-ac', 12],
    ] as const
  ).map(([id, perRow]) =>
    applianceFx({
      id,
      label: 'Air conditioner',
      kind: 'air_conditioner',
      parts: ['slots', 'grille'],
      controls: [
        op('slots', [0.05, 0.07, 0.95, 0.6], [perRow, 4]),
        op('grille', [0.04, 0.87, 0.96, 0.97]),
      ],
      finishes: [
        ['body', 'plastic', '#e9e9e6'],
        ['grille', 'plastic', '#2a2a2a'],
      ],
      concepts: ['fan_guard', 'grille'],
    })
  ),
  applianceFx({
    id: 'loft-hood',
    label: 'Range hood',
    kind: 'hood',
    parts: ['flue'],
    lines: { canopy: 0.46 },
    controls: [],
    finishes: [['body', 'metal', '#ececea']],
    concepts: ['pipe'],
  }),
  applianceFx({
    id: 'loft-radiator',
    label: 'Radiator cover',
    kind: 'radiator',
    parts: ['grille', 'top_board'],
    controls: [],
    finishes: [
      ['body', 'wood', '#dedcd6'],
      ['top', 'wood', '#e8e6e0'],
    ],
    concepts: ['grille', 'table'],
  }),
  applianceFx({
    id: 'hall-fireplace',
    label: 'Electric fireplace',
    kind: 'fireplace',
    parts: ['mantel', 'firebox'],
    controls: [
      op('mantel', [0.034, 0, 0.966, 0.064]),
      op('jamb', [0.075, 0.166, 0.19, 0.835]),
      op('jamb', [0.81, 0.166, 0.925, 0.835]),
      op('firebox', [0.264, 0.29, 0.736, 0.835]),
      op('logs', [0.36, 0.7, 0.64, 0.84]),
      op('hearth', [0, 0.89, 1, 1]),
    ],
    finishes: [
      ['body', 'stone', '#e6e4e0'],
      ['firebox', 'stone', '#bdb8b0'],
      ['base', 'stone', '#d3d0ca'],
    ],
    concepts: ['table', 'leg', 'stone_foundation', 'base'],
    minIou: 0.8,
    limit: FIREPLACE_LIMIT,
  }),
  applianceFx({
    id: 'lounge-fireplace',
    label: 'Fireplace',
    kind: 'fireplace',
    parts: ['mantel', 'firebox'],
    controls: [
      op('mantel', [0, 0.36, 1, 0.39]),
      op('jamb', [0.165, 0.4, 0.38, 0.95]),
      op('jamb', [0.62, 0.4, 0.835, 0.95]),
      op('firebox', [0.23, 0.43, 0.77, 0.95]),
      op('logs', [0.24, 0.76, 0.76, 0.95]),
      op('hearth', [0, 0.95, 1, 1]),
    ],
    finishes: [
      ['body', 'wood', '#e4e2de'],
      ['firebox', 'wood', '#5d4634'],
      ['base', 'stone', '#d3d0ca'],
    ],
    concepts: ['table', 'leg', 'stone_foundation', 'base'],
    minIou: 0.8,
    limit: FIREPLACE_LIMIT,
  }),
];

const lightFx = (
  id: string,
  label: string,
  kind: string,
  lamp: { shade: string; bulbs: number; arm: string; taper?: number },
  finishes: Finish[],
  concepts: string[],
  more: Partial<Parameters<typeof partsFixture>[0]> = {}
) =>
  partsFixture({
    id,
    team: 'light',
    label,
    kind,
    own: { lamp: { lamp } },
    finishes,
    concepts,
    ...more,
  });

const DISC: Finish[] = [
  ['frame', 'metal', '#d9d9d6'],
  ['shade', 'plastic', '#efefec'],
];

export const LIGHT_FIXTURES: FurnitureFixture[] = [
  lightFx(
    'bath-ceiling-1',
    'Ceiling light',
    'ceiling',
    { shade: 'disc', bulbs: 0, arm: 'none' },
    DISC,
    ['frame', 'lamp']
  ),
  lightFx(
    'bath-ceiling-2',
    'Ceiling light',
    'ceiling',
    { shade: 'disc', bulbs: 0, arm: 'none' },
    DISC,
    ['frame', 'lamp']
  ),
  lightFx(
    'salon-ceiling',
    'Ceiling light',
    'ceiling',
    { shade: 'disc', bulbs: 0, arm: 'none' },
    DISC,
    ['frame', 'lamp']
  ),
  lightFx(
    'lounge-ceiling',
    'Ceiling light',
    'ceiling',
    { shade: 'panel', bulbs: 0, arm: 'none' },
    [
      ['frame', 'plastic', '#e1e1df'],
      ['shade', 'plastic', '#f2f2f0'],
    ],
    ['frame', 'lamp']
  ),
  lightFx(
    'salon-chandelier',
    'Chandelier',
    'chandelier',
    { shade: 'bowl', bulbs: 8, arm: 'none' },
    [
      ['frame', 'metal', '#a8894f'],
      ['shade', 'glass', '#cdc6b6'],
      ['bulb', 'plastic', '#efe6d2'],
    ],
    ['pipe', 'lamp', 'arm']
  ),
  ...['lounge-sconce-1', 'lounge-sconce-2'].map((id) =>
    lightFx(
      id,
      'Wall lamp',
      'sconce',
      { shade: 'cone', bulbs: 0, arm: 'none' },
      [
        ['frame', 'metal', '#e9e9e5'],
        ['shade', 'metal', '#ecece8'],
      ],
      ['base', 'arm', 'lamp']
    )
  ),
  ...(
    [
      ['street-lamp', 'right'],
      ['street-lamp-2', 'left'],
    ] as const
  ).map(([id, arm]) =>
    lightFx(
      id,
      'Street light',
      'street_lamp',
      { shade: 'box', bulbs: 0, arm },
      [
        ['frame', 'metal', '#9da3aa'],
        ['shade', 'metal', '#bfc4c9'],
      ],
      ['pole', 'arm', 'lamp']
    )
  ),
  ...(
    [
      ['house-wall-lamp', 0.72],
      ['house-wall-lamp-2', 0.6],
    ] as const
  ).map(([id, taper]) =>
    lightFx(
      id,
      'Wall lamp',
      'wall_lantern',
      { shade: 'lantern', bulbs: 0, arm: 'none', taper },
      [
        ['frame', 'metal', '#2f3236'],
        ['shade', 'glass', '#454a50'],
      ],
      ['lid', 'lamp', 'base'],
      id === 'house-wall-lamp-2'
        ? {
            minIou: 0.75,
            limit:
              'Its glass is taller and its lid flatter than the lantern builder draws them: the share of glass, lid and hook inside a lantern is not read (0.79).',
          }
        : {}
    )
  ),
  lightFx(
    'bedroom-softbox',
    'Studio light',
    'studio',
    { shade: 'box', bulbs: 0, arm: 'none' },
    [['shade', 'fabric', '#e4e2de']],
    ['screen'],
    {
      minIou: 0.3,
      limit:
        'Two octagonal softboxes leaning on their stands: the light team builds one lit panel on the box (a studio light kit is two fittings).',
    }
  ),
  lightFx(
    'hall-letters',
    'Light-up letters',
    'sign',
    { shade: 'box', bulbs: 0, arm: 'none' },
    [['shade', 'metal', '#e8e3d6']],
    ['screen'],
    {
      minIou: 0.2,
      limit:
        'Marquee letters « MARRY »: a lit sign is its glyph outlines, not a fitting; the light team gives one lit panel on the box.',
    }
  ),
];
