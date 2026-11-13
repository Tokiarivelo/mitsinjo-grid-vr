import 'server-only';

import sharp from 'sharp';
import type { ObjectRecipe } from '@/lib/object-shape';
import {
  elevationBox,
  elevationGrid,
  scoreElevation,
  type ScoredElevation,
} from './elevation-score';
import type { Elevation } from './facade-house';

/**
 * Pixel yardstick of a model against its 2D drawing (PQ-T59), for the code route. The elevation
 * score (`scoreElevation`) compares against a label map that assumes ONE eave line and ONE wall
 * rectangle: a house made of several volumes with stepped shed roofs can be built right and still
 * score low there, so a good `build()` lost to the template draft. Here the target is the drawing
 * itself: its inked area against the render's silhouette, its colours against the render's, plus
 * the measured openings (kept from the elevation score). Pure once the drawing is sampled.
 */

/** Weights of the drawing score (sum 1); with no opening on the drawing theirs goes to the others. */
export const DRAWING_WEIGHTS = { silhouette: 0.5, color: 0.2, openings: 0.3 } as const;
/** RGB distance from the paper colour above which a pixel is drawn (clean drawings, plain ground). */
export const INK_MIN_DISTANCE = 26;
/** RGB distance at which two colours count as fully different (colour term 0). */
export const COLOR_FULL_DISTANCE = 140;
/** Margin around the measured object box where ink still counts, share of the box side. */
const BOX_MARGIN = 0.03;
/** Sheet tiles are drawn at this zoom, like the stage sheet. */
const SHEET_ZOOM = 3;

export interface DrawingTarget {
  cols: number;
  rows: number;
  /** The drawing on the score grid, sRGB, row-major. */
  rgb: Uint8Array;
  /** 1 = the drawing shows the object there. */
  ink: Uint8Array;
}

/** Median of a sample of bytes. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 255;
}

/** The inked object from the drawing pixels already on the grid (paper = median border colour). */
export function inkMask(rgb: Uint8Array, cols: number, rows: number, e: Elevation): Uint8Array {
  const border: [number[], number[], number[]] = [[], [], []];
  const push = (c: number, r: number) => {
    const i = (r * cols + c) * 3;
    border[0].push(rgb[i]!);
    border[1].push(rgb[i + 1]!);
    border[2].push(rgb[i + 2]!);
  };
  for (let c = 0; c < cols; c++) push(c, 0);
  for (let r = 0; r < rows; r++) {
    push(0, r);
    push(cols - 1, r);
  }
  const paper = border.map(median) as [number, number, number];
  const box = elevationBox(e);
  const [mx, my] = [box.w * BOX_MARGIN, box.h * BOX_MARGIN];
  const c0 = Math.max(0, Math.floor((box.x - mx) * cols));
  const c1 = Math.min(cols, Math.ceil((box.x + box.w + mx) * cols));
  const r0 = Math.max(0, Math.floor((box.y - my) * rows));
  // Nothing below the ground line: the base line and cast shadows are not the object.
  const r1 = Math.min(rows, Math.ceil((box.y + box.h) * rows));
  const ink = new Uint8Array(cols * rows);
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const i = (r * cols + c) * 3;
      const d = Math.hypot(rgb[i]! - paper[0], rgb[i + 1]! - paper[1], rgb[i + 2]! - paper[2]);
      if (d >= INK_MIN_DISTANCE) ink[r * cols + c] = 1;
    }
  }
  // Glass and pale walls are near the paper colour: close each row between its first and last
  // inked pixel, so a window does not read as a hole in the object.
  for (let r = r0; r < r1; r++) {
    let first = -1;
    let last = -1;
    for (let c = c0; c < c1; c++) {
      if (ink[r * cols + c]) {
        if (first < 0) first = c;
        last = c;
      }
    }
    for (let c = first; first >= 0 && c <= last; c++) ink[r * cols + c] = 1;
  }
  return ink;
}

/** The drawing sampled on the elevation grid; null when the image cannot be read or is blank. */
export async function drawingTarget(
  drawing: Buffer,
  e: Elevation,
  rows?: number
): Promise<DrawingTarget | null> {
  try {
    const grid = elevationGrid(e.aspect, rows);
    const raw = await sharp(drawing)
      .flatten({ background: '#ffffff' })
      .resize(grid.cols, grid.rows, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    const ink = inkMask(rgb, grid.cols, grid.rows, e);
    return ink.some((v) => v === 1) ? { cols: grid.cols, rows: grid.rows, rgb, ink } : null;
  } catch (err) {
    console.warn('[vision] 3D drawing target failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface DrawingScore {
  /** 0–100, higher = closer to the drawing. */
  score: number;
  /** Inked area vs model silhouette. */
  iou: number;
  /** 0–1 colour agreement where both cover. */
  color: number;
  /** 0–1 measured openings matched (count and place). */
  openings: number;
  /** The elevation score it rides on (render, openings, sheet). */
  elevation: ScoredElevation;
}

/** The recipe's front against the drawing's own pixels. */
export function scoreDrawing(
  recipe: ObjectRecipe,
  e: Elevation,
  target: DrawingTarget,
  opts: { roofRings?: ReadonlyArray<ReadonlyArray<readonly [number, number]>> } = {}
): DrawingScore {
  const elevation = scoreElevation(recipe, e, {
    rows: target.rows,
    ...(opts.roofRings ? { roofRings: opts.roofRings } : {}),
  });
  const mask = elevation.render.mask.data;
  const built = elevation.render.rgb;
  let both = 0;
  let either = 0;
  let dist = 0;
  for (let i = 0; i < target.ink.length; i++) {
    const a = target.ink[i] === 1;
    const b = mask[i] === 1;
    if (a || b) either += 1;
    if (a && b) {
      both += 1;
      const k = i * 3;
      dist += Math.hypot(
        target.rgb[k]! - built[k]!,
        target.rgb[k + 1]! - built[k + 1]!,
        target.rgb[k + 2]! - built[k + 2]!
      );
    }
  }
  const iou = either ? both / either : 0;
  const color = both ? Math.max(0, 1 - dist / both / COLOR_FULL_DISTANCE) : 0;
  const hasOpenings = elevation.openings.target > 0;
  const openings = hasOpenings ? elevation.openings.score : 0;
  const w = DRAWING_WEIGHTS;
  const total = hasOpenings ? 1 : w.silhouette + w.color;
  const raw =
    (w.silhouette * iou + w.color * color + (hasOpenings ? w.openings * openings : 0)) / total;
  return { score: Math.round(raw * 1000) / 10, iou, color, openings, elevation };
}

/** `iou 0.62 · colour 0.71 · openings 3/9` for the writer question. */
export function drawingDetailText(s: DrawingScore): string {
  const o = s.elevation.openings;
  return `silhouette iou ${s.iou.toFixed(2)} · colour ${s.color.toFixed(2)} · openings ${o.matched}/${o.target} matched (${o.render} built)`;
}

/**
 * Drawing | model | difference (JPEG data URL): grey = both, red = drawn but not built,
 * blue = built but not drawn. Null on failure (the caller falls back to the drawing alone).
 */
export async function drawingSheet(
  drawing: Buffer,
  target: DrawingTarget,
  s: DrawingScore
): Promise<string | null> {
  try {
    const { cols, rows } = target;
    const [w, h] = [cols * SHEET_ZOOM, rows * SHEET_ZOOM];
    const mask = s.elevation.render.mask.data;
    const built = Buffer.from(s.elevation.render.rgb);
    const diff = Buffer.alloc(cols * rows * 3, 255);
    for (let i = 0; i < mask.length; i++) {
      const a = target.ink[i] === 1;
      const b = mask[i] === 1;
      if (!b) built.fill(255, i * 3, i * 3 + 3);
      if (a && b) diff.fill(190, i * 3, i * 3 + 3);
      else if (a) diff.set([214, 48, 49], i * 3);
      else if (b) diff.set([52, 110, 235], i * 3);
    }
    const raw = (b: Buffer) =>
      sharp(b, { raw: { width: cols, height: rows, channels: 3 } })
        .resize(w, h, { kernel: 'nearest' })
        .png()
        .toBuffer();
    const tiles = await Promise.all([
      sharp(drawing)
        .flatten({ background: '#ffffff' })
        .resize(w, h, { fit: 'fill' })
        .png()
        .toBuffer(),
      raw(built),
      raw(diff),
    ]);
    const jpg = await sharp({
      create: { width: w * 3, height: h, channels: 3, background: '#ffffff' },
    })
      .composite(tiles.map((input, i) => ({ input, left: i * w, top: 0 })))
      .jpeg({ quality: 88 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch (err) {
    console.warn('[vision] 3D drawing sheet failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Stations of the skyline given to the writer (left to right across the object box). */
export const SKYLINE_STATIONS = 24;

/**
 * The drawing's skyline in object units (x, y ∈ [−0.5, 0.5], y up): the top of the inked object at
 * evenly spaced stations. It is the massing a modeller reads first: where each volume starts, how
 * high it stands, which way each roof slopes. `none` marks a station with nothing drawn.
 */
export function skylineText(target: DrawingTarget, e: Elevation): string {
  const box = elevationBox(e);
  const { cols, rows, ink } = target;
  const cells: string[] = [];
  for (let s = 0; s < SKYLINE_STATIONS; s++) {
    const fx = (s + 0.5) / SKYLINE_STATIONS;
    const c = Math.min(cols - 1, Math.max(0, Math.round((box.x + fx * box.w) * cols)));
    let top = -1;
    for (let r = 0; r < rows; r++) {
      if (ink[r * cols + c]) {
        top = r;
        break;
      }
    }
    const x = (fx - 0.5).toFixed(2);
    if (top < 0) cells.push(`${x}:none`);
    else {
      const y = 0.5 - (top / rows - box.y) / box.h;
      cells.push(`${x}:${Math.max(-0.5, Math.min(0.5, y)).toFixed(2)}`);
    }
  }
  return `Skyline measured on the drawing (x:top y, object units, left to right): ${cells.join(' ')}. A jump between neighbours is a volume edge; a steady slope is a roof plane.`;
}
