import type { PlantHints } from '../tree/plant-build';
import { box, cone, cyl, extrude, hull, lathe, type PartSpec, type TourSpec } from './spec';

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

const WOOD = '#8a6a48';
const METAL = '#2b2b2d';
const WHITE = '#e8e7e3';

/** Four legs under a w × d footprint, inset `inset` from the edges. */
function legs(
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

interface SofaSpec {
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
function sofa(s: SofaSpec): PartSpec[] {
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

interface ChairSpec {
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
function chair(c: ChairSpec): PartSpec[] {
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
function stool(
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
function bed(
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
function table(
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

/** A framed glazed opening (window, glass door, mirror): frame, glass, mullions on a cols × rows grid. */
function glazing(
  w: number,
  h: number,
  cols: number,
  rows: number,
  frame: string,
  glass: string,
  o: { y0?: number; bar?: number; arch?: boolean; concept?: string; glassConcept?: string } = {}
): PartSpec[] {
  const y0 = o.y0 ?? 0;
  const bar = o.bar ?? 0.05;
  const ring: Array<[number, number]> = o.arch
    ? [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.2],
        ...Array.from({ length: 9 }, (_, i) => {
          const t = (i / 8) * Math.PI;
          return [0.5 * Math.cos(t), 0.2 + 0.3 * Math.sin(t)] as [number, number];
        }).slice(1, 8),
        [-0.5, 0.2],
      ]
    : [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ];
  const out: PartSpec[] = [
    extrude([0, y0 + h / 2, 0], [w, h, 0.06], frame, ring, {
      material: 'wood',
      kind: 'frame',
      concept: o.concept ?? 'window',
    }),
    extrude([0, y0 + h / 2, 0.035], [w - 2 * bar, h - 2 * bar, 0.01], glass, ring, {
      material: 'glass',
      kind: 'body',
      concept: o.glassConcept ?? 'window_pane',
    }),
  ];
  for (let i = 1; i < cols; i++)
    out.push(
      box([-w / 2 + (w / cols) * i, y0 + h / 2, 0.045], [bar * 0.6, h - 2 * bar, 0.02], frame, {
        material: 'wood',
        kind: 'frame',
      })
    );
  for (let j = 1; j < rows; j++)
    out.push(
      box([0, y0 + (h / rows) * j, 0.045], [w - 2 * bar, bar * 0.6, 0.02], frame, {
        material: 'wood',
        kind: 'frame',
      })
    );
  return out;
}

/** A door: one or two leaves with raised panels or glass, a handle. */
function door(
  w: number,
  h: number,
  color: string,
  o: { leaves?: number; glass?: [number, number] } = {}
): PartSpec[] {
  const leaves = o.leaves ?? 1;
  const lw = w / leaves;
  const out: PartSpec[] = [
    box([0, h / 2, -0.03], [w + 0.12, h + 0.06, 0.04], color, {
      material: 'wood',
      kind: 'frame',
      concept: 'frame',
    }),
  ];
  for (let i = 0; i < leaves; i++) {
    const x = -w / 2 + lw * (i + 0.5);
    if (o.glass)
      out.push(
        ...glazing(lw - 0.02, h, o.glass[0], o.glass[1], color, '#3a4048').map((p) => ({
          ...p,
          at: [p.at[0] + x, p.at[1], p.at[2]] as const,
        }))
      );
    else
      out.push(
        box([x, h / 2, 0], [lw - 0.02, h, 0.05], color, {
          material: 'wood',
          kind: 'body',
          concept: 'door',
        }),
        box([x, h * 0.72, 0.03], [lw * 0.6, h * 0.38, 0.01], color, {
          material: 'wood',
          kind: 'frame',
        }),
        box([x, h * 0.27, 0.03], [lw * 0.6, h * 0.34, 0.01], color, {
          material: 'wood',
          kind: 'frame',
        })
      );
  }
  out.push(
    box([leaves > 1 ? 0.06 : w / 2 - 0.12, h * 0.48, 0.05], [0.04, 0.15, 0.04], '#b8b2a6', {
      material: 'metal',
      kind: 'handle',
      concept: 'handle',
    })
  );
  return out;
}

/** Side ring of a soft hanging sheet: thin at the rod, fuller where the folds hang (z, y). */
const DRAPE: Array<[number, number]> = [
  [-0.15, 0.5],
  [0.15, 0.5],
  [0.5, 0],
  [0.4, -0.5],
  [-0.4, -0.5],
  [-0.5, 0],
];

/** A hanging curtain: the sheet cut to its traced outline (gathered, tied back), a rod on top. */
function curtain(
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

/** A low cabinet run or a wall cabinet: carcass, door fronts, optional worktop and glazing. */
function cabinet(
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
  'terrace-railing-1': parts(railing(7.0, 1.0, 28)),
  'terrace-railing-2': parts(railing(6.5, 1.0, 28)),
  'terrace-pylon': parts([
    // A lattice tower: its outline, square in plan.
    box([0, 15, 0], [6, 30, 6], '#8d939a', {
      material: 'metal',
      kind: 'frame',
      concept: 'pole',
      silhouette: {
        section: [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.08, 0.5],
          [-0.08, 0.5],
        ],
      },
    }),
  ]),
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
  'garden-tree-1': plant('eucalyptus trunk', {
    habit: 'columnar',
    leaf: 'broad',
    species: 'eucalyptus',
  }),
  'garden-tree-2': plant('bare deciduous tree', {
    habit: 'round',
    leaf: 'none',
    species: 'oak in winter',
  }),
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

/** A wrought-iron railing: rails, end posts and `n` balusters. */
function railing(w: number, h: number, n: number): PartSpec[] {
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
function fence(w: number, h: number, color: string, pillars: number, base?: string): PartSpec[] {
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
