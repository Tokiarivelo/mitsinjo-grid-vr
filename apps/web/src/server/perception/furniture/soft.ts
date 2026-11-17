import { box, type PartSpec } from './part-spec';

/** Soft furnishings (VS-T42, shared since PQ-T88): a curtain cut to its traced outline. */

/** Side ring of a soft hanging sheet: thin at the rod, fuller where the folds hang (z, y). */
export const DRAPE: Array<[number, number]> = [
  [-0.15, 0.5],
  [0.15, 0.5],
  [0.5, 0],
  [0.4, -0.5],
  [-0.4, -0.5],
  [-0.5, 0],
];

/** A hanging curtain: the sheet cut to its traced outline (gathered, tied back), a rod on top. */
export function curtain(
  w: number,
  h: number,
  color: string,
  o: { y0?: number; band?: [number, number] } = {}
): PartSpec[] {
  const y0 = o.y0 ?? 0;
  return [
    box([0, y0 + h / 2, 0], [w, h, 0.14], color, {
      material: 'fabric',
      kind: 'body',
      concept: 'curtain',
      silhouette: { band: o.band ?? [0, 1], section: DRAPE },
    }),
  ];
}
