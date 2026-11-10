import 'server-only';

import sharp from 'sharp';
import { pathToRings } from '@/lib/vision';
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

/**
 * Send the tight crop as a second image to the kit call (PQ-T8). Off: its « done when » needs a paid
 * `make eval-shape` against the real set (agreement and part counts not worse); flip it after that run.
 */
export const KIT_TIGHT_CROP = false;

/** Grey outside the outline of the tight crop (neutral: no colour hint for Spark). */
const TIGHT_BACKGROUND = { r: 128, g: 128, b: 128 };
/** Margin kept around the box in the tight crop (share of the long side). */
export const TIGHT_CROP_MARGIN = 0.04;

/** Pixel rect of the tight crop: the box plus a small margin, clamped into the photo. */
export function tightRect(photoW: number, photoH: number, box: NormBox) {
  const mx = Math.max(1, box.w * photoW * TIGHT_CROP_MARGIN);
  const my = Math.max(1, box.h * photoH * TIGHT_CROP_MARGIN);
  const left = Math.max(0, Math.floor(box.x * photoW - mx));
  const top = Math.max(0, Math.floor(box.y * photoH - my));
  const right = Math.min(photoW, Math.ceil((box.x + box.w) * photoW + mx));
  const bottom = Math.min(photoH, Math.ceil((box.y + box.h) * photoH + my));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * Tight crop of the object alone (PQ-T8): the box with a small margin, everything outside the SAM outline
 * painted neutral grey, long side upscaled to `SHAPE_CROP_MIN_PX`…`SHAPE_CROP_MAX_PX`. Without an outline the
 * crop is the plain box (no grey). JPEG data URL.
 */
export async function tightCropForShape(
  photo: PhotoForRegions,
  box: NormBox,
  outline?: string
): Promise<string> {
  const rect = tightRect(photo.width, photo.height, box);
  const rings = outline ? pathToRings(outline).filter((r) => r.length >= 3) : [];
  let image = sharp(photo.buffer, { failOn: 'none' }).extract(rect);
  if (rings.length) {
    const d = rings
      .map(
        (ring) =>
          'M' +
          ring
            .map(
              ([x, y]) =>
                `${(x * photo.width - rect.left).toFixed(1)} ${(y * photo.height - rect.top).toFixed(1)}`
            )
            .join('L') +
          'Z'
      )
      .join('');
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">` +
        `<rect width="100%" height="100%" fill="black"/><path fill="white" d="${d}"/></svg>`
    );
    const base = await image.removeAlpha().png().toBuffer();
    const grey = await sharp({
      create: { width: rect.width, height: rect.height, channels: 3, background: TIGHT_BACKGROUND },
    })
      .png()
      .toBuffer();
    const cut = await sharp(base)
      .joinChannel(await sharp(mask).resize(rect.width, rect.height).greyscale().raw().toBuffer(), {
        raw: { width: rect.width, height: rect.height, channels: 1 },
      })
      .png()
      .toBuffer();
    image = sharp(grey).composite([{ input: cut }]);
  }
  const long = Math.max(rect.width, rect.height);
  const target = Math.min(SHAPE_CROP_MAX_PX, Math.max(SHAPE_CROP_MIN_PX, long));
  const jpeg = await sharp(await image.png().toBuffer())
    .resize({
      width: Math.round((rect.width / long) * target),
      height: Math.round((rect.height / long) * target),
      kernel: 'lanczos3',
    })
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}
