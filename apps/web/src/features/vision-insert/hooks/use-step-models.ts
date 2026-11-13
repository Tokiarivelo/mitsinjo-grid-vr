'use client';

import { useCallback, useRef, useState } from 'react';
import {
  StepModelsStateSchema,
  type StepModelsSelection,
  type StepModelStep,
} from '@/lib/step-models';

export interface StepModelsData {
  defaults: Record<StepModelStep, string>;
  models: string[];
  selection: StepModelsSelection | null;
}

interface StepModelsState extends Partial<StepModelsData> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  saving: boolean;
  failedSave: boolean;
}

const IDLE: StepModelsState = { status: 'idle', saving: false, failedSave: false };

/**
 * Per-step 3D model choice (PQ-T67): env defaults + stored selection from
 * `GET /api/vision/shape/step-models`, saved back with PUT. Loads on demand (modal open),
 * so panels pay no call until the operator touches the gear.
 */
export function useStepModels(scope: string) {
  const [state, setState] = useState<StepModelsState>(IDLE);
  // Load-once guard as refs, not read back from setState: an updater only runs when React
  // renders, so reading it right after setState misses when another update queued first
  // (the gear's setOpen: the request never went out, modal stuck on loading).
  const busyRef = useRef(false);
  const doneRef = useRef(false);

  const load = useCallback(async () => {
    if (busyRef.current || doneRef.current) return;
    busyRef.current = true;
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const res = await fetch(`/api/vision/shape/step-models?scope=${encodeURIComponent(scope)}`);
      const parsed = StepModelsStateSchema.safeParse(await res.json());
      if (!res.ok || !parsed.success) {
        setState((s) => ({ ...s, status: 'error' }));
        return;
      }
      doneRef.current = true;
      setState({ status: 'ready', saving: false, failedSave: false, ...parsed.data });
    } catch {
      setState((s) => ({ ...s, status: 'error' }));
    } finally {
      busyRef.current = false;
    }
  }, [scope]);

  /** Stores the choice; true = saved (the next generation uses it). */
  const save = useCallback(
    async (selection: StepModelsSelection): Promise<boolean> => {
      setState((s) => ({ ...s, saving: true, failedSave: false }));
      try {
        const res = await fetch('/api/vision/shape/step-models', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope, selection }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setState((s) => ({ ...s, saving: false, selection }));
        return true;
      } catch {
        setState((s) => ({ ...s, saving: false, failedSave: true }));
        return false;
      }
    },
    [scope]
  );

  return { ...state, load, save };
}
