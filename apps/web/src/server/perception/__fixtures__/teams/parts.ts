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
