import * as THREE from 'three';
import { HULL_SURFACES, type HullSurface } from '@/lib/face-hull';
import { HOUSE_SLOTS, houseMesh, type HouseSlot } from '@/lib/house-mesh';
import type { HousePlan, HouseSwatch } from '@/lib/house-plan';
import type { ObjectRecipe, RecipeMaterial } from '@/lib/object-shape';
import {
  atlasTexture,
  groupedGeometry,
  PROJECTED_BUMP,
  PROJECTED_ROUGHNESS,
  SELECTED_GLOW,
} from './face-projection';
import { MAP_TILE } from './surface-maps';
import { surfaceMaterial, type Surface } from './surface-look';
import { surfaceTextures } from './surface-textures';

/**
 * A house built from its specialist's plan (PQ-T72): `houseMesh` as one geometry group per slot,
 * and one material per slot. The roof shows the plan's covering; each wall wears its drawing
 * where a drawing sees it (the plan's wall material without a drawing); frames, glass, doors and
 * decks take the plan's colours. The operator's surface looks (`faces.surfaces`) win.
 */

/**
 * Pattern repeats on a house: the model's largest side is a whole house (≈ 10 m), so bricks,
 * tiles and boards are drawn this many times smaller than on an object part.
 */
export const HOUSE_PATTERN_SCALE = 3;

/** Metal of a house (roofing sheets, flashing): painted steel, barely metallic. */
export const PAINTED_SHEET_METALNESS = 0.15;
export const PAINTED_SHEET_ROUGHNESS = 0.55;

type HouseRecipe = Pick<ObjectRecipe, 'proportions' | 'faces'> & { house: HousePlan };

const isSurface = (slot: HouseSlot): slot is HullSurface =>
  (HULL_SURFACES as readonly string[]).includes(slot);

const WALL_SLOTS: ReadonlySet<HouseSlot> = new Set(['front', 'right', 'back', 'left', 'wall']);

/** The drawing's swatch a slot repeats (walls, roof), unless the operator chose a material. */
function swatchOf(recipe: HouseRecipe, slot: HouseSlot): HouseSwatch | null {
  const swatches = recipe.house.look.swatches;
  const set = isSurface(slot) ? recipe.faces?.surfaces?.[slot] : undefined;
  if (set?.material || set?.drawing) return null;
  if (slot === 'roof') return swatches?.roof ?? null;
  return WALL_SLOTS.has(slot) ? (swatches?.wall ?? null) : null;
}

/**
 * Whether a slot shows the whole atlas: a surface the operator set to drawing, or a wall with
 * drawings when no swatch of it was cut (a swatch repeated reads cleaner than the whole drawing,
 * whose windows and roofs would be painted on the wall).
 */
function drawn(recipe: HouseRecipe, slot: HouseSlot): boolean {
  if (!recipe.faces || !isSurface(slot)) return false;
  const look = recipe.faces.surfaces?.[slot];
  if (look?.material) return false;
  if (slot === 'roof') return Boolean(look?.drawing) && recipe.faces.views.includes('top');
  return Boolean(look?.drawing) || !recipe.house.look.swatches?.wall;
}

const swatchCache = new Map<string, THREE.Texture>();

/** A swatch as a texture, mirrored at each repeat so its edges meet without a seam. */
function swatchMap(image: string, onLoad?: () => void): THREE.Texture {
  let t = swatchCache.get(image);
  if (!t) {
    t = new THREE.TextureLoader().load(image, () => {
      t!.needsUpdate = true;
      onLoad?.();
    });
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    swatchCache.set(image, t);
  } else if (onLoad && (t.image as HTMLImageElement | undefined)?.complete) onLoad();
  return t;
}

/** The house as a geometry: one group per `HOUSE_SLOTS` entry, planar uvs on material slots. */
export function houseGeometry(recipe: HouseRecipe): THREE.BufferGeometry {
  const { w, h, d } = recipe.proportions;
  const m = houseMesh(recipe.house, [w, h, d], {
    ...(recipe.faces ? { views: recipe.faces.views } : {}),
  });
  return groupedGeometry(m.position, m.normal, m.uv, m.slot, HOUSE_SLOTS.length, (index) => {
    const slot = HOUSE_SLOTS[index]!;
    if (drawn(recipe, slot)) return null;
    const swatch = swatchOf(recipe, slot);
    // A swatch repeats at its own size on the drawing; a material pattern at the house's scale.
    return {
      slopes: slot === 'roof',
      scale: swatch ? MAP_TILE / Math.max(swatch.size * w, 1e-3) : HOUSE_PATTERN_SCALE,
    };
  });
}

export interface HouseMaterialOptions {
  tint?: string | null;
  selected?: { surface: HullSurface; color: string } | null;
  onLoad?: () => void;
}

/** What one slot of a house wears: its drawing, or a material in a colour. */
export interface HouseSlotLook {
  slot: HouseSlot;
  /** The slot shows the atlas (tinted by `tint`). */
  drawn: boolean;
  /** Material and colour when it does not (the plan's look, the operator's look winning). */
  surface: Surface;
  color: string;
  /** The operator's colour on a drawn slot. */
  tint: string | null;
  /** The drawing's swatch repeated on the slot (walls, roof). */
  swatch: HouseSwatch | null;
}

/** The look of every slot, in `HOUSE_SLOTS` order: shared by the viewer and the Blender export. */
export function houseSlotLooks(recipe: HouseRecipe): HouseSlotLook[] {
  const { look } = recipe.house;
  const own: Record<HouseSlot, { surface: Surface; color: string }> = {
    roof: { surface: look.roof.material, color: look.roof.color },
    front: { surface: look.wall.material, color: look.wall.color },
    right: { surface: look.wall.material, color: look.wall.color },
    back: { surface: look.wall.material, color: look.wall.color },
    left: { surface: look.wall.material, color: look.wall.color },
    wall: { surface: look.wall.material, color: look.wall.color },
    trim: { surface: 'painted', color: look.trim },
    glass: { surface: 'glass', color: look.glass },
    door: { surface: 'wood', color: look.door },
    base: { surface: 'concrete', color: look.base },
  };
  return HOUSE_SLOTS.map((slot) => {
    const set = isSurface(slot) ? recipe.faces?.surfaces?.[slot] : undefined;
    return {
      slot,
      drawn: drawn(recipe, slot),
      surface: (set?.material as RecipeMaterial | undefined) ?? own[slot].surface,
      color: set?.color ?? own[slot].color,
      tint: set?.color ?? null,
      swatch: swatchOf(recipe, slot),
    };
  });
}

/** One material per slot, indexed like the groups of `houseGeometry`. */
export function houseMaterials(
  recipe: HouseRecipe,
  { tint = null, selected = null, onLoad }: HouseMaterialOptions = {}
): THREE.MeshStandardMaterial[] {
  const atlas = recipe.faces ? atlasTexture(recipe.faces.atlas, onLoad) : null;
  const looks = houseSlotLooks(recipe);
  return HOUSE_SLOTS.map((slot, index) => {
    const slotLook = looks[index]!;
    const color = new THREE.Color(tint ?? '#ffffff');
    const glow =
      selected && selected.surface === slot
        ? { emissive: new THREE.Color(selected.color), emissiveIntensity: SELECTED_GLOW }
        : {};
    if (atlas && slotLook.drawn) {
      if (slotLook.tint) color.multiply(new THREE.Color(slotLook.tint));
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
    }
    if (slotLook.swatch) {
      if (slotLook.tint) color.multiply(new THREE.Color(slotLook.tint));
      const m = new THREE.MeshStandardMaterial({
        vertexColors: true,
        color,
        map: swatchMap(slotLook.swatch.image, onLoad),
        roughness: PROJECTED_ROUGHNESS,
        metalness: 0,
        ...glow,
      });
      if (slot === 'roof') m.side = THREE.DoubleSide;
      return m;
    }
    const { surface } = slotLook;
    color.multiply(new THREE.Color(slotLook.color));
    const maps = surfaceTextures(surface);
    const m = surfaceMaterial(surface, {
      vertexColors: true,
      color: color.multiplyScalar(maps?.gain ?? 1),
      ...(maps
        ? { map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap }
        : {}),
      ...glow,
    });
    // Seen from under the eaves, the roof shows its covering, not the sky.
    if (slot === 'roof') m.side = THREE.DoubleSide;
    // Roofing sheets are painted: they keep their colour instead of mirroring the studio.
    if (surface === 'metal') {
      m.metalness = PAINTED_SHEET_METALNESS;
      m.roughness = PAINTED_SHEET_ROUGHNESS;
      if (m instanceof THREE.MeshPhysicalMaterial) m.clearcoat = 0;
    }
    return m;
  });
}

/** The look each editable surface has before the operator touches it (the surface editor's base). */
export function houseBaseLooks(
  plan: HousePlan,
  withDrawings: boolean
): Partial<Record<HullSurface, { material: RecipeMaterial; color: string }>> {
  const wall = { material: plan.look.wall.material, color: plan.look.wall.color };
  return {
    roof: { material: plan.look.roof.material, color: plan.look.roof.color },
    // Walls wearing the whole drawing have no material base; a swatch stands for the material.
    ...(withDrawings && !plan.look.swatches?.wall
      ? {}
      : { front: wall, right: wall, back: wall, left: wall }),
  };
}
