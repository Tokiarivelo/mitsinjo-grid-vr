import { describe, expect, it } from 'vitest';
import { installDevXREmulator, isDevXREmulated, markEmulatedImmersion } from '../dev-xr-emulator';
import { isImmersiveVRSupported } from '../xr-session';

describe('installDevXREmulator (real IWER packages)', () => {
  it('installs the emulated runtime, reports immersive-vr, and is idempotent', async () => {
    expect(navigator.xr).toBeUndefined();
    await expect(installDevXREmulator()).resolves.toBe(true);
    expect(navigator.xr).toBeDefined();
    await expect(isImmersiveVRSupported()).resolves.toBe(true);
    await expect(installDevXREmulator()).resolves.toBe(true);
    expect(isDevXREmulated()).toBe(true);
  });

  it('marks <html> during an emulated immersion so the page is hidden, and clears it', () => {
    markEmulatedImmersion(true);
    expect(document.documentElement.hasAttribute('data-xr-emulated')).toBe(true);
    markEmulatedImmersion(false);
    expect(document.documentElement.hasAttribute('data-xr-emulated')).toBe(false);
  });
});

describe('isDevXREmulated with the Immersive Web Emulator extension', () => {
  it('detects the extension device even when our IWER is not installed', () => {
    const w = window as unknown as Record<string, unknown>;
    const own = w.__IWER_DEVICE__;
    delete w.__IWER_DEVICE__;
    try {
      expect(isDevXREmulated()).toBe(false);
      w.__IWE_XR_DEVICE__ = {};
      expect(isDevXREmulated()).toBe(true);
    } finally {
      delete w.__IWE_XR_DEVICE__;
      if (own !== undefined) w.__IWER_DEVICE__ = own;
    }
  });
});
