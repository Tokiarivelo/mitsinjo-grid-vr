import * as THREE from 'three';
import {
  PLANT_SLOTS,
  PLANT_TWO_SIDED,
  plantMesh,
  plantSlotColors,
  type PlantSlot,
} from '@/lib/plant-mesh';
import type { PlantPlan } from '@/lib/plant-plan';
import type { ObjectRecipe } from '@/lib/object-shape';
import { atlasTexture, groupedGeometry, SELECTED_GLOW } from './face-projection';
import { surfaceMaterial, type Surface } from './surface-look';
import { surfaceTextures } from './surface-textures';

/**
 * A plant built from its plan (PQ-T82): `plantMesh` as one geometry group per slot, one material
 * per slot. With its skin, every slot wears the validated front drawing projected from the front
 * (its leaves, light and colours); without, trunks and limbs wear bark (wood), the leaves foliage
 * in the two greens measured on the drawing, the flowers their colour. Leaves, strands and cards are thin: their materials draw both
 * sides (`PLANT_TWO_SIDED`). Green stems (cactus, bamboo, banana) wear the leaf colour.
 */

export type PlantRecipe = Pick<ObjectRecipe, 'proportions' | 'pieces'> & { plant: PlantPlan };

/** The shaded leaves wearing the drawing: a little darker, for depth. */
const SKIN_SHADE = 0.82;
/** Planar texture scale on the bark and the leaves: a few repeats over a model. */
const PLANT_UV_SCALE = 2;

/** The plant as a geometry, one group per `PLANT_SLOTS` entry. */
export function plantGeometry(recipe: PlantRecipe): THREE.BufferGeometry {
  const { w, h, d } = recipe.proportions;
  const m = plantMesh(recipe.plant, [w, h, d]);
  // With its skin the plant keeps the front projection; else each slot gets planar uvs for its
  // surface's texture.
  const skin = Boolean(recipe.plant.skin);
  return groupedGeometry(m.position, m.normal, m.uv, m.slot, PLANT_SLOTS.length, () =>
    skin ? null : { slopes: true, scale: PLANT_UV_SCALE }
  );
}

/** What one slot of a plant wears. */
export interface PlantSlotLook {
  slot: PlantSlot;
  surface: Surface;
  color: string;
  twoSided: boolean;
}

/** Surface of each slot: a glazed or terracotta pot and its earth (VS-T25) are solids, not leaves. */
const SLOT_SURFACE: Record<PlantSlot, Surface> = {
  bark: 'wood',
  leaf: 'foliage',
  leafDark: 'foliage',
  flower: 'foliage',
  pot: 'tile',
  soil: 'stone',
};

/** The look of every slot, in `PLANT_SLOTS` order: shared by the viewer and the Blender export. */
export function plantSlotLooks(recipe: PlantRecipe): PlantSlotLook[] {
  const colors = plantSlotColors(recipe.plant);
  return PLANT_SLOTS.map((slot) => ({
    slot,
    surface: SLOT_SURFACE[slot],
    color: colors[slot],
    twoSided: PLANT_TWO_SIDED.has(slot),
  }));
}

export interface PlantMaterialOptions {
  tint?: string | null;
  /** The slot the operator picked in the 3D Studio, glowing. */
  selected?: { surface: string; color: string } | null;
  onLoad?: () => void;
}

/** One material per slot, indexed like the groups of `plantGeometry`. */
export function plantMaterials(
  recipe: PlantRecipe,
  { tint = null, selected = null, onLoad }: PlantMaterialOptions = {}
): THREE.MeshStandardMaterial[] {
  const skin = recipe.plant.skin ? atlasTexture(recipe.plant.skin, onLoad) : null;
  return plantSlotLooks(recipe).map((look) => {
    const glow =
      selected && selected.surface === look.slot
        ? { emissive: new THREE.Color(selected.color), emissiveIntensity: SELECTED_GLOW }
        : {};
    const side = look.twoSided ? THREE.DoubleSide : THREE.FrontSide;
    if (skin) {
      // The drawing itself; the inner, shaded leaves a little darker for depth.
      const color = new THREE.Color(tint ?? '#ffffff').multiplyScalar(
        look.slot === 'leafDark' ? SKIN_SHADE : 1
      );
      return surfaceMaterial(look.surface, { vertexColors: true, color, map: skin, side, ...glow });
    }
    const maps = surfaceTextures(look.surface);
    const color = new THREE.Color(tint ?? '#ffffff')
      .multiply(new THREE.Color(look.color))
      .multiplyScalar(maps?.gain ?? 1);
    return surfaceMaterial(look.surface, {
      vertexColors: true,
      color,
      side,
      ...(maps
        ? { map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap }
        : {}),
      ...glow,
    });
  });
}
