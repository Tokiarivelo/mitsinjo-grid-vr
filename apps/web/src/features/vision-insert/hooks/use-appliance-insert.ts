'use client';

import { useCallback } from 'react';
import { MAX_APPLIANCES } from '@mitsinjo/engine';
import type { ApplianceDetection } from '@/lib/vision';
import type { ObjectRecipe } from '@/lib/object-shape';
import { defaultArchetype } from '@/lib/object-kit';
import { usePlacedModelsStore } from '@/stores';
import { useApplianceDraft } from './use-appliance-draft';
import { useSimulationAppliances } from './use-simulation-appliances';
import { applianceIdFor } from '../utils/appliance-draft';

export interface ApplianceInsertOptions {
  detection: ApplianceDetection;
  /** Object name in the page language (default line name). */
  name: string;
  /** `photoKey` of the current photo. */
  photo: string;
  /** Optional ready 3D recipe (PI-T1): stored in placed models on insert. */
  recipe?: ObjectRecipe | null;
  /** Prepared glTF model of the object (VS-T52, offline mock): the village shows it. */
  modelUrl?: string | null;
}

/**
 * Selected object → its load line in the store (PV-T12, PI-T1), shared by the page's « Add to the
 * simulation » panel and the VR lab's village hologram (VS-T28): the draft (AI estimate, position),
 * then insert / update (with its 3D model) or remove; the engine re-runs at once. Returns false
 * from `insert` when nothing was inserted (invalid line, simulation full).
 */
export function useApplianceInsert({
  detection,
  name,
  photo,
  recipe,
  modelUrl,
}: ApplianceInsertOptions) {
  const { list, upsert, remove } = useSimulationAppliances();
  const id = applianceIdFor(photo, detection.id);
  const existing = list.find((a) => a.id === id);
  const draft = useApplianceDraft(id, detection, name, existing);

  // A placed model needs a 3D recipe: the new one, or the one already stored for this object.
  const storedModel = usePlacedModelsStore((s) => s.models[id]);
  const modelRecipe = recipe ?? storedModel?.recipe;
  const { appliance } = draft;
  // A non-electric object (VS-T40) is never wired to the dispatcher.
  const connectionMode = draft.draft.electric ? (draft.draft.connectionMode ?? 'branch') : 'branch';

  const insert = useCallback((): boolean => {
    if (!appliance) return false;
    const ok = upsert(appliance);
    if (!ok || !modelRecipe) return ok;
    const fresh = defaultArchetype(detection.category, detection.scenery, detection.label);
    const archetype = recipe ? fresh : (storedModel?.archetype ?? fresh);
    usePlacedModelsStore.getState().upsert({
      applianceId: id,
      recipe: modelRecipe,
      yaw: recipe ? recipe.yaw : storedModel?.yaw,
      archetype,
      connectionMode,
      ...(modelUrl ? { modelUrl } : {}),
    });
    return true;
  }, [
    appliance,
    upsert,
    modelRecipe,
    detection,
    recipe,
    storedModel,
    id,
    connectionMode,
    modelUrl,
  ]);

  return {
    id,
    draft,
    inSimulation: Boolean(existing),
    full: !existing && list.length >= MAX_APPLIANCES,
    canConnect: Boolean(modelRecipe),
    insert,
    remove: useCallback(() => remove(id), [remove, id]),
  };
}
