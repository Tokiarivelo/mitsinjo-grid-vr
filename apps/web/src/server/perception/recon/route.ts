import 'server-only';

import sharp from 'sharp';
import {
  FACE_ATLAS_COLS,
  FACE_ATLAS_ROWS,
  FACE_TILE,
  ATLAS_VIEWS,
  faceSlot,
  type AtlasView,
} from '@/lib/face-atlas';
import { planContrast, silhouetteHull, type RoofVolume } from '@/lib/face-hull';
import { archetypeOf } from '@/lib/object-kit';
import type { ObjectRecipe, ShapeTarget } from '@/lib/object-shape';
import type { ClassMaterialsResult } from '../schemas';
import { FACE_ORDER, buildFacePrompt, buildTopPrompt } from '../facade-faces';
import { buildFacadePrompt } from '../facade-specialist';
import { inlineImageUrl } from '../inline-image';
import { grow, type ViewImage } from './grid';
import { buildLabelQuestion } from './label-classes';
import {
  classSheet,
  finishRecipe,
  readViews,
  reportLine,
  solveViews,
  type ReconReport,
  roofClassOf,
} from './reconstruct';
import { bleedPaper, maskAt, shrink, trimPaper } from './texture';
import {
  alignTop,
  depthFromPlan,
  type AlignedViews,
  type GridView,
  type ViewFrame,
  type ViewName,
} from './views';

/**
 * Views reconstruction, the part that talks to the outside (PQ-T69): get the four drawings
 * (validated ones first, Muse Image draws the missing ones from the others), decode them, run the
 * pure reconstruction, ask the cheap model for the materials, report. Never throws: null means
 * « no model from the views », and the caller falls back.
 */

/** Longest side a drawing is decoded at: enough for a 128-row grid, cheap to segment. */
export const DECODE_MAX_SIDE = 384;
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
  onView?: (view: ViewName | 'top', png: Buffer) => void;
  /** A view from above already drawn (the tool's `TOP=`); else drawn with the faces when `fourFaces`. */
  topPng?: Buffer;
}

export interface ReconOutcome {
  recipe: ObjectRecipe;
  report: ReconReport;
  /** Views Muse Image drew during this call. */
  drawn: Array<ViewName | 'top'>;
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

/** Cells the footprint read on the view from above is grown by before it cuts the hull. */
const FOOTPRINT_GROW = 3;

/** JPEG quality of the face atlas. */
const ATLAS_QUALITY = 82;

/**
 * The face atlas of a reading (PQ-T70): each drawing cut to the object's box at full resolution,
 * turned canonical, its paper bled over, one tile per view. Null when no drawing can be cut.
 */
export async function buildFaceAtlas(
  pngs: Partial<Record<ViewName, Buffer>>,
  aligned: AlignedViews,
  top?: { png: Buffer; view: GridView; frame: ViewFrame }
): Promise<{ atlas: string; views: AtlasView[] } | null> {
  const [aw, ah] = [FACE_ATLAS_COLS * FACE_TILE, FACE_ATLAS_ROWS * FACE_TILE];
  const sheet = new Uint8Array(aw * ah * 3).fill(255);
  const views: AtlasView[] = [];
  for (const view of ATLAS_VIEWS) {
    const frame = view === 'top' ? top?.frame : aligned.frames[view];
    const grid = view === 'top' ? top?.view : aligned.views[view];
    // The right tile may be the left drawing standing in: its own drawing is then the left one.
    const png =
      view === 'top'
        ? top?.png
        : (pngs[view] ?? (view === 'right' && aligned.rightFromLeft ? pngs.left : undefined));
    if (!frame || !grid || !png) continue;
    try {
      const flat = sharp(png, { failOn: 'none' }).flatten({ background: '#ffffff' });
      const meta = await flat.metadata();
      if (!meta.width || !meta.height) continue;
      const [kx, ky] = [meta.width / frame.cols, meta.height / frame.rows];
      const left = Math.max(0, Math.floor(frame.box.x0 * kx));
      const top = Math.max(0, Math.floor(frame.box.y0 * ky));
      const width = Math.min(meta.width - left, Math.ceil((frame.box.x1 - frame.box.x0 + 1) * kx));
      const height = Math.min(meta.height - top, Math.ceil((frame.box.y1 - frame.box.y0 + 1) * ky));
      if (width < 2 || height < 2) continue;
      let cut = flat.extract({ left, top, width, height });
      if (frame.mirrored) cut = cut.flop();
      const tile = await cut
        .resize(FACE_TILE, FACE_TILE, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer();
      const rgb = new Uint8Array(tile.buffer, tile.byteOffset, tile.byteLength);
      const mask = shrink(
        trimPaper(rgb, maskAt(grid, FACE_TILE, FACE_TILE), FACE_TILE, FACE_TILE, frame.paper),
        FACE_TILE,
        FACE_TILE
      );
      bleedPaper(rgb, mask, FACE_TILE, FACE_TILE);
      const slot = faceSlot(view);
      const [ox, oy] = [
        (slot % FACE_ATLAS_COLS) * FACE_TILE,
        Math.floor(slot / FACE_ATLAS_COLS) * FACE_TILE,
      ];
      for (let y = 0; y < FACE_TILE; y++)
        sheet.set(
          rgb.subarray(y * FACE_TILE * 3, (y + 1) * FACE_TILE * 3),
          ((oy + y) * aw + ox) * 3
        );
      views.push(view);
    } catch (err) {
      console.warn(
        `[vision] face atlas: ${view} not cut:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  if (!views.length) return null;
  const jpeg = await sharp(Buffer.from(sheet), { raw: { width: aw, height: ah, channels: 3 } })
    .jpeg({ quality: ATLAS_QUALITY })
    .toBuffer();
  return { atlas: `data:image/jpeg;base64,${jpeg.toString('base64')}`, views };
}

export async function reconstructObject(
  deps: ReconDeps,
  target: ShapeTarget,
  { cropUrl, signal, onView, fourFaces = true, topPng }: ReconOptions = {}
): Promise<ReconOutcome | null> {
  const tag = `[vision] 3D views reconstruction for "${target.label}"`;
  try {
    const archetype = archetypeOf(target);
    const drawn: Array<ViewName | 'top'> = [];
    const draw = async (view: ViewName | 'top', prompt: string, references: string[]) => {
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
    // With them the view from above: the footprint and the drawing of what faces the sky.
    // The operator's validated plan first, then one given by the caller, else drawn here.
    let top: Buffer | null =
      topPng ?? (target.faceUrls?.top ? await bytesOf(target.faceUrls.top) : null);
    const above = async () => {
      if (top || !fourFaces) return;
      const known = Object.values(pngs).map(dataUrl);
      top = await draw('top', buildTopPrompt(target.label, known.length), known);
    };
    await Promise.all([face('back'), face('left'), above()]);
    if (top) onView?.('top', top);
    const images: Partial<Record<ViewName, ViewImage>> = {};
    for (const [view, png] of Object.entries(pngs) as Array<[ViewName, Buffer]>) {
      const img = await decodeView(png);
      if (img) images[view] = img;
    }
    const reading = readViews(images);
    if (!reading) {
      console.info(
        `${tag}: unreadable (views ${Object.keys(images).join(', ') || 'none'}; the front and one side are needed)`
      );
      return null;
    }
    // The one model question, asked before the solver: what each colour class is made of. Best effort.
    let materials: NonNullable<ClassMaterialsResult['materials']> = [];
    let roofClass: number | null = null;
    if (deps.nameClasses && !signal?.aborted) {
      try {
        const classes = reading.palette.classes.length;
        const named = await deps.nameClasses(
          await encodeView(classSheet(reading)),
          buildLabelQuestion(target.label, classes),
          classes,
          signal
        );
        if (named.source === 'meta' && named.materials) {
          materials = named.materials;
          roofClass = named.roof ?? null;
        }
      } catch (err) {
        console.warn(`${tag}: materials not named:`, err instanceof Error ? err.message : err);
      }
    }
    // The solver runs after the naming: which classes are roofing decides where the roof slopes.
    // The geometry first (the class above the eave), the model's answer only when it cannot tell.
    const measuredRoof = roofClassOf(reading);
    if (measuredRoof !== null) roofClass = measuredRoof;
    const recon = solveViews(reading, materials, roofClass);
    if (!recon) {
      console.info(`${tag}: nothing solid in the views`);
      return null;
    }
    const { recipe, report } = finishRecipe(recon);
    // The drawings themselves go on the model (never the photo): best effort, flat colours without.
    const { W, D } = recon.aligned;
    const topImage = top ? await decodeView(top) : null;
    const topRead = topImage ? alignTop(topImage, W, D) : null;
    if (top && !topRead)
      console.info(`${tag}: the view from above disagrees with the elevations, not used`);
    const faces = await buildFaceAtlas(
      pngs,
      recon.aligned,
      top && topRead ? { png: top, ...topRead } : undefined
    ).catch(() => null);
    if (faces) {
      const { front: frontView, right: sideView } = recon.aligned.views;
      // The inferred pitched roof (hip + gables of the recipe) on the grid.
      const [gw, gh, gd] = [frontView.cols, frontView.rows, sideView.cols];
      const roofs = recipe.parts.flatMap((p): RoofVolume[] =>
        p.shape === 'hip' || p.shape === 'prism'
          ? [
              {
                shape: p.shape,
                box: [
                  Math.round((p.at[0] - p.size[0] / 2 + 0.5) * gw),
                  Math.round((p.at[0] + p.size[0] / 2 + 0.5) * gw),
                  Math.round((0.5 - p.at[1] - p.size[1] / 2) * gh),
                  Math.round((0.5 - p.at[1] + p.size[1] / 2) * gh),
                  Math.round((p.at[2] - p.size[2] / 2 + 0.5) * gd),
                  Math.round((p.at[2] + p.size[2] / 2 + 0.5) * gd),
                ],
                ...(p.ridge !== undefined ? { ridge: p.ridge } : {}),
                ...(p.apex !== undefined ? { apex: p.apex } : {}),
              },
            ]
          : []
      );
      // The footprint, a little wider than drawn: the plan and the elevations never align to the cell.
      const footprint =
        topRead && faces.views.includes('top')
          ? { ...topRead.view, mask: grow(topRead.view.mask, W, D, FOOTPRINT_GROW) }
          : undefined;
      // The plan also tells a chimney from the ghost two silhouettes put at every run crossing.
      const plan = footprint && topRead ? topRead.view : null;
      const hull = silhouetteHull(
        frontView,
        sideView,
        roofs,
        footprint,
        plan ? (rect) => planContrast(plan, rect) : undefined
      );
      // The plan shows width and depth on one drawing: it sets the depth of the model.
      if (footprint && topRead)
        recipe.proportions = depthFromPlan(recipe.proportions, topRead.aspect);
      if (hull.boxes.length)
        recipe.faces = {
          ...faces,
          hull: { grid: [...hull.grid], boxes: hull.boxes.map((b) => [...b]) },
        };
    }
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
