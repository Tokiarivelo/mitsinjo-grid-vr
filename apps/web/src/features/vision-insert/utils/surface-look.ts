import * as THREE from 'three';
import {
  RECIPE_MATERIALS,
  type GlossClass,
  type ObjectRecipe,
  type PartKind,
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

/**
 * Surfaces that glow (PQ-T34): not materials the AI names but the look of a part by what it is — a `light` part
 * (lamp, headlight) or a `display` part. Plastic-like and glass-like bodies with an emissive colour.
 */
export const GLOW_SURFACES = ['lamp', 'screen'] as const;
export type GlowSurface = (typeof GLOW_SURFACES)[number];

/** Every surface of the 3D view: the recipe materials (`painted` included, also the look of a part with no material), then the glows. */
export const SURFACES = [...RECIPE_MATERIALS, ...GLOW_SURFACES] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * Look per surface. Matte for stone, thatch, leaves; shiny for glass, water, metal. Metalness is 0 or 1
 * (PQ-T39, PBR metal / roughness workflow): only `metal` (bare metal: galvanised sheet, chrome, aluminium)
 * is 1, its base colour lifted by `liftMetal`; paint, rust and dirt are non-metal (`painted` = metalness 0
 * with a clearcoat). Edges: rounded most on pressed / moulded surfaces (metal, plastic, rubber), barely on
 * masonry. Clearcoat (PT-3) only on lacquered or glazed surfaces; metal stays fairly rough (0.45) so its
 * highlights are broad streaks.
 */
export const SURFACE_LOOK: Record<Surface, SurfaceLook> = {
  stone: { roughness: 0.95, metalness: 0, radius: 0.01, clearcoat: 0, clearcoatRoughness: 0 },
  brick: { roughness: 0.9, metalness: 0, radius: 0.01, clearcoat: 0, clearcoatRoughness: 0 },
  plaster: { roughness: 0.85, metalness: 0, radius: 0.015, clearcoat: 0, clearcoatRoughness: 0 },
  concrete: { roughness: 0.9, metalness: 0, radius: 0.01, clearcoat: 0, clearcoatRoughness: 0 },
  wood: { roughness: 0.75, metalness: 0, radius: 0.015, clearcoat: 0, clearcoatRoughness: 0 },
  thatch: { roughness: 1, metalness: 0, radius: 0.03, clearcoat: 0, clearcoatRoughness: 0 },
  tile: { roughness: 0.6, metalness: 0, radius: 0.01, clearcoat: 0.3, clearcoatRoughness: 0.3 },
  slate: { roughness: 0.55, metalness: 0, radius: 0.008, clearcoat: 0, clearcoatRoughness: 0 },
  metal: { roughness: 0.45, metalness: 1, radius: 0.04, clearcoat: 0.4, clearcoatRoughness: 0.2 },
  // Glass: no metalness (PG-T8: at 0.4 it mirrored the dark studio and windows read as holes).
  glass: { roughness: 0.1, metalness: 0, radius: 0.01, clearcoat: 1, clearcoatRoughness: 0.05 },
  plastic: { roughness: 0.4, metalness: 0, radius: 0.03, clearcoat: 0.5, clearcoatRoughness: 0.2 },
  fabric: { roughness: 1, metalness: 0, radius: 0.03, clearcoat: 0, clearcoatRoughness: 0 },
  rubber: { roughness: 0.9, metalness: 0, radius: 0.04, clearcoat: 0, clearcoatRoughness: 0 },
  foliage: { roughness: 0.95, metalness: 0, radius: 0.03, clearcoat: 0, clearcoatRoughness: 0 },
  water: { roughness: 0.1, metalness: 0, radius: 0.01, clearcoat: 0, clearcoatRoughness: 0 },
  // Glow surfaces (PQ-T34): the same body as plastic / glass, the emissive comes from `GLOW`.
  lamp: { roughness: 0.4, metalness: 0, radius: 0.03, clearcoat: 0.5, clearcoatRoughness: 0.2 },
  screen: { roughness: 0.1, metalness: 0, radius: 0.01, clearcoat: 1, clearcoatRoughness: 0.05 },
  painted: {
    roughness: 0.6,
    metalness: 0,
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

/** Lightest and darkest sRGB channel of the base colour of bare metal (PQ-T39): metal reflects, it is never dark paint. */
export const METAL_BASE_MIN = 180;
export const METAL_BASE_MAX = 255;

/**
 * Base colour of a bare-metal part: each sRGB channel moved into `METAL_BASE_MIN`–`METAL_BASE_MAX` (hue kept in
 * proportion), so metalness 1 does not mirror a dark studio into a black part. Non-metal colours pass through.
 */
export function baseColorFor(surface: Surface, hex: string): string {
  if (surface !== 'metal') return hex;
  const k = (METAL_BASE_MAX - METAL_BASE_MIN) / 255;
  const channel = (i: number) =>
    Math.round(METAL_BASE_MIN + parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Emissive colour and strength of a glow surface, in the viewer (`VIEWER_GLOW_MAX` is the ceiling of the strength). */
export const GLOW: Record<GlowSurface, { color: string; intensity: number }> = {
  lamp: { color: '#ffd9a0', intensity: 0.7 },
  screen: { color: '#bcdcff', intensity: 0.5 },
};
/** The viewer's fixed glow stays under this (a lamp reads as a lamp without blowing out the shot). */
export const VIEWER_GLOW_MAX = 1;

/** Which glow surface a part kind takes, if any (`light` → lamp, `display` → screen). */
export function glowSurfaceFor(kind?: PartKind): GlowSurface | null {
  return kind === 'light' ? 'lamp' : kind === 'display' ? 'screen' : null;
}

/** Index of a part's surface in `SURFACES` (the geometry group's material index): lights and displays glow. */
export function surfaceIndex(material?: RecipeMaterial, kind?: PartKind): number {
  return SURFACES.indexOf(glowSurfaceFor(kind) ?? material ?? 'painted');
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
  gloss?: GlossClass,
  /** Emissive strength override of a glow surface (village: 0 = off, else lit); default `GLOW[surface].intensity`. */
  glow?: number
): THREE.MeshStandardMaterial {
  const { roughness, metalness, clearcoat, clearcoatRoughness } = surfaceLook(surface, gloss);
  const glowing = (GLOW_SURFACES as readonly string[]).includes(surface)
    ? {
        emissive: new THREE.Color(GLOW[surface as GlowSurface].color),
        emissiveIntensity: Math.min(
          VIEWER_GLOW_MAX,
          glow ?? GLOW[surface as GlowSurface].intensity
        ),
      }
    : {};
  params = { ...params, ...glowing };
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
