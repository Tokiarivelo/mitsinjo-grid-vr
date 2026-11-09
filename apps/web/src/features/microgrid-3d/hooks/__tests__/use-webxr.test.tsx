import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { WebGLRenderer } from 'three';
import { useWebXR } from '../use-webxr';

function mockRenderer() {
  const renderer = {
    xr: { enabled: false, setSession: vi.fn(async () => undefined) },
  } as unknown as WebGLRenderer;
  return { renderer, ref: { current: renderer } };
}

function mockSession() {
  const listeners = new Map<string, () => void>();
  const session = {
    addEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.set(type, listener);
    }),
    end: vi.fn(async () => undefined),
  } as unknown as XRSession;
  return { session, fire: (type: string) => listeners.get(type)?.() };
}

function stubNavigator(xr: unknown) {
  vi.stubGlobal('navigator', { xr });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useWebXR', () => {
  it('reports unsupported without a WebXR runtime', async () => {
    stubNavigator(undefined);
    const { ref } = mockRenderer();
    const { result } = renderHook(() => useWebXR(ref));
    await waitFor(() => expect(result.current.status).toBe('unsupported'));
  });

  it('reports supported when immersive-vr is available', async () => {
    stubNavigator({ isSessionSupported: vi.fn(async () => true) });
    const { ref } = mockRenderer();
    const { result } = renderHook(() => useWebXR(ref));
    await waitFor(() => expect(result.current.status).toBe('supported'));
  });

  it('enters and exits the session, syncing back on outside end', async () => {
    const { session, fire } = mockSession();
    stubNavigator({
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(async () => session),
    });
    const { renderer, ref } = mockRenderer();
    const { result } = renderHook(() => useWebXR(ref));
    await waitFor(() => expect(result.current.status).toBe('supported'));

    act(() => result.current.enter());
    await waitFor(() => expect(result.current.status).toBe('active'));
    expect(renderer.xr.enabled).toBe(true);

    // The headset system gesture ends the session outside the button.
    act(() => fire('end'));
    expect(result.current.status).toBe('supported');

    act(() => result.current.enter());
    await waitFor(() => expect(result.current.status).toBe('active'));
    act(() => result.current.exit());
    expect(session.end).toHaveBeenCalled();
  });

  it('exposes the enter failure instead of throwing', async () => {
    stubNavigator({
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(async () => Promise.reject(new Error('denied'))),
    });
    const { ref } = mockRenderer();
    const { result } = renderHook(() => useWebXR(ref));
    await waitFor(() => expect(result.current.status).toBe('supported'));

    act(() => result.current.enter());
    await waitFor(() => expect(result.current.error).toBe('denied'));
    expect(result.current.status).toBe('supported');
  });

  it('ignores enter without a renderer', async () => {
    const requestSession = vi.fn();
    stubNavigator({ isSessionSupported: vi.fn(async () => true), requestSession });
    const { result } = renderHook(() => useWebXR({ current: null }));
    await waitFor(() => expect(result.current.status).toBe('supported'));

    act(() => result.current.enter());
    expect(requestSession).not.toHaveBeenCalled();
  });
});
