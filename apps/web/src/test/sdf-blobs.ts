import type { ObjectRecipe, RecipePart, SdfBlob } from '@/lib/object-shape';

/**
 * Shared SDF test unions (PQ-T53 §8): extent-legal blob lists (each blob's outer box + k
 * stays in unit space) with pinned triangle counts, so viewer, judge and fit tests read
 * the same bodies. Counts: BALL 2648, BOTTLE 1520, PERSON 1192 at 24³; SLABS steps down
 * to 16³ (1800).
 */
export const SDF_BALL: SdfBlob[] = [{ kind: 'sphere', c: [0, 0, 0], r: 0.35 }];

export const SDF_BOTTLE: SdfBlob[] = [
  { kind: 'capsule', c: [0, -0.1, 0], axis: 'y', halfLen: 0.2, r: 0.18 },
  { kind: 'capsule', c: [0, 0.28, 0], axis: 'y', halfLen: 0.08, r: 0.07, k: 0.03 },
  { kind: 'box', c: [0, 0.4, 0], size: [0.12, 0.08, 0.12], r: 0.02, k: 0.02 },
];

export const SDF_PERSON: SdfBlob[] = [
  { kind: 'ellipsoid', c: [0, -0.02, 0], radii: [0.14, 0.2, 0.1] },
  { kind: 'sphere', c: [0, 0.3, 0], r: 0.1, k: 0.04 },
  { kind: 'capsule', c: [-0.17, -0.02, 0], axis: 'y', halfLen: 0.14, r: 0.045, k: 0.04 },
  { kind: 'capsule', c: [0.17, -0.02, 0], axis: 'y', halfLen: 0.14, r: 0.045, k: 0.04 },
  { kind: 'capsule', c: [-0.07, -0.3, 0], axis: 'y', halfLen: 0.1, r: 0.05, k: 0.04 },
  { kind: 'capsule', c: [0.07, -0.3, 0], axis: 'y', halfLen: 0.1, r: 0.05, k: 0.04 },
  { kind: 'sphere', c: [0, 0.3, 0.09], r: 0.045, k: 0.02 },
];

/** Adversarial: 12 thin slabs, far past the per-part cap at 24³. */
export const SDF_SLABS: SdfBlob[] = Array.from(
  { length: 12 },
  (_, i) =>
    ({
      kind: 'box',
      c: [0, -0.46 + i * 0.084, 0],
      size: [0.7, 0.08, 0.7],
      r: 0.01,
    }) as SdfBlob
);

/** One `sdf` recipe part around the blobs. */
export const sdfPart = (blobs: SdfBlob[], over: Partial<RecipePart> = {}): RecipePart => ({
  shape: 'sdf',
  at: [0, 0, 0],
  size: [1, 1, 1],
  color: '#c08040',
  blobs,
  ...over,
});

/** One-part `sdf` recipe (unit proportions unless given). */
export const sdfRecipe = (
  blobs: SdfBlob[],
  proportions: ObjectRecipe['proportions'] = { w: 1, h: 1, d: 1 }
): ObjectRecipe => ({ proportions, parts: [sdfPart(blobs)] });
