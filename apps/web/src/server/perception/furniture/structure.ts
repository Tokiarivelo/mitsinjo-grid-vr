import { box, cyl, plate, rod, type PartSpec } from './part-spec';
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

/** A flat iron bar (`width` wide) along a centre line (metres, front plane): a ribbon ring. */
export function barRibbon(
  line: ReadonlyArray<readonly [number, number]>,
  width: number
): Array<[number, number]> {
  const side = (s: number) =>
    line.map(([x, y], i) => {
      const [ax, ay] = line[Math.max(0, i - 1)]!;
      const [bx, by] = line[Math.min(line.length - 1, i + 1)]!;
      const l = Math.hypot(bx - ax, by - ay) || 1;
      return [x - ((by - ay) / l) * (width / 2) * s, y + ((bx - ax) / l) * (width / 2) * s] as [
        number,
        number,
      ];
    });
  return [...side(1), ...side(-1).reverse()];
}

/** Points along an S baluster from its foot to its head: bellied out one way low, the other high. */
export function sCurve(
  x: number,
  y0: number,
  y1: number,
  swing: number,
  n = 14
): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [
      x + swing * Math.sin(t * Math.PI * 2) * (0.6 + 0.4 * Math.sin(t * Math.PI)),
      y0 + t * (y1 - y0),
    ];
  });
}

/** A C scroll (an open ring, `turn` = where it opens, rad) of radius `r` round `c`. */
export function cScroll(
  c: readonly [number, number],
  r: number,
  turn: number,
  n = 12
): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const t = turn + 0.5 + (i / (n - 1)) * (Math.PI * 2 - 1);
    return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
  });
}

/**
 * A wrought-iron balcony railing as built (VS-T46): square posts at `posts` (shares of the width),
 * a top rail and a second rail under it with C scrolls between them, a foot rail, and flat-bar S
 * balusters (`n`) swinging alternately: what a terrace railing looks like, not a row of rods.
 */
export function ironRailing(w: number, h: number, n: number, posts: readonly number[]): PartSpec[] {
  const iron = { material: 'metal' as const, kind: 'frame' as const };
  const band = Math.min(0.2, h * 0.2);
  const bar = 0.022;
  const out: PartSpec[] = [
    box([0, h, 0], [w, 0.045, 0.045], METAL, { ...iron, concept: 'rail' }),
    box([0, h - band, 0], [w, 0.03, 0.03], METAL, { ...iron, concept: 'rail' }),
    box([0, 0.06, 0], [w, 0.035, 0.035], METAL, { ...iron, concept: 'rail' }),
    ...posts.map((p) =>
      // Square posts, 8 cm: the deepest member (a recipe keeps depth ≥ 1 % of its width).
      box([-w / 2 + p * w, (h + 0.04) / 2, 0], [0.08, h + 0.04, Math.max(0.08, w * 0.011)], METAL, {
        ...iron,
        concept: 'pole',
      })
    ),
  ];
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5);
    if (posts.some((p) => Math.abs(-w / 2 + p * w - x) < w / n / 2)) continue;
    const swing = (i % 2 ? 1 : -1) * Math.min(0.05, w / n / 3);
    out.push(
      plate(barRibbon(sCurve(x, 0.08, h - band, swing), bar), 0, bar, METAL, {
        ...iron,
        concept: 'rail',
      })
    );
  }
  // Scrolls in the band, two by two back to back, between the posts.
  const r = band * 0.32;
  const step = Math.max(r * 6, w / 12);
  for (let x = -w / 2 + step / 2; x < w / 2 - r * 2; x += step) {
    if (posts.some((p) => Math.abs(-w / 2 + p * w - x) < r * 3)) continue;
    for (const s of [-1, 1])
      out.push(
        plate(
          barRibbon(cScroll([x + s * r * 1.1, h - band / 2], r, s > 0 ? Math.PI : 0), bar * 0.8),
          0,
          bar,
          METAL,
          {
            ...iron,
            concept: 'rail',
          }
        )
      );
  }
  return out;
}

/**
 * A steel lattice tower (VS-T46: a power pylon): four legs tapering from `base` wide at the foot to
 * `top` at the head, `levels` panels of X bracing with a girt at each, on the front and back faces,
 * and cross arms (`arms`: height share, half span) for the lines. Angle-iron members, not a solid.
 */
export function latticeTower(
  h: number,
  base: number,
  top: number,
  levels: number,
  arms: ReadonlyArray<readonly [number, number]>,
  color = '#8d939a'
): PartSpec[] {
  const steel = { material: 'metal' as const, kind: 'frame' as const };
  const leg = Math.max(0.12, base * 0.03);
  const brace = leg * 0.55;
  const half = (y: number) => (base + (top - base) * (y / h)) / 2;
  const out: PartSpec[] = [];
  for (const z of [-1, 1]) {
    for (const s of [-1, 1])
      out.push(
        rod([s * half(0), 0], [s * half(h), h], leg, z * half(0) * 0.9, color, {
          ...steel,
          concept: 'pole',
        })
      );
    for (let i = 0; i < levels; i++) {
      const [y0, y1] = [(h * i) / levels, (h * (i + 1)) / levels];
      const zz = z * (half(y0) + half(y1)) * 0.45;
      out.push(
        rod([-half(y0), y0], [half(y1), y1], brace, zz, color, { ...steel, concept: 'pole' }),
        rod([half(y0), y0], [-half(y1), y1], brace, zz, color, { ...steel, concept: 'pole' }),
        rod([-half(y1), y1], [half(y1), y1], brace, z * half(y1) * 0.9, color, {
          ...steel,
          concept: 'rail',
        })
      );
    }
  }
  for (const [at, span] of arms) {
    const y = h * at;
    out.push(
      box([0, y, 0], [span * 2, leg * 1.4, half(y) * 1.6], color, { ...steel, concept: 'rail' }),
      ...[-1, 1].map((s) =>
        rod([s * half(y), y - h * 0.04], [s * span, y], brace, 0, color, {
          ...steel,
          concept: 'pole',
        })
      )
    );
  }
  return out;
}

/** A board fence: boards on rails, stone pillars every `pillars` (0 = none) and an optional base wall. */
export function fence(
  w: number,
  h: number,
  color: string,
  pillars: number,
  base?: string
): PartSpec[] {
  const boards = Math.min(36, Math.round(w / FENCE_BOARD));
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

/** Board width of `fence` (metres): its board count is its width over this. */
export const FENCE_BOARD = 0.4;

/** A gate between two stone pillars: a board leaf meeting the pillars, the pillars a little taller. */
export function gate(w: number, h: number, color: string, pillar = '#9c8670'): PartSpec[] {
  const pw = Math.min(0.4, w * 0.18);
  return [
    ...fence(Math.max(0.3, w - 2 * pw + 0.1), h, color, 0),
    ...[-1, 1].map((s) =>
      box([s * (w / 2 - pw / 2), (h + 0.1) / 2, 0], [pw, h + 0.1, pw], pillar, {
        material: 'stone',
        kind: 'frame',
        concept: 'stone_foundation',
      })
    ),
  ];
}
