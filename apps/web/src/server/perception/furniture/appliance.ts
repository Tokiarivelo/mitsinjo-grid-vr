import { box, extrude, lathe, type PartSpec } from './part-spec';

/**
 * Appliances (PQ-T90): a wall air unit (promoted from the tour), a cooker hood, and the generic
 * appliance body — a box (its top rounded or not) on a plinth or feet, an optional top board, and
 * the front details read on its drawing (grilles, screens, buttons, handles, a firebox…) laid on
 * its face. Metres, x right, y up, z toward the camera.
 */

const WHITE = '#e9e9e6';
const DARK = '#2a2a2a';

/** A wall air unit: body, rows of staggered slots, a lower return grille (loft, hall). */
export function airUnit(
  w: number,
  h: number,
  rows: number,
  perRow: number,
  color = WHITE,
  slot = DARK
): PartSpec[] {
  const d = 0.22;
  const parts: PartSpec[] = [
    box([0, h / 2, 0], [w, h, d], color, {
      material: 'plastic',
      kind: 'body',
      concept: 'fan_guard',
    }),
    box([0, h * 0.08, d / 2 + 0.004], [w * 0.92, h * 0.1, 0.008], '#6d6d6b', {
      material: 'plastic',
      kind: 'grille',
      concept: 'grille',
    }),
  ];
  const slotW = (w * 0.9) / perRow;
  for (let r = 0; r < rows; r++) {
    const y = h * (0.86 - (r * 0.5) / rows);
    const shift = r % 2 ? slotW / 2 : 0;
    for (let i = 0; i < perRow - (r % 2); i++) {
      const x = -w * 0.45 + slotW * (i + 0.5) + shift;
      parts.push(
        box([x, y, d / 2 + 0.003], [slotW * 0.62, h * 0.055, 0.006], slot, {
          material: 'plastic',
          kind: 'grille',
        })
      );
    }
  }
  return parts;
}

/** A chimney cooker hood: a canopy `canopy` of the height, its flue above. */
export function hood(w: number, h: number, color: string, canopy = 0.5): PartSpec[] {
  const c = Math.min(0.9, Math.max(0.2, canopy));
  const flue = 0.41;
  return [
    lathe(
      [0, h / 2, 0],
      [w, h, w],
      color,
      [
        [0.0, -0.5],
        [0.5, -0.5],
        [0.49, -0.5 + c * 0.12],
        [flue / 2 + 0.035, -0.5 + c - 0.04],
        [flue / 2, -0.5 + c],
        [flue / 2, 0.5],
        [0.0, 0.5],
      ],
      { material: 'metal', kind: 'body', concept: 'pipe' }
    ),
  ];
}

/** One detail on the appliance front: its box on the front drawing (shares, y down). */
export interface FrontDetail {
  concept: string;
  box: readonly [number, number, number, number];
  color: string;
  material?: PartSpec['material'];
  /** How far it stands out of (+) or sinks into (−) the face (metres). */
  depth?: number;
}

/** A rounded top: the front ring with its upper corners eased. */
const ROUNDED: Array<[number, number]> = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.36],
  [0.47, 0.43],
  [0.4, 0.48],
  [0.3, 0.5],
  [-0.3, 0.5],
  [-0.4, 0.48],
  [-0.47, 0.43],
  [-0.5, 0.36],
];

/**
 * An appliance body `w` × `h` × `d`: from `foot` up (a plinth or feet below it), its top rounded
 * when asked, a top board overhanging it when `top` is given, its front details on the face.
 */
export function applianceBody(
  w: number,
  h: number,
  d: number,
  color: string,
  o: {
    rounded?: boolean;
    material?: PartSpec['material'];
    concept?: string;
    plinth?: { h: number; color: string };
    feet?: { h: number; color: string };
    top?: string;
    details?: ReadonlyArray<FrontDetail>;
    /** Depth of the body against the back (default `d`): a fireplace's hearth and mantel stand out of it. */
    bodyD?: number;
  } = {}
): PartSpec[] {
  const bd = Math.min(d, o.bodyD ?? d);
  const z0 = (bd - d) / 2;
  const foot = o.plinth?.h ?? o.feet?.h ?? 0;
  const topT = o.top ? Math.min(0.05, h * 0.05) : 0;
  const bh = h - foot - topT;
  const body = {
    material: o.material ?? 'metal',
    kind: 'body' as const,
    concept: o.concept ?? 'frame',
  };
  const out: PartSpec[] = [
    o.rounded
      ? extrude([0, foot + bh / 2, z0], [w, bh, bd], color, ROUNDED, { ...body, front: true })
      : box([0, foot + bh / 2, z0], [w, bh, bd], color, body),
  ];
  if (o.top)
    out.push(
      box([0, h - topT / 2, 0.02], [w * 1.02, topT, d + 0.04], o.top, {
        material: body.material,
        kind: 'body',
        concept: 'table',
      })
    );
  if (o.plinth)
    out.push(
      box([0, o.plinth.h / 2, -0.01], [w * 0.92, o.plinth.h, d * 0.92], o.plinth.color, {
        material: body.material,
        kind: 'plinth',
        concept: 'base',
      })
    );
  if (o.feet)
    for (const s of [-1, 1])
      out.push(
        box([s * w * 0.37, o.feet.h / 2, d / 3], [w * 0.16, o.feet.h, d * 0.2], o.feet.color, {
          material: body.material,
          kind: 'body',
          concept: 'foot',
        })
      );
  for (const f of o.details ?? []) {
    const [x0, y0, x1, y1] = f.box;
    const dw = Math.max(0.005, (x1 - x0) * w);
    const dh = Math.max(0.005, (y1 - y0) * h);
    const depth = f.depth ?? 0.008;
    out.push(
      box(
        [((x0 + x1) / 2 - 0.5) * w, (1 - (y0 + y1) / 2) * h, z0 + bd / 2 + depth / 2],
        [dw, dh, Math.abs(depth)],
        f.color,
        { material: f.material ?? 'plastic', kind: 'frame', concept: f.concept }
      )
    );
  }
  return out;
}
