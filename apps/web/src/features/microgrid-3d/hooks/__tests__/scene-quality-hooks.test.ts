import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  MIN_PROBE_SAMPLES,
  SCENE_QUALITY_STORAGE_KEY,
  resetSceneQualityForTests,
  MAX_PROBE_MS,
  probeVerdict,
  shouldAutoDowngrade,
  useSceneQuality,
} from '../use-scene-quality';
import { useFullscreen } from '../use-fullscreen';

describe('shouldAutoDowngrade', () => {
  it('needs enough samples', () => {
    expect(shouldAutoDowngrade([5, 5, 5])).toBe(false);
  });
  it('uses the median fps', () => {
    const slow = Array.from({ length: MIN_PROBE_SAMPLES }, (_, i) => (i < 3 ? 120 : 15));
    const fast = Array.from({ length: MIN_PROBE_SAMPLES }, (_, i) => (i < 3 ? 5 : 60));
    expect(shouldAutoDowngrade(slow)).toBe(true);
    expect(shouldAutoDowngrade(fast)).toBe(false);
  });
});

describe('probeVerdict', () => {
  const fast = Array.from({ length: MIN_PROBE_SAMPLES }, () => 60);
  const slow = Array.from({ length: MIN_PROBE_SAMPLES }, () => 10);
  it('keeps measuring inside the window', () => {
    expect(probeVerdict(fast, 1000, 3500)).toBe('measuring');
    expect(probeVerdict([60], 4000, 3500)).toBe('measuring');
  });
  it('decides from the median once the window and samples are enough', () => {
    expect(probeVerdict(fast, 3600, 3500)).toBe('keep');
    expect(probeVerdict(slow, 3600, 3500)).toBe('downgrade');
  });
  it('gives up and downgrades when frames are too slow to collect samples', () => {
    expect(probeVerdict([1, 1], MAX_PROBE_MS, 3500)).toBe('downgrade');
  });
});

describe('useSceneQuality', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSceneQualityForTests();
  });

  it('defaults to high and auto-downgrades once when not chosen', () => {
    const { result } = renderHook(() => useSceneQuality());
    expect(result.current.quality).toBe('high');
    expect(result.current.userChosen).toBe(false);
    act(() => result.current.autoDowngrade());
    expect(result.current.quality).toBe('low');
    // Auto-downgrade is not persisted.
    expect(window.localStorage.getItem(SCENE_QUALITY_STORAGE_KEY)).toBeNull();
  });

  it('persists a user choice and never auto-overrides it', () => {
    const { result } = renderHook(() => useSceneQuality());
    act(() => result.current.setQuality('high'));
    act(() => result.current.autoDowngrade());
    expect(result.current.quality).toBe('high');
    expect(window.localStorage.getItem(SCENE_QUALITY_STORAGE_KEY)).toBe('high');
  });

  it('restores the stored tier', () => {
    window.localStorage.setItem(SCENE_QUALITY_STORAGE_KEY, 'low');
    const { result } = renderHook(() => useSceneQuality());
    expect(result.current.quality).toBe('low');
    expect(result.current.userChosen).toBe(true);
  });

  it('shares state between hook instances', () => {
    const a = renderHook(() => useSceneQuality());
    const b = renderHook(() => useSceneQuality());
    act(() => a.result.current.setQuality('low'));
    expect(b.result.current.quality).toBe('low');
  });
});

describe('useFullscreen', () => {
  const el = document.createElement('div');
  let current: Element | null = null;

  beforeEach(() => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => current,
    });
    el.requestFullscreen = vi.fn(async () => {
      current = el;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    document.exitFullscreen = vi.fn(async () => {
      current = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
  });
  afterEach(() => {
    current = null;
  });

  it('reports support only after mount (hydration-safe)', () => {
    document.documentElement.requestFullscreen = vi.fn();
    const ref = { current: el };
    const { result } = renderHook(() => useFullscreen(ref));
    // renderHook flushes effects: support is known once mounted, never during SSR.
    expect(result.current.supported).toBe(true);
  });

  it('enters and exits fullscreen for the element', async () => {
    const ref = { current: el };
    const { result } = renderHook(() => useFullscreen(ref));
    expect(result.current.isFullscreen).toBe(false);
    await act(async () => result.current.toggle());
    expect(el.requestFullscreen).toHaveBeenCalled();
    expect(result.current.isFullscreen).toBe(true);
    await act(async () => result.current.toggle());
    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(result.current.isFullscreen).toBe(false);
  });

  it('exposes enter and exit methods that operate idempotently', async () => {
    const ref = { current: el };
    const { result } = renderHook(() => useFullscreen(ref));
    expect(result.current.isFullscreen).toBe(false);

    await act(async () => result.current.enter());
    expect(el.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isFullscreen).toBe(true);

    // Re-entering while already in fullscreen is a no-op
    await act(async () => result.current.enter());
    expect(el.requestFullscreen).toHaveBeenCalledTimes(1);

    await act(async () => result.current.exit());
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isFullscreen).toBe(false);

    // Re-exiting while already normal is a no-op
    await act(async () => result.current.exit());
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  });
});
