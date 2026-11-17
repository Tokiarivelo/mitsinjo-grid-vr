import { box, door, glazing, partsBounds, sphere, type PartSpec } from '../../furniture';
import {
  openingsAnswered,
  openingsSpec,
  parseOpenings,
  type ReadOpening,
} from '../shared/openings';
import { objectFrame } from '../shared/common';
import {
  FURNITURE_VIEWS,
  enumField,
  finishColor,
  footprint,
  furnitureTeam,
  type FurnitureReading,
} from './furniture';

/**
 * The fixture team (PQ-T90): doors, windows, mirrors, paintings and frames, a lit vanity mirror.
 * Shared profile and finishes, and the shared openings specialist in its own vocabulary (leaves,
 * glazed leaves, panes, mirror glass, canvases, bulbs) with panes and arched heads. `fixtureParts`
 * builds the door or glazing builder (`furniture/openings.ts`) from what it lists.
 */

export const FIXTURE_KINDS = ['door', 'window', 'mirror', 'painting', 'vanity'] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];
export const FIXTURE_PARTS = [
  'frame',
  'leaves',
  'glass',
  'panes',
  'arch',
  'bulbs',
  'handle',
] as const;
export const FIXTURE_OPENINGS = [
  'leaf',
  'glass_leaf',
  'glass',
  'mirror',
  'canvas',
  'bulb',
] as const;

const NOUN = 'fixture';
const SUBJECT = 'ONE wall fixture (a door, a window, a mirror, a painting or a lit vanity mirror)';

export const FIXTURE_OPENINGS_CFG = {
  subject: SUBJECT,
  frame: objectFrame(NOUN),
  what: 'every leaf of a door, every glass area, mirror glass, painted canvas and light bulb',
  key: 'openings',
  kinds: FIXTURE_OPENINGS,
  views: FURNITURE_VIEWS,
  shape: 'box' as const,
  panes: true,
  heads: true,
  notes: [
    'leaf = a solid door leaf, glass_leaf = a glazed door leaf, glass = the glass of a window, mirror = the mirror glass, canvas = one painted canvas or print (a diptych = 2), bulb = one bulb around a vanity mirror.',
  ],
  schemaName: 'FixtureOpenings',
  task: 'List its leaves, glass areas with their panes, mirror glass, canvases and bulbs.',
};

/** 1: first version. */
export const FIXTURE_PROMPT_VERSION = 1;

export const FIXTURE_TEAM = furnitureTeam({
  id: 'fixture',
  promptVersion: FIXTURE_PROMPT_VERSION,
  noun: NOUN,
  subject: SUBJECT,
  kinds: FIXTURE_KINDS,
  parts: FIXTURE_PARTS,
  finishes: [
    ['frame', 'the frame, the leaves or the sash'],
    ['glass', 'the glass or the mirror as it looks'],
    ['canvas', 'a painted canvas'],
    ['bulb', 'the bulbs'],
  ],
  materials: ['wood', 'metal', 'glass', 'plastic', 'fabric'],
  own: {
    openings: {
      spec: openingsSpec(FIXTURE_OPENINGS_CFG),
      answered: (c: string | null | undefined) => openingsAnswered(c, FIXTURE_OPENINGS_CFG),
    },
  },
  parseOwn: (a): ReadOpening[] => parseOpenings(a.openings, FIXTURE_OPENINGS_CFG),
  ownSummary: (o) => `${o.length} openings`,
});

export type FixtureReading = FurnitureReading<ReadOpening[]>;

/** Usual height of each kind (metres): only the proportions matter, the builders want metres. */
const FIXTURE_HEIGHT: Record<FixtureKind, number> = {
  door: 2.1,
  window: 2.4,
  mirror: 1.3,
  painting: 0.9,
  vanity: 0.84,
};

const front = (r: FixtureReading, kinds: ReadonlyArray<string>) =>
  r.own.filter((o) => o.view === 'front' && kinds.includes(o.kind) && o.box);

/** A box on the front drawing (shares, y down) → centre x, y and size on a `w` × `h` front. */
const place = (b: [number, number, number, number], w: number, h: number) => ({
  x: ((b[0] + b[2]) / 2 - 0.5) * w,
  y: (1 - (b[1] + b[3]) / 2) * h,
  w: (b[2] - b[0]) * w,
  h: (b[3] - b[1]) * h,
});

/**
 * A fixture reading on its measured proportions (largest side = 1) → its builder's parts. A door,
 * window or mirror is a frame of fixed depth: its height is the one that gives the measured depth
 * over height (a tall mirror is not drawn as thick as a small one), between 0.3 and 4 m.
 */
export function fixtureParts(
  r: FixtureReading,
  p: { w: number; h: number; d: number }
): PartSpec[] {
  const kind = enumField(r.kind, FIXTURE_KINDS, 'window');
  const h0 = FIXTURE_HEIGHT[kind];
  if (kind === 'painting' || kind === 'vanity' || p.d <= 0) return fixtureAt(r, kind, h0, p);
  const depth = partsBounds(fixtureAt(r, kind, h0, p)).dims[2];
  return fixtureAt(r, kind, Math.max(0.3, Math.min(4, (depth * p.h) / p.d)), p);
}

function fixtureAt(
  r: FixtureReading,
  kind: FixtureKind,
  h: number,
  p: { w: number; h: number; d: number }
): PartSpec[] {
  const { w } = footprint(h, p);
  const frame = finishColor(r, ['frame'], '#e8e7e3');
  const glass = finishColor(r, ['glass'], kind === 'mirror' ? '#8d8a80' : '#a9c3d6');
  if (kind === 'door') {
    const leaves = front(r, ['leaf', 'glass_leaf']);
    const glassy = leaves.find((l) => l.kind === 'glass_leaf');
    // The door builder's frame overhangs its leaves by 6 cm a side: the leaves are what is left.
    return door(Math.max(0.3, w - 0.12), h - 0.06, frame, {
      leaves: Math.max(1, Math.min(4, leaves.length)),
      ...(glassy?.panes ? { glass: glassy.panes } : {}),
    });
  }
  if (kind === 'painting') {
    const canvases = front(r, ['canvas']);
    const color = finishColor(r, ['canvas'], '#c9bfb6');
    const list = canvases.length
      ? canvases
      : [{ box: [0, 0, 1, 1] as [number, number, number, number] }];
    return list.map((c) => {
      const q = place(c.box!, w, h);
      return box([q.x, q.y, 0], [q.w, q.h, 0.03], color, {
        material: 'fabric',
        kind: 'body',
        concept: 'sign',
      });
    });
  }
  if (kind === 'vanity') {
    const bulb = finishColor(r, ['bulb'], '#dedad2');
    const mirror = front(r, ['mirror'])[0]?.box ?? [0.16, 0.2, 0.84, 0.88];
    const m = place(mirror, w, h);
    return [
      box([0, h / 2, 0], [w, h, 0.05], frame, {
        material: 'wood',
        kind: 'frame',
        concept: 'frame',
      }),
      box([m.x, m.y, 0.03], [m.w, m.h, 0.01], glass, {
        material: 'glass',
        kind: 'display',
        concept: 'screen',
      }),
      ...front(r, ['bulb']).map((b) => {
        const q = place(b.box!, w, h);
        return sphere([q.x, q.y, 0.06], [q.w, q.h, 0.06], bulb, {
          material: 'glass',
          kind: 'light',
          concept: 'lamp',
        });
      }),
    ];
  }
  // A window or a mirror: one glazed frame, its panes and its head as read.
  const pane = front(r, ['glass', 'mirror'])[0];
  const [cols, rows] = pane?.panes ?? [1, 1];
  return glazing(w, h, cols, rows, frame, glass, {
    arch: pane?.head === 'arch' || pane?.head === 'segment',
    ...(kind === 'mirror' ? { concept: 'frame', glassConcept: 'mirror' } : {}),
  });
}
