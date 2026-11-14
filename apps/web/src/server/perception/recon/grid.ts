/**
 * Raster helpers of the views reconstruction (PQ-T69): pure, deterministic, no image library.
 * A grid is row-major, row 0 at the top (image order); masks hold 0 / 1.
 */

/** One decoded view: sRGB, 3 bytes per pixel, row-major. */
export interface ViewImage {
  cols: number;
  rows: number;
  rgb: Uint8Array;
}

/** Inclusive cell box on a grid. */
export interface CellBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** One 4-connected component of a label map. */
export interface Component extends CellBox {
  /** Cell indices (`y * cols + x`). */
  cells: Int32Array;
  area: number;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Median of a byte sample (255 when empty). */
export function median(values: number[]): number {
  if (!values.length) return 255;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/**
 * 4-connected components of the cells where `keep(i)` holds. Scan order (top-left first), so the
 * result is stable for a given input.
 */
export function components(cols: number, rows: number, keep: (i: number) => boolean): Component[] {
  const seen = new Uint8Array(cols * rows);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (seen[start] || !keep(start)) continue;
    const cells: number[] = [];
    let [x0, x1, y0, y1] = [cols, -1, rows, -1];
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % cols;
      const y = (i - x) / cols;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (seen[j] || !keep(j)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    cells.sort((a, b) => a - b);
    out.push({ cells: Int32Array.from(cells), area: cells.length, x0, x1, y0, y1 });
  }
  return out;
}

/** Binary erosion (`grow` false) or dilation (`grow` true) by one cell, 4-neighbourhood. */
function morph(mask: Uint8Array, cols: number, rows: number, grow: boolean): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let v = mask[i]!;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        // Outside the grid counts as empty.
        const n = nx < 0 || ny < 0 || nx >= cols || ny >= rows ? 0 : mask[ny * cols + nx]!;
        v = grow ? v | n : v & n;
      }
      out[i] = v;
    }
  }
  return out;
}

/** Dilation by `radius` cells: the mask grown outward. */
export function grow(mask: Uint8Array, cols: number, rows: number, radius: number): Uint8Array {
  let m = mask;
  for (let k = 0; k < radius; k++) m = morph(m, cols, rows, true);
  return m;
}

/** Morphological opening: strokes thinner than `2 * radius + 1` cells vanish, bodies keep their shape. */
export function open(mask: Uint8Array, cols: number, rows: number, radius: number): Uint8Array {
  let m = mask;
  for (let k = 0; k < radius; k++) m = morph(m, cols, rows, false);
  for (let k = 0; k < radius; k++) m = morph(m, cols, rows, true);
  // Opening never adds cells: keep it inside the source.
  return m.map((v, i) => v & mask[i]!);
}

/** Morphological closing: gaps thinner than `2 * radius + 1` cells are bridged (panes of one window). */
export function close(mask: Uint8Array, cols: number, rows: number, radius: number): Uint8Array {
  let m = mask;
  for (let k = 0; k < radius; k++) m = morph(m, cols, rows, true);
  for (let k = 0; k < radius; k++) m = morph(m, cols, rows, false);
  // Closing never removes cells.
  return m.map((v, i) => v | mask[i]!);
}

/**
 * Majority filter on a label map (−1 = outside, never changed, never voted): each cell takes the
 * most frequent label of its (2·radius + 1)² neighbourhood; ties keep the cell's own label, then the lowest.
 */
export function majority(
  labels: Int16Array,
  cols: number,
  rows: number,
  classes: number,
  radius = 1
): Int16Array {
  const out = new Int16Array(labels);
  const votes = new Uint16Array(classes);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const own = labels[i]!;
      if (own < 0) continue;
      votes.fill(0);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const l = labels[ny * cols + nx]!;
          if (l >= 0) votes[l]!++;
        }
      }
      let best = own;
      for (let c = 0; c < classes; c++) if (votes[c]! > votes[best]!) best = c;
      out[i] = best;
    }
  }
  return out;
}

/**
 * Components smaller than `minArea` take the label that touches them most (specks of texture,
 * anti-aliased edges). A speck with no labelled neighbour is left as it is.
 */
export function absorbSpecks(
  labels: Int16Array,
  cols: number,
  rows: number,
  classes: number,
  minArea: number
): Int16Array {
  const out = new Int16Array(labels);
  for (let c = 0; c < classes; c++) {
    for (const comp of components(cols, rows, (i) => labels[i] === c)) {
      if (comp.area >= minArea) continue;
      const touch = new Uint32Array(classes);
      for (const i of comp.cells) {
        const x = i % cols;
        const y = (i - x) / cols;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const l = labels[ny * cols + nx]!;
          if (l >= 0 && l !== c) touch[l]!++;
        }
      }
      let best = -1;
      for (let k = 0; k < classes; k++)
        if (touch[k]! > 0 && (best < 0 || touch[k]! > touch[best]!)) best = k;
      if (best >= 0) for (const i of comp.cells) out[i] = best;
    }
  }
  return out;
}

/** The grid mirrored left ↔ right (labels or masks). */
export function mirror<T extends Int16Array | Uint8Array>(data: T, cols: number, rows: number): T {
  const out = data.slice() as T;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) out[y * cols + x] = data[y * cols + (cols - 1 - x)]!;
  return out;
}

/** Intersection over union of two masks of the same size (1 when both are empty). */
export function maskIou(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const [p, q] = [a[i]! > 0, b[i]! > 0];
    if (p && q) inter++;
    if (p || q) union++;
  }
  return union ? inter / union : 1;
}

/** A region is enclosed when no cell of it touches the outside and this share of its rim is one class. */
export const ENCLOSED_RIM_SHARE = 0.85;
/** Largest enclosed region absorbed, share of the object cells (a body inside a drawn outline is not a detail). */
export const ENCLOSED_MAX_SHARE = 0.3;
const ENCLOSED_PASSES = 3;

/**
 * Label map where every region enclosed by one other class takes that class: a window in a wall
 * is a feature of the wall's surface, not a break in the wall. Nested features (glass in a frame
 * in a wall) resolve over a few passes. The input map is left untouched.
 */
export function absorbEnclosed(
  labels: Int16Array,
  cols: number,
  rows: number,
  classes: number
): Int16Array {
  let out = new Int16Array(labels);
  let object = 0;
  for (const l of labels) if (l >= 0) object++;
  for (let pass = 0; pass < ENCLOSED_PASSES; pass++) {
    const next = new Int16Array(out);
    let changed = false;
    for (let c = 0; c < classes; c++) {
      for (const comp of components(cols, rows, (i) => out[i] === c)) {
        if (comp.area > object * ENCLOSED_MAX_SHARE) continue;
        const rim = new Uint32Array(classes);
        let total = 0;
        let outside = false;
        for (const i of comp.cells) {
          const x = i % cols;
          const y = (i - x) / cols;
          for (const [dx, dy] of NEIGHBOURS) {
            const nx = x + dx;
            const ny = y + dy;
            const l = nx < 0 || ny < 0 || nx >= cols || ny >= rows ? -1 : out[ny * cols + nx]!;
            if (l === c) continue;
            if (l < 0) outside = true;
            else {
              rim[l]!++;
              total++;
            }
          }
          if (outside) break;
        }
        if (outside || !total) continue;
        let best = 0;
        for (let k = 1; k < classes; k++) if (rim[k]! > rim[best]!) best = k;
        if (rim[best]! < total * ENCLOSED_RIM_SHARE) continue;
        for (const i of comp.cells) next[i] = best;
        changed = true;
      }
    }
    out = next;
    if (!changed) break;
  }
  return out;
}

/** Structural map: majority radius and passes, and the smallest mass kept (share of the object cells). */
export const STRUCTURE_RADIUS = 2;
export const STRUCTURE_PASSES = 2;
export const STRUCTURE_MIN_SHARE = 0.003;

/**
 * The masses of a view: the label map smoothed hard, small regions given to their surroundings,
 * surface features absorbed in the region that encloses them. Window bars, railings, lamps and
 * texture are gone; walls, roofs, pillars, wheels remain. Volumes are cut from this map; the fine
 * map keeps the details for the surface pass.
 */
export function structure(
  labels: Int16Array,
  cols: number,
  rows: number,
  classes: number
): Int16Array {
  let object = 0;
  for (const l of labels) if (l >= 0) object++;
  let out = labels;
  for (let p = 0; p < STRUCTURE_PASSES; p++)
    out = majority(out, cols, rows, classes, STRUCTURE_RADIUS);
  out = absorbSpecks(out, cols, rows, classes, Math.ceil(object * STRUCTURE_MIN_SHARE));
  return absorbEnclosed(out, cols, rows, classes);
}
