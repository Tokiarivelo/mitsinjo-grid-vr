import {
  ATLAS_VIEWS,
  FACE_ATLAS_COLS,
  FACE_ATLAS_ROWS,
  FACE_TILE,
  atlasUv,
  faceSlot,
} from '@/lib/face-atlas';
import { skinSample, type SkinBox, type SkinView } from '@/lib/face-skin';
import type { FlatPaint } from '../flat-render';
import { recipeBox } from '../recipe-box';
import type { Mask } from '../silhouette-fit';

/**
 * Faces of a 360° tour object (VS-T43, mock only, user exception 2026-11-17): the front face is
 * the object cut out of its panorama photo (outline kept, everything around it filled with the
 * nearest object colours so no background reaches the model), the sides fold the front's edge
 * bands back to the far corner (seamless at both corners), the back is the front as seen through
 * (canonical tile). The tiles go in one atlas (`lib/face-atlas.ts`) that the parts wear
 * (`lib/face-skin.ts`), in 3D and in the flat renders of the 2D faces. Pure, no image library.
 */

/** Side of one face tile, pixels (the atlas tile). */
export const SKIN_TILE = FACE_TILE;
/** Pixels the outline is pulled in before filling: a hand outline catches a little background. */
export const SKIN_ERODE = 2;
/** Widest share of the front a side folds in from its edge. */
export const SIDE_BAND_MAX = 0.5;

/** A panorama outline ring: [u, v] image fractions (u may run past 1 across the seam). */
export type PanoRing = ReadonlyArray<readonly [number, number]>;

const nearU = (u: number, ref: number) => u + Math.round(ref - u);

/**
 * An outline on the panorama turned so its centre is straight ahead (u = 0.5): its box and rings
 * in that photo's fractions, its centre column and the elevation of its centre (rad, + = above).
 */
export function outlineFrame(outline: ReadonlyArray<PanoRing>) {
  const ref = outline[0]![0]![0];
  const us = outline.flatMap((r) => r.map(([u]) => nearU(u, ref)));
  const vs = outline.flatMap((r) => r.map(([, v]) => v));
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const uc = (u0 + u1) / 2;
  const toX = (u: number) => nearU(u, ref) - uc + 0.5;
  return {
    uc,
    box: { x: toX(u0), y: v0, w: u1 - u0, h: v1 - v0 },
    rings: outline.map((r) => r.map(([u, v]) => [toX(u), v] as const)),
    elevation: (0.5 - (v0 + v1) / 2) * Math.PI,
  };
}

export { recipeBox };

/** The mask pulled in by `r` pixels (a pixel stays when its whole square neighbourhood is in). */
export function erodeMask(mask: Mask, r: number): Mask {
  const { cols, rows, data } = mask;
  // Separable min: rows, then columns.
  const tmp = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      let on = 1;
      for (let k = -r; k <= r && on; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= cols || !data[y * cols + xx]) on = 0;
      }
      tmp[y * cols + x] = on;
    }
  const out = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      let on = 1;
      for (let k = -r; k <= r && on; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= rows || !tmp[yy * cols + x]) on = 0;
      }
      out[y * cols + x] = on;
    }
  // An outline thinner than the erosion keeps its own pixels.
  return { cols, rows, data: out.some((v) => v) ? out : Uint8Array.from(data) };
}

/**
 * Pixels outside `mask` take the colours of the nearest object pixels (push-pull: weighted means
 * down a pyramid, holes filled back up from the coarser level). In place on `rgb` (3 bytes / px).
 */
export function fillOutside(rgb: Uint8Array, mask: Mask): void {
  const { cols: w0, rows: h0 } = mask;
  type Level = { w: number; h: number; c: Float32Array; a: Float32Array };
  const base: Level = {
    w: w0,
    h: h0,
    c: new Float32Array(w0 * h0 * 3),
    a: new Float32Array(w0 * h0),
  };
  for (let i = 0; i < w0 * h0; i++)
    if (mask.data[i]) {
      base.a[i] = 1;
      for (let k = 0; k < 3; k++) base.c[i * 3 + k] = rgb[i * 3 + k]!;
    }
  const levels: Level[] = [base];
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const f = levels.at(-1)!;
    const w = Math.max(1, Math.ceil(f.w / 2));
    const h = Math.max(1, Math.ceil(f.h / 2));
    const next: Level = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const a = f.a[i]!;
        if (!a) continue;
        const j = (y >> 1) * w + (x >> 1);
        next.a[j]! += a;
        for (let k = 0; k < 3; k++) next.c[j * 3 + k]! += f.c[i * 3 + k]! * a;
      }
    for (let j = 0; j < w * h; j++) {
      const a = next.a[j]!;
      if (a > 0) for (let k = 0; k < 3; k++) next.c[j * 3 + k]! /= a;
    }
    levels.push(next);
  }
  // Pull: each empty pixel reads the coarser level (bilinear), coarse to fine.
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l]!;
    const c = levels[l + 1]!;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        if (f.a[i]! > 0) continue;
        const sx = Math.min(c.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const sy = Math.min(c.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const [x0, y0] = [Math.floor(sx), Math.floor(sy)];
        const [x1, y1] = [Math.min(c.w - 1, x0 + 1), Math.min(c.h - 1, y0 + 1)];
        const [fx, fy] = [sx - x0, sy - y0];
        for (let k = 0; k < 3; k++) {
          const at = (xx: number, yy: number) => c.c[(yy * c.w + xx) * 3 + k]!;
          f.c[i * 3 + k] =
            (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) +
            (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
        }
        f.a[i] = 1;
      }
  }
  for (let i = 0; i < w0 * h0 * 3; i++) rgb[i] = Math.round(base.c[i]!);
}

/** Left and right ends of the mask on each row; rows without any take the nearest row's. */
export function rowExtents(mask: Mask): Array<[number, number]> {
  const { cols, rows, data } = mask;
  const out: Array<[number, number] | null> = [];
  for (let y = 0; y < rows; y++) {
    let [l, r] = [-1, -1];
    for (let x = 0; x < cols; x++)
      if (data[y * cols + x]) {
        if (l < 0) l = x;
        r = x;
      }
    out.push(l < 0 ? null : [l, r]);
  }
  const known = out.flatMap((e, y) => (e ? [y] : []));
  if (!known.length) return out.map(() => [0, cols - 1]);
  return out.map((e, y) => {
    if (e) return e;
    const near = known.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
    return out[near]!;
  });
}

/**
 * How the faces go round a model: `fold` (made things: a car, a sofa, a house) — each side reads
 * the front's edge band folded back to the far corner, the back is the front seen through;
 * `wrap` (grown things: a bouquet, a shrub) — the back is the front again as seen from behind and
 * each side is the whole front squeezed, so the faces run on round the model without a seam.
 */
export type SkinWrap = 'fold' | 'wrap';

/**
 * A side tile from the filled front (`size`²): canonical columns run back → front and meet the
 * back and front tiles at both ends (see `SkinWrap`).
 */
export function sideTile(
  front: Uint8Array,
  extents: ReadonlyArray<readonly [number, number]>,
  size: number,
  side: 'right' | 'left',
  depthShare: number,
  wrap: SkinWrap = 'fold'
): Uint8Array {
  const out = new Uint8Array(size * size * 3);
  const share = Math.min(SIDE_BAND_MAX, Math.max(0.08, depthShare * 0.5));
  for (let y = 0; y < size; y++) {
    const [l, r] = extents[Math.min(extents.length - 1, Math.floor((y / size) * extents.length))]!;
    const width = Math.max(1, r - l);
    const band = width * share;
    for (let x = 0; x < size; x++) {
      const s = (x + 0.5) / size;
      const fold = 1 - Math.abs(2 * s - 1);
      const fx =
        wrap === 'wrap'
          ? side === 'right'
            ? l + s * (r - l)
            : r - s * (r - l)
          : side === 'right'
            ? r - band * fold
            : l + band * fold;
      const sx = Math.min(size - 1, Math.max(0, Math.round(fx)));
      const src = (y * size + sx) * 3;
      const dst = (y * size + x) * 3;
      out[dst] = front[src]!;
      out[dst + 1] = front[src + 1]!;
      out[dst + 2] = front[src + 2]!;
    }
  }
  return out;
}

/** The tile mirrored left ↔ right. */
export function mirrorTile(tile: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(tile.length);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const src = (y * size + (size - 1 - x)) * 3;
      out.set(tile.subarray(src, src + 3), (y * size + x) * 3);
    }
  return out;
}

/** Mean colour of a tile (fills the unused top and underside tiles). */
function meanFill(tile: Uint8Array, size: number): Uint8Array {
  const sum = [0, 0, 0];
  for (let i = 0; i < size * size; i++) for (let k = 0; k < 3; k++) sum[k]! += tile[i * 3 + k]!;
  const out = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++)
    for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.round(sum[k]! / (size * size));
  return out;
}

/** The face atlas, raw RGB (`FACE_ATLAS_COLS` × `FACE_ATLAS_ROWS` tiles of `size`). */
export interface SkinAtlas {
  rgb: Uint8Array;
  width: number;
  height: number;
}

/**
 * The atlas of a tour object from its filled front tile and outline mask (both `size`²):
 * front, right, back, left, then the top and underside (mean colour, never read by the skin).
 */
export function skinAtlas(
  front: Uint8Array,
  mask: Mask,
  box: SkinBox,
  wrap: SkinWrap = 'fold'
): SkinAtlas {
  const size = mask.cols;
  const extents = rowExtents(mask);
  const depthShare = (box[5] - box[2]) / Math.max(1e-6, box[3] - box[0]);
  const tiles: Record<(typeof ATLAS_VIEWS)[number], Uint8Array> = {
    front,
    right: sideTile(front, extents, size, 'right', depthShare, wrap),
    // Canonical back tile = the back drawing mirrored: `wrap` shows the front from behind.
    back: wrap === 'wrap' ? mirrorTile(front, size) : front,
    left: sideTile(front, extents, size, 'left', depthShare, wrap),
    top: meanFill(front, size),
    bottom: meanFill(front, size),
  };
  const width = size * FACE_ATLAS_COLS;
  const height = size * FACE_ATLAS_ROWS;
  const rgb = new Uint8Array(width * height * 3);
  for (const view of ATLAS_VIEWS) {
    const slot = faceSlot(view);
    const [ox, oy] = [(slot % FACE_ATLAS_COLS) * size, Math.floor(slot / FACE_ATLAS_COLS) * size];
    const tile = tiles[view];
    for (let y = 0; y < size; y++)
      rgb.set(tile.subarray(y * size * 3, (y + 1) * size * 3), ((oy + y) * width + ox) * 3);
  }
  return { rgb, width, height };
}

/** The atlas as a paint of the flat renders: each point the colour of the tile it looks at. */
export function skinPaint(atlas: SkinAtlas, box: SkinBox, view: SkinView): FlatPaint {
  const { rgb, width, height } = atlas;
  return (p, n) => {
    const hit = skinSample(p, n, box, view);
    const [u, v] = atlasUv(faceSlot(hit.tile), hit.s, hit.t);
    const x = Math.min(width - 1, Math.max(0, u * width - 0.5));
    const y = Math.min(height - 1, Math.max(0, (1 - v) * height - 0.5));
    const [x0, y0] = [Math.floor(x), Math.floor(y)];
    const [x1, y1] = [Math.min(width - 1, x0 + 1), Math.min(height - 1, y0 + 1)];
    const [fx, fy] = [x - x0, y - y0];
    const at = (xx: number, yy: number, k: number) => rgb[(yy * width + xx) * 3 + k]!;
    const c = (k: number) =>
      (at(x0, y0, k) * (1 - fx) + at(x1, y0, k) * fx) * (1 - fy) +
      (at(x0, y1, k) * (1 - fx) + at(x1, y1, k) * fx) * fy;
    return [c(0), c(1), c(2)];
  };
}
