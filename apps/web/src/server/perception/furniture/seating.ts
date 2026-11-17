import { box, cyl, extrude, type PartSpec } from './part-spec';
import { WOOD } from './materials';

/**
 * Seats, beds and tables (VS-T42, shared since PQ-T88): parametric pieces in metres (x right, y up,
 * z toward the front), each part named by its concept (seat, backrest, leg, mattress…).
 */

/** Four legs under a w × d footprint, inset `inset` from the edges. */
export function legs(
  w: number,
  d: number,
  h: number,
  color: string,
  o: { inset?: number; r?: number; y0?: number; material?: PartSpec['material'] } = {}
): PartSpec[] {
  const inset = o.inset ?? 0.06;
  const r = o.r ?? 0.04;
  const y0 = o.y0 ?? 0;
  return [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) =>
      cyl([sx * (w / 2 - inset), y0 + h / 2, sz * (d / 2 - inset)], [r, h, r], color, {
        material: o.material ?? 'wood',
        kind: 'frame',
        concept: 'leg',
      })
    )
  );
}

export interface SofaSpec {
  w: number;
  d: number;
  /** Top of the seat above the floor. */
  seat: number;
  /** Top of the back above the floor. */
  back: number;
  /** Top of the arms above the floor (0 = no arms). */
  arm: number;
  armW?: number;
  leg: number;
  color: string;
  legColor?: string;
  cushions?: number;
  /** Arched back (tufted Chesterfield-like) instead of a straight one. */
  arched?: boolean;
  /** Back rising on one end only (chaise longue): share of the width it covers, from the right. */
  chaise?: number;
}

/** A sofa, an armchair or a chaise longue: legs, seat block, cushions, back, arms. */
export function sofa(s: SofaSpec): PartSpec[] {
  const fabric = { material: 'fabric' as const };
  const armW = s.arm > 0 ? (s.armW ?? 0.18) : 0;
  const seatT = s.seat - s.leg;
  const backD = 0.2;
  const backW = s.chaise ? s.w * s.chaise : s.w;
  const backX = s.chaise ? s.w / 2 - backW / 2 : 0;
  const backH = s.back - s.seat;
  const out: PartSpec[] = [
    ...legs(s.w, s.d, s.leg, s.legColor ?? WOOD),
    box([0, s.leg + seatT / 2, 0], [s.w, seatT, s.d], s.color, {
      ...fabric,
      kind: 'body',
      concept: 'seat',
    }),
    s.arched
      ? extrude(
          [backX, s.seat + backH / 2, -s.d / 2 + backD / 2],
          [backW, backH, backD],
          s.color,
          [
            [-0.5, -0.5],
            [0.5, -0.5],
            [0.5, 0.25],
            [0.35, 0.45],
            [0, 0.5],
            [-0.35, 0.45],
            [-0.5, 0.25],
          ],
          { ...fabric, kind: 'body', concept: 'backrest' }
        )
      : box([backX, s.seat + backH / 2, -s.d / 2 + backD / 2], [backW, backH, backD], s.color, {
          ...fabric,
          kind: 'body',
          concept: 'backrest',
        }),
  ];
  const n = s.cushions ?? 0;
  const inner = s.w - 2 * armW;
  for (let i = 0; i < n; i++)
    out.push(
      box(
        [-inner / 2 + (inner / n) * (i + 0.5), s.seat + 0.06, backD / 2],
        [inner / n - 0.02, 0.12, s.d - backD - 0.04],
        s.color,
        { ...fabric, kind: 'body', concept: 'cushion' }
      )
    );
  if (armW > 0)
    for (const sx of [-1, 1])
      out.push(
        box(
          [sx * (s.w / 2 - armW / 2), s.leg + (s.arm - s.leg) / 2, 0],
          [armW, s.arm - s.leg, s.d],
          s.color,
          {
            ...fabric,
            kind: 'body',
            concept: 'arm',
          }
        )
      );
  return out;
}

export interface ChairSpec {
  w: number;
  d: number;
  seat: number;
  back: number;
  color: string;
  legColor: string;
  /** shell: moulded seat on splayed legs · director: canvas on a crossed frame · upholstered. */
  style: 'shell' | 'director' | 'upholstered' | 'wire';
  arms?: boolean;
}

/** A chair: seat, back, legs (and arms). */
export function chair(c: ChairSpec): PartSpec[] {
  const mat = c.style === 'upholstered' ? 'fabric' : c.style === 'director' ? 'fabric' : 'plastic';
  const legMat = c.style === 'director' ? 'wood' : c.style === 'upholstered' ? 'wood' : 'metal';
  const seatT = c.style === 'upholstered' ? 0.12 : 0.05;
  const out: PartSpec[] = [
    ...legs(c.w, c.d, c.seat - seatT, c.legColor, { r: 0.03, material: legMat }),
    box([0, c.seat - seatT / 2, 0], [c.w, seatT, c.d], c.color, {
      material: mat,
      kind: 'body',
      concept: 'seat',
    }),
  ];
  const backH = c.back - c.seat;
  if (c.style === 'shell')
    out.push(
      extrude(
        [0, c.seat + backH / 2, -c.d / 2 + 0.03],
        [c.w, backH, 0.06],
        c.color,
        [
          [-0.42, -0.5],
          [0.42, -0.5],
          [0.5, 0.2],
          [0.38, 0.45],
          [0, 0.5],
          [-0.38, 0.45],
          [-0.5, 0.2],
        ],
        { material: mat, kind: 'body', concept: 'backrest' }
      )
    );
  else
    out.push(
      box(
        [0, c.seat + backH / 2, -c.d / 2 + 0.04],
        [c.w, backH, c.style === 'upholstered' ? 0.14 : 0.03],
        c.color,
        {
          material: mat,
          kind: 'body',
          concept: 'backrest',
        }
      )
    );
  if (c.style === 'director')
    for (const sx of [-1, 1])
      out.push(
        box([sx * (c.w / 2), c.seat * 0.45, 0], [0.03, c.seat * 0.9, c.d * 0.9], c.legColor, {
          material: 'wood',
          kind: 'frame',
          concept: 'frame',
        })
      );
  if (c.arms)
    for (const sx of [-1, 1])
      out.push(
        box([sx * (c.w / 2 - 0.02), c.seat + 0.12, 0], [0.04, 0.04, c.d * 0.85], c.color, {
          material: mat,
          kind: 'frame',
          concept: 'arm',
        })
      );
  return out;
}

/** A bar or wooden stool: round or square top, four legs, a ring or rails. */
export function stool(
  h: number,
  top: number,
  color: string,
  legColor: string,
  round: boolean
): PartSpec[] {
  const spread = top * 1.25;
  return [
    (round ? cyl : box)([0, h - 0.025, 0], [top, 0.05, top], color, {
      material: 'wood',
      kind: 'body',
      concept: 'seat',
    }),
    ...legs(spread, spread, h - 0.05, legColor, { r: 0.035, material: round ? 'metal' : 'wood' }),
    (round ? cyl : box)([0, h * 0.3, 0], [spread * 0.9, 0.03, spread * 0.9], legColor, {
      material: round ? 'metal' : 'wood',
      kind: 'frame',
      concept: 'frame',
    }),
  ];
}

/** A bed: low frame, mattress, blanket over the foot, pillows against the head. */
export function bed(
  w: number,
  l: number,
  frame: number,
  frameColor: string,
  sheet: string,
  blanket: string,
  pillows: string[]
): PartSpec[] {
  const matt = 0.22;
  const out: PartSpec[] = [
    box([0, frame / 2, 0], [w, frame, l], frameColor, {
      material: 'wood',
      kind: 'frame',
      concept: 'frame',
    }),
    box([0, frame + matt / 2, 0], [w - 0.06, matt, l - 0.06], sheet, {
      material: 'fabric',
      kind: 'body',
      concept: 'mattress',
    }),
    box([0, frame + matt + 0.03, l * 0.12], [w + 0.04, 0.06, l * 0.7], blanket, {
      material: 'fabric',
      kind: 'body',
      concept: 'cushion',
    }),
  ];
  pillows.forEach((c, i) =>
    out.push(
      box(
        [-w / 2 + (w / pillows.length) * (i + 0.5), frame + matt + 0.2, -l / 2 + 0.2],
        [w / pillows.length - 0.06, 0.4, 0.14],
        c,
        { material: 'fabric', kind: 'body', concept: 'cushion' }
      )
    )
  );
  return out;
}

/** A table: round or square top on legs, or on a centre pedestal with feet. */
export function table(
  h: number,
  w: number,
  d: number,
  top: string,
  leg: string,
  o: { round?: boolean; pedestal?: boolean; topT?: number; material?: PartSpec['material'] } = {}
): PartSpec[] {
  const t = o.topT ?? 0.04;
  const mat = o.material ?? 'wood';
  const out: PartSpec[] = [
    (o.round ? cyl : box)([0, h - t / 2, 0], [w, t, d], top, {
      material: mat,
      kind: 'body',
      concept: 'table',
    }),
  ];
  if (o.pedestal)
    out.push(
      cyl([0, (h - t) / 2, 0], [0.07, h - t, 0.07], leg, {
        material: mat,
        kind: 'frame',
        concept: 'stand',
      }),
      box([0, 0.03, 0], [w * 0.7, 0.06, 0.08], leg, {
        material: mat,
        kind: 'frame',
        concept: 'foot',
      }),
      box([0, 0.03, 0], [0.08, 0.06, d * 0.7], leg, {
        material: mat,
        kind: 'frame',
        concept: 'foot',
      })
    );
  else
    out.push(
      ...legs(w * (o.round ? 0.75 : 1), d * (o.round ? 0.75 : 1), h - t, leg, {
        r: 0.025,
        material: 'metal',
      })
    );
  return out;
}
