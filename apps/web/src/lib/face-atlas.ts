/**
 * Face atlas of a model built from its drawn views (PQ-T70): the validated drawings, cut to the
 * object and laid out in one image, projected on the model along the axis each one looks down.
 * Shared by the server (which builds the atlas) and the 3D view (which maps it). Pure.
 *
 * Every tile is canonical: columns run along an object axis (x for front and back, z for the two
 * sides, back first), rows top → bottom. So the back tile is the back drawing mirrored, and a point
 * of the model reads the same column on the front and on the back tile.
 */

export const FACE_VIEWS = ['front', 'right', 'back', 'left'] as const;
export type FaceView = (typeof FACE_VIEWS)[number];

/** Atlas layout: 3 × 2 square tiles: the four elevations, the view from above, one blank tile. */
export const FACE_ATLAS_COLS = 3;
export const FACE_ATLAS_ROWS = 2;
/** Tile side, pixels. */
export const FACE_TILE = 512;
/** Texels kept clear of a tile's edge, so filtering never reads the next tile. */
export const FACE_TILE_INSET = 1.5;
/** The drawings an atlas may hold: the four elevations, then the view from above. */
export const ATLAS_VIEWS = [...FACE_VIEWS, 'top'] as const;
export type AtlasView = (typeof ATLAS_VIEWS)[number];

/** Tile of a view (the top view takes the fifth tile; its rows run back → front). */
export const faceSlot = (view: AtlasView): number => ATLAS_VIEWS.indexOf(view);

/** Atlas uv (v up, as three.js reads an image) of the point [s, t] of a slot's tile. */
export function atlasUv(slot: number, s: number, t: number): [number, number] {
  const inset = FACE_TILE_INSET / FACE_TILE;
  const col = slot % FACE_ATLAS_COLS;
  const row = Math.floor(slot / FACE_ATLAS_COLS);
  const u = (col + inset + s * (1 - 2 * inset)) / FACE_ATLAS_COLS;
  const v = (row + inset + t * (1 - 2 * inset)) / FACE_ATLAS_ROWS;
  return [u, 1 - v];
}
