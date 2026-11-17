import {
  box,
  cone,
  cyl,
  extrude,
  glyphRing,
  hull,
  lathe,
  polygonRing,
  sphere,
  type PartSpec,
  type TourSpec,
} from './spec';
import { airUnit, ceilingDisc as ceilingDiscParts, sconce as sconceParts } from '../furniture';

/**
 * The studio rooms' objects (VS-T41), modelled on their photo (`public/tour/studio/*.jpg`).
 * Metres, x right, y up, z toward the camera. Colours are first guesses, re-measured by
 * `make tour-mock` except `fixed` ones (lit bulbs, flames).
 */

const BULB = '#fff1c9';
const GOLD = '#a8894f';

/** Five marquee letters « MARRY », traced on the photo: x0–x1 on a 0–10 grid, rings y down. */
const LETTERS: Array<{
  x0: number;
  x1: number;
  ring: Array<[number, number]>;
  bulbs: Array<[number, number]>;
}> = [
  {
    x0: 1.77,
    x1: 3.33,
    ring: [
      [1.77, 2.25],
      [2.2, 2.25],
      [2.55, 4.6],
      [2.9, 2.25],
      [3.33, 2.25],
      [3.33, 8.4],
      [2.97, 8.4],
      [2.97, 4.9],
      [2.65, 6.9],
      [2.45, 6.9],
      [2.13, 4.9],
      [2.13, 8.4],
      [1.77, 8.4],
    ],
    bulbs: [
      [1.95, 3.0],
      [1.95, 4.5],
      [1.95, 6.0],
      [1.95, 7.6],
      [3.15, 3.0],
      [3.15, 4.5],
      [3.15, 6.0],
      [3.15, 7.6],
      [2.3, 3.5],
      [2.55, 5.8],
      [2.8, 3.5],
    ],
  },
  {
    x0: 3.33,
    x1: 4.64,
    ring: [
      [3.75, 2.4],
      [4.22, 2.4],
      [4.64, 8.4],
      [4.25, 8.4],
      [4.15, 7.2],
      [3.82, 7.2],
      [3.72, 8.4],
      [3.33, 8.4],
    ],
    bulbs: [
      [3.85, 3.0],
      [4.15, 3.0],
      [3.7, 4.6],
      [4.28, 4.6],
      [3.55, 6.2],
      [3.98, 6.2],
      [4.42, 6.2],
      [3.48, 7.8],
      [4.5, 7.8],
    ],
  },
  {
    x0: 4.72,
    x1: 5.84,
    ring: [
      [4.72, 2.4],
      [5.55, 2.4],
      [5.84, 2.9],
      [5.84, 4.9],
      [5.6, 5.4],
      [5.84, 8.4],
      [5.45, 8.4],
      [5.2, 6.1],
      [5.12, 6.1],
      [5.12, 8.4],
      [4.72, 8.4],
    ],
    bulbs: [
      [4.9, 3.0],
      [5.3, 3.0],
      [5.68, 3.9],
      [4.9, 4.7],
      [5.3, 5.2],
      [4.9, 6.4],
      [5.5, 6.6],
      [4.9, 7.9],
      [5.68, 7.9],
    ],
  },
  {
    x0: 5.86,
    x1: 6.97,
    ring: [
      [5.86, 2.4],
      [6.68, 2.4],
      [6.97, 2.9],
      [6.97, 4.9],
      [6.74, 5.4],
      [6.97, 8.4],
      [6.58, 8.4],
      [6.33, 6.1],
      [6.25, 6.1],
      [6.25, 8.4],
      [5.86, 8.4],
    ],
    bulbs: [
      [6.04, 3.0],
      [6.44, 3.0],
      [6.82, 3.9],
      [6.04, 4.7],
      [6.44, 5.2],
      [6.04, 6.4],
      [6.64, 6.6],
      [6.04, 7.9],
      [6.82, 7.9],
    ],
  },
  {
    x0: 7.0,
    x1: 8.35,
    ring: [
      [7.0, 2.4],
      [7.45, 2.4],
      [7.68, 4.3],
      [7.92, 2.4],
      [8.35, 2.4],
      [7.9, 6.0],
      [7.9, 8.7],
      [7.45, 8.7],
      [7.45, 6.0],
    ],
    bulbs: [
      [7.2, 3.0],
      [8.15, 3.0],
      [7.4, 4.2],
      [7.95, 4.2],
      [7.68, 5.6],
      [7.68, 7.0],
      [7.68, 8.2],
    ],
  },
];

/** Grid units of the letters' photo crop → metres (one grid unit across ≈ 0.81 m, down ≈ 0.195 m). */
const LETTER_SX = 0.815;
const LETTER_SY = 0.195;

function marquee(): PartSpec[] {
  const parts: PartSpec[] = [];
  const depth = 0.14;
  const bottom = 8.7;
  const cx = (1.77 + 8.35) / 2;
  for (const l of LETTERS) {
    const ys = l.ring.map(([, y]) => y);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const w = (l.x1 - l.x0) * LETTER_SX;
    const h = (y1 - y0) * LETTER_SY;
    const at = [
      ((l.x0 + l.x1) / 2 - cx) * LETTER_SX,
      (bottom - (y0 + y1) / 2) * LETTER_SY,
      0,
    ] as const;
    parts.push(
      extrude(
        at,
        [w, h, depth],
        '#e7ded2',
        glyphRing(l.ring.map(([x, y]) => [(x - l.x0) / (l.x1 - l.x0), (y - y0) / (y1 - y0)])),
        {
          material: 'plastic',
          kind: 'body',
          concept: 'sign',
        }
      )
    );
    for (const [bx, by] of l.bulbs)
      parts.push(
        sphere(
          [(bx - cx) * LETTER_SX, (bottom - by) * LETTER_SY, depth / 2 + 0.02],
          [0.09, 0.09, 0.06],
          BULB,
          {
            material: 'glass',
            kind: 'light',
            concept: 'lamp',
            fixed: true,
          }
        )
      );
  }
  return parts;
}

export const INDOOR_SPECS: Record<string, TourSpec> = {
  'loft-fridge': {
    kind: 'parts',
    yaw: -0.32,
    parts: [
      extrude(
        [0, 0.79, 0],
        [0.62, 1.31, 0.6],
        '#e7e7e3',
        [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.36],
          [0.47, 0.43],
          [0.4, 0.48],
          [0.3, 0.5],
          [-0.3, 0.5],
          [-0.4, 0.48],
          [-0.47, 0.43],
          [-0.5, 0.36],
        ],
        { material: 'metal', kind: 'body', front: true, concept: 'door' }
      ),
      box([0, 0.39, 0.302], [0.6, 0.012, 0.006], '#9a9a96', { material: 'metal', kind: 'frame' }),
      box([-0.245, 1.12, 0.32], [0.035, 0.22, 0.04], '#b9bcbf', {
        material: 'metal',
        kind: 'handle',
        concept: 'handle',
      }),
      box([0, 0.07, -0.01], [0.56, 0.1, 0.55], '#dcdcd8', {
        material: 'metal',
        kind: 'plinth',
        concept: 'base',
      }),
      box([-0.23, 0.02, 0.2], [0.1, 0.04, 0.12], '#d6d6d2', {
        material: 'metal',
        kind: 'body',
        concept: 'foot',
      }),
      box([0.23, 0.02, 0.2], [0.1, 0.04, 0.12], '#d6d6d2', {
        material: 'metal',
        kind: 'body',
        concept: 'foot',
      }),
    ],
  },
  'loft-ac': { kind: 'parts', parts: airUnit(1.7, 0.42, 4, 14) },
  'hall-ac': { kind: 'parts', parts: airUnit(1.5, 0.42, 4, 12) },
  'loft-hood': {
    kind: 'parts',
    parts: [
      lathe(
        [0, 0.42, 0],
        [0.62, 0.84, 0.62],
        '#ececea',
        [
          [0.0, -0.5],
          [0.5, -0.5],
          [0.49, -0.44],
          [0.24, 0.0],
          [0.205, 0.04],
          [0.205, 0.5],
          [0.0, 0.5],
        ],
        { material: 'metal', kind: 'body', concept: 'pipe' }
      ),
      box([0.08, 0.06, 0.29], [0.03, 0.05, 0.02], '#4a4a48', {
        material: 'plastic',
        kind: 'handle',
        concept: 'control_panel',
      }),
    ],
  },
  'hall-letters': { kind: 'parts', parts: marquee() },
  'hall-fireplace': {
    kind: 'parts',
    parts: [
      box([0, 1.07, 0], [1.62, 0.07, 0.36], '#e6e4e0', {
        material: 'stone',
        kind: 'frame',
        concept: 'table',
      }),
      box([0, 0.95, 0.02], [1.5, 0.18, 0.3], '#d9d6d0', { material: 'stone', kind: 'body' }),
      box([-0.64, 0.5, 0.03], [0.2, 0.74, 0.28], '#e1ded9', {
        material: 'stone',
        kind: 'frame',
        concept: 'leg',
      }),
      box([0.64, 0.5, 0.03], [0.2, 0.74, 0.28], '#e1ded9', {
        material: 'stone',
        kind: 'frame',
        concept: 'leg',
      }),
      box([0, 0.5, -0.02], [1.08, 0.74, 0.22], '#cfcbc4', { material: 'stone', kind: 'body' }),
      box([0, 0.45, 0.05], [0.82, 0.6, 0.14], '#bdb8b0', { material: 'stone', kind: 'frame' }),
      box([0, 0.06, 0.05], [1.74, 0.12, 0.42], '#d3d0ca', {
        material: 'stone',
        kind: 'plinth',
        concept: 'base',
      }),
      cyl([-0.24, 0.24, 0.1], [0.12, 0.2, 0.12], '#f1efe9', {
        material: 'plastic',
        kind: 'light',
        concept: 'lamp',
      }),
      cyl([0.0, 0.25, 0.1], [0.12, 0.22, 0.12], '#f1efe9', {
        material: 'plastic',
        kind: 'light',
        concept: 'lamp',
      }),
      cyl([0.24, 0.22, 0.1], [0.12, 0.18, 0.12], '#f1efe9', {
        material: 'plastic',
        kind: 'light',
        concept: 'lamp',
      }),
    ],
  },
  'bedroom-vanity': {
    kind: 'parts',
    parts: [
      box([0, 0.42, 0], [1.1, 0.84, 0.05], '#4b3a2c', {
        material: 'wood',
        kind: 'frame',
        concept: 'frame',
      }),
      box([0, 0.39, 0.03], [0.74, 0.58, 0.01], '#c8b49a', {
        material: 'glass',
        kind: 'display',
        concept: 'screen',
      }),
      ...(
        [
          [-0.33, 0.78],
          [-0.11, 0.8],
          [0.11, 0.8],
          [0.33, 0.78],
          [-0.47, 0.6],
          [-0.47, 0.39],
          [-0.47, 0.18],
          [0.47, 0.6],
          [0.47, 0.39],
          [0.47, 0.15],
        ] as const
      ).map(([x, y]) =>
        sphere([x, y, 0.06], [0.075, 0.075, 0.06], '#dedad2', {
          material: 'glass',
          kind: 'light',
          concept: 'lamp',
        })
      ),
    ],
  },
  'bedroom-softbox': {
    kind: 'parts',
    parts: [
      // Two octagonal softboxes leaning back on their stands: tilted octagon slabs.
      hull(
        [-0.42, 0.62, 0.1],
        [1.1, 1.1, 0.42],
        '#e4e2de',
        polygonRing(8, Math.PI / 8),
        [
          [-0.5, 0.5],
          [-0.2, 0.5],
          [0.5, -0.5],
          [0.2, -0.5],
        ],
        { material: 'fabric', kind: 'display', concept: 'screen' }
      ),
      hull(
        [0.42, 0.92, -0.25],
        [1.0, 0.95, 0.42],
        '#e4e2de',
        polygonRing(8, Math.PI / 8),
        [
          [-0.5, 0.5],
          [-0.2, 0.5],
          [0.5, -0.5],
          [0.2, -0.5],
        ],
        { material: 'fabric', kind: 'display', concept: 'screen' }
      ),
      hull(
        [-0.42, 0.62, -0.02],
        [1.16, 1.16, 0.38],
        '#1e1e1e',
        polygonRing(8, Math.PI / 8),
        [
          [-0.5, 0.5],
          [-0.25, 0.5],
          [0.5, -0.5],
          [0.25, -0.5],
        ],
        { material: 'fabric', kind: 'frame' }
      ),
      hull(
        [0.42, 0.92, -0.37],
        [1.06, 1.0, 0.38],
        '#1e1e1e',
        polygonRing(8, Math.PI / 8),
        [
          [-0.5, 0.5],
          [-0.25, 0.5],
          [0.5, -0.5],
          [0.25, -0.5],
        ],
        { material: 'fabric', kind: 'frame' }
      ),
      cyl([-0.1, 0.9, -0.45], [0.04, 1.8, 0.04], '#8c8c8c', {
        material: 'metal',
        kind: 'body',
        concept: 'stand',
      }),
      box([-0.32, 1.32, -0.45], [0.95, 0.03, 0.03], '#9a9a9a', {
        material: 'metal',
        kind: 'body',
        concept: 'arm',
      }),
    ],
  },
  'bath-ceiling-1': ceilingDisc(0.62),
  'bath-ceiling-2': ceilingDisc(0.5),
  'salon-ceiling': ceilingDisc(0.48),
  'lounge-ceiling': {
    kind: 'parts',
    yaw: 0.38,
    parts: [
      box([0, 0.03, 0], [0.62, 0.05, 0.62], '#e1e1df', {
        material: 'plastic',
        kind: 'frame',
        concept: 'frame',
      }),
      box([0, 0.0, 0], [0.54, 0.02, 0.54], '#f2f2f0', {
        material: 'plastic',
        kind: 'light',
        concept: 'lamp',
      }),
    ],
  },
  'salon-chandelier': {
    kind: 'parts',
    parts: [
      cyl([0, 1.66, 0], [0.12, 0.06, 0.12], GOLD, { material: 'metal', kind: 'frame' }),
      cyl([0, 1.33, 0], [0.04, 0.62, 0.04], GOLD, {
        material: 'metal',
        kind: 'body',
        concept: 'pipe',
      }),
      lathe(
        [0, 0.98, 0],
        [0.32, 0.24, 0.32],
        GOLD,
        [
          [0.06, -0.5],
          [0.2, -0.3],
          [0.5, 0.5],
          [0.0, 0.5],
        ],
        {
          material: 'metal',
          kind: 'head',
        }
      ),
      lathe(
        [0, 0.55, 0],
        [0.72, 0.62, 0.72],
        '#cdc6b6',
        [
          [0.0, -0.5],
          [0.22, -0.45],
          [0.42, -0.2],
          [0.5, 0.1],
          [0.34, 0.35],
          [0.12, 0.5],
          [0.0, 0.5],
        ],
        { material: 'glass', kind: 'body', concept: 'lamp' }
      ),
      cyl([0, 0.6, 0], [1.02, 0.035, 1.02], GOLD, {
        material: 'metal',
        kind: 'frame',
        concept: 'arm',
      }),
      cone([0, 0.12, 0], [0.18, 0.26, 0.18], '#d2cbbd', { material: 'glass', kind: 'light' }),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const t = (i / 8) * Math.PI * 2 + Math.PI / 8;
        return cyl([Math.cos(t) * 0.5, 0.72, Math.sin(t) * 0.5], [0.04, 0.24, 0.04], '#efe6d2', {
          material: 'plastic',
          kind: 'light',
          concept: 'lamp',
        });
      }),
    ],
  },
  'lounge-sconce-1': sconce(),
  'lounge-sconce-2': sconce(),
  'lounge-fireplace': {
    kind: 'parts',
    parts: [
      box([0, 1.36, 0], [2.0, 0.6, 0.3], '#e4e2de', {
        material: 'wood',
        kind: 'body',
        front: true,
      }),
      box([0, 1.03, 0.04], [2.06, 0.05, 0.36], '#dedbd6', {
        material: 'wood',
        kind: 'frame',
        concept: 'table',
      }),
      box([-0.78, 0.5, 0], [0.44, 1.0, 0.3], '#e4e2de', {
        material: 'wood',
        kind: 'frame',
        concept: 'leg',
      }),
      box([0.78, 0.5, 0], [0.44, 1.0, 0.3], '#e4e2de', {
        material: 'wood',
        kind: 'frame',
        concept: 'leg',
      }),
      box([0, 0.55, -0.1], [1.12, 0.9, 0.1], '#dcdad5', { material: 'plaster', kind: 'body' }),
      ...[-0.42, -0.21, 0, 0.21, 0.42].map((x, i) =>
        box([x, 0.2 + (i % 2) * 0.04, 0.0], [0.2, 0.3 + (i % 2) * 0.08, 0.24], '#5d4634', {
          material: 'wood',
          kind: 'body',
          concept: 'stone_foundation',
        })
      ),
      box([0, 0.04, 0.03], [2.06, 0.08, 0.38], '#d3d0ca', {
        material: 'stone',
        kind: 'plinth',
        concept: 'base',
      }),
    ],
  },
};

/** A flush round ceiling light: base rim and a domed diffuser under it (seen from below). */
function ceilingDisc(d: number): TourSpec {
  return { kind: 'parts', parts: ceilingDiscParts(d) };
}

/** A white wall sconce: round wall plate, short arm, cone shade open downward. */
function sconce(): TourSpec {
  return { kind: 'parts', parts: sconceParts() };
}
