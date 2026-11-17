import { box, cyl, type PartSpec } from './part-spec';

/**
 * Soft furnishings (VS-T42, shared since PQ-T88): a curtain cut to its traced outline, a rug, a
 * photo backdrop falling onto the floor, the rods or rolls a hanging cloth hangs from.
 */

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
  o: { y0?: number; band?: [number, number]; d?: number } = {}
): PartSpec[] {
  const y0 = o.y0 ?? 0;
  return [
    box([0, y0 + h / 2, 0], [w, h, o.d ?? 0.14], color, {
      material: 'fabric',
      kind: 'body',
      concept: 'curtain',
      silhouette: { band: o.band ?? [0, 1], section: DRAPE },
    }),
  ];
}

/** A flat lying textile or mat. */
export const rug = (w: number, d: number, color: string): PartSpec[] => [
  box([0, 0.02, 0], [w, 0.04, d], color, { material: 'fabric', kind: 'body', concept: 'cushion' }),
];

/**
 * Side ring of a cloth hanging down a wall then running `pool` of its depth onto the floor (an L,
 * z + = front): the hanging sheet is `t` of the depth thick, the floor part `t` of the height.
 */
export function poolSection(t = 0.08): Array<[number, number]> {
  const x = -0.5 + t;
  const y = -0.5 + Math.max(0.03, t * 0.75);
  return [
    [-0.5, 0.5],
    [x, 0.5],
    [x, y],
    [0.5, y],
    [0.5, -0.5],
    [-0.5, -0.5],
  ];
}

/** A photo backdrop falling onto the floor: one cloth, the outline as its front, an L side. */
export function backdrop(w: number, h: number, d: number, color: string): PartSpec[] {
  return [
    box([0, h / 2, 0], [w, h, d], color, {
      material: 'fabric',
      kind: 'body',
      concept: 'curtain',
      silhouette: { section: poolSection() },
    }),
  ];
}

/** Rods or paper rolls side by side along the top of a hanging cloth (stacked from `top` down). */
export function rods(
  w: number,
  top: number,
  colors: ReadonlyArray<string>,
  dia: number
): PartSpec[] {
  return colors.map((c, i) =>
    cyl([0, top - dia * (i + 0.5), 0.05 + 0.05 * i], [w, dia, dia], c, {
      material: 'fabric',
      kind: 'frame',
      axis: 'x',
      concept: 'rail',
    })
  );
}
