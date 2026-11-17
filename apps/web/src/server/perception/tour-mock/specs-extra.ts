import type { PlantHints } from '../tree/plant-build';
import {
  box,
  cone,
  cyl,
  extrude,
  hull,
  lathe,
  leaf,
  rod,
  type PartSpec,
  type TourSpec,
} from './spec';
import {
  bed,
  cabinet,
  chair,
  curtain,
  door,
  fence,
  glazing,
  legs,
  METAL,
  ironRailing,
  latticeTower,
  sofa,
  stool,
  table,
} from '../furniture';

/**
 * The tour objects added in VS-T42 (furniture, soft furnishings, doors, windows, rocks, tyres, trees
 * and plants), modelled on their photo like the others: metres, x right, y up, z toward the camera.
 * Furniture is built from a few parametric pieces (seat, back, arms, legs…); plants are read like
 * the real pipeline reads one (`reconstructTree` on the outlined photo, with the plant team's hints).
 * Colours are first guesses, re-measured part by part by `make tour-mock`.
 */

type Spec = TourSpec;
const parts = (p: PartSpec[], yaw?: number): Spec => ({
  kind: 'parts',
  parts: p,
  ...(yaw ? { yaw } : {}),
});
const plant = (label: string, hints: PlantHints): Spec => ({ kind: 'plant', label, hints });

const WHITE = '#e8e7e3';

/** Side ring of a rock: flat bottom, rounded back and top (z, y). */
const BOULDER: Array<[number, number]> = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, -0.1],
  [0.38, 0.3],
  [0.1, 0.5],
  [-0.25, 0.42],
  [-0.48, 0.1],
];

/** A free-standing rock: its traced outline as the front, a boulder section as the side. */
/** Parts that keep one colour (`fixed`): open iron and steel, whose photo pixels are what shows through. */
function fixedColor(p: PartSpec[], color: string): PartSpec[] {
  return p.map((x) => ({ ...x, color, fixed: true }));
}

/** The bare oak of the garden (garden-tree-2), traced on its photo: 7 m wide, 10 m tall. */
function bareTree(): PartSpec[] {
  const bark = '#6e6458';
  const wood = { material: 'wood' as const, kind: 'trunk' as const, concept: 'tree_trunk' };
  const fork: [number, number] = [-0.8, 2.8];
  const limbs: Array<[[number, number], [number, number], number]> = [
    [fork, [-1.96, 6.5], 0.3],
    [[-1.96, 6.5], [-2.66, 8.8], 0.16],
    [fork, [-0.7, 7.0], 0.34],
    [[-0.7, 7.0], [-0.35, 9.7], 0.18],
    [fork, [0.7, 5.5], 0.3],
    [[0.7, 5.5], [1.75, 8.8], 0.16],
    [fork, [1.75, 3.8], 0.24],
    [[1.75, 3.8], [3.15, 5.5], 0.12],
    [fork, [-3.1, 3.4], 0.18],
  ];
  const haze: Array<[number, number, number, number]> = [
    [-2.2, 7.4, 1.5, 1.7],
    [0, 8.4, 1.9, 1.4],
    [2.0, 7.6, 1.5, 1.6],
    [2.6, 5.3, 1.0, 1.1],
    [-2.6, 4.8, 1.0, 1.5],
    [0, 5.6, 1.7, 1.3],
    [-1.3, 9.2, 1.1, 0.6],
    [1.0, 9.2, 1.1, 0.6],
  ];
  return [
    rod([-1.0, 0], fork, 0.6, 0, bark, wood),
    ...limbs.map(([a, b, w]) => rod(a, b, w, 0, bark, { ...wood, concept: undefined })),
    ...haze.map(([x, y, rx, ry], i) =>
      leaf([x - rx, y], rx * 2, ry * 2, 0, (i % 3) * 0.4 - 0.4, '#8f8577', {
        material: 'foliage',
        kind: 'crown',
        concept: 'foliage',
      })
    ),
  ];
}

function rock(h: number, d: number, color: string): Spec {
  return parts([
    box([0, h / 2, 0], [h, h, d], color, {
      material: 'stone',
      kind: 'body',
      concept: 'stone_foundation',
      silhouette: { section: BOULDER },
    }),
  ]);
}

/** A flat lying textile or mat. */
const rug = (w: number, d: number, color: string): PartSpec[] => [
  box([0, 0.02, 0], [w, 0.04, d], color, { material: 'fabric', kind: 'body', concept: 'cushion' }),
];

/** A vase of cut flowers or dried grasses, read as a plant on its vase. */
const bouquet = (species: string, habit: PlantHints['habit'] = 'shrub'): Spec =>
  plant('flowers in a vase', { habit, leaf: habit === 'grass' ? 'blade' : 'broad', species });

const ROUND: PlantHints = { habit: 'round', leaf: 'broad' };

export const EXTRA_SPECS: Record<string, Spec> = {
  // ── Loft ──────────────────────────────────────────────────────────────────────────────────
  'loft-sofa': parts(
    sofa({
      w: 2.0,
      d: 0.9,
      seat: 0.45,
      back: 0.82,
      arm: 0.6,
      leg: 0.15,
      color: '#33333a',
      cushions: 2,
    }),
    -0.35
  ),
  'loft-plant-1': plant('potted bamboo palm', {
    habit: 'bamboo',
    leaf: 'blade',
    species: 'bamboo palm in a grey pot on wooden legs',
  }),
  'loft-plant-2': bouquet('olive branch and cherry blossom in a dark glass bottle', 'shrub'),
  'loft-crate': parts(
    [
      box([0, 0.2, 0], [0.55, 0.4, 0.38], '#8d8273', {
        material: 'wood',
        kind: 'body',
        concept: 'frame',
      }),
      ...[0.08, 0.2, 0.32].map((y) =>
        box([0, y, 0.2], [0.55, 0.07, 0.02], '#a29886', {
          material: 'wood',
          kind: 'frame',
          concept: 'timber_beam',
        })
      ),
      cyl([0.12, 0.2, 0.26], [0.16, 0.4, 0.16], '#3a3533', {
        material: 'glass',
        kind: 'body',
        concept: 'pot',
      }),
    ],
    0.2
  ),
  'loft-bed': parts(
    bed(1.7, 2.1, 0.22, '#5a4535', WHITE, '#a3542a', ['#e9e7e2', '#c76a3a', '#e3b04f', '#7a7570']),
    -0.55
  ),
  'loft-pouf': parts([
    lathe(
      [0, 0.2, 0],
      [0.55, 0.4, 0.55],
      '#d9d2c3',
      [
        [0.4, -0.5],
        [0.48, -0.35],
        [0.5, 0],
        [0.47, 0.3],
        [0.38, 0.45],
        [0, 0.5],
      ],
      { material: 'fabric', kind: 'body', concept: 'cushion' }
    ),
  ]),
  'loft-rug': parts(rug(2.0, 2.8, '#b9b2a3'), -0.3),
  'loft-window-plants': parts([
    box([0, 0.12, 0], [0.7, 0.24, 0.22], '#d8d2c6', {
      material: 'wood',
      kind: 'body',
      concept: 'pot',
    }),
    {
      shape: 'sdf',
      at: [0, 0.38, 0],
      size: [0.8, 0.3, 0.26],
      color: '#4f6d3a',
      material: 'foliage',
      kind: 'crown',
      concept: 'foliage',
      blobs: [
        { kind: 'ellipsoid', c: [-0.25, 0, 0], radii: [0.22, 0.4, 0.4], k: 0 },
        { kind: 'ellipsoid', c: [0.05, 0.05, 0], radii: [0.22, 0.38, 0.4], k: 0.06 },
        { kind: 'ellipsoid', c: [0.26, -0.02, 0], radii: [0.16, 0.38, 0.4], k: 0.06 },
      ],
    },
  ]),
  'loft-radiator': parts(
    [
      box([0, 0.38, 0], [4.2, 0.76, 0.32], '#dedcd6', {
        material: 'wood',
        kind: 'body',
        concept: 'grille',
      }),
      box([0, 0.78, 0.02], [4.3, 0.04, 0.4], '#e8e6e0', {
        material: 'wood',
        kind: 'body',
        concept: 'table',
      }),
    ],
    -0.45
  ),
  'loft-window': parts(glazing(3.4, 2.4, 4, 3, '#f0efea', '#a9c3d6', { bar: 0.07 }), -0.2),
  'loft-curtain': parts(curtain(3.2, 2.9, '#e6e6e4')),
  'loft-wardrobe': parts(
    [
      box([0, 1.35, 0], [4.4, 2.7, 0.6], '#d6d0c8', {
        material: 'wood',
        kind: 'body',
        concept: 'frame',
      }),
      ...Array.from({ length: 8 }, (_, i) =>
        box([-2.2 + 0.55 * (i + 0.5), 1.35, 0.31], [0.52, 2.6, 0.02], '#ddd7cf', {
          material: 'wood',
          kind: 'body',
          concept: 'door',
        })
      ),
    ],
    0.45
  ),
  'loft-wall-cabinet': parts(cabinet(0.8, 0.72, 0.32, WHITE, 2, { glass: true })),
  'loft-shelf': parts([
    // Floating shelves with potted plants: the group's outline, as deep as a shelf.
    box([0, 0.45, 0], [0.9, 0.9, 0.24], '#d9d6cf', {
      material: 'wood',
      kind: 'body',
      concept: 'shelf',
      silhouette: {
        section: [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ],
      },
    }),
  ]),
  'loft-counter': parts(
    [
      box([0, 0.45, 0], [3.4, 0.9, 0.6], WHITE, {
        material: 'wood',
        kind: 'body',
        concept: 'frame',
        silhouette: {
          section: [
            [-0.5, -0.5],
            [0.5, -0.5],
            [0.5, 0.5],
            [-0.5, 0.5],
          ],
        },
      }),
    ],
    0
  ),
  'loft-island': parts(
    [
      box([0, 0.88, 0], [2.0, 0.05, 0.9], WHITE, {
        material: 'wood',
        kind: 'body',
        concept: 'table',
      }),
      box([-0.98, 0.44, 0], [0.04, 0.88, 0.9], WHITE, {
        material: 'wood',
        kind: 'frame',
        concept: 'leg',
      }),
      box([0.98, 0.44, 0], [0.04, 0.88, 0.9], WHITE, {
        material: 'wood',
        kind: 'frame',
        concept: 'leg',
      }),
      box([0, 0.5, 0.3], [1.9, 0.7, 0.03], '#7a5a3f', {
        material: 'wood',
        kind: 'body',
        concept: 'frame',
      }),
    ],
    0.3
  ),
  'loft-island-plant': plant('palm in a glass jar', {
    habit: 'palm',
    leaf: 'frond',
    species: 'kentia palm in a green glass jar',
  }),

  // ── Hall ──────────────────────────────────────────────────────────────────────────────────
  'hall-armchair': parts(
    sofa({
      w: 0.85,
      d: 0.85,
      seat: 0.45,
      back: 1.05,
      arm: 0.65,
      armW: 0.16,
      leg: 0.12,
      color: '#5b4752',
      legColor: '#efefef',
    }),
    -0.25
  ),
  'hall-door': parts(door(1.4, 2.2, '#efefec', { leaves: 2, glass: [2, 6] }), -0.5),
  'hall-sofa': parts(
    sofa({
      w: 2.0,
      d: 0.8,
      seat: 0.45,
      back: 0.95,
      arm: 0.65,
      leg: 0.15,
      color: '#6a95a8',
      legColor: '#c8d6dc',
      arched: true,
    }),
    -0.2
  ),
  'hall-vase': bouquet('roses and peonies in a white urn'),
  'hall-curtain-1': parts(curtain(4.2, 2.9, '#ecedef')),
  'hall-curtain-2': parts(curtain(2.3, 2.9, '#ecedef')),

  // ── Bedroom ───────────────────────────────────────────────────────────────────────────────
  'bedroom-shelf': parts([
    ...[-0.85, 0.85].map((x) =>
      box([x, 1.15, 0], [0.04, 2.3, 0.04], METAL, {
        material: 'metal',
        kind: 'frame',
        concept: 'frame',
      })
    ),
    ...[0.15, 0.6, 1.05, 1.5, 1.95].map((y) =>
      box([0, y, 0], [1.7, 0.04, 0.3], '#9a7550', {
        material: 'wood',
        kind: 'frame',
        concept: 'shelf',
      })
    ),
    box([-0.2, 1.15, 0.12], [0.04, 2.3, 0.04], METAL, {
      material: 'metal',
      kind: 'frame',
      concept: 'frame',
    }),
    box([0.3, 1.15, 0.12], [0.04, 2.3, 0.04], METAL, {
      material: 'metal',
      kind: 'frame',
      concept: 'frame',
    }),
  ]),
  'bedroom-drape': parts([
    ...curtain(2.6, 2.4, '#c4321e'),
    box([1.3, 1.15, 0.03], [0.55, 2.3, 0.04], '#c8a650', {
      material: 'fabric',
      kind: 'body',
      concept: 'curtain',
    }),
  ]),
  'bedroom-chair-black': parts(
    chair({
      w: 0.45,
      d: 0.45,
      seat: 0.75,
      back: 1.15,
      color: '#1e1e20',
      legColor: '#c9a679',
      style: 'shell',
    }),
    0.2
  ),
  'bedroom-chair-director': parts(
    chair({
      w: 0.55,
      d: 0.45,
      seat: 0.75,
      back: 1.15,
      color: '#1b1b1d',
      legColor: '#7a6a5a',
      style: 'director',
      arms: true,
    }),
    -0.3
  ),
  'bedroom-chair-red': parts(
    chair({
      w: 0.55,
      d: 0.5,
      seat: 0.45,
      back: 0.85,
      color: '#c23a22',
      legColor: '#c23a22',
      style: 'wire',
      arms: true,
    }),
    0.25
  ),
  'bedroom-door': parts(door(0.85, 2.05, '#e19d26')),
  'bedroom-bed': parts(
    bed(1.6, 2.0, 0.25, '#4b3a2b', '#7d6655', '#bba58a', ['#d9d2c6', '#8b6d60', '#d0c6b8']),
    -0.55
  ),
  'bedroom-window': parts(glazing(2.4, 2.0, 1, 1, '#e8e8e4', '#f2f4f5'), 0.35),
  'bedroom-stool': parts(stool(0.75, 0.38, '#7b5a3c', METAL, true)),
  'bedroom-backdrop': parts([
    ...curtain(3.4, 2.4, '#141518', { band: [0.1, 1] }),
    ...['#2e6f9e', '#b6382c', '#1c1c1c'].map((c, i) =>
      cyl([0, 2.5 + 0.09 * (2 - i), 0.05 + 0.05 * i], [3.6, 0.09, 0.09], c, {
        material: 'fabric',
        kind: 'frame',
        axis: 'x',
        concept: 'rail',
      })
    ),
  ]),
  'bedroom-chair-blue': parts(
    chair({
      w: 0.55,
      d: 0.5,
      seat: 0.48,
      back: 0.85,
      color: '#1f2e3d',
      legColor: '#1c1c1e',
      style: 'upholstered',
      arms: true,
    }),
    0.3
  ),
  'bedroom-stool-2': parts(stool(0.75, 0.36, '#5a3d29', '#5a3d29', false)),

  // ── Bath ──────────────────────────────────────────────────────────────────────────────────
  'bath-sofa': parts(
    sofa({
      w: 1.4,
      d: 0.75,
      seat: 0.48,
      back: 1.05,
      arm: 0.65,
      armW: 0.14,
      leg: 0.18,
      color: '#9b7f69',
      legColor: '#efeee8',
      arched: true,
    })
  ),
  'bath-flowers-1': bouquet('pink roses and blue hydrangeas on a column stand'),
  'bath-armchair': parts(
    sofa({
      w: 1.3,
      d: 0.8,
      seat: 0.48,
      back: 1.0,
      arm: 0.65,
      armW: 0.16,
      leg: 0.15,
      color: '#8e8b80',
      legColor: '#efeee8',
      cushions: 1,
    }),
    0.15
  ),
  'bath-mirror-2': parts(
    glazing(0.8, 1.2, 3, 4, '#efede7', '#7b7a72', {
      arch: true,
      concept: 'frame',
      glassConcept: 'mirror',
    })
  ),
  'bath-flowers-2': bouquet('blue hydrangeas and pink roses hanging garland'),
  'bath-flowers-3': bouquet('pink hydrangeas in a stone urn'),
  'bath-mirror': parts(
    glazing(1.8, 2.8, 4, 6, '#e9e6de', '#8d8a80', {
      arch: true,
      concept: 'frame',
      glassConcept: 'mirror',
    }),
    -0.35
  ),
  'bath-door': parts(
    [
      ...glazing(2.0, 2.8, 2, 4, '#efefec', '#e9eff3'),
      box([0.8, 1.4, 0.1], [0.6, 2.8, 0.1], '#b4917e', {
        material: 'fabric',
        kind: 'body',
        concept: 'curtain',
      }),
      box([0, 2.95, 0.05], [2.4, 0.25, 0.1], '#3a2a24', {
        material: 'wood',
        kind: 'frame',
        concept: 'frame',
      }),
    ],
    -0.25
  ),
  'bath-chair': parts(
    chair({
      w: 0.55,
      d: 0.5,
      seat: 0.5,
      back: 1.1,
      color: '#121214',
      legColor: '#c79a5c',
      style: 'upholstered',
    }),
    0.3
  ),
  'bath-side-table': parts([
    ...table(0.7, 0.6, 0.6, '#1e2124', '#1e2124', { round: true, pedestal: true }),
    cyl([0, 0.8, 0], [0.2, 0.2, 0.2], WHITE, { material: 'stone', kind: 'body', concept: 'pot' }),
    sphereish([0, 1.05, 0], 0.5, '#d9cbb8', 'flower'),
  ]),
  'bath-tub': parts(
    [
      hull(
        [0, 0.42, 0],
        [1.7, 0.62, 0.78],
        '#ebe7dc',
        [
          [-0.5, 0.5],
          [0.5, 0.5],
          [0.42, -0.2],
          [0.3, -0.5],
          [-0.3, -0.5],
          [-0.42, -0.2],
        ],
        [
          [-0.5, 0.5],
          [0.5, 0.5],
          [0.4, -0.3],
          [0.25, -0.5],
          [-0.25, -0.5],
          [-0.4, -0.3],
        ],
        { material: 'plastic', kind: 'body', concept: 'frame' }
      ),
      ...legs(1.2, 0.5, 0.18, '#b5b8bc', { r: 0.06, material: 'metal' }),
    ],
    -0.2
  ),
  'bath-plant': plant('potted fiddle-leaf fig', {
    habit: 'round',
    leaf: 'broad',
    species: 'fiddle-leaf fig in a pot',
  }),

  // ── Salon ─────────────────────────────────────────────────────────────────────────────────
  'salon-arch': parts([
    lathe(
      [0, 1.1, 0],
      [2.0, 2.2, 0.06],
      '#b48a52',
      [
        [0.48, -0.5],
        [0.5, 0],
        [0.48, 0.5],
      ],
      { material: 'metal', kind: 'frame', concept: 'frame' }
    ),
    sphereish([-0.7, 1.4, 0.1], 0.9, '#b0644e', 'flower'),
    sphereish([0.4, 2.0, 0.1], 0.8, '#a95947', 'flower'),
    sphereish([-0.2, 0.15, 0.1], 0.6, '#c99a84', 'flower'),
  ]),
  'salon-sofa': parts(
    sofa({
      w: 2.1,
      d: 0.85,
      seat: 0.45,
      back: 0.95,
      arm: 0.6,
      armW: 0.12,
      leg: 0.12,
      color: '#b58b86',
      legColor: '#b38b55',
    }),
    -0.4
  ),
  'salon-side-table': parts(table(0.55, 0.45, 0.45, '#8a7a65', '#b8955a', { round: true })),
  'salon-curtain-1': parts(curtain(1.8, 2.9, '#e9c9cc')),
  'salon-curtain-2': parts(curtain(0.9, 2.9, '#e3c4c4')),
  'salon-sofa-2': parts(
    sofa({
      w: 2.0,
      d: 0.85,
      seat: 0.42,
      back: 0.75,
      arm: 0,
      leg: 0.14,
      color: '#8fb1c4',
      legColor: '#a57a48',
      chaise: 0.55,
    }),
    -0.3
  ),
  'salon-pampas-1': bouquet('pampas grass in a gold pot', 'grass'),
  'salon-pampas-2': bouquet('pampas grass in a gold pot', 'grass'),
  'salon-stool': parts(stool(0.75, 0.36, '#c49a64', '#c49a64', true)),
  'salon-backdrop': parts([
    // A photo backdrop falling onto the floor: an L side, the outline as its front.
    box([0, 1.5, 0], [3.0, 3.0, 2.4], '#73574a', {
      material: 'fabric',
      kind: 'body',
      concept: 'curtain',
      silhouette: {
        section: [
          [-0.5, 0.5],
          [-0.42, 0.5],
          [-0.42, -0.44],
          [0.5, -0.44],
          [0.5, -0.5],
          [-0.5, -0.5],
        ],
      },
    }),
  ]),
  // ── Lounge ────────────────────────────────────────────────────────────────────────────────
  'lounge-door': parts(door(0.9, 2.1, '#d9dadb'), 0.25),
  'lounge-mirror-1': parts(
    glazing(0.7, 1.3, 2, 4, '#d7d6d1', '#9c9a93', { concept: 'frame', glassConcept: 'mirror' }),
    0.4
  ),
  'lounge-mirror-2': parts(
    glazing(0.7, 1.3, 2, 4, '#d7d6d1', '#9c9a93', { concept: 'frame', glassConcept: 'mirror' }),
    -0.4
  ),
  'lounge-chaise': parts(
    sofa({
      w: 1.8,
      d: 0.7,
      seat: 0.45,
      back: 0.95,
      arm: 0,
      leg: 0.15,
      color: '#d4c8b8',
      legColor: '#efeee8',
      arched: true,
      chaise: 0.6,
    }),
    -0.2
  ),
  'lounge-rug': parts(rug(2.2, 1.5, '#a9adae'), -0.2),
  'lounge-window-1': parts(glazing(1.6, 2.6, 4, 7, '#efefef', '#d6e6ee')),
  'lounge-window-2': parts(glazing(1.6, 2.6, 4, 7, '#efefef', '#d6e6ee'), 0.7),
  'lounge-arch': parts([
    extrude(
      [0, 1.25, 0],
      [1.9, 1.9, 0.04],
      '#a77b4f',
      [
        [0, 0.5],
        [0.5, 0],
        [0, -0.5],
        [-0.5, 0],
        [-0.44, 0],
        [0, -0.44],
        [0.44, 0],
        [0, 0.44],
        [-0.44, 0],
        [-0.5, 0],
      ],
      { material: 'metal', kind: 'frame', concept: 'frame' }
    ),
    box([-0.55, 0.15, 0], [0.03, 0.3, 0.03], '#a77b4f', {
      material: 'metal',
      kind: 'frame',
      concept: 'leg',
    }),
    box([0.55, 0.15, 0], [0.03, 0.3, 0.03], '#a77b4f', {
      material: 'metal',
      kind: 'frame',
      concept: 'leg',
    }),
    sphereish([-0.5, 1.55, 0.1], 0.8, '#d8b9a6', 'flower'),
    sphereish([0.35, 0.85, 0.1], 0.7, '#d8b9a6', 'flower'),
  ]),
  'lounge-plant-1': plant('potted dracaena', {
    habit: 'palm',
    leaf: 'blade',
    species: 'dracaena marginata in a beige pot',
  }),
  'lounge-plant-2': plant('potted bamboo palm', {
    habit: 'bamboo',
    leaf: 'blade',
    species: 'bamboo palm in a beige pot',
  }),
  'lounge-chair': parts(
    sofa({
      w: 0.75,
      d: 0.75,
      seat: 0.45,
      back: 0.85,
      arm: 0.6,
      armW: 0.12,
      leg: 0.15,
      color: '#c9c5b5',
      legColor: '#d4b083',
      arched: true,
    }),
    0.4
  ),
  'lounge-painting': parts([
    box([-0.38, 0, 0], [0.55, 0.85, 0.03], '#c9bfb6', {
      material: 'fabric',
      kind: 'body',
      concept: 'sign',
    }),
    box([0.38, 0.05, 0], [0.62, 0.95, 0.03], '#c3bab2', {
      material: 'fabric',
      kind: 'body',
      concept: 'sign',
    }),
  ]),
  'lounge-screen': parts(
    [0, 1]
      .map((i) =>
        box([-0.25 + 0.5 * i, 0.9, 0.06 * i], [0.48, 1.8, 0.03], '#c9ad84', {
          material: 'wood',
          kind: 'body',
          concept: 'door',
        })
      )
      .flat(),
    0.5
  ),

  // ── Terrace ───────────────────────────────────────────────────────────────────────────────
  'terrace-parasol': parts([
    lathe(
      [0, 1.75, 0],
      [0.75, 2.3, 0.75],
      '#9fa2a6',
      [
        [0.4, -0.5],
        [0.48, -0.3],
        [0.38, 0.2],
        [0.2, 0.45],
        [0.05, 0.5],
      ],
      { material: 'fabric', kind: 'body', concept: 'curtain' }
    ),
    cyl([0, 0.4, 0], [0.05, 0.8, 0.05], '#4a4440', {
      material: 'metal',
      kind: 'frame',
      concept: 'pole',
    }),
    cyl([0, 0.04, 0], [0.75, 0.08, 0.75], '#a8a49c', {
      material: 'concrete',
      kind: 'frame',
      concept: 'base',
    }),
  ]),
  // Wrought iron: S balusters, scrolls under the top rail, iron posts where the photo shows them.
  // Their colour stays the iron's: what the photo shows between the bars is the lawn and the deck.
  'terrace-railing-1': parts(
    fixedColor(ironRailing(7.0, 1.0, 30, [0.01, 0.42, 0.72, 0.99]), '#2c2e33')
  ),
  'terrace-railing-2': parts(fixedColor(ironRailing(6.5, 1.0, 28, [0.01, 0.5, 0.99]), '#2c2e33')),
  // A lattice tower as built (VS-T46): legs, X bracing, cross arms; not a solid of its outline.
  'terrace-pylon': parts(
    latticeTower(30, 6, 1.4, 9, [
      [0.68, 3.4],
      [0.88, 2.4],
    ])
  ),
  'terrace-tree-1': plant('jacaranda tree', {
    habit: 'spreading',
    leaf: 'broad',
    species: 'jacaranda',
  }),
  'terrace-tree-2': plant('eucalyptus tree', {
    habit: 'spreading',
    leaf: 'broad',
    species: 'eucalyptus',
  }),
  'terrace-cypress-2': plant('cypress', {
    habit: 'columnar',
    leaf: 'scale',
    species: 'Italian cypress',
  }),
  'terrace-cypress-3': plant('cypress', {
    habit: 'columnar',
    leaf: 'scale',
    species: 'Italian cypress',
  }),

  // ── Street ────────────────────────────────────────────────────────────────────────────────
  'street-fence': parts(fence(14, 1.3, '#6a5545', 3)),
  'street-gate': parts([
    ...fence(1.6, 1.6, '#5d4a3c', 0),
    box([-0.95, 0.85, 0], [0.4, 1.7, 0.4], '#9c8670', {
      material: 'stone',
      kind: 'frame',
      concept: 'stone_foundation',
    }),
    box([0.95, 0.85, 0], [0.4, 1.7, 0.4], '#9c8670', {
      material: 'stone',
      kind: 'frame',
      concept: 'stone_foundation',
    }),
  ]),
  'street-hedge': plant('elder shrub', { habit: 'shrub', leaf: 'broad', species: 'elder hedge' }),
  'street-house-5': parts(houseLite(11, 7, 6.5, '#e6e6e8', '#6c6d76', 4.2), -0.35),
  'street-fence-2': parts(fence(12, 1.1, '#ecedee', 0, '#9a8b78'), 0.1),
  'street-lamp-2': parts([
    cyl([0, 4.0, 0], [0.16, 8.0, 0.16], '#9da3aa', {
      material: 'metal',
      kind: 'body',
      concept: 'pole',
    }),
    box([-0.55, 7.35, 0], [1.1, 0.07, 0.07], '#9da3aa', {
      material: 'metal',
      kind: 'frame',
      concept: 'arm',
    }),
    box([-1.25, 7.33, 0], [0.55, 0.12, 0.22], '#bfc4c9', {
      material: 'metal',
      kind: 'light',
      concept: 'lamp',
    }),
  ]),
  'street-tree-2': plant('ash tree', { ...ROUND, species: 'ash tree' }),

  // ── House front ───────────────────────────────────────────────────────────────────────────
  'house-planter-1': parts(planter(1.6, 0.8, 1.0), -0.5),
  'house-planter-2': parts(planter(1.6, 0.8, 1.0), 0.5),
  'house-shrub-1': plant('wisteria', {
    habit: 'shrub',
    leaf: 'broad',
    species: 'wisteria over the porch',
  }),
  'house-shrub-2': plant('wisteria', {
    habit: 'shrub',
    leaf: 'broad',
    species: 'wisteria with bare twisted vines',
  }),
  'house-wall-lamp-2': parts([
    cyl([0, 0.66, 0], [0.04, 0.12, 0.04], '#2c2f33', { material: 'metal', kind: 'frame' }),
    cone([0, 0.56, 0], [0.3, 0.1, 0.3], '#2f3236', {
      material: 'metal',
      kind: 'roof',
      concept: 'lid',
    }),
    extrude(
      [0, 0.3, 0],
      [0.3, 0.42, 0.3],
      '#454a50',
      [
        [-0.5, 0.5],
        [0.5, 0.5],
        [0.3, -0.5],
        [-0.3, -0.5],
      ],
      { material: 'glass', kind: 'light', concept: 'lamp' }
    ),
  ]),
  'house-fountain': parts([
    cyl([0, 0.6, 0], [0.5, 1.2, 0.5], '#e9e8e2', {
      material: 'concrete',
      kind: 'body',
      concept: 'stand',
    }),
  ]),

  // ── Garden ────────────────────────────────────────────────────────────────────────────────
  'garden-tyre-1': parts(tyre(1.5, 0.45), 0),
  'garden-tyre-2': parts(tyre(1.7, 0.5), 0),
  // Only the trunk is in the photo (its crown is past the top): a bark column on its outline,
  // round in section, not a crown of leaves (VS-T46).
  'garden-tree-1': parts([
    box([0, 6, 0], [2, 12, 1.1], '#8a8170', {
      material: 'wood',
      kind: 'trunk',
      concept: 'tree_trunk',
      silhouette: {},
    }),
  ]),
  // Bare in winter: the reader sees the bushes behind its twigs, not the tree. Its trunk and
  // limbs as traced on the photo, and the twig haze as thin grey masses (VS-T46).
  'garden-tree-2': parts(bareTree()),
  'garden-shrub': plant('shrub', { habit: 'shrub', leaf: 'broad', species: 'privet shrub' }),
  'garden-tree-3': plant('oak tree', { habit: 'spreading', leaf: 'broad', species: 'old oak' }),
  'garden-log': parts([
    // A fallen trunk: its traced outline, a round section.
    box([0, 0.7, 0], [1.4, 1.4, 0.6], '#6b5f50', {
      material: 'wood',
      kind: 'trunk',
      concept: 'tree_trunk',
      silhouette: {},
    }),
  ]),
  'garden-tree-4': plant('evergreen tree', { ...ROUND, species: 'holm oak' }),

  // ── Avenue ────────────────────────────────────────────────────────────────────────────────
  'avenue-pine-2': plant('pine', { habit: 'spreading', leaf: 'needle', species: 'patula pine' }),
  'avenue-pine-3': plant('pine', { habit: 'spreading', leaf: 'needle', species: 'patula pine' }),
  'avenue-bush': plant('shrubs', { habit: 'shrub', leaf: 'broad', species: 'wild shrubs' }),
  'avenue-tree-small': plant('young tree', { ...ROUND, species: 'young acacia' }),

  // ── Forest & woods ────────────────────────────────────────────────────────────────────────
  'forest-rock-2': rock(0.45, 0.6, '#7d786c'),
  'forest-rock-3': rock(0.45, 0.7, '#8a877e'),
  'forest-rock-4': rock(0.9, 1.0, '#545a2f'),
  'forest-rock-5': rock(0.8, 1.1, '#56592f'),
  'forest-log': parts([
    // A fallen trunk: its traced outline, a round section.
    box([0, 0.8, 0], [1.6, 1.6, 0.25], '#4b4136', {
      material: 'wood',
      kind: 'trunk',
      concept: 'tree_trunk',
      silhouette: {},
    }),
  ]),
  'forest-tree-3': plant('forest tree', {
    habit: 'spreading',
    leaf: 'broad',
    species: 'forest tree with a curved trunk',
  }),
  'woods-bridge': parts(
    [
      box([0, 0.35, 0], [2.4, 0.08, 1.0], '#4a3b2e', {
        material: 'wood',
        kind: 'body',
        concept: 'stair',
      }),
      ...[-1.1, 1.1].flatMap((x) =>
        [-0.45, 0.45].map((z) =>
          box([x, 0.55, z], [0.1, 1.1, 0.1], '#3d3127', {
            material: 'wood',
            kind: 'frame',
            concept: 'pole',
          })
        )
      ),
      box([0, 1.08, -0.45], [2.4, 0.08, 0.08], '#3d3127', {
        material: 'wood',
        kind: 'frame',
        concept: 'rail',
      }),
    ],
    -0.3
  ),
  'woods-fern': plant('ferns', { habit: 'rosette', leaf: 'frond', species: 'bracken ferns' }),
  'woods-palm': plant('young palm', { habit: 'palm', leaf: 'frond', species: 'young date palm' }),
  'woods-tree-2': plant('young tree', {
    habit: 'spreading',
    leaf: 'broad',
    species: 'thin forest tree',
  }),
};

/** A rounded clump (foliage, a bouquet's flowers) as one `sdf` part of diameter `s`. */
function sphereish(
  at: readonly [number, number, number],
  s: number,
  color: string,
  concept = 'foliage'
): PartSpec {
  return {
    shape: 'sdf',
    at: [at[0], at[1], at[2]],
    size: [s, s * 0.8, s * 0.8],
    color,
    material: 'foliage',
    kind: 'crown',
    concept,
    blobs: [
      { kind: 'ellipsoid', c: [-0.1, -0.04, 0], radii: [0.3, 0.36, 0.4], k: 0 },
      { kind: 'ellipsoid', c: [0.12, 0.04, 0], radii: [0.28, 0.36, 0.4], k: 0.06 },
    ],
  };
}

/** A painted masonry planter: block, soil on top. */
function planter(w: number, h: number, d: number): PartSpec[] {
  return [
    box([0, h / 2, 0], [w, h, d], '#e5e3dc', {
      material: 'concrete',
      kind: 'body',
      concept: 'pot',
    }),
    box([0, h + 0.01, 0], [w - 0.1, 0.03, d - 0.1], '#5e3b2a', { material: 'stone', kind: 'body' }),
  ];
}

/** A tractor tyre lying flat: tread ring and the soil filling its hole. */
function tyre(dia: number, h: number): PartSpec[] {
  return [
    lathe(
      [0, h / 2, 0],
      [dia, h, dia],
      '#5a5644',
      [
        [0.42, -0.5],
        [0.5, -0.25],
        [0.5, 0.25],
        [0.42, 0.5],
      ],
      { material: 'rubber', kind: 'body', concept: 'wheel' }
    ),
    cyl([0, h * 0.8, 0], [dia * 0.55, h * 0.4, dia * 0.55], '#4a3a2c', {
      material: 'stone',
      kind: 'body',
    }),
  ];
}

/** A plain detached house: walls, hip roof, a few windows and a balcony band. */
function houseLite(
  w: number,
  d: number,
  wall: number,
  wallColor: string,
  roofColor: string,
  roofH: number
): PartSpec[] {
  const out: PartSpec[] = [
    box([0, wall / 2, 0], [w, wall, d], wallColor, {
      material: 'plaster',
      kind: 'wall',
      concept: 'wall',
      front: true,
    }),
    {
      shape: 'hip',
      at: [0, wall + roofH / 2, 0],
      size: [w + 0.6, roofH, d + 0.6],
      color: roofColor,
      material: 'slate',
      kind: 'roof',
      concept: 'roof',
      ridge: 0.3,
    },
    box([0, 3.0, d / 2 + 0.4], [w * 0.7, 0.15, 0.8], '#cfd0d3', {
      material: 'concrete',
      kind: 'frame',
      concept: 'stair',
    }),
  ];
  for (const y of [1.0, 3.8])
    for (const x of [-w * 0.3, 0, w * 0.3])
      out.push(
        box([x, y + 0.7, d / 2 + 0.02], [1.1, 1.4, 0.04], '#55606a', {
          material: 'glass',
          kind: 'window',
          concept: 'window',
        })
      );
  return out;
}
