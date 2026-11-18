import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SectorId } from '@mitsinjo/engine';
import type { KitArchetype } from '@/lib/object-kit';
import type { ObjectRecipe } from '@/lib/object-shape';
import { facesMesh } from '@/features/vision-insert/utils/face-projection';
import { carGeometry } from '@/features/vision-insert/utils/car-projection';
import { plantGeometry } from '@/features/vision-insert/utils/plant-projection';
import { skinGeometry } from '@/features/vision-insert/utils/skin-projection';
import { houseGeometry } from '@/features/vision-insert/utils/house-projection';
import { withPieceEdits } from '@/features/vision-insert/utils/model-pieces';
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
  /** Prepared glTF model (VS-T52, offline mock): drawn as itself, outside the merged mesh. */
  modelUrl?: string;
}

/** A placed model shown as its prepared glTF (VS-T52): where it stands, how tall, its turn. */
export interface PlacedGltfModel {
  id: string;
  url: string;
  position: [number, number, number];
  height: number;
  yaw: number;
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
  /** Models with a prepared glTF (VS-T52, high tier): drawn one by one, outside the merged mesh. */
  gltf: PlacedGltfModel[];
}

/**
 * One model drawn with its own drawings or built from its house plan (PQ-T72): where it stands
 * and how its feeder state tints it. `recipe` holds `faces`, `house` or both.
 */
export interface PlacedDrawnModel {
  id: string;
  recipe: ObjectRecipe;
  position: [number, number, number];
  scale: number;
  yaw: number;
  state: 'served' | 'unserved' | 'fire';
  /** Colour kept when unpowered (`placedDim`): 1 = as drawn. */
  dim: number;
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

/** Colour left on an unpowered object at full night (the village's dark windows, VS-T35). */
export const PLACED_NIGHT_DIM = 0.45;

/**
 * An inserted object lit like the village's buildings (VS-T35): as built in daylight whatever its
 * feeder state (the status shows on its beacon and label), unpowered ones going dark only as night
 * falls. `darkness` from `duskDarkness`, 0 day … 1 night; snapped to tenths so the merged mesh is
 * rebuilt a few times at dusk, not on every hour step. Pure.
 */
export function placedDim(unserved: boolean, darkness: number): number {
  if (!unserved) return 1;
  const d = Math.round(Math.max(0, Math.min(1, darkness)) * 10) / 10;
  return 1 - (1 - PLACED_NIGHT_DIM) * d;
}

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
  tier: 'high' | 'low' = 'high',
  darkness = 1
): PlacedModelsGeometryResult {
  if (items.length === 0) {
    return { modelsGeometry: null, plinths: [], modelBounds: {}, drawn: [], gltf: [] };
  }

  const plinths: PlacedPlinth[] = [];
  const modelBounds: Record<string, { height: number; radius: number }> = {};
  const geometriesToMerge: THREE.BufferGeometry[] = [];
  const drawn: PlacedDrawnModel[] = [];
  const gltf: PlacedGltfModel[] = [];
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
    const own = tier === 'high' && drawn.length < PLACED_DRAWN_MAX;
    const faces = own ? item.recipe.faces : undefined;
    // A house read by its specialist is built volume by volume (PQ-T72).
    const house = own ? item.recipe.house : undefined;
    // A car fitted on its drawings (PQ-T76): lofted body and wheels.
    const carPlan = own && !house && item.recipe.car?.body ? item.recipe.car : undefined;
    const carMesh = carPlan ? carGeometry({ ...item.recipe, car: carPlan }) : null;
    // A plant built from its plan (PQ-T82): trunk, limbs, foliage, its own materials.
    const plantPlan = own && !house && !carMesh ? item.recipe.plant : undefined;
    // Parts wearing their 2D faces (VS-T43, tour mock).
    const skin = own && !house && !carMesh && !plantPlan ? item.recipe.skin : undefined;
    // The operator's piece edits from the 3D Studio (PQ-T77) are baked in before the turn.
    const edited = (geo: THREE.BufferGeometry) => withPieceEdits(geo, item.recipe);
    let g = house
      ? edited(houseGeometry({ ...item.recipe, house })).rotateY(effYaw)
      : carMesh
        ? edited(carMesh).rotateY(effYaw)
        : plantPlan
          ? edited(plantGeometry({ ...item.recipe, plant: plantPlan })).rotateY(effYaw)
          : skin
            ? edited(skinGeometry({ ...item.recipe, skin })).rotateY(effYaw)
            : faces
              ? edited(facesMesh({ proportions: item.recipe.proportions, faces })).rotateY(effYaw)
              : withPieceEdits(
                  recipeMesh(recipeWithYaw, tier === 'low' ? 'low' : 'full'),
                  recipeWithYaw
                );
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
    // Unpowered (sector unserved or the appliance draws nothing now): dark at night only, like
    // the village's buildings (VS-T35).
    const dim = placedDim((sec?.unserved ?? false) || !item.running, darkness);

    if (item.modelUrl && tier === 'high') {
      // Its prepared model, as tall as the recipe would stand, on the same ground.
      gltf.push({
        id: item.id,
        url: item.modelUrl,
        position: [x, restY, z],
        height: finalHeight,
        yaw: effYaw,
      });
      g.dispose();
      continue;
    }

    if (faces || house || carMesh || plantPlan || skin) {
      // Wears its drawings: its own mesh and texture, same place, same bounds.
      drawn.push({
        id: item.id,
        recipe: item.recipe,
        position: [x, restY - bottomY * effScale, z],
        scale: effScale,
        yaw: effYaw,
        state: onFire ? 'fire' : dim < 1 ? 'unserved' : 'served',
        dim,
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
        } else if (dim < 1) {
          // Unpowered at night: lights out
          r = r * dim;
          gr = gr * dim;
          b = b * dim;
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
    gltf,
  };
}

/** Stable signature of everything `buildPlacedModelsGeometry` reads (recipes are replaced, never mutated). */
export function placedGeometryKey(
  items: readonly PlacedModelItem[],
  sectorStatuses: Partial<Record<SectorId, SectorStateOverride>> | undefined,
  tier: 'high' | 'low',
  darkness = 1
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
      `${i.id}@${i.position.join(',')}:${i.running ? 1 : 0}:${i.scale ?? ''}:${i.yaw ?? ''}:${i.archetype ?? ''}:${i.modelUrl ?? ''}:${recipeId(i.recipe)}`
  );
  return `${tier}|${Math.round(Math.max(0, Math.min(1, darkness)) * 10)}|${status}|${parts.join(';')}`;
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
