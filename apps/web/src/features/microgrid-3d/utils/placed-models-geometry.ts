import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SectorId } from '@mitsinjo/engine';
import type { KitArchetype } from '@/lib/object-kit';
import type { ObjectRecipe } from '@/lib/object-shape';
import { facesMesh } from '@/features/vision-insert/utils/face-projection';
import { recipeMesh, triangleCount } from '@/features/vision-insert/utils/object-geometry';
import { terrainHeight } from './landscape';
import { TOKEN_HEX } from './scene-palette';
import { footprint, sceneScale } from '@/stores/placed-models.store';

export interface PlacedModelItem {
  id: string;
  sector: SectorId;
  running: boolean;
  position: [number, number, number];
  recipe: ObjectRecipe;
  scale?: number;
  yaw?: number;
  archetype?: KitArchetype;
}

export interface PlacedPlinth {
  position: [number, number, number];
  size: [number, number, number];
}

export interface PlacedModelsGeometryResult {
  /** Single merged geometry for all placed models (1 draw call). Null if empty. */
  modelsGeometry: THREE.BufferGeometry | null;
  /** Concrete plinths under models on sloped ground. */
  plinths: PlacedPlinth[];
  /** Heights and footprint radius per model id (for tag positioning and click bounds). */
  modelBounds: Record<string, { height: number; radius: number }>;
  /** Models that wear their drawings (PQ-T71): drawn one by one, outside the merged mesh. */
  drawn: PlacedDrawnModel[];
}

/** One model drawn with its own drawings: where it stands and how its feeder state tints it. */
export interface PlacedDrawnModel {
  id: string;
  recipe: ObjectRecipe & { faces: NonNullable<ObjectRecipe['faces']> };
  position: [number, number, number];
  scale: number;
  yaw: number;
  state: 'served' | 'unserved' | 'fire';
}

/**
 * Most models drawn with their drawings (one draw call and one texture each, high tier only);
 * the next ones, and every model on the low tier, stay in the merged flat-colour mesh.
 */
export const PLACED_DRAWN_MAX = 8;

export interface SectorStateOverride {
  unserved?: boolean;
  onFire?: boolean;
}

/** Triangles the low tier spends on placed models (budget 150 k for the whole scene). */
export const PLACED_LOW_TRIANGLES = 40_000;

/** The model as one box of its main colour, same bounds and yaw (low-tier fallback). */
function boxRecipe(recipe: ObjectRecipe): ObjectRecipe {
  const main = recipe.parts[0];
  return {
    ...recipe,
    parts: [
      {
        shape: 'box',
        at: [0, 0, 0],
        size: [1, 1, 1],
        color: main?.color ?? TOKEN_HEX.idle,
        ...(main?.material ? { material: main.material } : {}),
      },
    ],
  };
}

/** Ground height difference over the footprint above which the model stands on a plinth. */
export const PLINTH_SLOPE_MIN = 0.04;
/** Plinth sinks this far below the lowest ground point (no gap on the downhill side). */
const PLINTH_SINK = 0.04;

/**
 * Builds a single merged BufferGeometry for all placed models (PI-T2):
 * - Reuses `recipeMesh` from vision-insert (no code duplication).
 * - Sits on `terrainHeight` at the lowest point of the footprint (plinth if slope).
 * - Applies departure states (dimmed if unserved/delested, fiery tint if sector on fire).
 * - Merges into ONE BufferGeometry (≤ +2 draw calls budget for up to 30 objects).
 * - Tier `low`: light assemblies, a box per model only past `PLACED_LOW_TRIANGLES`.
 */
export function buildPlacedModelsGeometry(
  items: readonly PlacedModelItem[],
  sectorStatus?: Partial<Record<SectorId, SectorStateOverride>>,
  tier: 'high' | 'low' = 'high'
): PlacedModelsGeometryResult {
  if (items.length === 0) {
    return { modelsGeometry: null, plinths: [], modelBounds: {}, drawn: [] };
  }

  const plinths: PlacedPlinth[] = [];
  const modelBounds: Record<string, { height: number; radius: number }> = {};
  const geometriesToMerge: THREE.BufferGeometry[] = [];
  const drawn: PlacedDrawnModel[] = [];
  let lowTriangles = 0;

  for (const item of items) {
    const effScale = item.scale ?? sceneScale(item.archetype, item.recipe.proportions);
    const effYaw = item.yaw ?? item.recipe.yaw ?? 0;
    const fp = footprint(item.recipe, effScale, effYaw);

    const x = item.position[0];
    const z = item.position[2];

    // Sample terrain height at center and footprint corners
    const hCenter = terrainHeight(x, z);
    const h1 = terrainHeight(x + fp.box.minX, z + fp.box.minZ);
    const h2 = terrainHeight(x + fp.box.maxX, z + fp.box.minZ);
    const h3 = terrainHeight(x + fp.box.maxX, z + fp.box.maxZ);
    const h4 = terrainHeight(x + fp.box.minX, z + fp.box.maxZ);

    const baseH = Math.min(hCenter, h1, h2, h3, h4);
    const maxH = Math.max(hCenter, h1, h2, h3, h4);
    const slope = maxH - baseH;

    // On a slope, a plinth fills from the lowest point to the highest and the model stands on top,
    // so the uphill ground never pokes through the model.
    let restY = baseH;
    if (slope > PLINTH_SLOPE_MIN) {
      const bottom = baseH - PLINTH_SINK;
      plinths.push({
        position: [x, (bottom + maxH) / 2, z],
        size: [fp.box.width + 0.1, maxH - bottom, fp.box.depth + 0.1],
      });
      restY = maxH;
    }

    const recipeWithYaw =
      item.yaw !== undefined && item.yaw !== item.recipe.yaw
        ? { ...item.recipe, yaw: item.yaw }
        : item.recipe;
    // The model's own shape on both tiers (a lamp post stays a lamp post); the low tier takes the
    // light assemblies and, past its budget, a coloured box for the remaining models.
    const faces =
      tier === 'high' && drawn.length < PLACED_DRAWN_MAX ? item.recipe.faces : undefined;
    let g = faces
      ? facesMesh({ proportions: item.recipe.proportions, faces }).rotateY(effYaw)
      : recipeMesh(recipeWithYaw, tier === 'low' ? 'low' : 'full');
    if (tier === 'low') {
      const tris = triangleCount(g);
      if (lowTriangles + tris > PLACED_LOW_TRIANGLES) {
        g.dispose();
        g = recipeMesh(boxRecipe(recipeWithYaw));
      }
      lowTriangles += triangleCount(g);
    }
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const bottomY = bb ? bb.min.y : 0;
    const rawHeight = bb ? bb.max.y - bb.min.y : item.recipe.proportions.h;
    const finalHeight = rawHeight * effScale;

    modelBounds[item.id] = {
      height: finalHeight,
      radius: fp.radius,
    };

    // Apply feeder / departure states to vertex colors
    const sec = sectorStatus?.[item.sector];
    const onFire = sec?.onFire ?? false;
    // Dimmed when the sector is unserved or the appliance draws nothing now (same as the box markers).
    const unserved = (sec?.unserved ?? false) || !item.running;

    if (faces) {
      // Wears its drawings: its own mesh and texture, same place, same bounds.
      drawn.push({
        id: item.id,
        recipe: { ...item.recipe, faces },
        position: [x, restY - bottomY * effScale, z],
        scale: effScale,
        yaw: effYaw,
        state: onFire ? 'fire' : unserved ? 'unserved' : 'served',
      });
      g.dispose();
      continue;
    }

    g.scale(effScale, effScale, effScale);
    // Translate so the bottom of the model rests on the ground (or its plinth)
    g.translate(x, restY - bottomY * effScale, z);

    const colorAttr = g.getAttribute('color');
    if (colorAttr) {
      for (let j = 0; j < colorAttr.count; j++) {
        let r = colorAttr.getX(j);
        let gr = colorAttr.getY(j);
        let b = colorAttr.getZ(j);

        if (onFire) {
          // Fiery / burnt amber-red alert tint
          r = Math.min(1, r * 1.5 + 0.3);
          gr = gr * 0.35;
          b = b * 0.25;
        } else if (unserved) {
          // Unpowered / darkened lights out
          r = r * 0.45;
          gr = gr * 0.45;
          b = b * 0.45;
        }
        colorAttr.setXYZ(j, r, gr, b);
      }
      colorAttr.needsUpdate = true;
    }

    geometriesToMerge.push(g);
  }

  const merged = geometriesToMerge.length
    ? (mergeGeometries(geometriesToMerge, false) ?? null)
    : null;
  for (const g of geometriesToMerge) g.dispose();

  return {
    modelsGeometry: merged,
    plinths,
    modelBounds,
    drawn,
  };
}

/** Stable signature of everything `buildPlacedModelsGeometry` reads (recipes are replaced, never mutated). */
export function placedGeometryKey(
  items: readonly PlacedModelItem[],
  sectorStatuses: Partial<Record<SectorId, SectorStateOverride>> | undefined,
  tier: 'high' | 'low'
): string {
  const sectors = new Set(items.map((i) => i.sector));
  const status = [...sectors]
    .sort()
    .map(
      (id) =>
        `${id}:${sectorStatuses?.[id]?.unserved ? 1 : 0}${sectorStatuses?.[id]?.onFire ? 1 : 0}`
    )
    .join(',');
  const parts = items.map(
    (i) =>
      `${i.id}@${i.position.join(',')}:${i.running ? 1 : 0}:${i.scale ?? ''}:${i.yaw ?? ''}:${i.archetype ?? ''}:${recipeId(i.recipe)}`
  );
  return `${tier}|${status}|${parts.join(';')}`;
}

/** Identity tag per recipe object, so a new recipe for the same appliance changes the key. */
const recipeIdMap = new WeakMap<object, number>();
let nextRecipeId = 0;
function recipeId(recipe: object): number {
  let id = recipeIdMap.get(recipe);
  if (id === undefined) {
    id = ++nextRecipeId;
    recipeIdMap.set(recipe, id);
  }
  return id;
}
