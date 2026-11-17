import * as THREE from 'three';
import { skinUvs } from '@/lib/face-skin';
import { MAX_TRIANGLES, type ObjectRecipe } from '@/lib/object-shape';
import { atlasTexture, SELECTED_GLOW } from './face-projection';
import { buildMesh, triangleCount } from './object-geometry';
import { surfaceMaterial, SURFACES, type Surface } from './surface-look';

/**
 * Parts wearing their 2D faces (VS-T43, 360° tour mock): the recipe's own parts (rounded boxes,
 * turned profiles, cushions…), one geometry group per piece (`skin.pieces`: seat, leg, cushion…),
 * every surface reading its face tile from the atlas (`lib/face-skin.ts`). The pieces are the 3D
 * Studio's layers. Each piece keeps the sheen of its material (glass shines, fabric stays matte);
 * the faces are the colour.
 */

export type SkinRecipe = ObjectRecipe & { skin: NonNullable<ObjectRecipe['skin']> };

/** Most a skinned surface may look like metal: its face already shows its reflections. */
export const SKIN_METALNESS_MAX = 0.25;

/** The piece names of a skinned model, in order of first part. */
export function skinPieceNames(skin: Pick<SkinRecipe['skin'], 'pieces'>): string[] {
  return [...new Set(skin.pieces)];
}

/** The material surface of each piece: that of its first part. */
export function skinPieceSurfaces(recipe: SkinRecipe): Surface[] {
  return skinPieceNames(recipe.skin).map((name) => {
    const k = recipe.skin.pieces.indexOf(name);
    return recipe.parts[k]?.material ?? 'painted';
  });
}

/** The skinned model as a geometry: one group per piece (material index = piece), atlas uvs, white colours. */
export function skinGeometry(recipe: SkinRecipe): THREE.BufferGeometry {
  const names = skinPieceNames(recipe.skin);
  const flat: ObjectRecipe = { ...recipe, yaw: undefined };
  const slotOf = (origin: number) => Math.max(0, names.indexOf(recipe.skin.pieces[origin] ?? ''));
  let g = buildMesh(flat, 'full', slotOf);
  if (triangleCount(g) > MAX_TRIANGLES) {
    g.dispose();
    g = buildMesh(flat, 'low', slotOf);
  }
  const soup = g.index ? g.toNonIndexed() : g;
  if (soup !== g) g.dispose();
  const position = soup.getAttribute('position').array;
  const normal = soup.getAttribute('normal').array;
  soup.setAttribute(
    'uv',
    new THREE.BufferAttribute(
      skinUvs(position, normal, recipe.skin.box, recipe.skin.view, recipe.skin.mode),
      2
    )
  );
  soup.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(position.length).fill(1), 3)
  );
  return soup;
}

export interface SkinMaterialOptions {
  tint?: string | null;
  /** The piece the operator picked in the 3D Studio, glowing. */
  selected?: { surface: string; color: string } | null;
  onLoad?: () => void;
}

/** One material per piece, indexed like the groups of `skinGeometry`: the atlas with the piece's sheen. */
export function skinMaterials(
  recipe: SkinRecipe,
  { tint = null, selected = null, onLoad }: SkinMaterialOptions = {}
): THREE.MeshStandardMaterial[] {
  const atlas = atlasTexture(recipe.skin.atlas, onLoad);
  const names = skinPieceNames(recipe.skin);
  return skinPieceSurfaces(recipe).map((surface, i) => {
    const glow =
      selected && selected.surface === names[i]
        ? { emissive: new THREE.Color(selected.color), emissiveIntensity: SELECTED_GLOW }
        : {};
    const m = surfaceMaterial(SURFACES.includes(surface) ? surface : 'painted', {
      vertexColors: true,
      color: new THREE.Color(tint ?? '#ffffff'),
      map: atlas,
      ...glow,
    });
    m.metalness = Math.min(m.metalness, SKIN_METALNESS_MAX);
    return m;
  });
}
