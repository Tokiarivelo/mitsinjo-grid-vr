import * as THREE from 'three';
import { CAR_SLOTS, carMesh, type CarSlot } from '@/lib/car-mesh';
import type { CarPlan } from '@/lib/car-plan';
import { HULL_SURFACES, type HullSurface } from '@/lib/face-hull';
import type { ObjectRecipe, RecipeMaterial } from '@/lib/object-shape';
import { atlasTexture, groupedGeometry, MATERIAL_COLOR, SELECTED_GLOW } from './face-projection';
import { surfaceMaterial, type Surface } from './surface-look';
import { surfaceTextures } from './surface-textures';

/**
 * A car built from its plan (PQ-T76): `carMesh` as one geometry group per slot, one material per
 * slot. The body wears its drawings under a glossy paint coat, the windows the drawing under glass,
 * the wheel faces the drawn wheels; tyres and the underside are rubber. Without drawings each slot
 * takes the colour measured on them. The operator's surface looks (`faces.surfaces`) win.
 */

/** Paint over the drawings: a lacquered car body, not a matte wall. */
export const CAR_PAINT_ROUGHNESS = 0.38;
export const CAR_PAINT_CLEARCOAT = 0.6;
/** Glass over the drawn windows: smooth and a little reflective. */
export const CAR_GLASS_ROUGHNESS = 0.08;
export const CAR_GLASS_METALNESS = 0.25;
/** Colour of the underside (shadowed rubber and steel). */
export const CAR_UNDER_COLOR = '#1c1d1f';

export type CarRecipe = Pick<ObjectRecipe, 'proportions' | 'faces'> & { car: CarPlan };

const isSurface = (slot: CarSlot): slot is HullSurface =>
  (HULL_SURFACES as readonly string[]).includes(slot);

/** Whether a slot wears the drawings: a body surface the operator did not give a material, glass and rims. */
function drawn(recipe: CarRecipe, slot: CarSlot): boolean {
  if (!recipe.faces) return false;
  if (slot === 'glass' || slot === 'rim') return true;
  return isSurface(slot) && !recipe.faces.surfaces?.[slot]?.material;
}

/** The car as a geometry, one group per `CAR_SLOTS` entry; null without a fitted body. */
export function carGeometry(recipe: CarRecipe): THREE.BufferGeometry | null {
  const { w, h, d } = recipe.proportions;
  const m = carMesh(recipe.car, [w, h, d], recipe.faces ? { views: recipe.faces.views } : {});
  if (!m) return null;
  return groupedGeometry(m.position, m.normal, m.uv, m.slot, CAR_SLOTS.length, (index) =>
    drawn(recipe, CAR_SLOTS[index]!) ? null : { slopes: false }
  );
}

/** What one slot of a car wears: its drawing, or a material in a colour. */
export interface CarSlotLook {
  slot: CarSlot;
  drawn: boolean;
  surface: Surface;
  color: string;
  /** The operator's colour on a drawn slot. */
  tint: string | null;
}

/** The look of every slot, in `CAR_SLOTS` order: shared by the viewer and the Blender export. */
export function carSlotLooks(recipe: CarRecipe): CarSlotLook[] {
  const look = recipe.car.look ?? {};
  const paint = look.paint ?? MATERIAL_COLOR.metal;
  const own: Record<CarSlot, { surface: Surface; color: string }> = {
    roof: { surface: 'metal', color: paint },
    front: { surface: 'metal', color: paint },
    right: { surface: 'metal', color: paint },
    back: { surface: 'metal', color: paint },
    left: { surface: 'metal', color: paint },
    glass: { surface: 'glass', color: look.glass ?? MATERIAL_COLOR.glass },
    tyre: { surface: 'rubber', color: look.tyre ?? MATERIAL_COLOR.rubber },
    rim: { surface: 'metal', color: look.rim ?? MATERIAL_COLOR.metal },
    under: { surface: 'rubber', color: CAR_UNDER_COLOR },
  };
  return CAR_SLOTS.map((slot) => {
    const set = isSurface(slot) ? recipe.faces?.surfaces?.[slot] : undefined;
    return {
      slot,
      drawn: drawn(recipe, slot),
      surface: (set?.material as RecipeMaterial | undefined) ?? own[slot].surface,
      color: set?.color ?? own[slot].color,
      tint: set?.color ?? null,
    };
  });
}

export interface CarMaterialOptions {
  tint?: string | null;
  selected?: { surface: HullSurface; color: string } | null;
  onLoad?: () => void;
}

/** One material per slot, indexed like the groups of `carGeometry`. */
export function carMaterials(
  recipe: CarRecipe,
  { tint = null, selected = null, onLoad }: CarMaterialOptions = {}
): THREE.MeshStandardMaterial[] {
  const atlas = recipe.faces ? atlasTexture(recipe.faces.atlas, onLoad) : null;
  const looks = carSlotLooks(recipe);
  return CAR_SLOTS.map((slot, index) => {
    const slotLook = looks[index]!;
    const color = new THREE.Color(tint ?? '#ffffff');
    const glow =
      selected && selected.surface === slot
        ? { emissive: new THREE.Color(selected.color), emissiveIntensity: SELECTED_GLOW }
        : {};
    if (atlas && slotLook.drawn) {
      if (slotLook.tint) color.multiply(new THREE.Color(slotLook.tint));
      const glass = slot === 'glass';
      return new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        color,
        map: atlas,
        roughness: glass ? CAR_GLASS_ROUGHNESS : CAR_PAINT_ROUGHNESS,
        metalness: glass ? CAR_GLASS_METALNESS : 0,
        clearcoat: slot === 'rim' ? 0 : CAR_PAINT_CLEARCOAT,
        ...glow,
      });
    }
    color.multiply(new THREE.Color(slotLook.color));
    const maps = surfaceTextures(slotLook.surface);
    return surfaceMaterial(slotLook.surface, {
      vertexColors: true,
      color: color.multiplyScalar(maps?.gain ?? 1),
      ...(maps
        ? { map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap }
        : {}),
      ...glow,
    });
  });
}
