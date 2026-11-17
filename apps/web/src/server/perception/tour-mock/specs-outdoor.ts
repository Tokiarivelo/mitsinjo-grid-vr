import type { PlantHints } from '../tree/plant-build';
import {
  box,
  cyl,
  extrude,
  hip,
  hull,
  leaf,
  prism,
  rod,
  type PartSpec,
  type TourSpec,
} from './spec';

/**
 * The outdoor places' objects (VS-T41), modelled on their photo (`public/tour/outdoor/*.jpg`):
 * houses and cars as parts, plants read by the real tree reconstructor on their outline.
 * Metres, x right, y up, z toward the camera.
 */

type Opening = { x: number; y: number; w: number; h: number; grid?: [number, number] };

interface HouseSpec {
  w: number;
  d: number;
  wall: number;
  wallColor: string;
  wallMaterial?: 'plaster' | 'stone' | 'brick';
  roof: {
    kind: 'hip' | 'gable';
    h: number;
    color: string;
    material: 'tile' | 'slate' | 'metal';
    ridge?: number;
    over?: number;
  };
  /** Openings on the front wall (x from the centre, y = sill height). */
  front?: Opening[];
  /** Openings on the right wall (x across it from its centre). */
  right?: Opening[];
  doors?: Opening[];
  frame?: string;
  glass?: string;
  plinth?: { h: number; color: string; material?: 'stone' | 'concrete' };
  chimneys?: Array<{ x: number; z: number; h: number }>;
  extra?: PartSpec[];
}

/** A house as walls, a roof, framed openings on two walls, a plinth and chimneys. */
function house(h: HouseSpec): PartSpec[] {
  const frame = h.frame ?? '#f2f2ef';
  const glass = h.glass ?? '#3c4650';
  const over = h.roof.over ?? 0.35;
  const parts: PartSpec[] = [
    box([0, h.wall / 2, 0], [h.w, h.wall, h.d], h.wallColor, {
      material: h.wallMaterial ?? 'plaster',
      kind: 'wall',
      front: true,
      concept: 'wall',
    }),
  ];
  const roofSize = [h.w + 2 * over, h.roof.h, h.d + 2 * over] as const;
  parts.push(
    h.roof.kind === 'hip'
      ? hip([0, h.wall + h.roof.h / 2, 0], roofSize, h.roof.color, {
          material: h.roof.material,
          kind: 'roof',
          ridge: h.roof.ridge ?? 0.4,
          concept: 'roof',
        })
      : prism([0, h.wall + h.roof.h / 2, 0], roofSize, h.roof.color, {
          material: h.roof.material,
          kind: 'roof',
          concept: 'roof',
        })
  );
  const fz = h.d / 2 + 0.03;
  for (const o of h.front ?? [])
    parts.push(
      box([o.x, o.y + o.h / 2, fz], [o.w, o.h, 0.06], glass, {
        material: 'glass',
        kind: 'window',
        grid: o.grid ?? [2, 2],
        concept: 'window',
      })
    );
  for (const o of h.doors ?? [])
    parts.push(
      box([o.x, o.y + o.h / 2, fz], [o.w, o.h, 0.08], o.grid ? glass : frame, {
        material: 'wood',
        kind: 'door',
        leaves: o.w > 1.2 ? 2 : 1,
        ...(o.grid ? { glazed: 0.7, grid: o.grid } : { panels: 2 }),
        concept: 'door',
      })
    );
  const rx = h.w / 2 + 0.03;
  for (const o of h.right ?? [])
    parts.push(
      box([rx, o.y + o.h / 2, o.x], [0.06, o.h, o.w], glass, {
        material: 'glass',
        kind: 'window',
        grid: o.grid ?? [2, 2],
        concept: 'window',
      })
    );
  if (h.plinth)
    parts.push(
      box([0, h.plinth.h / 2, 0], [h.w + 0.06, h.plinth.h, h.d + 0.06], h.plinth.color, {
        material: h.plinth.material ?? 'stone',
        kind: 'plinth',
        concept: 'stone_foundation',
      })
    );
  for (const c of h.chimneys ?? [])
    parts.push(
      box([c.x, h.wall + c.h / 2, c.z], [0.45, c.h, 0.45], '#8d7c70', {
        material: 'brick',
        kind: 'chimney',
        cap: true,
        concept: 'chimney',
      })
    );
  parts.push(...(h.extra ?? []));
  return parts;
}

interface CarSpec {
  /** Length, height, width (m). */
  L: number;
  H: number;
  W: number;
  /** Side silhouette of the body below the windows, unit ring (x rear −0.5 → nose 0.5, y up). */
  body: Array<[number, number]>;
  /** Side silhouette of the glasshouse, unit ring over the cabin box. */
  cabin: Array<[number, number]>;
  /** Cabin box along x (m, from the car centre) and its base height. */
  cabinX: [number, number];
  belt: number;
  paint: string;
  /** Nose toward −x (the car faces left on the photo). */
  noseLeft?: boolean;
  wheelR: number;
  /** Wheel centres along x (m from the centre, rear then front, nose at +x). */
  axles: [number, number];
  tail: string;
}

/** A car: body, glasshouse, four tyres with rims, tail lights, plate. */
function car(c: CarSpec): PartSpec[] {
  const s = c.noseLeft ? -1 : 1;
  const flip = (ring: Array<[number, number]>) =>
    s > 0 ? ring : ring.map(([x, y]) => [-x, y] as [number, number]).reverse();
  const [cx0, cx1] = c.cabinX;
  const parts: PartSpec[] = [
    extrude(
      [0, (c.belt + c.wheelR * 0.4) / 2, 0],
      [c.L, c.belt - c.wheelR * 0.4, c.W],
      c.paint,
      flip(c.body),
      {
        material: 'metal',
        kind: 'body',
        front: true,
        concept: 'door',
      }
    ),
    extrude(
      [(s * (cx0 + cx1)) / 2, (c.belt + c.H) / 2 - 0.02, 0],
      [cx1 - cx0, c.H - c.belt + 0.04, c.W * 0.86],
      '#2b3138',
      flip(c.cabin),
      { material: 'glass', kind: 'window', concept: 'windshield' }
    ),
  ];
  for (const ax of c.axles)
    for (const z of [-1, 1]) {
      parts.push(
        cyl(
          [s * ax, c.wheelR, (z * (c.W - 0.22)) / 2],
          [c.wheelR * 2, c.wheelR * 2, 0.22],
          '#1c1c1c',
          {
            material: 'rubber',
            kind: 'wheel',
            axis: 'z',
            rim: true,
            concept: 'wheel',
          }
        )
      );
    }
  const rear = -s * (c.L / 2 + 0.01);
  for (const z of [-1, 1])
    parts.push(
      box([rear, c.belt - 0.08, (z * (c.W - 0.36)) / 2], [0.04, 0.12, 0.3], c.tail, {
        material: 'plastic',
        kind: 'light',
        concept: 'tail_light',
      })
    );
  parts.push(
    box([rear, c.wheelR * 1.1, 0], [0.03, 0.12, 0.5], '#e8e8e8', {
      material: 'plastic',
      kind: 'bumper',
      concept: 'sign',
    })
  );
  return parts;
}

/** A plant read by the tree reconstructor from its outlined photo, with the plant team's answer. */
const plant = (label: string, hints: PlantHints): TourSpec => ({ kind: 'plant', label, hints });

const ROUND_BROAD: PlantHints = { habit: 'round', leaf: 'broad' };

export const OUTDOOR_SPECS: Record<string, TourSpec> = {
  'terrace-solar': {
    kind: 'parts',
    yaw: 0.35,
    parts: [
      // Two long rows of modules tilted to the sky, each on a steel rack.
      hull(
        [0.4, 0.95, -1.4],
        [6.4, 1.0, 1.7],
        '#1d2e66',
        [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ],
        [
          [0.5, -0.5],
          [0.42, -0.5],
          [-0.5, 0.5],
          [-0.42, 0.5],
        ],
        { material: 'glass', kind: 'cell', concept: 'solar_panel' }
      ),
      hull(
        [0.9, 0.85, 1.0],
        [5.6, 1.0, 1.7],
        '#1d2e66',
        [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ],
        [
          [0.5, -0.5],
          [0.42, -0.5],
          [-0.5, 0.5],
          [-0.42, 0.5],
        ],
        { material: 'glass', kind: 'cell', concept: 'solar_panel' }
      ),
      ...[-2.4, -0.8, 0.8, 2.4].flatMap((x) => [
        box([x + 0.4, 0.3, -0.75], [0.06, 0.6, 0.06], '#8a8f94', {
          material: 'metal',
          kind: 'frame',
          concept: 'leg',
        }),
        box([x + 0.9, 0.25, 1.65], [0.06, 0.5, 0.06], '#8a8f94', {
          material: 'metal',
          kind: 'frame',
          concept: 'leg',
        }),
      ]),
    ],
  },
  'terrace-house': {
    kind: 'parts',
    parts: house({
      w: 6.2,
      d: 4.5,
      wall: 2.7,
      wallColor: '#8c7a5c',
      roof: { kind: 'hip', h: 1.5, color: '#9c5139', material: 'tile', ridge: 0.3, over: 0.45 },
      doors: [{ x: -0.9, y: 0.25, w: 1.4, h: 2.15, grid: [2, 3] }],
      front: [{ x: 1.9, y: 0.95, w: 0.65, h: 1.45, grid: [2, 4] }],
      glass: '#4669c2',
      extra: [
        prism([-0.9, 3.4, 2.6], [2.6, 1.3, 1.3], '#9c5139', {
          material: 'tile',
          kind: 'roof',
          concept: 'roof',
        }),
        box([-0.9, 2.62, 2.6], [2.5, 0.12, 0.12], '#f0f0ec', {
          material: 'wood',
          kind: 'frame',
          concept: 'timber_beam',
        }),
        box([-0.9, 0.1, 2.9], [2.6, 0.2, 1.4], '#a5563c', {
          material: 'tile',
          kind: 'step',
          concept: 'doorstep',
        }),
        box([1.15, 0.6, 2.55], [0.45, 1.2, 0.45], '#bdb5a5', {
          material: 'concrete',
          kind: 'frame',
          concept: 'pole',
        }),
      ],
    }),
  },
  'terrace-car': {
    kind: 'parts',
    yaw: 0.78,
    parts: car({
      L: 3.8,
      H: 1.5,
      W: 1.7,
      belt: 0.95,
      paint: '#9ea2a6',
      wheelR: 0.3,
      axles: [-1.25, 1.2],
      tail: '#b3121a',
      cabinX: [-1.85, 0.75],
      body: [
        [-0.5, -0.5],
        [0.42, -0.5],
        [0.5, -0.1],
        [0.48, 0.5],
        [-0.49, 0.5],
        [-0.5, 0.0],
      ],
      cabin: [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.15, 0.45],
        [0.05, 0.5],
        [-0.44, 0.5],
        [-0.49, 0.2],
      ],
    }),
  },
  'terrace-cypress': plant('Italian cypress', {
    habit: 'columnar',
    leaf: 'scale',
    species: 'Italian cypress, Cupressus sempervirens',
  }),
  'street-car-white': {
    kind: 'parts',
    yaw: -0.22,
    parts: car({
      L: 4.7,
      H: 1.45,
      W: 1.84,
      belt: 0.95,
      paint: '#e8eaec',
      wheelR: 0.34,
      axles: [-1.45, 1.35],
      tail: '#8e1a1f',
      noseLeft: true,
      cabinX: [-2.2, 1.0],
      body: [
        [-0.5, -0.5],
        [0.44, -0.5],
        [0.5, -0.05],
        [0.47, 0.42],
        [0.3, 0.5],
        [-0.49, 0.5],
        [-0.5, 0.1],
      ],
      cabin: [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.15, 0.4],
        [0.02, 0.5],
        [-0.46, 0.5],
        [-0.49, 0.25],
      ],
    }),
  },
  'street-car-black': {
    kind: 'parts',
    yaw: -0.62,
    parts: car({
      L: 4.5,
      H: 1.65,
      W: 1.83,
      belt: 1.0,
      paint: '#1a1d22',
      wheelR: 0.33,
      axles: [-1.4, 1.3],
      tail: '#9a1a1e',
      noseLeft: true,
      cabinX: [-2.2, 1.1],
      body: [
        [-0.5, -0.5],
        [0.45, -0.5],
        [0.5, 0.0],
        [0.46, 0.45],
        [0.3, 0.5],
        [-0.49, 0.5],
        [-0.5, 0.05],
      ],
      cabin: [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.12, 0.45],
        [0.02, 0.5],
        [-0.47, 0.5],
        [-0.5, 0.2],
      ],
    }),
  },
  'street-house-1': {
    kind: 'parts',
    yaw: -0.55,
    parts: house({
      w: 9,
      d: 8,
      wall: 6.2,
      wallColor: '#d9dbe0',
      roof: { kind: 'hip', h: 3.4, color: '#5b4c4a', material: 'tile', ridge: 0.25, over: 0.4 },
      front: [
        { x: -3.1, y: 3.5, w: 0.9, h: 1.3 },
        { x: -1.6, y: 3.5, w: 0.9, h: 1.3 },
        { x: -0.2, y: 3.5, w: 0.9, h: 1.3 },
        { x: 1.4, y: 3.5, w: 0.9, h: 1.3 },
        { x: -2.6, y: 0.6, w: 1.0, h: 1.6, grid: [2, 2] },
        { x: 0.8, y: 0.8, w: 1.4, h: 1.4, grid: [3, 2] },
      ],
      right: [
        { x: 1.8, y: 3.4, w: 0.9, h: 1.0 },
        { x: 1.8, y: 1.0, w: 0.6, h: 1.0 },
      ],
      doors: [{ x: -1.8, y: 0.2, w: 0.9, h: 2.1, grid: [1, 3] }],
      chimneys: [{ x: 1.0, z: -0.5, h: 4.6 }],
      extra: [
        box([-2.3, 3.2, 4.35], [2.8, 0.18, 0.75], '#cfd2d6', {
          material: 'concrete',
          kind: 'frame',
          concept: 'stair',
        }),
        box([-0.8, 7.2, 3.2], [2.6, 1.2, 1.6], '#cfd1d6', {
          material: 'plaster',
          kind: 'wall',
          concept: 'wall',
        }),
      ],
    }),
  },
  'street-house-2': {
    kind: 'parts',
    parts: house({
      w: 13,
      d: 9,
      wall: 6.0,
      wallColor: '#dedcd6',
      roof: { kind: 'hip', h: 2.2, color: '#6c4a40', material: 'tile', ridge: 0.45, over: 0.45 },
      front: [
        { x: -4.8, y: 3.6, w: 1.2, h: 1.3 },
        { x: -1.6, y: 3.6, w: 1.6, h: 1.3 },
        { x: 1.2, y: 3.6, w: 1.6, h: 1.3 },
        { x: 4.0, y: 3.4, w: 2.6, h: 1.5, grid: [3, 1] },
        { x: -4.5, y: 0.8, w: 1.1, h: 1.6 },
        { x: -1.0, y: 0.6, w: 1.6, h: 1.7 },
        { x: 1.8, y: 0.6, w: 1.6, h: 1.7 },
        { x: 4.0, y: 0.5, w: 2.6, h: 1.7, grid: [3, 1] },
      ],
      chimneys: [
        { x: -2.0, z: 0, h: 3.3 },
        { x: 2.5, z: 0, h: 3.4 },
      ],
      extra: [
        box([-1.6, 3.0, 5.0], [8.6, 0.2, 1.0], '#c9c6c0', {
          material: 'concrete',
          kind: 'frame',
          concept: 'stair',
        }),
        box([-1.6, 3.55, 5.45], [8.6, 0.9, 0.06], '#b4a7a0', {
          material: 'metal',
          kind: 'frame',
          concept: 'frame',
        }),
        box([0, 7.0, 1.0], [5.0, 1.2, 1.8], '#d3d4d6', {
          material: 'plaster',
          kind: 'wall',
          concept: 'window',
        }),
      ],
    }),
  },
  'street-house-3': {
    kind: 'parts',
    yaw: -0.5,
    parts: house({
      w: 10,
      d: 9,
      wall: 6.0,
      wallColor: '#e3e3e6',
      roof: { kind: 'hip', h: 3.6, color: '#8a3a32', material: 'tile', ridge: 0.3, over: 0.4 },
      front: [
        { x: -2.8, y: 3.4, w: 0.9, h: 1.3 },
        { x: -4.2, y: 2.6, w: 0.6, h: 1.2 },
        { x: -1.6, y: 0.9, w: 0.8, h: 1.3 },
      ],
      right: [
        { x: 2.2, y: 2.8, w: 2.6, h: 1.6, grid: [3, 2] },
        { x: -0.4, y: 2.8, w: 0.9, h: 1.4 },
        { x: -2.6, y: 2.8, w: 0.9, h: 1.4 },
        { x: -2.6, y: 0.4, w: 0.9, h: 1.4 },
      ],
      chimneys: [{ x: 0.3, z: -0.8, h: 4.4 }],
      extra: [
        box([0, 7.4, 3.6], [1.2, 1.1, 1.1], '#e6e6e8', {
          material: 'plaster',
          kind: 'wall',
          concept: 'window',
        }),
        box([5.2, 7.2, 1.5], [1.2, 1.5, 4.0], '#d8dade', {
          material: 'plaster',
          kind: 'wall',
          concept: 'window',
        }),
      ],
    }),
  },
  'street-house-4': {
    kind: 'parts',
    yaw: 0.45,
    parts: house({
      w: 11,
      d: 10,
      wall: 6.2,
      wallColor: '#dfe1e8',
      wallMaterial: 'plaster',
      roof: { kind: 'hip', h: 4.2, color: '#3e4a5c', material: 'slate', ridge: 0.15, over: 0.3 },
      plinth: { h: 1.8, color: '#a58f6f', material: 'stone' },
      front: [
        { x: -3.8, y: 3.4, w: 0.8, h: 1.4 },
        { x: -2.2, y: 3.4, w: 0.8, h: 1.4 },
        { x: -0.4, y: 3.4, w: 0.8, h: 1.4 },
        { x: -3.8, y: 0.3, w: 0.8, h: 1.6, grid: [1, 2] },
        { x: -2.2, y: 0.3, w: 0.8, h: 1.6, grid: [1, 2] },
        { x: -0.4, y: 0.3, w: 0.8, h: 1.6, grid: [1, 2] },
      ],
      right: [
        { x: 1.5, y: 3.4, w: 1.0, h: 1.5 },
        { x: -2.5, y: 3.4, w: 1.0, h: 1.5 },
        { x: 1.5, y: 0.3, w: 1.0, h: 1.6, grid: [1, 2] },
        { x: -2.5, y: 0.3, w: 1.0, h: 1.6, grid: [1, 2] },
      ],
      extra: [
        box([2.4, 8.0, 3.4], [4.0, 1.6, 1.4], '#45526a', {
          material: 'glass',
          kind: 'cell',
          concept: 'solar_panel',
        }),
        box([-2.3, 7.6, 4.6], [2.6, 1.0, 0.8], '#e9e5df', {
          material: 'plaster',
          kind: 'window',
          concept: 'window',
        }),
      ],
    }),
  },
  'street-tree': plant('walnut tree', { ...ROUND_BROAD, species: 'common walnut, Juglans regia' }),
  'street-lamp': {
    kind: 'parts',
    parts: [
      cyl([0, 4.0, 0], [0.16, 8.0, 0.16], '#9da3aa', {
        material: 'metal',
        kind: 'body',
        concept: 'pole',
      }),
      box([0.55, 7.35, 0], [1.1, 0.07, 0.07], '#9da3aa', {
        material: 'metal',
        kind: 'frame',
        concept: 'arm',
      }),
      box([1.25, 7.33, 0], [0.55, 0.12, 0.22], '#bfc4c9', {
        material: 'metal',
        kind: 'light',
        concept: 'lamp',
      }),
      box([0, 7.75, 0.05], [0.12, 0.35, 0.12], '#7d8086', {
        material: 'plastic',
        kind: 'frame',
        concept: 'crossarm',
      }),
    ],
  },
  'house-front': {
    kind: 'parts',
    parts: house({
      w: 16,
      d: 8,
      wall: 4.6,
      wallColor: '#e6e3dc',
      roof: { kind: 'hip', h: 1.4, color: '#c9c3b8', material: 'tile', ridge: 0.6, over: 0.3 },
      front: [
        { x: -4.5, y: 0.9, w: 1.4, h: 1.6, grid: [2, 3] },
        { x: 4.5, y: 0.9, w: 1.4, h: 2.4, grid: [2, 3] },
      ],
      doors: [{ x: 0, y: 0, w: 1.8, h: 2.9, grid: [2, 3] }],
      chimneys: [
        { x: -7.2, z: 2.5, h: 1.6 },
        { x: 7.4, z: 2.5, h: 1.6 },
      ],
      extra: [
        // The arched portal round the entrance, its pediment and the three dormers.
        extrude(
          [0, 2.6, 4.25],
          [4.2, 5.2, 0.5],
          '#ece9e2',
          [
            [-0.5, -0.5],
            [-0.28, -0.5],
            [-0.28, 0.12],
            [-0.2, 0.25],
            [0, 0.3],
            [0.2, 0.25],
            [0.28, 0.12],
            [0.28, -0.5],
            [0.5, -0.5],
            [0.5, 0.3],
            [0, 0.5],
            [-0.5, 0.3],
          ],
          { material: 'plaster', kind: 'frame', concept: 'door' }
        ),
        prism([-4.5, 6.4, 2.4], [1.6, 1.2, 1.4], '#d9d4ca', {
          material: 'tile',
          kind: 'roof',
          concept: 'roof',
        }),
        box([-4.5, 5.6, 2.4], [1.4, 1.0, 1.2], '#eae7e0', {
          material: 'plaster',
          kind: 'wall',
          concept: 'window',
        }),
        prism([0, 6.7, 2.0], [2.4, 1.2, 1.6], '#d9d4ca', {
          material: 'tile',
          kind: 'roof',
          concept: 'roof',
        }),
        box([0, 5.8, 2.0], [2.2, 1.2, 1.4], '#eae7e0', {
          material: 'plaster',
          kind: 'wall',
          concept: 'window',
        }),
        prism([4.5, 6.4, 2.4], [1.6, 1.2, 1.4], '#d9d4ca', {
          material: 'tile',
          kind: 'roof',
          concept: 'roof',
        }),
        box([4.5, 5.6, 2.4], [1.4, 1.0, 1.2], '#eae7e0', {
          material: 'plaster',
          kind: 'wall',
          concept: 'window',
        }),
      ],
    }),
  },
  'house-wall-lamp': {
    kind: 'parts',
    parts: [
      cyl([0, 0.66, 0], [0.04, 0.12, 0.04], '#2c2f33', { material: 'metal', kind: 'frame' }),
      hip([0, 0.55, 0], [0.32, 0.12, 0.32], '#2f3236', {
        material: 'metal',
        kind: 'roof',
        ridge: 0,
        concept: 'lid',
      }),
      extrude(
        [0, 0.3, 0],
        [0.3, 0.38, 0.3],
        '#454a50',
        [
          [-0.5, 0.5],
          [0.5, 0.5],
          [0.36, -0.5],
          [-0.36, -0.5],
        ],
        {
          material: 'glass',
          kind: 'light',
          concept: 'lamp',
        }
      ),
      box([0, 0.09, 0], [0.24, 0.04, 0.24], '#2f3236', {
        material: 'metal',
        kind: 'frame',
        concept: 'base',
      }),
      cyl([0, 0.03, 0], [0.05, 0.08, 0.05], '#2c2f33', { material: 'metal', kind: 'frame' }),
    ],
  },
  'house-tree-1': plant('plane tree', {
    ...ROUND_BROAD,
    species: 'London plane, Platanus × acerifolia',
  }),
  'house-tree-2': plant('tree', {
    habit: 'spreading',
    leaf: 'broad',
    species: 'yellow-leaved shade tree',
  }),
  'house-tree-3': plant('plane tree', {
    ...ROUND_BROAD,
    species: 'London plane, Platanus × acerifolia',
  }),
  'garden-house': {
    kind: 'parts',
    parts: house({
      w: 14,
      d: 7,
      wall: 2.8,
      wallColor: '#6b5947',
      wallMaterial: 'stone',
      roof: { kind: 'hip', h: 1.2, color: '#8c7769', material: 'metal', ridge: 0.75, over: 0.5 },
      front: [
        { x: -4.0, y: 1.0, w: 2.0, h: 1.3, grid: [3, 1] },
        { x: -0.6, y: 1.0, w: 1.8, h: 1.3, grid: [3, 1] },
        { x: 2.2, y: 0.9, w: 1.6, h: 1.4, grid: [2, 1] },
      ],
      doors: [{ x: 4.9, y: 0, w: 2.4, h: 2.2 }],
      chimneys: [{ x: 3.3, z: 0.6, h: 1.8 }],
    }),
  },
  'garden-palm': plant('Canary date palm', {
    habit: 'palm',
    leaf: 'frond',
    species: 'Canary Island date palm, Phoenix canariensis',
    leafCount: 24,
  }),
  'garden-big-tree': {
    kind: 'parts',
    parts: [
      rod([0.1, 0], [0.05, 3.6], 1.1, 0, '#5e5a52', {
        material: 'wood',
        kind: 'trunk',
        concept: 'tree_trunk',
      }),
      rod([0.0, 3.4], [-2.6, 6.4], 0.38, 0, '#5e5a52', { material: 'wood', kind: 'trunk' }),
      rod([-1.8, 5.5], [-4.4, 7.2], 0.22, 0, '#5e5a52', { material: 'wood', kind: 'trunk' }),
      rod([0.1, 3.4], [0.6, 9.0], 0.42, 0, '#5e5a52', { material: 'wood', kind: 'trunk' }),
      rod([0.3, 3.6], [2.8, 7.6], 0.32, 0, '#5e5a52', { material: 'wood', kind: 'trunk' }),
      rod([1.9, 6.2], [4.2, 8.6], 0.2, 0, '#5e5a52', { material: 'wood', kind: 'trunk' }),
      rod([-0.6, 6.0], [-1.6, 9.2], 0.22, 0, '#5e5a52', { material: 'wood', kind: 'trunk' }),
      // The bare twig crown: sparse grey masses against the sky.
      ...(
        [
          [-4.4, 7.0, 2.4, 1.6],
          [-2.4, 8.6, 2.6, 1.8],
          [0.0, 9.4, 2.8, 1.6],
          [2.6, 8.8, 2.6, 1.8],
          [4.4, 7.4, 2.2, 1.6],
          [-2.2, 6.6, 1.8, 1.2],
          [2.0, 6.8, 1.8, 1.2],
          [0.2, 7.8, 2.4, 1.6],
        ] as const
      ).map(([x, y, rx, ry]) =>
        leaf([x - rx, y], rx * 2, ry * 2, 0, -0.2, '#7d7a70', {
          material: 'foliage',
          kind: 'crown',
          concept: 'foliage',
        })
      ),
    ],
  },
  'garden-pine': plant('cedar', {
    habit: 'conical',
    leaf: 'needle',
    species: 'deodar cedar, Cedrus deodara',
  }),
  'avenue-pine': plant('pine', {
    habit: 'spreading',
    leaf: 'needle',
    species: 'Mexican weeping pine, Pinus patula',
  }),
  'avenue-tree-left': plant('pine', {
    habit: 'round',
    leaf: 'needle',
    species: 'Mexican weeping pine, Pinus patula',
  }),
  'avenue-tree-right': plant('pine', {
    habit: 'round',
    leaf: 'needle',
    species: 'Mexican weeping pine, Pinus patula',
  }),
  'avenue-tree-back': plant('pine', {
    habit: 'spreading',
    leaf: 'needle',
    species: 'Mexican weeping pine, Pinus patula',
  }),
  'forest-tree-1': plant('tree', {
    habit: 'round',
    leaf: 'broad',
    species: 'mossy forest tree',
    trunks: [
      {
        points: [
          [0.25, 1.0],
          [0.45, 0.6],
          [0.75, 0.15],
          [0.9, 0.0],
        ],
        width: 0.35,
      },
    ],
  }),
  'forest-tree-2': plant('tree', {
    habit: 'round',
    leaf: 'broad',
    species: 'multi-stemmed forest tree',
    trunks: [
      {
        points: [
          [0.6, 1.0],
          [0.55, 0.5],
          [0.45, 0.0],
        ],
        width: 0.12,
      },
      {
        points: [
          [0.66, 1.0],
          [0.75, 0.5],
          [0.8, 0.05],
        ],
        width: 0.08,
      },
    ],
  }),
  'forest-rock': {
    kind: 'parts',
    parts: [
      {
        shape: 'sdf',
        at: [0, 0.35, 0],
        size: [1.2, 0.7, 0.9],
        color: '#4e4a32',
        material: 'stone',
        kind: 'body',
        concept: 'stone_foundation',
        blobs: [
          { kind: 'box', c: [0, -0.04, 0], size: [0.82, 0.78, 0.8], r: 0.2 },
          { kind: 'ellipsoid', c: [0.1, 0.12, 0.05], radii: [0.3, 0.28, 0.34], k: 0.08 },
          { kind: 'ellipsoid', c: [-0.22, -0.1, 0.05], radii: [0.2, 0.3, 0.34], k: 0.08 },
        ],
      },
    ],
  },
  'woods-tree': plant('tree', {
    habit: 'spreading',
    leaf: 'broad',
    species: 'forest tree with a leaning trunk',
    trunks: [
      {
        points: [
          [0.75, 1.0],
          [0.62, 0.55],
          [0.45, 0.35],
        ],
        width: 0.12,
      },
    ],
    branches: [
      {
        points: [
          [0.45, 0.35],
          [0.15, 0.25],
          [0.0, 0.2],
        ],
        width: 0.05,
      },
      {
        points: [
          [0.45, 0.35],
          [0.7, 0.15],
          [1.0, 0.05],
        ],
        width: 0.05,
      },
    ],
  }),
  'woods-plant': {
    kind: 'parts',
    parts: [
      rod([0.05, 0], [-0.05, 2.6], 0.14, 0, '#5d5a3c', {
        material: 'wood',
        kind: 'trunk',
        concept: 'tree_trunk',
      }),
      // Seven big leaves fanned round the top of the stem, seen from below.
      ...[
        [1.62, 1.25],
        [2.45, 1.0],
        [0.65, 0.95],
        [3.25, 0.95],
        [-0.2, 0.9],
        [4.05, 0.75],
        [-1.05, 0.75],
      ].map(([a, l]) =>
        leaf([-0.03, 2.75], l! * 1.35, l! * 0.68, a!, 0, '#6f9a3c', {
          material: 'foliage',
          kind: 'crown',
          concept: 'foliage',
        })
      ),
    ],
  },
};
