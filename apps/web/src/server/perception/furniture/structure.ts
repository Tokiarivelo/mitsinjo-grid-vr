import { box, cyl, type PartSpec } from './part-spec';
import { METAL } from './materials';

/** Railings and fences (VS-T42, shared since PQ-T88): posts, rails, balusters, boards. */

/** A wrought-iron railing: rails, end posts and `n` balusters. */
export function railing(w: number, h: number, n: number): PartSpec[] {
  const iron = { material: 'metal' as const, kind: 'frame' as const };
  return [
    box([0, h, 0], [w, 0.05, 0.05], METAL, { ...iron, concept: 'rail' }),
    box([0, 0.08, 0], [w, 0.05, 0.05], METAL, { ...iron, concept: 'rail' }),
    ...[-1, 1].map((s) =>
      box([s * (w / 2 + 0.2), h / 2 + 0.1, 0], [0.4, h + 0.2, 0.4], '#bdb39c', {
        material: 'stone',
        kind: 'body',
        concept: 'pole',
      })
    ),
    ...Array.from({ length: n }, (_, i) =>
      cyl([-w / 2 + (w / n) * (i + 0.5), h / 2, 0], [0.04, h, 0.04], METAL, {
        ...iron,
        concept: 'rail',
      })
    ),
  ];
}

/** A board fence: boards on rails, stone pillars every `pillars` (0 = none) and an optional base wall. */
export function fence(
  w: number,
  h: number,
  color: string,
  pillars: number,
  base?: string
): PartSpec[] {
  const boards = Math.min(36, Math.round(w / 0.4));
  const y0 = base ? 0.35 : 0;
  const out: PartSpec[] = [
    box([0, y0 + h * 0.75, -0.04], [w, 0.08, 0.04], color, {
      material: 'wood',
      kind: 'frame',
      concept: 'rail',
    }),
    ...Array.from({ length: boards }, (_, i) =>
      box([-w / 2 + (w / boards) * (i + 0.5), y0 + h / 2, 0], [w / boards - 0.05, h, 0.03], color, {
        material: 'wood',
        kind: 'body',
        concept: 'timber_beam',
      })
    ),
  ];
  if (base)
    out.push(
      box([0, 0.175, 0], [w, 0.35, 0.3], base, {
        material: 'stone',
        kind: 'body',
        concept: 'stone_foundation',
      })
    );
  for (let i = 0; i < pillars; i++)
    out.push(
      box(
        [-w / 2 + (w / (pillars + 1)) * (i + 1), (h + 0.2) / 2, 0],
        [0.5, h + 0.2, 0.5],
        '#9c8670',
        { material: 'stone', kind: 'frame', concept: 'stone_foundation' }
      )
    );
  return out;
}
