import 'server-only';

import sharp from 'sharp';
import type { PhotoForRegions } from './region';
import type { NormBox } from './schemas';

/** Context around the object: the crop is a square this many times the object's long side. */
export const SHAPE_CROP_CONTEXT = 1.6;
/** A small object (a lamp post is ~20 px wide) is upscaled so Spark sees its parts. */
export const SHAPE_CROP_MIN_PX = 640;
/** Never send more than this (tokens). */
export const SHAPE_CROP_MAX_PX = 768;

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
  outWidth: number;
  outHeight: number;
}

/**
 * Pure geometry of `cropForShape` (same numbers, no pixels): the square around the box with
 * context, clamped into the photo, and the size it is sent at. Shared so captures (PR-0.4)
 * remap the target into crop space exactly like the crop sent to Spark.
 */
export function cropRectForShape(photoW: number, photoH: number, box: NormBox): CropRect {
  const bw = Math.max(1, box.w * photoW);
  const bh = Math.max(1, box.h * photoH);
  const side = Math.min(Math.max(photoW, photoH), Math.ceil(Math.max(bw, bh) * SHAPE_CROP_CONTEXT));
  const width = Math.min(photoW, side);
  const height = Math.min(photoH, side);
  const cx = box.x * photoW + bw / 2;
  const cy = box.y * photoH + bh / 2;
  const left = Math.round(Math.min(photoW - width, Math.max(0, cx - width / 2)));
  const top = Math.round(Math.min(photoH - height, Math.max(0, cy - height / 2)));
  const long = Math.max(width, height);
  const target = Math.min(SHAPE_CROP_MAX_PX, Math.max(SHAPE_CROP_MIN_PX, long));
  return {
    left,
    top,
    width,
    height,
    outWidth: Math.round((width / long) * target),
    outHeight: Math.round((height / long) * target),
  };
}

/**
 * Crop for the 3D recipe (PV-T9): a square around the object box with context, upscaled when small,
 * outside the box lightly dimmed in white so Spark knows which object to model. JPEG data URL.
 */
export async function cropForShape(photo: PhotoForRegions, box: NormBox): Promise<string> {
  const W = photo.width;
  const H = photo.height;
  const { left, top, width, height, outWidth, outHeight } = cropRectForShape(W, H, box);
  const bw = Math.max(1, box.w * W);
  const bh = Math.max(1, box.h * H);

  const bx = box.x * W - left;
  const by = box.y * H - top;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<path fill="white" fill-opacity="0.4" fill-rule="evenodd" d="M0 0H${width}V${height}H0Z ` +
      `M${bx.toFixed(1)} ${by.toFixed(1)}h${bw.toFixed(1)}v${bh.toFixed(1)}h${(-bw).toFixed(1)}Z"/></svg>`
  );
  const jpeg = await sharp(
    await sharp(photo.buffer, { failOn: 'none' })
      .extract({ left, top, width, height })
      .composite([{ input: mask, top: 0, left: 0 }])
      .png()
      .toBuffer()
  )
    .resize({ width: outWidth, height: outHeight, kernel: 'lanczos3' })
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}
