import * as THREE from 'three';
import {
  RECIPE_MATERIALS,
  type GlossClass,
  type ObjectRecipe,
  type RecipeMaterial,
} from '@/lib/object-shape';

/** How a material's surface catches the light in the 3D view (three.js standard material). */
export interface SurfaceLook {
  roughness: number;
  metalness: number;
  /** Edge radius of a box part (PR-1.2), object units (largest side = 1): pressed metal soft, cut stone sharp. */
  radius: number;
  /** Clear lacquer layer (PT-3), 0 = none: painted, plastic, tile, glass and metal get a sharp highlight. */
  clearcoat: number;
  clearcoatRoughness: number;
}

/** Every surface of the 3D view: the AI materials, then `painted` for a part with no material. */
export const SURFACES = [...RECIPE_MATERIALS, 'painted'] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * Look per surface. Matte for stone, thatch, leaves; shiny for glass, water, metal. Metalness stays
 * ≤ 0.6 so a metal part keeps its measured colour under the studio light. Edges: rounded most on
 * pressed / moulded surfaces (metal, plastic, rubber), barely on masonry. Clearcoat (PT-3) only on
 * lacquered or glazed surfaces; metal stays fairly rough (0.45) so its highlights are broad streaks.
 */
export const SURFACE_LOOK: Record<Surface, SurfaceLook> = {
  stone: { roughness: 0.95, metalness: 0, radius: 0.01, clearcoat: 0, clearcoatRoughness: 0 },
  brick: { roughness: 0.9, metalness: 0, radius: 0.01, clearcoat: 0, clearcoatRoughness: 0 },
  plaster: { roughness: 0.85, metalness: 0, radius: 0.015, clearcoat: 0, clearcoatRoughness: 0 },
  concrete: { roughness: 0.9, metalness: 0, radius: 0.01, clearcoat: 0, clearcoatRoughness: 0 },
  wood: { roughness: 0.75, metalness: 0, radius: 0.015, clearcoat: 0, clearcoatRoughness: 0 },
  thatch: { roughness: 1, metalness: 0, radius: 0.03, clearcoat: 0, clearcoatRoughness: 0 },
  tile: { roughness: 0.6, metalness: 0, radius: 0.01, clearcoat: 0.3, clearcoatRoughness: 0.3 },
  slate: { roughness: 0.55, metalness: 0.05, radius: 0.008, clearcoat: 0, clearcoatRoughness: 0 },
  metal: { roughness: 0.45, metalness: 0.6, radius: 0.04, clearcoat: 0.4, clearcoatRoughness: 0.2 },
  // Glass: no metalness (PG-T8: at 0.4 it mirrored the dark studio and windows read as holes).
  glass: { roughness: 0.1, metalness: 0, radius: 0.01, clearcoat: 1, clearcoatRoughness: 0.05 },
  plastic: { roughness: 0.4, metalness: 0, radius: 0.03, clearcoat: 0.5, clearcoatRoughness: 0.2 },
  fabric: { roughness: 1, metalness: 0, radius: 0.03, clearcoat: 0, clearcoatRoughness: 0 },
  rubber: { roughness: 0.9, metalness: 0, radius: 0.04, clearcoat: 0, clearcoatRoughness: 0 },
  foliage: { roughness: 0.95, metalness: 0, radius: 0.03, clearcoat: 0, clearcoatRoughness: 0 },
  water: { roughness: 0.1, metalness: 0.2, radius: 0.01, clearcoat: 0, clearcoatRoughness: 0 },
  painted: {
    roughness: 0.6,
    metalness: 0.05,
    radius: 0.02,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
  },
};

/** How far a measured gloss moves a material's roughness and clearcoat (PQ-T26). */
export const GLOSS_SHIFT = 0.2;

/** Metal never turns rougher-than-polished below this roughness (`/designer-3d`: no mirror in a dark studio). */
export const METAL_MIN_ROUGHNESS = 0.45;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Look of a surface with the gloss read on the photo (PQ-T26): matt raises roughness and lowers the clearcoat
 * by `GLOSS_SHIFT`, gloss does the opposite, satin and no measure keep the material's entry. Metal never goes
 * under `METAL_MIN_ROUGHNESS`. Pure.
 */
export function surfaceLook(surface: Surface, gloss?: GlossClass): SurfaceLook {
  const base = SURFACE_LOOK[surface];
  if (!gloss || gloss === 'satin') return base;
  const sign = gloss === 'gloss' ? -1 : 1;
  const floor = surface === 'metal' ? METAL_MIN_ROUGHNESS : 0.05;
  return {
    ...base,
    roughness: clamp(base.roughness + sign * GLOSS_SHIFT, floor, 1),
    clearcoat: clamp(base.clearcoat - sign * GLOSS_SHIFT, 0, 1),
    clearcoatRoughness:
      base.clearcoat > 0 || gloss === 'gloss' ? Math.max(base.clearcoatRoughness, 0.05) : 0,
  };
}

/** Index of a part's surface in `SURFACES` (the geometry group's material index). */
export function surfaceIndex(material?: RecipeMaterial): number {
  return SURFACES.indexOf(material ?? 'painted');
}

/** Materials named on a recipe's parts, once each, in part order (the AI's reading, shown in the panel). */
export function recipeMaterials(recipe: Pick<ObjectRecipe, 'parts'>): RecipeMaterial[] {
  const seen: RecipeMaterial[] = [];
  for (const p of recipe.parts) if (p.material && !seen.includes(p.material)) seen.push(p.material);
  return seen;
}

/**
 * Material of one surface (PT-3): physical (clearcoat layer) only when the surface has a clearcoat, else the
 * cheaper standard material. `params` adds the maps, colour and vertex colours.
 */
export function surfaceMaterial(
  surface: Surface,
  params: THREE.MeshStandardMaterialParameters = {},
  gloss?: GlossClass
): THREE.MeshStandardMaterial {
  const { roughness, metalness, clearcoat, clearcoatRoughness } = surfaceLook(surface, gloss);
  if (clearcoat > 0)
    return new THREE.MeshPhysicalMaterial({
      ...params,
      roughness,
      metalness,
      clearcoat,
      clearcoatRoughness,
    });
  return new THREE.MeshStandardMaterial({ ...params, roughness, metalness });
}
