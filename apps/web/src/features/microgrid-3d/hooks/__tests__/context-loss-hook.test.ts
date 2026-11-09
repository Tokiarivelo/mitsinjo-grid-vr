import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { CONTEXT_REMOUNT_MS, MAX_CONTEXT_REMOUNTS, useContextLoss } from '../use-context-loss';

/** A canvas in the document, like the one R3F renders. */
function liveCanvas() {
  return document.body.appendChild(document.createElement('canvas'));
}

function loseContext(canvas: HTMLCanvasElement) {
  const event = new Event('webglcontextlost', { cancelable: true });
  act(() => {
    canvas.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useContextLoss', () => {
  it('shows the placeholder on loss, then remounts with a fresh canvas', () => {
    vi.useFakeTimers();
    const canvas = liveCanvas();
    const { result } = renderHook(() => useContextLoss());
    act(() => result.current.attach(canvas));
    expect(result.current).toMatchObject({ lost: false, epoch: 0 });

    const event = loseContext(canvas);
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.lost).toBe(true);

    act(() => vi.advanceTimersByTime(CONTEXT_REMOUNT_MS));
    expect(result.current).toMatchObject({ lost: false, epoch: 1 });
  });

  it('stops rebuilding after the max number of remounts', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useContextLoss());
    for (let i = 0; i < MAX_CONTEXT_REMOUNTS + 2; i++) {
      const canvas = liveCanvas();
      act(() => result.current.attach(canvas));
      loseContext(canvas);
      act(() => vi.advanceTimersByTime(CONTEXT_REMOUNT_MS));
    }
    expect(result.current.epoch).toBe(MAX_CONTEXT_REMOUNTS);
    expect(result.current.lost).toBe(true);
  });

  it('recovers from a creation failure through the same remount cycle', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useContextLoss());
    act(() => result.current.reportCreationFailed());
    expect(result.current.lost).toBe(true);

    act(() => vi.advanceTimersByTime(CONTEXT_REMOUNT_MS));
    expect(result.current).toMatchObject({ lost: false, epoch: 1 });
  });

  it('stops listening to the old canvas once a new one is attached', () => {
    const { result } = renderHook(() => useContextLoss());
    const old = liveCanvas();
    act(() => result.current.attach(old));
    act(() => result.current.attach(liveCanvas()));
    loseContext(old);
    expect(result.current.lost).toBe(false);
  });
});

describe('useContextLoss ignores expected losses (regression: stuck placeholder)', () => {
  it('ignores the loss R3F forces when it unmounts a canvas', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useContextLoss());
    let active = true;
    const canvas = liveCanvas();
    act(() => result.current.attach(canvas, () => active));
    active = false; // R3F marks the root inactive, then calls forceContextLoss()
    loseContext(canvas);
    act(() => vi.advanceTimersByTime(CONTEXT_REMOUNT_MS * 5));
    expect(result.current).toMatchObject({ lost: false, epoch: 0 });
  });

  it('ignores a loss on a canvas already removed from the page', () => {
    const { result } = renderHook(() => useContextLoss());
    const canvas = liveCanvas();
    act(() => result.current.attach(canvas));
    canvas.remove();
    loseContext(canvas);
    expect(result.current.lost).toBe(false);
  });
});
