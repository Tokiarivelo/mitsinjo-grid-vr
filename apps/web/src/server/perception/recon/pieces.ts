/**
 * Regions cut into single-run pieces (PQ-T69). The 3D hull primitive reads a shape as one span
 * per scan line, so a comb (a base carrying four pillars) must become the base and each pillar,
 * or its span would fill the gaps between the teeth. A piece has exactly one run per scan line.
 * Pure and deterministic.
 */

/** Runs of a class closer than this many cells on one scan line are one run (texture gaps). */
export const RUN_GAP = 1;
/** A piece under this many cells is left to the detail pass. */
export const PIECE_MIN_CELLS = 8;

/** One run per scan line from `start`: inclusive cell range `lo[i]..hi[i]` on line `start + i`. */
export interface Span {
  start: number;
  lo: number[];
  hi: number[];
}

export const spanEnd = (s: Span) => s.start + s.lo.length - 1;
export const spanArea = (s: Span) => s.lo.reduce((sum, lo, i) => sum + s.hi[i]! - lo + 1, 0);
/** Lowest and highest cell any line of the span reaches. */
export const spanReach = (s: Span): [number, number] => [Math.min(...s.lo), Math.max(...s.hi)];

/**
 * Single-run pieces of the cells where `inside` holds, scanning by rows (`rows`: lines = y, runs
 * along x) or by columns (`cols`: lines = x, runs along y). A run continues the piece above it
 * only when it is its sole successor and has no other predecessor: pieces split where a shape
 * forks or merges. Largest first; pieces under `minCells` are dropped.
 */
export function runPieces(
  cols: number,
  rows: number,
  inside: (x: number, y: number) => boolean,
  scan: 'rows' | 'cols',
  minCells = PIECE_MIN_CELLS
): Span[] {
  const [lines, length] = scan === 'rows' ? [rows, cols] : [cols, rows];
  const at = scan === 'rows' ? (a: number, b: number) => inside(b, a) : inside;
  interface Run {
    lo: number;
    hi: number;
    piece: number;
  }
  const pieces: Span[] = [];
  let previous: Run[] = [];
  for (let a = 0; a < lines; a++) {
    const runs: Run[] = [];
    for (let b = 0; b < length; b++) {
      if (!at(a, b)) continue;
      const last = runs.at(-1);
      if (last && b - last.hi - 1 <= RUN_GAP) last.hi = b;
      else runs.push({ lo: b, hi: b, piece: -1 });
    }
    const overlaps = (p: Run, r: Run) => p.lo <= r.hi && r.lo <= p.hi;
    for (const r of runs) {
      const above = previous.filter((p) => overlaps(p, r));
      const sole =
        above.length === 1 && runs.filter((q) => overlaps(above[0]!, q)).length === 1
          ? above[0]!
          : null;
      if (sole) {
        r.piece = sole.piece;
        pieces[r.piece]!.lo.push(r.lo);
        pieces[r.piece]!.hi.push(r.hi);
      } else {
        r.piece = pieces.length;
        pieces.push({ start: a, lo: [r.lo], hi: [r.hi] });
      }
    }
    previous = runs;
  }
  return pieces
    .filter((p) => spanArea(p) >= minCells)
    .sort((a, b) => spanArea(b) - spanArea(a) || a.start - b.start || a.lo[0]! - b.lo[0]!);
}

/** Outer run per scan line of a mask (first to last set cell), lines without a cell left out of the range. */
export function outerSpan(
  cols: number,
  rows: number,
  inside: (x: number, y: number) => boolean,
  scan: 'rows' | 'cols'
): Map<number, [number, number]> {
  const [lines, length] = scan === 'rows' ? [rows, cols] : [cols, rows];
  const at = scan === 'rows' ? (a: number, b: number) => inside(b, a) : inside;
  const out = new Map<number, [number, number]>();
  for (let a = 0; a < lines; a++) {
    let lo = -1;
    let hi = -1;
    for (let b = 0; b < length; b++) {
      if (!at(a, b)) continue;
      if (lo < 0) lo = b;
      hi = b;
    }
    if (lo >= 0) out.set(a, [lo, hi]);
  }
  return out;
}
