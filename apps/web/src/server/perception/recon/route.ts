import 'server-only';

import sharp from 'sharp';
import { archetypeOf } from '@/lib/object-kit';
import type { ObjectRecipe, ShapeTarget } from '@/lib/object-shape';
import type { ClassMaterialsResult } from '../schemas';
import { FACE_ORDER, buildFacePrompt } from '../facade-faces';
import { buildFacadePrompt } from '../facade-specialist';
import { inlineImageUrl } from '../inline-image';
import type { ViewImage } from './grid';
import { buildLabelQuestion } from './label-classes';
import {
  classSheet,
  finishRecipe,
  reconstructFromViews,
  reportLine,
  type ReconReport,
} from './reconstruct';
import type { ViewName } from './views';

/**
 * Views reconstruction, the part that talks to the outside (PQ-T69): get the four drawings
 * (validated ones first, Muse Image draws the missing ones from the others), decode them, run the
 * pure reconstruction, ask the cheap model for the materials, report. Never throws: null means
 * « no model from the views », and the caller falls back.
 */

/** Longest side a drawing is decoded at: enough for a 96-row grid, cheap to segment. */
export const DECODE_MAX_SIDE = 256;
/** Under this overall score the drawings contradict each other too much to trust the model. */
export const RECON_MIN_SCORE = 0.5;
/** Model name reported with the shape (the geometry is computed, not written by a model). */
export const RECON_MODEL = 'views-reconstruction';

const FACE_VIEW = { side: 'right', back: 'back', left: 'left' } as const;

export interface ReconDeps {
  /** One drawing from a prompt and reference images (Muse Image); null = nothing can be drawn. */
  draw: ((prompt: string, references: string[], signal?: AbortSignal) => Promise<Buffer>) | null;
  /** Materials of the colour classes (the cheap seeing model); absent = no materials. */
  nameClasses?: (
    imageUrl: string,
    question: string,
    classes: number,
    signal?: AbortSignal
  ) => Promise<ClassMaterialsResult>;
}

export interface ReconOptions {
  /** The photo crop around the object: reference of a front drawn here (no validated 2D view). */
  cropUrl?: string;
  signal?: AbortSignal;
  /** Also draw the back and the left side when they are not validated (default true; 2 more drawings). */
  fourFaces?: boolean;
  /** Each drawing as it is known (validated or just drawn), for captures and evals. */
  onView?: (view: ViewName, png: Buffer) => void;
}

export interface ReconOutcome {
  recipe: ObjectRecipe;
  report: ReconReport;
  /** Views Muse Image drew during this call. */
  drawn: ViewName[];
}

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

async function bytesOf(url: string): Promise<Buffer | null> {
  try {
    const inline = await inlineImageUrl(url);
    return Buffer.from(inline.slice(inline.indexOf(',') + 1), 'base64');
  } catch {
    return null;
  }
}

/** A drawing as raw sRGB on white, at most `DECODE_MAX_SIDE` a side; null when unreadable. */
export async function decodeView(bytes: Buffer): Promise<ViewImage | null> {
  try {
    const { data, info } = await sharp(bytes, { failOn: 'none' })
      .flatten({ background: '#ffffff' })
      .resize(DECODE_MAX_SIDE, DECODE_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      cols: info.width,
      rows: info.height,
      rgb: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    };
  } catch {
    return null;
  }
}

/** Raw sRGB → PNG data URL (the class sheet sent to the model). */
export async function encodeView(img: ViewImage): Promise<string> {
  const png = await sharp(Buffer.from(img.rgb), {
    raw: { width: img.cols, height: img.rows, channels: 3 },
  })
    .png()
    .toBuffer();
  return dataUrl(png);
}

export async function reconstructObject(
  deps: ReconDeps,
  target: ShapeTarget,
  { cropUrl, signal, onView, fourFaces = true }: ReconOptions = {}
): Promise<ReconOutcome | null> {
  const tag = `[vision] 3D views reconstruction for "${target.label}"`;
  try {
    const archetype = archetypeOf(target);
    const drawn: ViewName[] = [];
    const draw = async (view: ViewName, prompt: string, references: string[]) => {
      if (!deps.draw || signal?.aborted) return null;
      try {
        const png = await deps.draw(prompt, references, signal);
        drawn.push(view);
        return png;
      } catch (err) {
        console.warn(`${tag}: ${view} view not drawn:`, err instanceof Error ? err.message : err);
        return null;
      }
    };
    // Front: the validated 2D view, else drawn from the photo crop.
    const front = target.facadeUrl
      ? await bytesOf(target.facadeUrl)
      : cropUrl
        ? await draw(
            'front',
            buildFacadePrompt(archetype, target.label, undefined, { fromPhoto: true }),
            [cropUrl]
          )
        : null;
    if (!front) {
      console.info(`${tag}: no front view, skipped`);
      return null;
    }
    onView?.('front', front);
    const pngs: Partial<Record<ViewName, Buffer>> = { front };
    /** A face: the operator's validated drawing, else drawn from every view known so far. */
    const face = async (name: (typeof FACE_ORDER)[number]) => {
      const view = FACE_VIEW[name];
      const provided = target.faceUrls?.[name];
      const known = Object.values(pngs).map(dataUrl);
      const png = provided
        ? await bytesOf(provided)
        : name !== 'side' && !fourFaces
          ? null
          : await draw(
              view,
              buildFacePrompt(name, target.label, archetype, { known: known.length }),
              known
            );
      if (png) {
        pngs[view] = png;
        onView?.(view, png);
      }
    };
    // The right side first (it fixes the depth), then the back and the left side from both.
    await face('side');
    await Promise.all([face('back'), face('left')]);
    const images: Partial<Record<ViewName, ViewImage>> = {};
    for (const [view, png] of Object.entries(pngs) as Array<[ViewName, Buffer]>) {
      const img = await decodeView(png);
      if (img) images[view] = img;
    }
    const recon = reconstructFromViews(images);
    if (!recon) {
      console.info(
        `${tag}: unreadable (views ${Object.keys(images).join(', ') || 'none'}; the front and one side are needed)`
      );
      return null;
    }
    // The one model question: what each colour class is made of. Best effort.
    let materials: NonNullable<ClassMaterialsResult['materials']> = [];
    if (deps.nameClasses && !signal?.aborted) {
      try {
        const classes = recon.palette.classes.length;
        const named = await deps.nameClasses(
          await encodeView(classSheet(recon)),
          buildLabelQuestion(target.label, classes),
          classes,
          signal
        );
        if (named.source === 'meta' && named.materials) materials = named.materials;
      } catch (err) {
        console.warn(`${tag}: materials not named:`, err instanceof Error ? err.message : err);
      }
    }
    const { recipe, report } = finishRecipe(recon, materials);
    console.info(
      `${tag}: ${recipe.parts.length} parts${drawn.length ? `, drawn here: ${drawn.join(', ')}` : ''}; ${reportLine(report)}`
    );
    if (report.score.overall < RECON_MIN_SCORE) {
      console.info(`${tag}: score under ${RECON_MIN_SCORE}, the drawings disagree: dropped`);
      return null;
    }
    return { recipe, report, drawn };
  } catch (err) {
    console.warn(`${tag} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
