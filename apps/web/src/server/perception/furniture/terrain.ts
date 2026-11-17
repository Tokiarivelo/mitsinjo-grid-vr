import { box, cyl, lathe, type PartSpec } from './part-spec';

/**
 * Things lying on the ground (VS-T42, shared since PQ-T90): a rock or a fallen log cut to the
 * object's outline (`silhouette` parts), a tyre lying flat, a stump. Metres, x right, y up.
 */

/** Side ring of a rock: flat bottom, rounded back and top (z, y). */
export const BOULDER: Array<[number, number]> = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, -0.1],
  [0.38, 0.3],
  [0.1, 0.5],
  [-0.25, 0.42],
  [-0.48, 0.1],
];

/** A free-standing rock: its traced outline as the front (`w` wide without one), a boulder section as the side. */
export function rock(h: number, d: number, color: string, w = h): PartSpec[] {
  return [
    box([0, h / 2, 0], [w, h, d], color, {
      material: 'stone',
      kind: 'body',
      concept: 'stone_foundation',
      silhouette: { section: BOULDER },
    }),
  ];
}

/** A fallen trunk: its traced outline, a round section. */
export function log(h: number, d: number, color: string, w = h): PartSpec[] {
  return [
    box([0, h / 2, 0], [w, h, d], color, {
      material: 'wood',
      kind: 'trunk',
      concept: 'tree_trunk',
      silhouette: {},
    }),
  ];
}

/** A tractor tyre lying flat: tread ring and the soil filling its hole. */
export function tyre(dia: number, h: number, rubber = '#5a5644', soil = '#4a3a2c'): PartSpec[] {
  return [
    lathe(
      [0, h / 2, 0],
      [dia, h, dia],
      rubber,
      [
        [0.42, -0.5],
        [0.5, -0.25],
        [0.5, 0.25],
        [0.42, 0.5],
      ],
      { material: 'rubber', kind: 'body', concept: 'wheel' }
    ),
    cyl([0, h * 0.8, 0], [dia * 0.55, h * 0.4, dia * 0.55], soil, {
      material: 'stone',
      kind: 'body',
    }),
  ];
}

/** A tree stump: a short trunk, its cut top a lighter ring. */
export function stump(dia: number, h: number, bark: string, cut = '#b99a6b'): PartSpec[] {
  return [
    cyl([0, h / 2, 0], [dia, h, dia], bark, {
      material: 'wood',
      kind: 'trunk',
      concept: 'tree_trunk',
    }),
    cyl([0, h + 0.005, 0], [dia * 0.9, 0.01, dia * 0.9], cut, { material: 'wood', kind: 'body' }),
  ];
}
