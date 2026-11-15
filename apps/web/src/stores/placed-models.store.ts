import { z } from 'zod';
import { create } from 'zustand';
import type { ApplianceCategory } from '@mitsinjo/engine';
import { ObjectRecipeSchema, type ObjectRecipe } from '@/lib/object-shape';
import { KIT_ARCHETYPES, type KitArchetype, defaultArchetype } from '@/lib/object-kit';
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
 * Computes the real size multiplier in scene units (PI-T1):
 * returns the appropriate scale factor so objects render at realistic sizes.
 */
export function sceneScale(
  archetype?: KitArchetype | ApplianceCategory | string,
  _proportions?: { w: number; h: number; d: number }
): number {
  void _proportions;
  if (!archetype) return 1.0;
  if ((KIT_ARCHETYPES as readonly string[]).includes(archetype)) {
    return ARCHETYPE_SCENE_SCALE[archetype as KitArchetype] ?? 1.0;
  }
  const resolved = defaultArchetype(archetype as ApplianceCategory);
  return ARCHETYPE_SCENE_SCALE[resolved] ?? 1.0;
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

function loadStoredModels(): Record<string, PlacedModel> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(PLACED_MODELS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const valid: Record<string, PlacedModel> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const p = PlacedModelSchema.safeParse(v);
      if (p.success) valid[k] = p.data;
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
