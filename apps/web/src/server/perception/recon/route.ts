import 'server-only';

import sharp from 'sharp';
import {
  FACE_ATLAS_COLS,
  FACE_ATLAS_ROWS,
  FACE_TILE,
  ATLAS_VIEWS,
  faceSlot,
  type AtlasTile,
  type AtlasView,
} from '@/lib/face-atlas';
import { planContrast, silhouetteHull, type RoofVolume } from '@/lib/face-hull';
import { archetypeOf } from '@/lib/object-kit';
import { teamIdOf } from '../team/registry';
import { furnitureModel, isFurnitureTeam, type ReadFurniture } from '../team/teams';
import { silhouetteRings, type ObjectRecipe, type ShapeTarget } from '@/lib/object-shape';
import type { ClassMaterialsResult } from '../schemas';
import { FACE_ORDER, buildFacePrompt, buildTopPrompt } from '../facade-faces';
import { buildFacadePrompt } from '../facade-specialist';
import { buildCarFacePrompt, type CarFace } from '../car/car-views';
import {
  cropToObject,
  readHousePlan,
  type AskHouseTool,
  type ReadHouse,
} from '../house/house-specialist';
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
import { measureCarPlan } from '../car/car-measure';
import { carImages, type ReadCar } from '../car/car-specialist';
import type { CarReading } from '../car/car-tools';
import { profileProportions, vehicleAspects } from '../car/car-proportions';
import { readCarTop } from '../car/car-top';
import { readUnderside } from '../car/car-underside';
import { reconstructTree } from '../tree/tree-recon';
import { FRAME_MARGIN } from '../tree/tree-parts';
import type { ReadPlant } from '../tree/plant-specialist';
import { plantHints, type PlantReading } from '../tree/plant-tools';
import { bleedPaper, maskAt, plantHoles, shrink, trimPaper } from './texture';
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

/** A drawing of the reconstruction: an elevation, the view from above, or a vehicle's underside. */
export type DrawnView = ViewName | 'top' | 'bottom';

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
  /** The house specialist (PQ-T72); absent = houses keep their drawn hull. */
  readHouse?: ReadHouse;
  /** The piloted part specialists (PQ-T73); absent = the single reading. */
  askHouseTool?: AskHouseTool;
  /** The car team (PQ-T76), live or a saved reading; absent = a car keeps its measured plan. */
  readCar?: ReadCar;
  /** The plant team (PQ-T82), live or a saved reading; absent = label and outline decide. */
  readPlant?: ReadPlant;
  /** The furniture teams (PQ-T89); absent = a seat, a table, a cupboard or a bed keeps its hull. */
  readFurniture?: ReadFurniture;
}

export interface ReconOptions {
  /** The photo crop around the object: reference of a front drawn here (no validated 2D view). */
  cropUrl?: string;
  signal?: AbortSignal;
  /** Also draw the back and the left side when they are not validated (default true; 2 more drawings). */
  fourFaces?: boolean;
  /** Each drawing as it is known (validated or just drawn), for captures and evals. */
  onView?: (view: DrawnView, png: Buffer) => void;
  /** A view from above already drawn (the tool's `TOP=`); else drawn with the faces when `fourFaces`. */
  topPng?: Buffer;
  /** The house specialist's raw reading, for captures and evals. */
  onHouseReading?: (reading: unknown) => void;
  /** The car team's reading, for captures, evals and replays (PQ-T76). */
  onCarReading?: (reading: unknown) => void;
  /** The plant team's reading, for captures, evals and replays (PQ-T82). */
  onPlantReading?: (reading: unknown) => void;
}

export interface ReconOutcome {
  recipe: ObjectRecipe;
  report: ReconReport;
  /** Views Muse Image drew during this call. */
  drawn: DrawnView[];
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

/**
 * One drawing cut to the object's box, `w` × `h` raw sRGB, mirrored when its frame says so, its
 * paper bled to the nearest drawn colour (filtering at the outline never reads the sheet). Null
 * when it cannot be cut. Throws only on an unreadable image.
 */
export async function cutDrawing(
  png: Buffer,
  frame: ViewFrame,
  grid: GridView,
  w: number,
  h: number,
  plant = false
): Promise<Uint8Array | null> {
  const flat = sharp(png, { failOn: 'none' }).flatten({ background: '#ffffff' });
  const meta = await flat.metadata();
  if (!meta.width || !meta.height) return null;
  const [kx, ky] = [meta.width / frame.cols, meta.height / frame.rows];
  const left = Math.max(0, Math.floor(frame.box.x0 * kx));
  const top = Math.max(0, Math.floor(frame.box.y0 * ky));
  const width = Math.min(meta.width - left, Math.ceil((frame.box.x1 - frame.box.x0 + 1) * kx));
  const height = Math.min(meta.height - top, Math.ceil((frame.box.y1 - frame.box.y0 + 1) * ky));
  if (width < 2 || height < 2) return null;
  let cut = flat.extract({ left, top, width, height });
  if (frame.mirrored) cut = cut.flop();
  const tile = await cut.resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const rgb = new Uint8Array(tile.buffer, tile.byteOffset, tile.byteLength);
  const trimmed = trimPaper(rgb, maskAt(grid, w, h), w, h, frame.paper);
  // A plant's holes (sky, paper between its leaves) take its leaves' colours, far enough to fill them.
  const mask = shrink(plant ? plantHoles(rgb, trimmed, frame.paper) : trimmed, w, h);
  bleedPaper(rgb, mask, w, h, plant ? PLANT_BLEED_PASSES : undefined);
  return rgb;
}

/** Bleed passes over a plant's skin: its holes and its paper covered (pixels of the skin). */
const PLANT_BLEED_PASSES = 48;
/** Side of a plant's skin, pixels. */
const PLANT_SKIN_SIDE = 512;
/** JPEG quality of a plant's skin. */
const PLANT_SKIN_QUALITY = 84;

/**
 * A plant's skin (PQ-T82): its front drawing over the plant's box, whose margin (`margin` times the
 * drawing) is above the plant and on both sides, never under it; the margin repeats the bled edge.
 */
export async function plantSkin(
  png: Buffer,
  frame: ViewFrame,
  grid: GridView,
  margin: number
): Promise<string | null> {
  const [w, h] = [Math.round(PLANT_SKIN_SIDE / margin), Math.round(PLANT_SKIN_SIDE / margin)];
  const rgb = await cutDrawing(png, frame, grid, w, h, true).catch(() => null);
  if (!rgb) return null;
  const side = Math.floor((PLANT_SKIN_SIDE - w) / 2);
  const jpg = await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } })
    .extend({
      left: side,
      right: PLANT_SKIN_SIDE - w - side,
      top: PLANT_SKIN_SIDE - h,
      bottom: 0,
      extendWith: 'copy',
    })
    .jpeg({ quality: PLANT_SKIN_QUALITY })
    .toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
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
  top?: { png: Buffer; view: GridView; frame: ViewFrame },
  bottom?: { png: Buffer; view: GridView; frame: ViewFrame }
): Promise<{ atlas: string; views: AtlasTile[] } | null> {
  const [aw, ah] = [FACE_ATLAS_COLS * FACE_TILE, FACE_ATLAS_ROWS * FACE_TILE];
  const sheet = new Uint8Array(aw * ah * 3).fill(255);
  const views: AtlasTile[] = [];
  for (const view of ATLAS_VIEWS) {
    const plan = view === 'top' ? top : view === 'bottom' ? bottom : null;
    const frame = plan
      ? plan.frame
      : view === 'top' || view === 'bottom'
        ? undefined
        : aligned.frames[view];
    const grid = plan
      ? plan.view
      : view === 'top' || view === 'bottom'
        ? undefined
        : aligned.views[view];
    // The right tile may be the left drawing standing in: its own drawing is then the left one.
    const png =
      view === 'top' || view === 'bottom'
        ? plan?.png
        : (pngs[view] ?? (view === 'right' && aligned.rightFromLeft ? pngs.left : undefined));
    if (!frame || !grid || !png) continue;
    try {
      const rgb = await cutDrawing(png, frame, grid, FACE_TILE, FACE_TILE);
      if (!rgb) continue;
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
  {
    cropUrl,
    signal,
    onView,
    fourFaces = true,
    topPng,
    onHouseReading,
    onCarReading,
    onPlantReading,
  }: ReconOptions = {}
): Promise<ReconOutcome | null> {
  const tag = `[vision] 3D views reconstruction for "${target.label}"`;
  try {
    const archetype = archetypeOf(target);
    // PQ-T87: the class's specialist team decides the drawings and the reading (registry).
    const team = teamIdOf(archetype);
    const drawn: DrawnView[] = [];
    const draw = async (view: DrawnView, prompt: string, references: string[]) => {
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
    const pngs: Partial<Record<ViewName, Buffer>> = {};
    let top: Buffer | null =
      topPng ?? (target.faceUrls?.top ? await bytesOf(target.faceUrls.top) : null);
    /** A vehicle's underside (PQ-T76): its tile wears the floor of the car. */
    let bottom: Buffer | null = null;
    if (team === 'car') {
      // A vehicle is drawn from its profile (PQ-T76): the validated 2D view, else drawn from the
      // photo crop. Its left side is the profile mirrored, never drawn; then its front, and with
      // `fourFaces` its back, view from above and underside, each from the profile and the front.
      const profile = target.facadeUrl
        ? await bytesOf(target.facadeUrl)
        : cropUrl
          ? await draw(
              'right',
              buildFacadePrompt(archetype, target.label, undefined, { fromPhoto: true }),
              [cropUrl]
            )
          : null;
      if (!profile) {
        console.info(`${tag}: no profile, skipped`);
        return null;
      }
      // The profile shows the car's own right side, its front to the RIGHT of the image: in the
      // model's frame (x to the right as seen from the front) that is the `left` elevation, whose
      // image right is the object's front. Its mirror is the `right` elevation (front at the image
      // left). Fed the other way round, the car was built backwards: grille on the boot (PQ-T78).
      const mirror = await sharp(profile, { failOn: 'none' }).flop().png().toBuffer();
      pngs.left = profile;
      pngs.right = mirror;
      // The operator still sees the profile as validated (« right ») and its mirror.
      onView?.('right', profile);
      onView?.('left', mirror);
      const carFace = async (face: CarFace): Promise<Buffer | null> => {
        const provided = target.faceUrls?.[face];
        if (provided) return bytesOf(provided);
        if (face !== 'front' && !fourFaces) return null;
        const refs = [profile, ...(pngs.front ? [pngs.front] : [])].map(dataUrl);
        return draw(face, buildCarFacePrompt(face, target.label, { known: refs.length }), refs);
      };
      const front = await carFace('front');
      if (front) {
        pngs.front = front;
        onView?.('front', front);
      }
      const [back, above, below] = await Promise.all([
        carFace('back'),
        top ? Promise.resolve(top) : carFace('top'),
        carFace('bottom'),
      ]);
      if (back) {
        pngs.back = back;
        onView?.('back', back);
      }
      top = above;
      bottom = below;
      if (bottom) onView?.('bottom', bottom);
    } else {
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
      pngs.front = front;
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
      if (team === 'plant') {
        // A plant is round about its trunk: its side is its front, never drawn (a drawn side
        // shows another tree and the crown would be cut where the two disagree). The views the
        // operator validated are still read.
        for (const name of FACE_ORDER) if (target.faceUrls?.[name]) await face(name);
        if (!pngs.right && !pngs.left) pngs.right = front;
      } else {
        // The right side first (it fixes the depth), then the back and the left side from both.
        await face('side');
        // With them the view from above: the footprint and the drawing of what faces the sky.
        // The operator's validated plan first, then one given by the caller, else drawn here.
        const above = async () => {
          if (top || !fourFaces) return;
          const known = Object.values(pngs).map(dataUrl);
          top = await draw('top', buildTopPrompt(target.label, known.length), known);
        };
        await Promise.all([face('back'), face('left'), above()]);
      }
    }
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
    // A tree or a bush is one crown on one trunk (PQ-T79): read on the drawings, not carved into boxes.
    if (team === 'plant') {
      // The plant team names what the outline cannot: the species, the habit, the leaves, the limbs.
      let plantReading: PlantReading | null = null;
      const frontFrame = reading.aligned.frames.front;
      if (deps.readPlant && !signal?.aborted && pngs.front && frontFrame) {
        const image = await cropToObject(pngs.front, frontFrame);
        plantReading = image
          ? await deps.readPlant(target.label, image, signal).catch((err) => {
              console.warn(`${tag}: plant team failed:`, err instanceof Error ? err.message : err);
              return null;
            })
          : null;
        if (plantReading) onPlantReading?.(plantReading);
      }
      const tree = reconstructTree(reading.aligned, reading.palette, target.label, {
        sideIsFront: pngs.right === pngs.front,
        hints: plantHints(plantReading),
      });
      if (tree) {
        // The plant wears its own drawing (PQ-T82), projected from the front.
        if (tree.recipe.plant && pngs.front && frontFrame) {
          const skin = await plantSkin(
            pngs.front,
            frontFrame,
            reading.aligned.views.front,
            FRAME_MARGIN
          );
          if (skin) tree.recipe.plant.skin = skin;
        }
        console.info(
          `${tag}: ${tree.recipe.parts.length} parts (${tree.plan.bush ? 'no trunk' : `trunk ${tree.plan.trunk.length} lobes`}, crown ${tree.plan.crown.length} lobes); plant ${tree.recipe.plant ? `${tree.recipe.plant.habit}, ${tree.recipe.plant.stems.length} stems, ${tree.recipe.plant.masses.length} masses, ${tree.recipe.plant.strands?.length ?? 0} strands, ${tree.recipe.plant.leaves?.length ?? 0} leaves, ${tree.recipe.plant.tiers?.length ?? 0} tiers, iou front ${tree.plantScore.front.toFixed(2)} side ${tree.plantScore.side.toFixed(2)}` : 'none'}${drawn.length ? `, drawn here: ${drawn.join(', ')}` : ''}; ${reportLine(tree.report)}`
        );
        return { recipe: tree.recipe, report: tree.report, drawn };
      }
      console.info(`${tag}: no crown found on the drawings, generic reconstruction`);
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
    // A vehicle's length is its profile (PQ-T76): read on the elevations, not clamped by the grid,
    // its width on the body without the wing mirrors.
    if (team === 'car') recipe.proportions = profileProportions(vehicleAspects(recon.aligned));
    // The drawings themselves go on the model (never the photo): best effort, flat colours without.
    const { W, D } = recon.aligned;
    // A vehicle's plan is turned the way its profile runs (PQ-T78): Muse may lay it across the sheet.
    const carTop =
      top && team === 'car'
        ? await readCarTop(top, recon.aligned.views.right, W, D, decodeView)
        : null;
    if (carTop && top && carTop.turn) {
      top = carTop.png;
      onView?.('top', top);
    }
    const topImage = top && !carTop ? await decodeView(top) : null;
    const topRead = carTop ? carTop.read : topImage ? alignTop(topImage, W, D) : null;
    if (top && !topRead)
      console.info(`${tag}: the view from above disagrees with the elevations, not used`);
    // A vehicle's underside (PQ-T76): read like the plan, turned the way the plan is drawn (Muse
    // may lay it across the sheet), then mirrored (seen from below, the sides swap).
    const under = bottom
      ? await readUnderside(bottom, topRead?.view ?? null, W, D, decodeView)
      : null;
    if (bottom && !under)
      console.info(`${tag}: the underside disagrees with the elevations, not used`);
    const faces = await buildFaceAtlas(
      pngs,
      recon.aligned,
      top && topRead ? { png: top, ...topRead } : undefined,
      under
        ? { png: under.png, view: under.read.view, frame: { ...under.read.frame, mirrored: true } }
        : undefined
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
      // The plan shows width and depth on one drawing: it sets the depth of the model (not of a
      // vehicle, whose depth is its profile: Muse draws a car seen from above too wide).
      if (footprint && topRead && team !== 'car')
        recipe.proportions = depthFromPlan(recipe.proportions, topRead.aspect);
      if (hull.boxes.length)
        recipe.faces = {
          atlas: faces.atlas,
          views: faces.views.filter((v): v is AtlasView => v !== 'bottom'),
          ...(faces.views.includes('bottom') ? { underside: true } : {}),
          hull: { grid: [...hull.grid], boxes: hull.boxes.map((b) => [...b]) },
        };
    }
    // A vehicle: its wheels, track and clearance measured on the drawings (PQ-T76).
    if (team === 'car' && !signal?.aborted) {
      // The car team reads what pixels cannot name: kind, body stations, windows, lamps, finishes.
      let reading: CarReading | null = null;
      if (deps.readCar && !signal?.aborted) {
        const { order, images } = await carImages(
          pngs,
          recon.aligned,
          top && topRead ? { png: top, frame: topRead.frame } : null
        );
        reading =
          order[0] === 'front'
            ? await deps.readCar(target.label, order, images, signal).catch((err) => {
                console.warn(`${tag}: car team failed:`, err instanceof Error ? err.message : err);
                return null;
              })
            : null;
        if (reading) onCarReading?.(reading);
      }
      // Then the pixels: wheels, body profile and section, the reading's windows fitted on them.
      const car = await measureCarPlan(pngs, recon.aligned, {
        top: topRead?.view ?? null,
        reading,
      });
      if (car) recipe.car = car;
      // A fitted body is a share of the whole front drawing, mirrors included (PQ-T80): the box
      // takes the drawing's full width, or the body would be narrowed twice.
      if (car?.body) recipe.proportions = profileProportions(recon.aligned.aspects);
      console.info(
        `${tag}: car ${car ? `${car.kind ?? 'kind ?'}, body ${car.body ? car.body.top.length : 0} stations, ${car.windows?.length ?? 0} windows, ${car.wheels.length} axles (${car.wheels.map((w) => `z ${w.z} r ${w.r}`).join(', ')}), clearance ${car.clearance ?? '?'}, track ${car.track ? `${car.track.x0}–${car.track.x1}` : '?'}` : 'not measured'}`
      );
    }
    // A piece of furniture (PQ-T89): its team reads the front and side drawings cut to it; the
    // builder makes its named parts (seat, backrest, legs…), wearing the drawings instead of the hull.
    if (isFurnitureTeam(team) && deps.readFurniture && !signal?.aborted) {
      const cut = async (v: 'front' | 'right') => {
        const png = pngs[v];
        const frame = recon.aligned.frames[v];
        return png && frame ? cropToObject(png, frame) : null;
      };
      const [front, side] = await Promise.all([cut('front'), cut('right')]);
      const read = front
        ? await deps
            .readFurniture(team, target.label, side ? [front, side] : [front], signal)
            .catch((err) => {
              console.warn(
                `${tag}: ${team} team failed:`,
                err instanceof Error ? err.message : err
              );
              return null;
            })
        : null;
      const model = read
        ? furnitureModel(
            team,
            read,
            recipe.proportions,
            recipe.faces?.atlas,
            target.outline
              ? {
                  rings: silhouetteRings(target),
                  aspect: recipe.proportions.w / Math.max(1e-6, recipe.proportions.h),
                }
              : undefined
          )
        : null;
      if (model) {
        recipe.parts = model.parts;
        recipe.proportions = model.proportions;
        if (model.skin) {
          recipe.skin = model.skin;
          delete recipe.faces;
        }
      }
      console.info(
        `${tag}: ${team} ${model ? `${read!.kind}, ${model.parts.length} named parts${model.skin ? ' wearing the drawings' : ''}` : 'not read, hull kept'}`
      );
    }
    // A house or a building: its specialist reads it room by room (volumes, roofs, openings).
    if (deps.readHouse && !signal?.aborted && team === 'house') {
      const wallPart = recipe.parts
        .filter((p) => p.shape === 'box')
        .sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
      const roofPart = recipe.parts.find((p) => p.shape === 'hip' || p.shape === 'prism');
      const house = await readHousePlan(deps.readHouse, {
        label: target.label,
        pngs,
        aligned: recon.aligned,
        top: top && topRead ? { png: top, view: topRead.view, frame: topRead.frame } : null,
        fallback: {
          ...(wallPart?.material ? { wall: wallPart.material } : {}),
          ...(roofPart?.material ? { roof: roofPart.material } : {}),
        },
        ...(signal ? { signal } : {}),
        ...(onHouseReading ? { onReading: onHouseReading } : {}),
        ...(deps.askHouseTool ? { ask: deps.askHouseTool } : {}),
      });
      if (house) recipe.house = house;
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
