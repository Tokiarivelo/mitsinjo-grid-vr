import type { Appliance, ApplianceCategory, AppliancePosition } from '@mitsinjo/engine';
import { KIT_ARCHETYPES, type KitArchetype, defaultArchetype } from '@/lib/object-kit';
import type { ObjectRecipe } from '@/lib/object-shape';
import { footprint, sceneScale, type PlacedModel } from '@/stores/placed-models.store';
import { KEEP_OUT_ZONES, type KeepOutZone } from './landscape';

export { type KeepOutZone } from './landscape';

/**
 * Clearing margins per archetype (scene units, PI-T3).
 * Added to the model footprint radius to define the keep-out / clearing zone:
 * `radius = emprise + marge par archétype`.
 */
export const ARCHETYPE_CLEARING_MARGIN: Record<KitArchetype, number> = {
  house: 1.2,
  building: 1.2,
  vehicle: 0.8,
  tree: 0.5,
  bush: 0.4,
  lamp_post: 0.4,
  pole: 0.4,
  tank: 0.6,
  panel: 0.6,
  cabinet: 0.5,
  machine: 0.6,
  screen: 0.4,
  fan: 0.4,
  person: 0.4,
  animal: 0.4,
  water: 0.6,
  other: 0.5,
};

export const DEFAULT_CLEARING_MARGIN = 0.5;

/** Returns the clearing margin in scene units for an archetype or category. */
export function archetypeMargin(archetype?: KitArchetype | ApplianceCategory | string): number {
  if (!archetype) return DEFAULT_CLEARING_MARGIN;
  if ((KIT_ARCHETYPES as readonly string[]).includes(archetype)) {
    return ARCHETYPE_CLEARING_MARGIN[archetype as KitArchetype] ?? DEFAULT_CLEARING_MARGIN;
  }
  const resolved = defaultArchetype(archetype as ApplianceCategory);
  return ARCHETYPE_CLEARING_MARGIN[resolved] ?? DEFAULT_CLEARING_MARGIN;
}

/** Input representation for a placed object when calculating dynamic site zones. */
export interface PlacedZoneItem {
  id?: string;
  x?: number;
  z?: number;
  position?: AppliancePosition | [number, number] | [number, number, number] | null;
  recipe?: ObjectRecipe | null;
  scale?: number;
  yaw?: number;
  archetype?: KitArchetype | ApplianceCategory | string;
  category?: ApplianceCategory;
  /** Explicit radius override (takes precedence if specified). */
  radius?: number;
}

function extractCoords(item: PlacedZoneItem): { x: number; z: number } | null {
  if (
    typeof item.x === 'number' &&
    typeof item.z === 'number' &&
    Number.isFinite(item.x) &&
    Number.isFinite(item.z)
  ) {
    return { x: item.x, z: item.z };
  }
  if (item.position) {
    if (Array.isArray(item.position) && item.position.length >= 2) {
      const x = item.position[0];
      const z = item.position.length >= 3 ? item.position[2] : item.position[1];
      if (
        typeof x === 'number' &&
        typeof z === 'number' &&
        Number.isFinite(x) &&
        Number.isFinite(z)
      ) {
        return { x, z };
      }
    } else if (typeof item.position === 'object' && 'x' in item.position && 'z' in item.position) {
      const { x, z } = item.position;
      if (
        typeof x === 'number' &&
        typeof z === 'number' &&
        Number.isFinite(x) &&
        Number.isFinite(z)
      ) {
        return { x, z };
      }
    }
  }
  return null;
}

/**
 * Computes the keep-out circle for a placed object (PI-T3):
 * `rayon = emprise + marge par archétype`.
 */
export function placedItemZone(item: PlacedZoneItem, index = 0): KeepOutZone | null {
  const coords = extractCoords(item);
  if (!coords) return null;
  const { x, z } = coords;

  const id = item.id ?? `placed:${index}`;

  if (typeof item.radius === 'number' && item.radius > 0) {
    return { x, z, r: item.radius, id };
  }

  const margin = archetypeMargin(item.archetype ?? item.category);

  let emprise = 0.4;
  if (item.recipe) {
    emprise = footprint(
      item.recipe,
      item.scale ?? sceneScale(item.archetype ?? item.category, item.recipe.proportions),
      item.yaw
    ).radius;
  } else if (item.archetype || item.category) {
    const arch = item.archetype ?? (item.category ? defaultArchetype(item.category) : undefined);
    const scale = item.scale ?? sceneScale(arch);
    emprise = Math.max(0.35, scale * 0.45);
  }

  return {
    x,
    z,
    r: emprise + margin,
    id,
  };
}

/**
 * Returns only the dynamic keep-out zones for placed objects (excluding static village zones).
 * Used by tree clearing (PI-T4) and laterite yards (PI-T5).
 */
export function dynamicPlacedZones(placed?: readonly PlacedZoneItem[] | null): KeepOutZone[] {
  if (!placed || placed.length === 0) return [];
  const list: KeepOutZone[] = [];
  placed.forEach((item, i) => {
    const zone = placedItemZone(item, i);
    if (zone) list.push(zone);
  });
  return list;
}

/** An engine line or a scene marker (whose position is the rendered `[x, y, z]`). */
export type ZoneSource = Pick<Appliance, 'id' | 'category'> & {
  position?: PlacedZoneItem['position'];
};

/**
 * Positioned engine lines + their 3D models (if any) → zone inputs. Lines still on the default ring
 * (no position) take no zone; scene markers always have one. Shared by the scene (clearings, yards) and placement (drag, insert, map).
 */
export function applianceZoneItems(
  appliances: readonly ZoneSource[] | undefined,
  models: Readonly<Record<string, PlacedModel>> = {}
): PlacedZoneItem[] {
  if (!appliances?.length) return [];
  return appliances
    .filter((a) => a.position)
    .map((a) => {
      const m = models[a.id];
      return {
        id: a.id,
        position: a.position,
        recipe: m?.recipe,
        scale: m?.scale,
        yaw: m?.yaw,
        archetype: m?.archetype,
        category: a.category,
      };
    });
}

/**
 * Pure dynamic site zones (PI-T3, Rule 2):
 * Single source of truth for "where things cannot be placed":
 * `KEEP_OUT_ZONES` (static buildings, pads, pond) + one circle per placed object.
 * Vegetation, ground, placement and poles all read this function.
 * Positions of the 6 sector buildings never move.
 */
export function siteZones(placed?: readonly PlacedZoneItem[] | null): KeepOutZone[] {
  const staticZones = KEEP_OUT_ZONES;
  const dynamic = dynamicPlacedZones(placed);
  if (dynamic.length === 0) {
    return [...staticZones];
  }
  return [...staticZones, ...dynamic];
}
