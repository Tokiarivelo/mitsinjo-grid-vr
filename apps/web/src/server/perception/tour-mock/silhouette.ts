import type { PartSpec, TourPartsSpec } from './spec';
import { resolveSilhouettes, silhouetteRing, type OutlineBox } from '../furniture/silhouette';

/** Outline helpers of the tour mock (VS-T42): the shared ones (`furniture/silhouette.ts`) and the plant fallback. */
export * from '../furniture/silhouette';

type Pt = readonly [number, number];

/**
 * The plant fallback (VS-T42): when the tree reconstructor misreads a photo (sky through a sparse
 * crown, a leaning trunk), the plant as its outline: crown down to `split`, trunk below it.
 */
export function silhouettePlant(
  rings: ReadonlyArray<ReadonlyArray<Pt>>,
  box: OutlineBox,
  pixelAspect: number,
  split = 0.8
): TourPartsSpec | null {
  const crown = silhouetteRing(rings, box, pixelAspect, [0, split]);
  const trunk = silhouetteRing(rings, box, pixelAspect, [split, 1]);
  if (!crown) return null;
  const h = 1;
  const parts: PartSpec[] = [
    {
      shape: 'box',
      at: [0, h * (1 - split / 2), 0],
      size: [1, h * split, crown.aspect * h * split * 0.7],
      color: '#4f6a3a',
      material: 'foliage',
      kind: 'crown',
      concept: 'foliage',
      silhouette: { band: [0, split] },
    },
  ];
  if (trunk)
    parts.push({
      shape: 'box',
      at: [0, (h * (1 - split)) / 2, 0],
      size: [1, h * (1 - split), Math.min(trunk.aspect, 0.4) * h * (1 - split)],
      color: '#5b4a3a',
      material: 'wood',
      kind: 'trunk',
      concept: 'tree_trunk',
      silhouette: { band: [split, 1] },
    });
  return resolveSilhouettes<TourPartsSpec>({ kind: 'parts', parts }, rings, box, pixelAspect);
}
