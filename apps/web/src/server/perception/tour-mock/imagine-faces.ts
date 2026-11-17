import sharp from 'sharp';
import { ATLAS_VIEWS, FACE_TILE, type AtlasTile } from '@/lib/face-atlas';
import type { SkinBox } from '@/lib/face-skin';
import type { ObjectRecipe } from '@/lib/object-shape';
import { renderFlat, type FlatView } from '../flat-render';
import { CANONICAL_FLAT_VIEWS } from '../views-generation';
import { recipeBox, skinOf } from '../recipe-box';
import { imaginedPaint, inkEdges, partSeams } from './imagined-shader';
import { fillOutside, mirrorTile, packAtlas } from './skin';
import { renderPlant } from './plant-render';

/**
 * Every tour object imagined on all its faces (VS-T44): its parts drawn as a game / animated-film
 * render from each side (`imagined-shader.ts`), no photo; the six drawings framed on the model's
 * box make the atlas its pieces wear (`ObjectRecipe.skin`, `box` mode: each surface reads the
 * face it looks at, top and underside included). The 2D faces shown to the operator are the same
 * renders on white paper. Pure but for the JPEG encoding.
 */

const QUARTER = Math.PI / 2;
const STRAIGHT_DOWN = QUARTER - 1e-3;

/**
 * The camera of each canonical tile and how its render is turned into the tile (`lib/face-atlas.ts`:
 * back mirrored, sides along z back first, top and underside on x with the back at the top).
 */
export const TILE_CAMERA: Record<AtlasTile, { view: FlatView; flip?: 'x' | 'y' }> = {
  front: { view: { yaw: 0, pitch: 0 } },
  right: { view: { yaw: -QUARTER, pitch: 0 }, flip: 'x' },
  back: { view: { yaw: Math.PI, pitch: 0 }, flip: 'x' },
  left: { view: { yaw: QUARTER, pitch: 0 } },
  top: { view: { yaw: 0, pitch: STRAIGHT_DOWN } },
  bottom: { view: { yaw: 0, pitch: -STRAIGHT_DOWN }, flip: 'y' },
};

/** Share darkened on the outlines of an atlas tile (lighter than on a drawing: they wrap the model). */
const TILE_INK = 0.3;
/** Share darkened on the outlines of a drawing. */
export const DRAWING_INK = 0.6;
const ATLAS_JPEG = 86;

const flipY = (rgb: Uint8Array, size: number) => {
  const out = new Uint8Array(rgb.length);
  for (let y = 0; y < size; y++)
    out.set(rgb.subarray(y * size * 3, (y + 1) * size * 3), (size - 1 - y) * size * 3);
  return out;
};

/** One canonical tile of the model (`size`², raw RGB): its render framed on the box, filled round. */
export function imaginedTile(
  recipe: ObjectRecipe,
  box: SkinBox,
  tile: AtlasTile,
  size = FACE_TILE
): Uint8Array {
  const { view, flip } = TILE_CAMERA[tile];
  // A plant is drawn as its mesh (VS-T46: trunk, limbs, lumpy leaves), never as its clumps.
  const r = recipe.plant
    ? renderPlant(recipe, size, size, view, true)
    : renderFlat(
        recipe,
        1,
        size,
        size,
        view,
        (b) => ({
          cx: (b.x0 + b.x1) / 2,
          cy: (b.y0 + b.y1) / 2,
          fw: Math.max(1e-6, b.x1 - b.x0),
          fh: Math.max(1e-6, b.y1 - b.y0),
        }),
        imaginedPaint(recipe, view, box)
      );
  inkEdges(r, size, size, TILE_INK, recipe.plant ? () => false : partSeams(recipe));
  const rgb = Uint8Array.from(r.rgb);
  // A surface hidden at a silhouette edge reads the colours next to it, never black paper.
  fillOutside(rgb, r.mask);
  return flip === 'x' ? mirrorTile(rgb, size) : flip === 'y' ? flipY(rgb, size) : rgb;
}

/** A drawn face kept with the model (a plant's: its crown is slow to draw). */
export type DrawnFace = 'front' | 'right' | 'back' | 'left' | 'top' | 'three_quarter';

export interface ImaginedFaces {
  /** The model wearing its imagined faces (no yaw: it faces its own front). */
  recipe: ObjectRecipe;
  /** The model as built, without its skin: what the drawings are rendered from. */
  base: ObjectRecipe;
  box: SkinBox;
  /** Its drawings drawn once (JPEG data URLs), when drawing them on demand is too slow. */
  views?: Partial<Record<DrawnFace, string>>;
}

/** The camera of each kept drawing (as `faceView` and the six angles). */
export const DRAWN_VIEWS: Record<DrawnFace, FlatView> = {
  front: { yaw: 0, pitch: 0 },
  right: { yaw: -QUARTER, pitch: 0 },
  back: { yaw: Math.PI, pitch: 0 },
  left: { yaw: QUARTER, pitch: 0 },
  top: { yaw: 0, pitch: STRAIGHT_DOWN },
  three_quarter: CANONICAL_FLAT_VIEWS.three_quarter.view,
};
/** Side of a kept drawing. */
export const DRAWN_PX = 384;

/**
 * A parts model imagined on its six faces, its pieces named by `concepts` (else their material); a
 * plant wears its front and keeps its drawings.
 */
export async function imagineFaces(
  model: ObjectRecipe,
  concepts: ReadonlyArray<string | null | undefined>
): Promise<ImaginedFaces> {
  const base: ObjectRecipe = { ...model, yaw: undefined };
  delete base.skin;
  const box = recipeBox(base, { yaw: 0, pitch: 0 });
  if (base.plant) {
    // A plant grows its own crown (PQ-T82 mesh): it wears its imagined front, as it wore its photo.
    const front = await sharp(Buffer.from(imaginedTile(base, box, 'front')), {
      raw: { width: FACE_TILE, height: FACE_TILE, channels: 3 },
    })
      .jpeg({ quality: ATLAS_JPEG })
      .toBuffer();
    const faces: ImaginedFaces = {
      recipe: {
        ...base,
        plant: { ...base.plant, skin: `data:image/jpeg;base64,${front.toString('base64')}` },
      },
      base,
      box,
    };
    return { ...faces, views: await drawnViews(faces) };
  }
  const tiles = Object.fromEntries(
    ATLAS_VIEWS.map((t) => [t, imaginedTile(base, box, t)])
  ) as Record<AtlasTile, Uint8Array>;
  const atlas = packAtlas(tiles, FACE_TILE);
  const jpeg = await sharp(Buffer.from(atlas.rgb), {
    raw: { width: atlas.width, height: atlas.height, channels: 3 },
  })
    .jpeg({ quality: ATLAS_JPEG })
    .toBuffer();
  const url = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  return { recipe: { ...base, skin: { ...skinOf(base, concepts, url), mode: 'box' } }, base, box };
}

/**
 * An imagined drawing of the model seen along `view`: the render on white paper, `px` square,
 * 10 % margin, inked outlines and seams (PNG).
 */
export async function imaginedDrawing(
  faces: Pick<ImaginedFaces, 'base' | 'box'>,
  view: FlatView,
  px: number
): Promise<Buffer> {
  const r = faces.base.plant
    ? renderPlant(faces.base, px, px, view)
    : renderFlat(
        faces.base,
        1,
        px,
        px,
        view,
        undefined,
        imaginedPaint(faces.base, view, faces.box)
      );
  inkEdges(r, px, px, DRAWING_INK, faces.base.plant ? () => false : partSeams(faces.base));
  const rgb = Buffer.alloc(px * px * 3, 255);
  for (let i = 0; i < px * px; i++)
    if (r.mask.data[i]) {
      rgb[i * 3] = r.rgb[i * 3]!;
      rgb[i * 3 + 1] = r.rgb[i * 3 + 1]!;
      rgb[i * 3 + 2] = r.rgb[i * 3 + 2]!;
    }
  return sharp(rgb, { raw: { width: px, height: px, channels: 3 } })
    .png()
    .toBuffer();
}

/** Every kept drawing of the model (JPEG data URLs, `px` square). */
export async function drawnViews(
  faces: Pick<ImaginedFaces, 'base' | 'box'>,
  px = DRAWN_PX
): Promise<Partial<Record<DrawnFace, string>>> {
  const views: Partial<Record<DrawnFace, string>> = {};
  for (const [face, view] of Object.entries(DRAWN_VIEWS)) {
    const jpg = await sharp(await imaginedDrawing(faces, view, px))
      .jpeg({ quality: ATLAS_JPEG })
      .toBuffer();
    views[face as DrawnFace] = `data:image/jpeg;base64,${jpg.toString('base64')}`;
  }
  return views;
}
