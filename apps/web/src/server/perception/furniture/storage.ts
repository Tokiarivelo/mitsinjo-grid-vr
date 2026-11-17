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

/** Open shelving: two sides, a top, a bottom and `shelves` boards between them (none = a frame). */
export function shelving(
  w: number,
  h: number,
  d: number,
  color: string,
  shelves: number,
  o: {
    material?: PartSpec['material'];
    t?: number;
    /** Four corner posts of this colour (a metal rack) instead of the two side panels. */
    posts?: string;
  } = {}
): PartSpec[] {
  // Boards keep a visible share of a tall rack (1.8 % of its height, at least 25 mm).
  const t = o.t ?? Math.max(0.025, 0.018 * h);
  const material = o.material ?? 'wood';
  const board = (y: number): PartSpec =>
    box([0, y, 0], [w - 2 * t, t, d], color, { material, kind: 'body', concept: 'shelf' });
  const n = Math.max(0, Math.round(shelves));
  const post = 0.035;
  const sides = o.posts
    ? [-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) =>
          box(
            [sx * (w / 2 - post / 2), h / 2, sz * (d / 2 - post / 2)],
            [post, h, post],
            o.posts!,
            {
              material: 'metal',
              kind: 'frame',
              concept: 'frame',
            }
          )
        )
      )
    : [-1, 1].map((sx) =>
        box([sx * (w / 2 - t / 2), h / 2, 0], [t, h, d], color, {
          material,
          kind: 'frame',
          concept: 'frame',
        })
      );
  return [
    ...sides,
    board(t / 2),
    board(h - t / 2),
    ...Array.from({ length: n }, (_, i) => board(((i + 1) * h) / (n + 1))),
  ];
}
