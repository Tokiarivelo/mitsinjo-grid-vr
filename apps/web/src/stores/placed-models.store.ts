import { z } from 'zod';
import { create } from 'zustand';
import type { ApplianceCategory } from '@mitsinjo/engine';
import { ObjectRecipeSchema, type ObjectRecipe } from '@/lib/object-shape';
import {
  ARCHETYPE_SIZE_MM,
  KIT_ARCHETYPES,
  type KitArchetype,
  defaultArchetype,
} from '@/lib/object-kit';
import { useSimulationStore, type SimulationState } from './simulation.store';

export const ConnectionModeSchema = z.enum(['branch', 'ems']);
export type ConnectionMode = z.infer<typeof ConnectionModeSchema>;

/**
 * 3D placed model contract (PI-T1, visual store only, zero engine change):
 * links an inserted appliance to its 3D recipe, orientation yaw, scene scale,
 * and electrical grid connection mode (PI-T6/PI-T7).
 */
export const PlacedModelSchema = z.object({
  applianceId: z.string().min(1),
  recipe: ObjectRecipeSchema,
  yaw: z.number().optional(),
  scale: z.number().positive().optional(),
  archetype: z.enum(KIT_ARCHETYPES).optional(),
  connectionMode: ConnectionModeSchema.optional(),
});
export type PlacedModel = z.infer<typeof PlacedModelSchema>;

export const PLACED_MODELS_STORAGE_KEY = 'mitsinjo:placed-models';

/**
 * Target scene scale per archetype (scene units).
 * A house matches village houses (~3.8 units), a vehicle is ~2.4 units,
 * a fridge is ~1.0 unit (~1 m in real life).
 */
export const ARCHETYPE_SCENE_SCALE: Record<KitArchetype, number> = {
  house: 3.8,
  building: 4.0,
  vehicle: 2.4,
  tree: 3.0,
  bush: 1.2,
  lamp_post: 2.8,
  pole: 2.8,
  tank: 1.5,
  panel: 1.5,
  cabinet: 1.0,
  machine: 0.9,
  screen: 0.5,
  fan: 0.6,
  person: 0.9,
  animal: 0.8,
  water: 2.5,
  other: 1.0,
};

/**
 * Scene units per real metre: the village is a half-scale model (house walls 1.3 units for a
 * 2.6 m wall, VS-T35), the same ratio as the VR walker's scale (`XR_VILLAGE_SCALE`).
 */
export const VILLAGE_UNITS_PER_M = 0.5;

/**
 * Typical real height per archetype (VS-T35), metres: an inserted object stands as tall as its
 * kind does in the village (a house as tall as the village's, a fridge at a person's shoulder).
 * Water (a flat sheet) and `other` have none: their largest side keeps `ARCHETYPE_SCENE_SCALE`.
 */
export const ARCHETYPE_HEIGHT_M: Partial<Record<KitArchetype, number>> = {
  house: 4,
  building: 7,
  vehicle: 1.5,
  tree: 6,
  bush: 1.2,
  lamp_post: 5,
  pole: 7,
  tank: 2,
  panel: 1.6,
  cabinet: 1.8,
  machine: 0.8,
  screen: 0.6,
  fan: 1.2,
  person: 1.7,
  animal: 1.4,
};

function resolveArchetype(archetype?: string): KitArchetype | undefined {
  if (!archetype) return undefined;
  if ((KIT_ARCHETYPES as readonly string[]).includes(archetype)) return archetype as KitArchetype;
  return defaultArchetype(archetype as ApplianceCategory);
}

/**
 * Scene scale of an inserted object (PI-T1, VS-T35): the scene length of its largest side
 * (proportions are largest side = 1). With its proportions, it stands at its archetype's typical
 * height (`ARCHETYPE_HEIGHT_M`), kept inside the archetype's real width and height ranges
 * (`ARCHETYPE_SIZE_MM`, the height range wins when both cannot hold): a slim pump grows until its
 * width is plausible, a wide house stays as tall as the village's. Without proportions, or for
 * an archetype without a typical height, the fixed largest side (`ARCHETYPE_SCENE_SCALE`). Pure.
 */
export function sceneScale(
  archetype?: KitArchetype | ApplianceCategory | string,
  proportions?: { w: number; h: number; d: number }
): number {
  const arch = resolveArchetype(archetype);
  if (!arch) return 1.0;
  const fixed = ARCHETYPE_SCENE_SCALE[arch] ?? 1.0;
  const heightM = ARCHETYPE_HEIGHT_M[arch];
  if (!proportions || !heightM || !(proportions.h > 0)) return fixed;
  const U = VILLAGE_UNITS_PER_M;
  // Scale bounds that keep one axis (proportion p) inside a real range [lo, hi] mm.
  const bounds = (p: number, range?: readonly [number, number]): [number, number] =>
    range && p > 0 ? [(range[0] / 1000) * (U / p), (range[1] / 1000) * (U / p)] : [0, Infinity];
  const size = ARCHETYPE_SIZE_MM[arch];
  const byH = bounds(proportions.h, size?.h);
  const byW = bounds(proportions.w, size?.w);
  let [lo, hi] = [Math.max(byH[0], byW[0]), Math.min(byH[1], byW[1])];
  if (lo > hi) [lo, hi] = byH;
  const target = (heightM * U) / proportions.h;
  return Math.round(Math.min(hi, Math.max(lo, target)) * 1000) / 1000;
}

export interface FootprintBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
}

export interface ModelFootprint {
  radius: number;
  box: FootprintBox;
}

/**
 * 2D ground footprint of a model (PI-T1): bounding box and radius in scene units,
 * with scale and yaw applied. Pure, tested helper.
 */
export function footprint(recipe: ObjectRecipe, scale?: number, yaw?: number): ModelFootprint {
  const effScale = typeof scale === 'number' && scale > 0 ? scale : 1;
  const effYaw = typeof yaw === 'number' ? yaw : (recipe.yaw ?? 0);
  const cos = Math.cos(effYaw);
  const sin = Math.sin(effYaw);
  const dims = recipe.proportions;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let maxR = 0;

  for (const part of recipe.parts) {
    const cx = part.at[0] * dims.w;
    const cz = part.at[2] * dims.d;
    const hx = (part.size[0] * dims.w) / 2;
    const hz = (part.size[2] * dims.d) / 2;

    const corners: [number, number][] = [
      [cx - hx, cz - hz],
      [cx + hx, cz - hz],
      [cx + hx, cz + hz],
      [cx - hx, cz + hz],
    ];

    for (const [x, z] of corners) {
      const rx = (x * cos - z * sin) * effScale;
      const rz = (x * sin + z * cos) * effScale;

      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (rz < minZ) minZ = rz;
      if (rz > maxZ) maxZ = rz;

      const r = Math.hypot(rx, rz);
      if (r > maxR) maxR = r;
    }
  }

  if (!Number.isFinite(minX)) {
    const hw = (dims.w * effScale) / 2;
    const hd = (dims.d * effScale) / 2;
    minX = -hw;
    maxX = hw;
    minZ = -hd;
    maxZ = hd;
    maxR = Math.hypot(hw, hd);
  }

  return {
    radius: Math.max(0.2, maxR),
    box: {
      minX,
      maxX,
      minZ,
      maxZ,
      width: Math.max(0.1, maxX - minX),
      depth: Math.max(0.1, maxZ - minZ),
    },
  };
}

export function loadStoredModels(): Record<string, PlacedModel> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(PLACED_MODELS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const valid: Record<string, PlacedModel> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const p = PlacedModelSchema.safeParse(v);
      if (!p.success) continue;
      // Stored scales were always derived from the archetype (fixed largest side, before VS-T35):
      // dropped, so the scene re-sizes every object from its proportions.
      const { scale: _scale, ...model } = p.data;
      void _scale;
      valid[k] = model;
    }
    return valid;
  } catch {
    return {};
  }
}

/** The models without their drawings (`recipe.faces`): what fits a full storage. */
export function withoutDrawings(models: Record<string, PlacedModel>): Record<string, PlacedModel> {
  return Object.fromEntries(
    Object.entries(models).map(([id, m]) => {
      const { faces: _faces, ...recipe } = m.recipe;
      void _faces;
      return [id, { ...m, recipe }];
    })
  );
}

function saveStoredModels(models: Record<string, PlacedModel>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(PLACED_MODELS_STORAGE_KEY, JSON.stringify(models));
  } catch {
    // Quota exceeded (a drawn model carries its drawings, PQ-T70): keep the parts at least, so a
    // reload shows the models in flat colours instead of losing them all.
    try {
      window.localStorage.setItem(
        PLACED_MODELS_STORAGE_KEY,
        JSON.stringify(withoutDrawings(models))
      );
    } catch {
      // storage disabled
    }
  }
}

export interface PlacedModelsState {
  models: Record<string, PlacedModel>;
  upsert: (model: PlacedModel) => void;
  remove: (applianceId: string) => void;
  getModel: (applianceId: string) => PlacedModel | undefined;
  syncWithAppliances: (activeApplianceIds: readonly string[]) => void;
  clear: () => void;
}

export const usePlacedModelsStore = create<PlacedModelsState>((set, get) => ({
  models: loadStoredModels(),
  upsert: (model: PlacedModel) => {
    const next = { ...get().models, [model.applianceId]: model };
    set({ models: next });
    saveStoredModels(next);
  },
  remove: (applianceId: string) => {
    const current = get().models;
    if (!current[applianceId]) return;
    const next = { ...current };
    delete next[applianceId];
    set({ models: next });
    saveStoredModels(next);
  },
  getModel: (applianceId: string) => get().models[applianceId],
  syncWithAppliances: (activeApplianceIds: readonly string[]) => {
    const setIds = new Set(activeApplianceIds);
    const current = get().models;
    let changed = false;
    const next: Record<string, PlacedModel> = {};
    for (const [id, m] of Object.entries(current)) {
      if (setIds.has(id)) {
        next[id] = m;
      } else {
        changed = true;
      }
    }
    if (changed) {
      set({ models: next });
      saveStoredModels(next);
    }
  },
  clear: () => {
    set({ models: {} });
    saveStoredModels({});
  },
}));

/**
 * Appliance ids whose 3D model must be kept: those in the current input, plus those an undo can bring back
 * (inputs saved in `changeHistory`), so undoing a removal also brings the model back.
 */
export function liveApplianceIds(s: Pick<SimulationState, 'input' | 'changeHistory'>): string[] {
  const ids = new Set((s.input.appliances ?? []).map((a) => a.id));
  for (const c of s.changeHistory) for (const a of c.before.input.appliances ?? []) ids.add(a.id);
  return [...ids];
}

/**
 * Prunes models of appliances gone from the simulation (scenario load, reset, copilot change).
 * Deferred to a microtask: actions like `approveChange` set the input before the undo history,
 * so pruning reads the settled state once the action is done.
 */
let pruneQueued = false;
useSimulationStore.subscribe((s, prev) => {
  if (pruneQueued || (s.input === prev.input && s.changeHistory === prev.changeHistory)) return;
  pruneQueued = true;
  queueMicrotask(() => {
    pruneQueued = false;
    usePlacedModelsStore
      .getState()
      .syncWithAppliances(liveApplianceIds(useSimulationStore.getState()));
  });
});
