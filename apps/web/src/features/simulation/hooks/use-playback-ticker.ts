'use client';

import { useEffect } from 'react';
import { useSimulationStore, type PlaybackSpeed } from '@/stores/simulation.store';

/** Default simulated hour tick while playing at 1x speed (smooth & responsive). */
export const BASE_PLAYBACK_TICK_MS = 500;
export const PLAYBACK_TICK_MS = BASE_PLAYBACK_TICK_MS;

/** Calculates milliseconds per simulated hour for a given playback speed multiplier. */
export function playbackTickMs(speed: PlaybackSpeed | number = 1): number {
  return Math.round(BASE_PLAYBACK_TICK_MS / (speed > 0 ? speed : 1));
}

/** Advances the store's time cursor (hour, then workflow day) while playback is on. */
export function usePlaybackTicker(isPlaying: boolean) {
  const playbackSpeed = useSimulationStore((s) => s.playbackSpeed);
  const tickMs = playbackTickMs(playbackSpeed);

  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      useSimulationStore.getState().advancePlayback();
    }, tickMs);
    return () => window.clearInterval(id);
  }, [isPlaying, tickMs]);
}
