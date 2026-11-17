import { toCamera, type SkinBox, type SkinView } from '@/lib/face-skin';
import type { ObjectRecipe } from '@/lib/object-shape';
import { applyTransform, partTransform } from './silhouette-fit';

/**
 * The box a skin spans (VS-T43): a recipe's parts in the camera frame of its front face. Shared by
 * the tour mock (faces cut from the photos) and the furniture teams (PQ-T89, validated drawings).
 */

/** Box of a recipe's parts (no yaw of its own) in the camera frame of `view`: their corners. */
export function recipeBox(recipe: ObjectRecipe, view: SkinView = { yaw: 0, pitch: 0 }): SkinBox {
  const flat = { ...recipe, yaw: undefined };
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of flat.parts) {
    const t = partTransform(flat, p);
    for (const x of [-0.5, 0.5])
      for (const y of [-0.5, 0.5])
        for (const z of [-0.5, 0.5]) {
          const q = toCamera(applyTransform(t, [x, y, z]), view);
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k]!, q[k]!);
            hi[k] = Math.max(hi[k]!, q[k]!);
          }
        }
  }
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return [r(lo[0]!), r(lo[1]!), r(lo[2]!), r(hi[0]!), r(hi[1]!), r(hi[2]!)];
}

/**
 * The skin of a recipe (VS-T43, PQ-T89): its faces atlas, the camera turn of the front face, the
 * parts' box in that frame and each part's piece (layer) name: its concept, else its material.
 */
export function skinOf(
  recipe: ObjectRecipe,
  concepts: ReadonlyArray<string | null | undefined>,
  atlas: string,
  view: SkinView = { yaw: 0, pitch: 0 }
): NonNullable<ObjectRecipe['skin']> {
  return {
    atlas,
    view: { ...view },
    box: [...recipeBox(recipe, view)],
    pieces: recipe.parts.map((p, k) => concepts[k] || p.material || 'painted'),
  };
}
