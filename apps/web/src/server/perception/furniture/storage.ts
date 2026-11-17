import { box, type PartSpec } from './part-spec';

/** Cabinets (VS-T42, shared since PQ-T88): carcass, door fronts, worktop, glazing. */

/** A low cabinet run or a wall cabinet: carcass, door fronts, optional worktop and glazing. */
export function cabinet(
  w: number,
  h: number,
  d: number,
  color: string,
  doors: number,
  o: { y0?: number; top?: string; glass?: boolean } = {}
): PartSpec[] {
  const y0 = o.y0 ?? 0;
  const out: PartSpec[] = [
    box([0, y0 + h / 2, 0], [w, h, d], color, { material: 'wood', kind: 'body', concept: 'frame' }),
  ];
  if (o.top)
    out.push(
      box([0, y0 + h + 0.02, 0.01], [w + 0.03, 0.04, d + 0.03], o.top, {
        material: 'wood',
        kind: 'body',
        concept: 'table',
      })
    );
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + dw * (i + 0.5);
    if (o.glass)
      out.push(
        box([x, y0 + h / 2, d / 2 + 0.005], [dw * 0.72, h * 0.82, 0.01], '#6c7074', {
          material: 'glass',
          kind: 'body',
          concept: 'window_pane',
        })
      );
    else
      out.push(
        box([x, y0 + h / 2, d / 2 + 0.005], [dw - 0.02, h - 0.04, 0.01], color, {
          material: 'wood',
          kind: 'body',
          concept: 'door',
        })
      );
    out.push(
      box(
        [x + dw * 0.3, y0 + (o.glass ? 0.06 : h * 0.85), d / 2 + 0.02],
        [0.12, 0.02, 0.02],
        '#9c9c9c',
        { material: 'metal', kind: 'handle', concept: 'handle' }
      )
    );
  }
  return out;
}
