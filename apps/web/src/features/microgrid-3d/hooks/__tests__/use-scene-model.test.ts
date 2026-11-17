import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { resetSimulationStore, useSimulationStore } from '@/stores';
import { toSceneModel } from '../../utils/to-scene-model';
import { useSceneModelFor, useStoreSceneModel } from '../use-scene-model';

describe('scene model hooks (VS-T49)', () => {
  beforeEach(() => resetSimulationStore());

  it('maps a run like toSceneModel', () => {
    const input = useSimulationStore.getState().input;
    const { result } = renderHook(() => useSceneModelFor({ input, timeIndex: 9 }));
    const expected = toSceneModel({ input, timeIndex: 9, events: input.events });
    expect(result.current.timeIndex).toBe(expected.timeIndex);
    expect(Object.keys(result.current.buildings)).toEqual(Object.keys(expected.buildings));
    expect(result.current.hasResult).toBe(false);
  });

  it('reads the live run from the store and follows the hour', () => {
    const { result, rerender } = renderHook(() => useStoreSceneModel());
    const first = result.current.timeIndex;
    const next = (first + 1) % 24;
    useSimulationStore.setState({ timeIndex: next });
    rerender();
    expect(result.current.timeIndex).toBe(next);
  });
});
