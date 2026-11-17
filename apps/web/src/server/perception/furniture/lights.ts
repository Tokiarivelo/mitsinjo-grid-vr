import { box, cone, cyl, extrude, lathe, type PartSpec } from './part-spec';

/**
 * Light fittings (PQ-T90): ceiling disc and panel, wall sconce (promoted from the tour), wall
 * lantern, street lamp on its pole and arm, chandelier with its candle bulbs. Metres, x right,
 * y up, z toward the camera (out of the wall for a wall light).
 */

/** A flush ceiling disc: metal rim and its diffuser, seen from below (y = 0 is the lens). */
export function ceilingDisc(d: number, frame = '#d9d9d6', lens = '#efefec'): PartSpec[] {
  return [
    cyl([0, 0.035, 0], [d, 0.05, d], frame, { material: 'metal', kind: 'frame', concept: 'frame' }),
    cyl([0, 0.0, 0], [d * 0.86, 0.03, d * 0.86], lens, {
      material: 'plastic',
      kind: 'light',
      concept: 'lamp',
    }),
  ];
}

/** A flush square ceiling panel: its frame and diffuser. */
export function ceilingPanel(w: number, frame = '#e1e1df', lens = '#f2f2f0'): PartSpec[] {
  return [
    box([0, 0.03, 0], [w, 0.05, w], frame, {
      material: 'plastic',
      kind: 'frame',
      concept: 'frame',
    }),
    box([0, 0.0, 0], [w * 0.87, 0.02, w * 0.87], lens, {
      material: 'plastic',
      kind: 'light',
      concept: 'lamp',
    }),
  ];
}

/** A wall sconce: round wall plate, short arm, cone shade open downward (`s` = scale, 1 ≈ 30 cm). */
export function sconce(s = 1, frame = '#e9e9e5', shade = '#ecece8'): PartSpec[] {
  return [
    cyl([0.03 * s, 0.2 * s, -0.06 * s], [0.1 * s, 0.1 * s, 0.02 * s], frame, {
      material: 'metal',
      kind: 'frame',
      axis: 'z',
      concept: 'base',
    }),
    box([0.0, 0.26 * s, 0.0], [0.02 * s, 0.1 * s, 0.1 * s], '#dcdcd8', {
      material: 'metal',
      kind: 'body',
      concept: 'arm',
    }),
    cone([0.0, 0.09 * s, 0.03 * s], [0.17 * s, 0.2 * s, 0.17 * s], shade, {
      material: 'metal',
      kind: 'light',
      concept: 'lamp',
    }),
  ];
}

/** A wall lantern `w` wide, `h` tall: hook, lid, glass tapering to `taper` of its top, base plate, foot. */
export function lantern(
  w: number,
  h: number,
  frame = '#2f3236',
  glass = '#454a50',
  taper = 0.68
): PartSpec[] {
  const y = (v: number) => (v / 0.7) * h;
  const x = (v: number) => (v / 0.32) * w;
  return [
    cyl([0, y(0.66), 0], [x(0.04), y(0.12), x(0.04)], frame, { material: 'metal', kind: 'frame' }),
    cone([0, y(0.56), 0], [x(0.32), y(0.11), x(0.32)], frame, {
      material: 'metal',
      kind: 'roof',
      concept: 'lid',
    }),
    extrude(
      [0, y(0.3), 0],
      [x(0.3), y(0.4), x(0.3)],
      glass,
      [
        [-0.5, 0.5],
        [0.5, 0.5],
        [taper / 2, -0.5],
        [-taper / 2, -0.5],
      ],
      { material: 'glass', kind: 'light', concept: 'lamp' }
    ),
    box([0, y(0.09), 0], [x(0.24), y(0.04), x(0.24)], frame, {
      material: 'metal',
      kind: 'frame',
      concept: 'base',
    }),
    cyl([0, y(0.03), 0], [x(0.05), y(0.08), x(0.05)], frame, { material: 'metal', kind: 'frame' }),
  ];
}

/** A street lamp `h` tall: its pole, an arm reaching `reach` to one `side` (±1), the lamp head. */
export function streetLamp(
  h: number,
  reach: number,
  side: 1 | -1,
  pole = '#9da3aa',
  head = '#bfc4c9'
): PartSpec[] {
  const headW = Math.min(0.55, reach * 0.36);
  const arm = reach - headW * 0.5;
  return [
    cyl([0, h / 2, 0], [0.16, h, 0.16], pole, { material: 'metal', kind: 'body', concept: 'pole' }),
    box([(side * arm) / 2, h * 0.919, 0], [arm, 0.07, 0.07], pole, {
      material: 'metal',
      kind: 'frame',
      concept: 'arm',
    }),
    box([side * (reach - headW / 2), h * 0.916, 0], [headW, 0.12, 0.22], head, {
      material: 'metal',
      kind: 'light',
      concept: 'lamp',
    }),
  ];
}

/**
 * A chandelier `w` wide, `h` tall: ceiling cup and stem, a crown, a glass bowl, a ring of
 * `bulbs` candle bulbs on its arm ring, a drop under the bowl.
 */
export function chandelier(
  w: number,
  h: number,
  bulbs: number,
  metal = '#a8894f',
  glass = '#cdc6b6',
  candle = '#efe6d2'
): PartSpec[] {
  const y = (v: number) => (v / 1.69) * h;
  const x = (v: number) => (v / 1.02) * w;
  const n = Math.max(0, Math.min(16, Math.round(bulbs)));
  return [
    cyl([0, y(1.66), 0], [x(0.12), y(0.06), x(0.12)], metal, { material: 'metal', kind: 'frame' }),
    cyl([0, y(1.33), 0], [x(0.04), y(0.62), x(0.04)], metal, {
      material: 'metal',
      kind: 'body',
      concept: 'pipe',
    }),
    lathe(
      [0, y(0.98), 0],
      [x(0.32), y(0.24), x(0.32)],
      metal,
      [
        [0.06, -0.5],
        [0.2, -0.3],
        [0.5, 0.5],
        [0.0, 0.5],
      ],
      { material: 'metal', kind: 'head' }
    ),
    lathe(
      [0, y(0.55), 0],
      [x(0.72), y(0.62), x(0.72)],
      glass,
      [
        [0.0, -0.5],
        [0.22, -0.45],
        [0.42, -0.2],
        [0.5, 0.1],
        [0.34, 0.35],
        [0.12, 0.5],
        [0.0, 0.5],
      ],
      { material: 'glass', kind: 'body', concept: 'lamp' }
    ),
    cyl([0, y(0.6), 0], [w, y(0.035), w], metal, {
      material: 'metal',
      kind: 'frame',
      concept: 'arm',
    }),
    cone([0, y(0.12), 0], [x(0.18), y(0.26), x(0.18)], glass, { material: 'glass', kind: 'light' }),
    ...Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2 + Math.PI / n;
      return cyl(
        [Math.cos(t) * x(0.5), y(0.72), Math.sin(t) * x(0.5)],
        [x(0.04), y(0.24), x(0.04)],
        candle,
        { material: 'plastic', kind: 'light', concept: 'lamp' }
      );
    }),
  ];
}
