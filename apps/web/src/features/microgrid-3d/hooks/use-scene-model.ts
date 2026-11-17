'use client';

import { useMemo } from 'react';
import type { SimulationInput, SimulationResult, WeatherId } from '@mitsinjo/engine';
import { dayEvents } from '@/lib/day-events';
import {
  selectActiveResult,
  selectInput,
  selectStatus,
  selectTimeIndex,
  usePlacedModelsStore,
  useSimulationStore,
} from '@/stores';
import type { SceneModel } from '../types';
import { toSceneModel } from '../utils/to-scene-model';

export interface SceneModelFor {
  input: SimulationInput;
  result?: SimulationResult | undefined;
  timeIndex: number;
  /** Store status is `modified`: the last result shown dimmed and frozen. */
  isModified?: boolean;
  weather?: WeatherId | undefined;
}

/**
 * The village scene model for a run (pure `toSceneModel`), with the day's events and the placed
 * 3D models from the stores. One place for /simulation and the /village VR world (VS-T49).
 */
export function useSceneModelFor({
  input,
  result,
  timeIndex,
  isModified = false,
  weather,
}: SceneModelFor): SceneModel {
  const placedModels = usePlacedModelsStore((s) => s.models);
  // Fires of the day shown: a multi-day run keeps reported fires on its days.
  const workflow = useSimulationStore((s) => s.workflow);
  const dayIndex = useSimulationStore((s) => s.dayIndex);
  const events = useMemo(
    () => dayEvents(input.events, workflow, dayIndex),
    [input.events, workflow, dayIndex]
  );
  return useMemo(
    () =>
      toSceneModel({
        input,
        events,
        result,
        timeIndex,
        isModified,
        strategy: result?.strategy ?? 'proportional',
        weather,
        placedModels,
      }),
    [input, result, timeIndex, isModified, weather, placedModels, events]
  );
}

/** The scene model of the live run, read from the stores as /simulation shows it. */
export function useStoreSceneModel(): SceneModel {
  const input = useSimulationStore(selectInput);
  const result = useSimulationStore(selectActiveResult);
  const timeIndex = useSimulationStore(selectTimeIndex);
  const isModified = useSimulationStore((s) => selectStatus(s) === 'modified');
  const weather = useSimulationStore(
    (s) => s.workflow[s.dayIndex]?.weather ?? s.workflow[0]?.weather
  );
  return useSceneModelFor({ input, result, timeIndex, isModified, weather });
}
