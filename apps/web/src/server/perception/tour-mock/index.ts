import 'server-only';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';
import {
  partLabelKey,
  type FaceName,
  type ObjectRecipe,
  type ObjectShape,
  type PartCoverage,
  type PartMask,
  type ShapeTarget,
} from '@/lib/object-shape';
import { TOUR_ROOMS } from '@/features/vision-insert/ui/xr/tour/tour-data';
import type { SkinBox, SkinView } from '@/lib/face-skin';
import { renderFlat, type FlatPaint, type FlatView } from '../flat-render';
import { cropRectForShape } from '../shape-crop';
import { ringsMask, type Mask } from '../silhouette-fit';
import { CANONICAL_FLAT_VIEWS, generateImaginedViews, getAngleAnatomy } from '../views-generation';
import { archetypeOf } from '@/lib/object-kit';
import { CANONICAL_ANGLES, type ImaginedAngleView } from '@/lib/object-shape';
import type { TourImagined } from './imagine';
import { imagineFaces, imaginedDrawing, type ImaginedFaces } from './imagine-faces';
import { imaginedPaint } from './imagined-shader';
import { skinOf } from '../recipe-box';
import { renderAtPhoto, type TourMockEntry } from './render';
import {
  outlineFrame,
  recipeBox,
  skinAtlas,
  skinPaint,
  type PanoRing,
  type SkinWrap,
} from './skin';
import DATA from './tour-mock.json';
import { preparedDrawing, preparedModelUrl } from './prepared';

/**
 * Mock answers of the 360° tour objects (VS-T41): with no Meta model, a tour object selected in
 * the immersion gets its hand-built model (`specs-*.ts`, coloured and scored on its photo by
 * `make tour-mock`) instead of the generic recipe of its category, with everything the real
 * analysis returns: the 3D recipe (its materials are the studio's layers), part masks and their
 * coverage, the six imagined angles and the 2D drawings of every face. Deterministic, offline.
 */

/** Stop criteria of the tour mock loop (methodology §9): silhouette IoU and colour ΔE. */
export const TOUR_MOCK_STOP = { iou: 0.85, deltaE: 8 } as const;

/** Model id of every tour mock answer. */
export const TOUR_MOCK_MODEL = 'mock-tour-v2';

const ENTRIES = DATA as unknown as Readonly<Record<string, TourMockEntry>>;

/** The built entry of a tour object, or null for any other id. */
export function tourMockEntry(id: string): TourMockEntry | null {
  return Object.hasOwn(ENTRIES, id) ? ENTRIES[id]! : null;
}

let IMAGINED: Promise<Readonly<Record<string, TourImagined>>> | null = null;

/**
 * A tour object built from its imagined drawings (VS-T44, `make tour-imagine`), or null: then its
 * hand-built model wearing its photo faces answers (VS-T43).
 */
export async function tourImagined(id: string): Promise<TourImagined | null> {
  IMAGINED ??= import('./tour-imagined.json').then(
    (m) => m.default as unknown as Record<string, TourImagined>
  );
  const all = await IMAGINED;
  return Object.hasOwn(all, id) ? all[id]! : null;
}

/** The six angles of an imagined object: its own drawings (an angle not drawn is left out). */
export function imaginedAngles(
  imagined: { views: Partial<Record<string, string>> },
  target: Pick<ShapeTarget, 'label' | 'category' | 'scenery'>
): ImaginedAngleView[] {
  const archetype = archetypeOf(target);
  return CANONICAL_ANGLES.flatMap((angle) => {
    const imageUrl = imagined.views[angle];
    if (!imageUrl) return [];
    const { labelKey, deg } = CANONICAL_FLAT_VIEWS[angle];
    return [{ angle, labelKey, angleDeg: deg, imageUrl, ...getAngleAnatomy(archetype, angle) }];
  });
}

/** The stored drawing of a face of an imagined object (a car's main view is its profile), or null. */
export async function storedDrawing(
  imagined: { views: Partial<Record<string, string>> },
  face: FaceName | 'main',
  vehicle: boolean
): Promise<Buffer | null> {
  const key = face === 'main' ? (vehicle ? 'right' : 'front') : face === 'side' ? 'right' : face;
  const url = key ? imagined.views[key] : null;
  if (!url) return null;
  return sharp(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
    .png()
    .toBuffer();
}

const FACES = new Map<string, Promise<ImaginedFaces | null>>();
/**
 * How long an answer waits for an object being imagined for the first time (ms): past it, the
 * object answers with the faces cut from its photo (VS-T43) and the imagining goes on, cached for
 * the next look (a tree's crown takes minutes; `make tour-faces` prepares them all).
 */
export const IMAGINE_WAIT_MS = 20_000;

/** The imagined faces of `id` if they are ready within `IMAGINE_WAIT_MS`, else null. */
async function facesInTime(id: string): Promise<ImaginedFaces | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), IMAGINE_WAIT_MS);
  });
  const faces = await Promise.race([tourFaces(id), late]);
  clearTimeout(timer);
  return faces;
}
/**
 * Version of the imagined look: bump it when the shader or the tile framing changes, so the
 * faces cached on disk are drawn again.
 */
export const IMAGINED_LOOK = 2;
/** Where imagined faces are kept between runs (ignored by git, like every build cache). */
const FACES_CACHE = join(process.cwd(), 'node_modules', '.cache', 'tour-imagined');

/** The cache file of an object: named by its model and the look, stale when either changes. */
function facesCachePath(entry: TourMockEntry, id: string): string {
  const key = createHash('sha1')
    .update(JSON.stringify([IMAGINED_LOOK, entry.recipe, entry.concepts]))
    .digest('hex')
    .slice(0, 12);
  return join(FACES_CACHE, `${id}-${key}.json`);
}

async function loadOrImagine(entry: TourMockEntry, id: string): Promise<ImaginedFaces> {
  const path = facesCachePath(entry, id);
  const cached = await readFile(path, 'utf8').catch(() => null);
  if (cached) return JSON.parse(cached) as ImaginedFaces;
  const faces = await imagineFaces(entry.recipe, entry.concepts);
  // A cache that cannot be written (read-only deploy) only costs the next run a render.
  await mkdir(FACES_CACHE, { recursive: true })
    .then(() => writeFile(path, JSON.stringify(faces)))
    .catch(() => undefined);
  return faces;
}

/**
 * A tour object imagined on its six faces on demand (VS-T44: no photo), cached in memory and on
 * disk: the model wearing them and what its drawings are rendered from. Null for any other id.
 */
export function tourFaces(id: string): Promise<ImaginedFaces | null> {
  let faces = FACES.get(id);
  if (!faces) {
    const entry = tourMockEntry(id);
    faces = entry
      ? loadOrImagine(entry, id).catch((err) => {
          console.warn(
            `[tour-mock] ${id}: not imagined:`,
            err instanceof Error ? err.message : err
          );
          return null;
        })
      : Promise.resolve(null);
    FACES.set(id, faces);
  }
  return faces;
}

/** JPEG quality of the face atlas sent with a tour model. */
const SKIN_ATLAS_QUALITY = 84;

/** A tour object's faces (VS-T43): what its model wears and what its 2D faces are drawn from. */
export interface TourSkin {
  /** The recipe without its photo turn: the faces are drawn as the object itself. */
  recipe: ObjectRecipe;
  box: SkinBox;
  /** Camera turn of the front face: the photo's yaw of the model and its pitch. */
  view: SkinView;
  /** Front face cut from the photo (data URL, one tile, spans the model box). */
  frontUrl: string;
  /** Face atlas (data URL). */
  atlasUrl: string;
  /** Outline on the front tile. */
  mask: Mask;
  /** Front tile pixels (RGB) and the photo aspect of the object's box (w / h). */
  front: Uint8Array;
  aspect: number;
  paint: FlatPaint;
}

/** Outline of a tour object by id (`tour-data.ts`). */
function tourOutline(id: string) {
  for (const room of Object.values(TOUR_ROOMS)) {
    const o = room.objects.find((x) => x.id === id);
    if (o?.outline) return o.outline;
  }
  return null;
}

let FRONTS: Promise<Record<string, string>> | null = null;
/** The stored front faces (`make tour-mock`), loaded on first use. */
const fronts = () =>
  (FRONTS ??= import('./tour-skins.json').then((m) => m.default as Record<string, string>));

const SKINS = new Map<string, Promise<TourSkin | null>>();

/** The faces of a tour object (cached), or null without a stored front face. */
export function tourSkin(id: string): Promise<TourSkin | null> {
  let hit = SKINS.get(id);
  if (!hit) {
    hit = buildTourSkin(id).catch((err) => {
      console.warn(`[tour-mock] ${id}: faces failed:`, err instanceof Error ? err.message : err);
      return null;
    });
    SKINS.set(id, hit);
  }
  return hit;
}

async function buildTourSkin(id: string): Promise<TourSkin | null> {
  const entry = tourMockEntry(id);
  const outline = tourOutline(id);
  const b64 = (await fronts())[id];
  if (!entry || !outline || !b64) return null;
  return skinFromFront(entry, Buffer.from(b64, 'base64'), outline);
}

/** A tour object's faces from its stored front face (JPEG) and its panorama outline. */
export async function skinFromFront(
  entry: Pick<TourMockEntry, 'recipe' | 'concepts' | 'pitch'>,
  jpg: Buffer,
  outline: ReadonlyArray<PanoRing>
): Promise<TourSkin> {
  const { data, info } = await sharp(jpg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const front = new Uint8Array(data.buffer, data.byteOffset, data.length);
  const frame = outlineFrame(outline);
  const mask = ringsMask(frame.rings, frame.box, info.width, info.height);
  const recipe: ObjectRecipe = { ...entry.recipe, yaw: undefined };
  const view: SkinView = { yaw: entry.recipe.yaw ?? 0, pitch: entry.pitch };
  const box = recipeBox(recipe, view);
  const atlas = skinAtlas(front, mask, box, skinWrap(entry));
  const atlasJpg = await sharp(Buffer.from(atlas.rgb), {
    raw: { width: atlas.width, height: atlas.height, channels: 3 },
  })
    .jpeg({ quality: SKIN_ATLAS_QUALITY, mozjpeg: true })
    .toBuffer();
  return {
    recipe,
    box,
    view,
    frontUrl: `data:image/jpeg;base64,${jpg.toString('base64')}`,
    atlasUrl: `data:image/jpeg;base64,${atlasJpg.toString('base64')}`,
    mask,
    front,
    // The panorama is twice as wide as high: a box's pixel aspect is 2 w / h.
    aspect: (2 * frame.box.w) / frame.box.h,
    paint: skinPaint(atlas, box, view),
  };
}

/** Grown things (a plant, flowers, foliage) wrap their faces round; made things fold them. */
export function skinWrap(entry: Pick<TourMockEntry, 'recipe' | 'concepts'>): SkinWrap {
  return entry.recipe.plant || entry.concepts.some((c) => c === 'foliage' || c === 'flower')
    ? 'wrap'
    : 'fold';
}

/** The recipe a tour object is answered with: its parts wearing their faces (a plant its front). */
export function skinnedRecipe(entry: TourMockEntry, skin: TourSkin | null): ObjectRecipe {
  if (!skin) return entry.recipe;
  if (skin.recipe.plant)
    return { ...skin.recipe, plant: { ...skin.recipe.plant, skin: skin.frontUrl } };
  return {
    ...skin.recipe,
    skin: skinOf(skin.recipe, entry.concepts, skin.atlasUrl, skin.view),
  };
}

/** Grid the part masks are read on (long side, cells). */
const MASK_GRID = 96;

/**
 * Part masks as SAM would return them on the shape crop (crop fractions): one instance per part
 * that has a concept, its box where the model draws it at the photo's view. Pure.
 */
export function tourPartMasks(
  entry: TourMockEntry,
  box: ShapeTarget['box'],
  photo: { width: number; height: number }
): PartMask[] {
  const aspect = (box.w * photo.width) / Math.max(1e-6, box.h * photo.height);
  const cols = aspect >= 1 ? MASK_GRID : Math.max(8, Math.round(MASK_GRID * aspect));
  const rows = aspect >= 1 ? Math.max(8, Math.round(MASK_GRID / aspect)) : MASK_GRID;
  const render = renderAtPhoto(entry.recipe, cols, rows, entry.pitch);
  const crop = cropRectForShape(photo.width, photo.height, box);
  const bounds = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < render.part.length; i++) {
    const k = render.part[i]!;
    if (k < 0 || !entry.concepts[k]) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    const b = bounds.get(k) ?? [c, r, c, r];
    bounds.set(k, [Math.min(b[0], c), Math.min(b[1], r), Math.max(b[2], c), Math.max(b[3], r)]);
  }
  const r4 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4;
  const toCrop = (fx: number, fy: number) => [
    (box.x * photo.width + fx * box.w * photo.width - crop.left) / crop.width,
    (box.y * photo.height + fy * box.h * photo.height - crop.top) / crop.height,
  ];
  return [...bounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([k, [c0, r0, c1, r1]]) => {
      const [x0, y0] = toCrop(c0 / cols, r0 / rows);
      const [x1, y1] = toCrop((c1 + 1) / cols, (r1 + 1) / rows);
      return {
        concept: entry.concepts[k]!,
        box: { x: r4(x0!), y: r4(y0!), w: r4(x1! - x0!), h: r4(y1! - y0!) },
      };
    })
    .filter((m) => m.box.w > 0 && m.box.h > 0);
}

/** Parts seen (masks) vs built (parts with that concept), per concept. */
export function tourCoverage(entry: TourMockEntry, masks: ReadonlyArray<PartMask>): PartCoverage[] {
  const built = new Map<string, number>();
  for (const c of entry.concepts) if (c) built.set(c, (built.get(c) ?? 0) + 1);
  return [...built.entries()].map(([concept, n]) => ({
    concept: partLabelKey(concept),
    seen: masks.filter((m) => m.concept === concept).length,
    built: n,
  }));
}

/**
 * The full mock answer for a tour object (`/api/vision/shape` in mock mode), or null when the
 * target is not a tour object. The recipe keeps its own proportions (a ceiling light seen from
 * below is round, whatever its box on the photo).
 */
export async function tourMockShape(
  target: Pick<ShapeTarget, 'id' | 'label' | 'category' | 'scenery' | 'box' | 'outline'>,
  photo: { width: number; height: number } | null
): Promise<ObjectShape | null> {
  const entry = tourMockEntry(target.id);
  if (!entry) return null;
  const partMasks = photo ? tourPartMasks(entry, target.box, photo) : [];
  const masks = partMasks.length ? { partMasks, coverage: tourCoverage(entry, partMasks) } : {};
  const modelUrl = preparedModelUrl(target.id);
  const answer = {
    detectionId: target.id,
    mode: 'recipe' as const,
    source: 'mock' as const,
    model: TOUR_MOCK_MODEL,
    ...(target.outline ? { outline: target.outline } : {}),
    // VS-T52: its prepared glTF model is what the lab and the village show.
    ...(modelUrl ? { modelUrl } : {}),
  };
  // VS-T44: imagined on every face first. The cars are precomputed (built from their drawings
  // like a real capture); every other object is imagined here once and cached.
  const imagined = await tourImagined(target.id);
  if (imagined)
    return {
      ...answer,
      recipe: imagined.recipe,
      family: 'parametric',
      fit: { iou: imagined.iou },
      imaginedViews: imaginedAngles(imagined, target),
    };
  const faces = await facesInTime(target.id);
  if (faces?.views)
    return {
      ...answer,
      recipe: faces.recipe,
      family: 'procedural',
      fit: { iou: entry.score.iou },
      ...masks,
      imaginedViews: imaginedAngles({ views: faces.views }, target),
    };
  if (faces) {
    const imaginedViews = await generateImaginedViews(
      faces.base,
      target,
      1,
      256,
      (view: FlatView) => imaginedPaint(faces.base, view, faces.box)
    ).catch(() => []);
    return {
      ...answer,
      recipe: faces.recipe,
      family: entry.recipe.plant ? 'procedural' : 'parametric',
      fit: { iou: entry.score.iou },
      ...masks,
      ...(imaginedViews.length ? { imaginedViews } : {}),
    };
  }
  // Not imagined (a render failed): its parts wearing faces cut from its photo (VS-T43).
  const skin = await tourSkin(target.id);
  const imaginedViews = await generateImaginedViews(
    skin?.recipe ?? entry.recipe,
    target,
    1,
    256,
    skin?.paint
  ).catch(() => []);
  return {
    ...answer,
    recipe: skinnedRecipe(entry, skin),
    family: entry.recipe.plant ? 'procedural' : 'parametric',
    fit: { iou: entry.score.iou },
    ...masks,
    ...(imaginedViews.length ? { imaginedViews } : {}),
  };
}

/** Which way the nose of a modelled car points (+x or −x): away from its tail lights. */
function noseSign(recipe: ObjectRecipe): 1 | -1 {
  const tail = recipe.parts.find((p) => p.kind === 'light');
  return tail && tail.at[0] > 0 ? -1 : 1;
}

const QUARTER = Math.PI / 2;
const STRAIGHT_DOWN = QUARTER - 1e-3;

/** The camera turn of each drawn face (`main` = the view the operator validates first). */
export function faceView(
  face: FaceName | 'main',
  recipe: ObjectRecipe,
  vehicle: boolean
): FlatView {
  if (vehicle) {
    // A car's main view is its profile; its front and back are its nose and its tail.
    const nose = noseSign(recipe);
    if (face === 'front') return { yaw: -nose * QUARTER, pitch: 0 };
    if (face === 'back') return { yaw: nose * QUARTER, pitch: 0 };
    if (face === 'side' || face === 'main') return { yaw: 0, pitch: 0 };
    if (face === 'left') return { yaw: Math.PI, pitch: 0 };
  }
  switch (face) {
    case 'side':
      return { yaw: -QUARTER, pitch: 0 };
    case 'left':
      return { yaw: QUARTER, pitch: 0 };
    case 'back':
      return { yaw: Math.PI, pitch: 0 };
    case 'top':
      return { yaw: 0, pitch: STRAIGHT_DOWN };
    case 'bottom':
      return { yaw: 0, pitch: -STRAIGHT_DOWN };
    default:
      return { yaw: 0, pitch: 0 };
  }
}

/** Side of a drawn face (pixels). */
export const DRAWING_PX = 512;
/** Paper kept around the object on a drawn face (share of the side). */
const DRAWING_MARGIN = 0.06;

/** RGB pixels on white paper as a PNG. */
const paperPng = (rgb: Uint8Array | Buffer, w: number, h: number) =>
  sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.length), {
    raw: { width: w, height: h, channels: 3 },
  })
    .png()
    .toBuffer();

/**
 * The front face as cut from the photo (VS-T43): the object inside its outline, on white paper,
 * at its own proportions. PNG.
 */
export async function frontCutout(skin: TourSkin): Promise<Buffer> {
  const { mask, front } = skin;
  const size = mask.cols;
  const cut = Buffer.alloc(size * size * 3, 255);
  for (let i = 0; i < size * size; i++)
    if (mask.data[i]) for (let k = 0; k < 3; k++) cut[i * 3 + k] = front[i * 3 + k]!;
  const inner = Math.round(DRAWING_PX * (1 - 2 * DRAWING_MARGIN));
  const [w, h] =
    skin.aspect >= 1
      ? [inner, Math.max(8, Math.round(inner / skin.aspect))]
      : [Math.max(8, Math.round(inner * skin.aspect)), inner];
  const left = Math.floor((DRAWING_PX - w) / 2);
  const top = Math.floor((DRAWING_PX - h) / 2);
  return sharp(cut, { raw: { width: size, height: size, channels: 3 } })
    .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
    .extend({
      left,
      right: DRAWING_PX - w - left,
      top,
      bottom: DRAWING_PX - h - top,
      background: '#ffffff',
    })
    .png()
    .toBuffer();
}

/**
 * One 2D view of a tour object (the mock's « Muse Image » answer): the front as cut from its photo,
 * every other face drawn from its model wearing that front (VS-T43), an orthographic elevation on
 * white paper, the object as itself (its own turn on the photo dropped). Null for any other id.
 */
export async function tourMockDrawing(
  target: Pick<ShapeTarget, 'id' | 'scenery'>,
  face: FaceName | 'main'
): Promise<Buffer | null> {
  const entry = tourMockEntry(target.id);
  if (!entry) return null;
  const vehicle = target.scenery === 'vehicle';
  // VS-T52: a prepared object answers with its realistic drawings.
  const prepared = await preparedDrawing(target.id, face, vehicle);
  if (prepared) return prepared;
  // VS-T44: every face is imagined, never the photo.
  const imagined = await tourImagined(target.id);
  const stored = imagined ? await storedDrawing(imagined, face, vehicle) : null;
  if (stored) return stored;
  const faces = await facesInTime(target.id);
  const kept = faces?.views ? await storedDrawing({ views: faces.views }, face, vehicle) : null;
  if (kept) return kept;
  if (faces) return imaginedDrawing(faces, faceView(face, faces.base, vehicle), DRAWING_PX);
  const skin = await tourSkin(target.id);
  const recipe: ObjectRecipe = skin?.recipe ?? { ...entry.recipe, yaw: undefined };
  // The photo shows the front (a car: its profile, its main view).
  if (skin && (face === 'main' || (!vehicle && face === 'front') || (vehicle && face === 'side')))
    return frontCutout(skin);
  const view = faceView(face, recipe, vehicle);
  const flat = renderFlat(recipe, 1, DRAWING_PX, DRAWING_PX, view, undefined, skin?.paint);
  const n = DRAWING_PX * DRAWING_PX;
  const rgb = Buffer.alloc(n * 3, 255);
  for (let i = 0; i < n; i++)
    if (flat.mask.data[i]) {
      rgb[i * 3] = flat.rgb[i * 3]!;
      rgb[i * 3 + 1] = flat.rgb[i * 3 + 1]!;
      rgb[i * 3 + 2] = flat.rgb[i * 3 + 2]!;
    }
  return paperPng(rgb, DRAWING_PX, DRAWING_PX);
}
