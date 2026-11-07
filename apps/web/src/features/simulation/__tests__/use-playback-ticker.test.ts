import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { initialSimulationData, useSimulationStore } from '@/stores/simulation.store';
import { PLAYBACK_TICK_MS, usePlaybackTicker } from '../hooks/use-playback-ticker';

describe('usePlaybackTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSimulationStore.setState({ ...initialSimulationData, timeIndex: 22 });
  });
  afterEach(() => vi.useRealTimers());

  it('advances one hour per tick and loops after 23:00', () => {
    renderHook(() => usePlaybackTicker(true));
    vi.advanceTimersByTime(PLAYBACK_TICK_MS);
    expect(useSimulationStore.getState().timeIndex).toBe(23);
    vi.advanceTimersByTime(PLAYBACK_TICK_MS);
    expect(useSimulationStore.getState().timeIndex).toBe(0);
  });

  it('rolls over to the next workflow day after 23:00, then loops to day 1', () => {
    useSimulationStore.setState({
      workflow: [{ weather: 'sunny' }, { weather: 'cloudy' }],
      dayIndex: 0,
      timeIndex: 23,
    });
    renderHook(() => usePlaybackTicker(true));
    vi.advanceTimersByTime(PLAYBACK_TICK_MS);
    expect(useSimulationStore.getState()).toMatchObject({ dayIndex: 1, timeIndex: 0 });
    useSimulationStore.setState({ timeIndex: 23 });
    vi.advanceTimersByTime(PLAYBACK_TICK_MS);
    expect(useSimulationStore.getState()).toMatchObject({ dayIndex: 0, timeIndex: 0 });
  });

  it('does nothing while paused and stops on unmount', () => {
    const { rerender, unmount } = renderHook(({ on }) => usePlaybackTicker(on), {
      initialProps: { on: false },
    });
    vi.advanceTimersByTime(PLAYBACK_TICK_MS * 3);
    expect(useSimulationStore.getState().timeIndex).toBe(22);
    rerender({ on: true });
    unmount();
    vi.advanceTimersByTime(PLAYBACK_TICK_MS * 3);
    expect(useSimulationStore.getState().timeIndex).toBe(22);
  });

  it('adjusts tick interval dynamically when playbackSpeed changes', () => {
    act(() => {
      useSimulationStore.setState({ playbackSpeed: 0.5, timeIndex: 22 });
    });
    renderHook(() => usePlaybackTicker(true));

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useSimulationStore.getState().timeIndex).toBe(22);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useSimulationStore.getState().timeIndex).toBe(23);

    act(() => {
      useSimulationStore.getState().setPlaybackSpeed(0.25);
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(useSimulationStore.getState().timeIndex).toBe(23);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(useSimulationStore.getState().timeIndex).toBe(0);
  });
});
