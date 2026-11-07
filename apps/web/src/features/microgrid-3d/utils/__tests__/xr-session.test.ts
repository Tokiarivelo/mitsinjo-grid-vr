import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebGLRenderer } from 'three';
import {
  XR_IMMERSIVE_VR,
  XR_SESSION_INIT,
  isImmersiveVRSupported,
  startImmersiveVRSession,
} from '../xr-session';

function xrDouble(overrides: Partial<XRSystem> = {}): XRSystem {
  return {
    isSessionSupported: vi.fn(async () => true),
    requestSession: vi.fn(),
    ...overrides,
  } as unknown as XRSystem;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isImmersiveVRSupported', () => {
  it('is false without a WebXR runtime', async () => {
    await expect(isImmersiveVRSupported(undefined)).resolves.toBe(false);
  });

  it('is false when isSessionSupported is missing', async () => {
    await expect(isImmersiveVRSupported({} as XRSystem)).resolves.toBe(false);
  });

  it('asks for the immersive-vr mode', async () => {
    const xr = xrDouble();
    await expect(isImmersiveVRSupported(xr)).resolves.toBe(true);
    expect(xr.isSessionSupported).toHaveBeenCalledWith(XR_IMMERSIVE_VR);
  });

  it('is false when the runtime refuses or throws', async () => {
    await expect(
      isImmersiveVRSupported(xrDouble({ isSessionSupported: vi.fn(async () => false) }))
    ).resolves.toBe(false);
    await expect(
      isImmersiveVRSupported(
        xrDouble({ isSessionSupported: vi.fn(async () => Promise.reject(new Error('nope'))) })
      )
    ).resolves.toBe(false);
  });

  it('defaults to navigator.xr', async () => {
    vi.stubGlobal('navigator', { xr: undefined });
    await expect(isImmersiveVRSupported()).resolves.toBe(false);
  });
});

describe('startImmersiveVRSession', () => {
  it('enables XR on the renderer, requests the session and hands it over', async () => {
    const session = { id: 's1' } as unknown as XRSession;
    const requestSession = vi.fn(async () => session);
    vi.stubGlobal('navigator', { xr: xrDouble({ requestSession }) });
    const setSession = vi.fn(async () => undefined);
    const renderer = { xr: { enabled: false, setSession } } as unknown as WebGLRenderer;

    await expect(startImmersiveVRSession(renderer)).resolves.toBe(session);
    expect(renderer.xr.enabled).toBe(true);
    expect(requestSession).toHaveBeenCalledWith(XR_IMMERSIVE_VR, XR_SESSION_INIT);
    expect(XR_SESSION_INIT.optionalFeatures).toContain('local-floor');
    expect(setSession).toHaveBeenCalledWith(session);
  });

  it('rejects without a WebXR runtime', async () => {
    vi.stubGlobal('navigator', { xr: undefined });
    const renderer = { xr: { enabled: false } } as unknown as WebGLRenderer;
    await expect(startImmersiveVRSession(renderer)).rejects.toThrow(/WebXR is not available/);
  });

  it('rejects when the user refuses the session', async () => {
    vi.stubGlobal('navigator', {
      xr: xrDouble({
        requestSession: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))),
      }),
    });
    const renderer = { xr: { enabled: false } } as unknown as WebGLRenderer;
    await expect(startImmersiveVRSession(renderer)).rejects.toThrow('NotAllowedError');
  });
});
