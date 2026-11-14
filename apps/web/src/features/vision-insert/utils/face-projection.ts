import * as THREE from 'three';
import { HULL_SURFACES, hullMesh, type HullSurface } from '@/lib/face-hull';
import type { FaceSurface, ObjectRecipe, RecipeMaterial } from '@/lib/object-shape';
import { surfaceMaterial } from './surface-look';
import { planarUvs } from './surface-maps';
import { surfaceTextures } from './surface-textures';

/**
 * Model wearing its drawn views (PQ-T70): the silhouette hull of the recipe, each face reading
 * the drawing that looks at it (`lib/face-hull.ts`). Seen from a drawing's side the model is that
 * drawing. Never the photo. One geometry group per surface (`HULL_SURFACES`: roof, then each
 * wall), so the operator can restyle a surface (PQ-T71): tint its drawing or give it a material.
 */

type FacesRecipe = Pick<ObjectRecipe, 'proportions'> & {
  faces: NonNullable<ObjectRecipe['faces']>;
};

/** Colour of a material surface the operator has not coloured yet. */
export const MATERIAL_COLOR: Record<RecipeMaterial, string> = {
  stone: '#9a968e',
  brick: '#a34937',
  plaster: '#e8e2d6',
  concrete: '#b5b5b0',
  wood: '#8a6a48',
  thatch: '#a08552',
  tile: '#b5543a',
  slate: '#4a4f57',
  metal: '#9aa3ab',
  glass: '#9fc3d6',
  plastic: '#d0d3d6',
  fabric: '#b9a58c',
  rubber: '#2e3033',
  foliage: '#4f7a3a',
  water: '#4f8fb0',
};

/** Colour a restyled surface shows: its own, else its material's default; null = the drawing untouched. */
export function surfaceColor(look: FaceSurface | undefined): string | null {
  if (!look) return null;
  return look.color ?? (look.material ? MATERIAL_COLOR[look.material] : null);
}

/**
 * The hull as a geometry: white vertex colours (the atlas or the material is the colour), one
 * group per surface, material index = index in `HULL_SURFACES`. A surface given a material gets
 * the planar uvs of the material patterns instead of its atlas uvs.
 */
export function facesMesh(recipe: FacesRecipe): THREE.BufferGeometry {
  const { w, h, d } = recipe.proportions;
  const m = hullMesh(recipe.faces.hull, [w, h, d], recipe.faces.views);
  const triangles = m.surface.length;
  // Triangles sorted by surface, so each surface is one group.
  const order = Array.from({ length: triangles }, (_, t) => t).sort(
    (a, b) => m.surface[a]! - m.surface[b]! || a - b
  );
  const position = new Float32Array(triangles * 9);
  const normal = new Float32Array(triangles * 9);
  const uv = new Float32Array(triangles * 6);
  order.forEach((t, i) => {
    position.set(m.position.subarray(t * 9, t * 9 + 9), i * 9);
    normal.set(m.normal.subarray(t * 9, t * 9 + 9), i * 9);
    uv.set(m.uv.subarray(t * 6, t * 6 + 6), i * 6);
  });
  const g = new THREE.BufferGeometry();
  let start = 0;
  HULL_SURFACES.forEach((name, index) => {
    let count = 0;
    while (start + count < triangles && m.surface[order[start + count]!] === index) count++;
    if (count) {
      g.addGroup(start * 3, count * 3, index);
      if (recipe.faces.surfaces?.[name]?.material)
        uv.set(
          planarUvs(
            position.subarray(start * 9, (start + count) * 9),
            normal.subarray(start * 9, (start + count) * 9)
          ),
          start * 6
        );
    }
    start += count;
  });
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(position.length).fill(1), 3));
  return g;
}

const cache = new Map<string, THREE.Texture>();

/** The atlas as a texture (cached by URL): sRGB, no mipmaps (tiles never bleed into each other). */
export function atlasTexture(dataUrl: string, onLoad?: () => void): THREE.Texture {
  let t = cache.get(dataUrl);
  if (!t) {
    t = new THREE.TextureLoader().load(dataUrl, () => {
      t!.needsUpdate = true;
      onLoad?.();
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    cache.set(dataUrl, t);
  } else if (onLoad && (t.image as HTMLImageElement | undefined)?.complete) {
    onLoad();
  }
  return t;
}

/** Matte paint: the drawing is the colour, the studio light only shades the volumes. */
export const PROJECTED_ROUGHNESS = 0.85;
/**
 * Relief read on the drawing itself (PQ-T71): dark areas (glass, openings, joints) sit back, pale
 * ones (frames, sills) stand out under the light. Lighting only, the hull keeps its faces flat.
 */
export const PROJECTED_BUMP = 1.2;
/** Glow of the surface selected in the editor. */
export const SELECTED_GLOW = 0.28;

export interface FaceMaterialOptions {
  /** Tint multiplied over every surface (display tweak); null = none. */
  tint?: string | null;
  /** Surface highlighted as selected, with the glow colour. */
  selected?: { surface: HullSurface; color: string } | null;
  /** Called when the atlas has loaded (`frameloop="demand"`). */
  onLoad?: () => void;
}

/**
 * One material per surface, indexed like the groups of `facesMesh`: the atlas (tinted by the
 * surface's colour when it has one) or, for a surface given a material, that material with its
 * relief patterns in the surface's colour.
 */
export function faceMaterials(
  faces: FacesRecipe['faces'],
  { tint = null, selected = null, onLoad }: FaceMaterialOptions = {}
): THREE.MeshStandardMaterial[] {
  const atlas = atlasTexture(faces.atlas, onLoad);
  return HULL_SURFACES.map((name) => {
    const look = faces.surfaces?.[name];
    const color = new THREE.Color(tint ?? '#ffffff');
    const own = surfaceColor(look);
    if (own) color.multiply(new THREE.Color(own));
    const glow =
      selected?.surface === name
        ? { emissive: new THREE.Color(selected.color), emissiveIntensity: SELECTED_GLOW }
        : {};
    if (look?.material) {
      const maps = surfaceTextures(look.material);
      return surfaceMaterial(look.material, {
        vertexColors: true,
        color: color.multiplyScalar(maps?.gain ?? 1),
        ...(maps
          ? { map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap }
          : {}),
        ...glow,
      });
    }
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      color,
      map: atlas,
      bumpMap: atlas,
      bumpScale: PROJECTED_BUMP,
      roughness: PROJECTED_ROUGHNESS,
      metalness: 0,
      ...glow,
    });
  });
}
