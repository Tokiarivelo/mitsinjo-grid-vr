import type { AlignedViews, GridView } from '../recon/views';

/** A synthetic drawn tree for the tree tests (PQ-T79): an elliptic crown on a rectangular trunk. */
export interface DrawnTree {
  /** Width of the drawing (the depth of the side views is the same), rows are always 128. */
  cols?: number;
  /** Crown: top row, base row, half-width as a share of the width. */
  crown?: { top: number; base: number; half: number };
  /** Trunk half-width in cells; 0 = none (a bush). */
  trunk?: number;
  /** Rows (from the foot) where the trunk is swollen, and by how much (fallen fronds). */
  swollen?: { rows: number; by: number };
  /** Roots: rows of the foot spread out to this half-width. */
  roots?: { rows: number; half: number };
  leaf?: [number, number, number];
  bark?: [number, number, number];
  /** Leaves painted in bark colour instead (a leafless drawing). */
  bare?: boolean;
}

export const ROWS = 128;
const PAPER: [number, number, number] = [196, 218, 232];

export function drawTree(t: DrawnTree = {}): GridView {
  const cols = t.cols ?? 80;
  const crown = t.crown ?? { top: 4, base: 70, half: 0.42 };
  const leaf = t.bare ? (t.bark ?? [110, 80, 60]) : (t.leaf ?? [70, 140, 60]);
  const bark = t.bark ?? [110, 80, 60];
  const rgb = new Uint8Array(cols * ROWS * 3);
  const mask = new Uint8Array(cols * ROWS);
  const set = (x: number, y: number, c: [number, number, number]) => {
    const i = y * cols + x;
    mask[i] = 1;
    rgb.set(c, i * 3);
  };
  for (let i = 0; i < cols * ROWS; i++) rgb.set(PAPER, i * 3);
  const cx = cols / 2;
  const cy = (crown.top + crown.base) / 2;
  const ry = (crown.base - crown.top) / 2;
  const rx = crown.half * cols;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < cols; x++)
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) set(x, y, leaf);
  const trunk = t.trunk ?? 4;
  if (trunk > 0)
    for (let y = crown.base - 4; y < ROWS; y++) {
      const fromFoot = ROWS - 1 - y;
      let half = trunk;
      if (t.swollen && fromFoot >= 40 && fromFoot < 40 + t.swollen.rows) half += t.swollen.by;
      if (t.roots && fromFoot < t.roots.rows) half = t.roots.half;
      for (let x = Math.round(cx - half); x < Math.round(cx + half); x++) set(x, y, bark);
    }
  return { cols, rows: ROWS, rgb, mask };
}

/** The four elevations of one drawn tree (the same drawing seen from each side), in the aligned frame. */
export function alignedTree(t: DrawnTree = {}): AlignedViews {
  const v = drawTree(t);
  return {
    W: v.cols,
    H: ROWS,
    D: v.cols,
    paper: PAPER,
    views: { front: v, right: v, back: v, left: v },
    read: ['front', 'right', 'back', 'left'],
    flipped: [],
    rightFromLeft: false,
    agreement: { frontBack: 1, rightLeft: 1 },
    frames: {},
    aspects: { w: v.cols / ROWS, d: v.cols / ROWS },
  };
}
