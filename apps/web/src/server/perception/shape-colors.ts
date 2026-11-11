import 'server-only';

import sharp from 'sharp';
import { pathToRings } from '@/lib/vision';
import { insideRings, MIN_MEASURED_PIXELS, objectPixels, type ObjectPixels } from './color-measure';
import type { RgbGrid } from './model-score';
import type { PhotoForRegions } from './region';
import type { GrayGrid } from './repetition';
import type { NormBox } from './schemas';

/**
 * Pixel budget of the sampled box (96²): enough for colour groups. A budget on the area, not the long
 * side, keeps thin objects wide enough (a 40 × 160 lamp post is no longer squeezed to a 4 px pole).
 */
export const COLOR_SAMPLE_PX = 96;
const COLOR_SAMPLE_AREA = COLOR_SAMPLE_PX * COLOR_SAMPLE_PX;

/** Box of the object in photo pixels, clamped inside the photo. */
export function pixelBox(photo: Pick<PhotoForRegions, 'width' | 'height'>, box: NormBox) {
  const left = Math.max(0, Math.min(photo.width - 1, Math.floor(box.x * photo.width)));
  const top = Math.max(0, Math.min(photo.height - 1, Math.floor(box.y * photo.height)));
  const width = Math.max(1, Math.min(photo.width - left, Math.round(box.w * photo.width)));
  const height = Math.max(1, Math.min(photo.height - top, Math.round(box.h * photo.height)));
  return { left, top, width, height };
}

/** Columns of the grey grid for the repetition measure (PF-T4). */
export const GRAY_COLUMNS = 128;
/** Columns for the perspective measure (PF-T5): line segments need more pixels. */
export const EDGE_COLUMNS = 256;

/**
 * Grey levels of the box: `columns` wide (128 for repetition, PF-T4; 256 for perspective, PF-T5), rows
 * keeping the box aspect (¼–2 × columns), and the SAM outline as a mask (all pixels without an outline).
 */
export async function sampleObjectGray(
  photo: PhotoForRegions,
  box: NormBox,
  outline?: string,
  columns = GRAY_COLUMNS
): Promise<GrayGrid> {
  const px = pixelBox(photo, box);
  const width = columns;
  const height = Math.max(
    columns / 4,
    Math.min(2 * columns, Math.round((width * px.height) / px.width))
  );
  return readGray(photo, box, px, width, height, outline);
}

/** Longest side of the grid the sharpness is read on: the photo's own pixels up to this, never enlarged. */
export const SHARPNESS_MAX_SIDE = 1024;

/**
 * Grey levels of the box at the photo's own resolution (PQ-T7 sharpness): a blur of a few pixels only shows
 * there, the fixed-width grids above shrink it away on a large object and invent it on a small one. No mask:
 * sharpness is read on the whole box.
 */
export async function sampleNativeGray(photo: PhotoForRegions, box: NormBox): Promise<GrayGrid> {
  const px = pixelBox(photo, box);
  const scale = Math.min(1, SHARPNESS_MAX_SIDE / Math.max(px.width, px.height));
  return readGray(
    photo,
    box,
    px,
    Math.max(1, Math.round(px.width * scale)),
    Math.max(1, Math.round(px.height * scale))
  );
}

async function readGray(
  photo: PhotoForRegions,
  box: NormBox,
  px: ReturnType<typeof pixelBox>,
  width: number,
  height: number,
  outline?: string
): Promise<GrayGrid> {
  const { data } = await sharp(photo.buffer, { failOn: 'none' })
    .extract(px)
    .resize({ width, height, fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rings = outline ? pathToRings(outline).filter((r) => r.length >= 3) : [];
  const channels = data.length / (width * height);
  const gray = new Float32Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    const py = box.y + ((j + 0.5) / height) * box.h;
    for (let i = 0; i < width; i++) {
      const k = j * width + i;
      gray[k] = data[k * channels]! / 255;
      mask[k] =
        !rings.length || insideRings(box.x + ((i + 0.5) / width) * box.w, py, rings) ? 1 : 0;
    }
  }
  return { width, height, gray, mask };
}

/**
 * The box resized to `cols` × `rows` (sRGB, 3 bytes per pixel, stretched like the render frame), for the
 * model score (PR-0.2).
 */
export async function sampleObjectRgb(
  photo: PhotoForRegions,
  box: NormBox,
  cols: number,
  rows: number
): Promise<RgbGrid> {
  const { data } = await sharp(photo.buffer, { failOn: 'none' })
    .extract(pixelBox(photo, box))
    .resize({ width: cols, height: rows, fit: 'fill' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { cols, rows, rgb: data };
}

/**
 * Pixels of the object for the colour measure (PF-T2): the box, downscaled, kept only inside the SAM
 * outline when there is one (no sky, no road). Without an outline every box pixel counts.
 */
export async function sampleObjectPixels(
  photo: PhotoForRegions,
  box: NormBox,
  outline?: string
): Promise<ObjectPixels> {
  const { left, top, width, height } = pixelBox(photo, box);
  const scale = Math.min(1, Math.sqrt(COLOR_SAMPLE_AREA / (width * height)));
  const { data, info } = await sharp(photo.buffer, { failOn: 'none' })
    .extract({ left, top, width, height })
    .resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rings = outline ? pathToRings(outline).filter((r) => r.length >= 3) : [];
  const W = info.width;
  const H = info.height;
  const inside = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const py = (top + ((j + 0.5) / H) * height) / photo.height;
    for (let i = 0; i < W; i++) {
      const px = (left + ((i + 0.5) / W) * width) / photo.width;
      inside[j * W + i] = !rings.length || insideRings(px, py, rings) ? 1 : 0;
    }
  }
  // Edge pixels of the outline blend the object with the sky behind it once downscaled (a lamp post
  // pole 4 px wide came out pale grey): keep the inner pixels, unless too few are left.
  const inner = (i: number, j: number) =>
    !rings.length ||
    (i > 0 &&
      j > 0 &&
      i < W - 1 &&
      j < H - 1 &&
      inside[j * W + i - 1]! +
        inside[j * W + i + 1]! +
        inside[(j - 1) * W + i]! +
        inside[(j + 1) * W + i]! ===
        4);
  const collect = (keep: (i: number, j: number) => boolean) => {
    const rgb: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!inside[j * W + i] || !keep(i, j)) continue;
        const k = (j * W + i) * info.channels;
        rgb.push(data[k]!, data[k + 1]!, data[k + 2]!);
        ys.push((j + 0.5) / H);
      }
    }
    return { rgb, ys };
  };
  let px = collect(inner);
  if (px.ys.length < MIN_MEASURED_PIXELS) px = collect(() => true);
  return objectPixels(px.rgb, px.ys);
}
