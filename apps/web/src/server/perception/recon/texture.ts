import type { GridView } from './views';

/**
 * Face textures (PQ-T70): a drawing cut to the object keeps paper around the silhouette. The
 * solids follow the silhouette on a coarser grid, so their edges would catch that paper: the
 * object's colours are bled outward over it. Pure, no image library.
 */

/** Passes of the bleed: pixels of paper covered beyond the silhouette edge. */
export const BLEED_PASSES = 4;
/** The silhouette is pulled in by this many pixels first, so the drawn outline stroke is not what bleeds. */
export const BLEED_INSET = 1;

/** The object mask of a canonical view at `cols` × `rows` (nearest cell). */
export function maskAt(view: GridView, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const sy = Math.min(view.rows - 1, Math.floor(((y + 0.5) / rows) * view.rows));
    for (let x = 0; x < cols; x++) {
      const sx = Math.min(view.cols - 1, Math.floor(((x + 0.5) / cols) * view.cols));
      out[y * cols + x] = view.mask[sy * view.cols + sx]!;
    }
  }
  return out;
}

/**
 * Object colours spread over the paper next to the silhouette, in place: each pass, a paper pixel
 * beside coloured ones takes their mean. `mask` (1 = object) is not modified.
 */
export function bleedPaper(
  rgb: Uint8Array,
  mask: Uint8Array,
  cols: number,
  rows: number,
  passes = BLEED_PASSES
): void {
  let known = Uint8Array.from(mask);
  for (let p = 0; p < passes; p++) {
    const next = Uint8Array.from(known);
    let changed = false;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (known[i]) continue;
        let [r, g, b, n] = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= cols) continue;
            const j = yy * cols + xx;
            if (!known[j]) continue;
            r += rgb[j * 3]!;
            g += rgb[j * 3 + 1]!;
            b += rgb[j * 3 + 2]!;
            n++;
          }
        }
        if (!n) continue;
        rgb[i * 3] = Math.round(r / n);
        rgb[i * 3 + 1] = Math.round(g / n);
        rgb[i * 3 + 2] = Math.round(b / n);
        next[i] = 1;
        changed = true;
      }
    }
    known = next;
    if (!changed) break;
  }
  fillRest(rgb, known, cols, rows);
}

/**
 * What the bleed did not reach takes the nearest coloured pixel straight left, right, above or
 * below it: where a solid is larger than the drawn silhouette (an inferred roof slope above the
 * drawn roof), it reads the colour next to it, never white paper.
 */
function fillRest(rgb: Uint8Array, known: Uint8Array, cols: number, rows: number): void {
  const n = cols * rows;
  const dist = new Int32Array(n).fill(1 << 30);
  const from = new Int32Array(n).fill(-1);
  const sweep = (start: number, step: number, count: number) => {
    let src = -1;
    let d = 0;
    for (let k = 0, i = start; k < count; k++, i += step) {
      if (known[i]) {
        src = i;
        d = 0;
        continue;
      }
      d++;
      if (src >= 0 && d < dist[i]!) {
        dist[i] = d;
        from[i] = src;
      }
    }
  };
  for (let y = 0; y < rows; y++) {
    sweep(y * cols, 1, cols);
    sweep(y * cols + cols - 1, -1, cols);
  }
  for (let x = 0; x < cols; x++) {
    sweep(x, cols, rows);
    sweep((rows - 1) * cols + x, -cols, rows);
  }
  for (let i = 0; i < n; i++) {
    const f = from[i]!;
    if (f < 0) continue;
    rgb[i * 3] = rgb[f * 3]!;
    rgb[i * 3 + 1] = rgb[f * 3 + 1]!;
    rgb[i * 3 + 2] = rgb[f * 3 + 2]!;
  }
}

/** A texture pixel this close (RGB distance) to the paper colour may be paper. */
export const TEXTURE_PAPER_DISTANCE = 40;

/**
 * The object mask at texture resolution: the grid mask is a few pixels coarse, so its edge cells
 * hold paper. Paper-coloured pixels reachable from outside the mask are taken out (pale glass
 * and walls enclosed by drawn lines stay). Returns a new mask.
 */
export function trimPaper(
  rgb: Uint8Array,
  mask: Uint8Array,
  cols: number,
  rows: number,
  paper: readonly [number, number, number]
): Uint8Array {
  const out = Uint8Array.from(mask);
  const papery = (i: number) =>
    Math.hypot(rgb[i * 3]! - paper[0], rgb[i * 3 + 1]! - paper[1], rgb[i * 3 + 2]! - paper[2]) <
    TEXTURE_PAPER_DISTANCE;
  const queue: number[] = [];
  const visit = (i: number) => {
    if (out[i] && papery(i)) {
      out[i] = 0;
      queue.push(i);
    }
  };
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (mask[i]) continue;
      if (x > 0) visit(i - 1);
      if (x < cols - 1) visit(i + 1);
      if (y > 0) visit(i - cols);
      if (y < rows - 1) visit(i + cols);
    }
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % cols;
    if (x > 0) visit(i - 1);
    if (x < cols - 1) visit(i + 1);
    if (i >= cols) visit(i - cols);
    if (i < cols * (rows - 1)) visit(i + cols);
  }
  return out;
}

/** `mask` shrunk by `by` pixels (a pixel stays when its whole neighbourhood is object). */
export function shrink(mask: Uint8Array, cols: number, rows: number, by = BLEED_INSET): Uint8Array {
  let cur = mask;
  for (let p = 0; p < by; p++) {
    const next = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        next[i] =
          cur[i] &&
          (x === 0 || cur[i - 1]) &&
          (x === cols - 1 || cur[i + 1]) &&
          (y === 0 || cur[i - cols]) &&
          (y === rows - 1 || cur[i + cols])
            ? 1
            : 0;
      }
    cur = next;
  }
  return cur;
}
