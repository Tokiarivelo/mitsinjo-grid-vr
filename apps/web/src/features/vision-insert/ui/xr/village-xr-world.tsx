'use client';

import { memo, useCallback } from 'react';
import { LazyVillageWorld, useStoreSceneModel } from '@/features/microgrid-3d';
import { useSimulationStore } from '@/stores';
import { useXrWorld } from './xr-world-switch';

/**
 * The simulation's village inside the /village XR session (VS-T49): the same world as /simulation
 * (scene, labels, power panels, mixing desk, map, hands pad), on the live run from the stores, with
 * « Back to the lab ». The headset arrives next to the object just added (`useXrHandoff`).
 */
export const VillageXrWorld = memo(function VillageXrWorld() {
  const model = useStoreSceneModel();
  const selectedSector = useSimulationStore((s) => s.selectedSector);
  const selectSector = useSimulationStore((s) => s.selectSector);
  const backToLab = useCallback(() => useXrWorld.getState().go('lab'), []);
  return (
    <LazyVillageWorld
      model={model}
      selectedSector={selectedSector}
      onSelectSector={selectSector}
      cameraPreset="immersion"
      // Quest budget: no real-time shadows nor post-processing in the headset.
      quality="low"
      xrActive
      onBackToLab={backToLab}
    />
  );
});
