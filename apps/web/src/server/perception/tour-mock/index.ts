import 'server-only';

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
import { renderFlat, type FlatView } from '../flat-render';
import { cropRectForShape } from '../shape-crop';
import { generateImaginedViews } from '../views-generation';
import { renderAtPhoto, type TourMockEntry } from './render';
import DATA from './tour-mock.json';

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
export const TOUR_MOCK_MODEL = 'mock-tour-v1';

const ENTRIES = DATA as unknown as Readonly<Record<string, TourMockEntry>>;

/** The built entry of a tour object, or null for any other id. */
export function tourMockEntry(id: string): TourMockEntry | null {
  return Object.hasOwn(ENTRIES, id) ? ENTRIES[id]! : null;
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
  const imaginedViews = await generateImaginedViews(entry.recipe, target, 1, 256).catch(() => []);
  return {
    detectionId: target.id,
    mode: 'recipe',
    recipe: entry.recipe,
    source: 'mock',
    model: TOUR_MOCK_MODEL,
    family: entry.recipe.plant ? 'procedural' : 'parametric',
    fit: { iou: entry.score.iou },
    ...(target.outline ? { outline: target.outline } : {}),
    ...(partMasks.length ? { partMasks, coverage: tourCoverage(entry, partMasks) } : {}),
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

/**
 * One 2D view of a tour object drawn from its model (the mock's « Muse Image » answer): an
 * orthographic elevation on white paper, the object as itself (its own turn on the photo dropped).
 * Null for any other id.
 */
export async function tourMockDrawing(
  target: Pick<ShapeTarget, 'id' | 'scenery'>,
  face: FaceName | 'main'
): Promise<Buffer | null> {
  const entry = tourMockEntry(target.id);
  if (!entry) return null;
  const recipe: ObjectRecipe = { ...entry.recipe, yaw: undefined };
  const view = faceView(face, recipe, target.scenery === 'vehicle');
  const flat = renderFlat(recipe, 1, DRAWING_PX, DRAWING_PX, view);
  const n = DRAWING_PX * DRAWING_PX;
  const rgb = Buffer.alloc(n * 3, 255);
  for (let i = 0; i < n; i++)
    if (flat.mask.data[i]) {
      rgb[i * 3] = flat.rgb[i * 3]!;
      rgb[i * 3 + 1] = flat.rgb[i * 3 + 1]!;
      rgb[i * 3 + 2] = flat.rgb[i * 3 + 2]!;
    }
  return sharp(rgb, { raw: { width: DRAWING_PX, height: DRAWING_PX, channels: 3 } })
    .png()
    .toBuffer();
}
