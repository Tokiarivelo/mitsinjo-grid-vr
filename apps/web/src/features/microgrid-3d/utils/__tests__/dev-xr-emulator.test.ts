import { describe, expect, it, vi } from 'vitest';
import {
  installDevXREmulator,
  installDevXRPanels,
  isDevXREmulated,
  markEmulatedImmersion,
} from '../dev-xr-emulator';

// The DevUI bundles its own Three.js: it must never load with the page, only on « enter ».
const devUiLoaded = vi.fn();
vi.mock('@iwer/devui', () => {
  devUiLoaded();
  return { DevUI: 'devui' };
});
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

describe('installDevXRPanels (DevUI on « enter » only)', () => {
  it('is not loaded by the runtime install, and is nothing without an IWER device', async () => {
    await installDevXREmulator();
    expect(devUiLoaded).not.toHaveBeenCalled();
    const w = window as unknown as Record<string, unknown>;
    const own = w.__IWER_DEVICE__;
    delete w.__IWER_DEVICE__;
    try {
      expect(installDevXRPanels()).toBeNull();
    } finally {
      w.__IWER_DEVICE__ = own;
    }
  });

  it('installs the panels through the device once, whatever the number of entries', async () => {
    const w = window as unknown as Record<string, unknown>;
    const own = w.__IWER_DEVICE__;
    const installDevUI = vi.fn();
    w.__IWER_DEVICE__ = { installDevUI };
    try {
      await installDevXRPanels();
      await installDevXRPanels();
      expect(devUiLoaded).toHaveBeenCalledTimes(1);
      expect(installDevUI).toHaveBeenCalledTimes(1);
      expect(installDevUI).toHaveBeenCalledWith('devui');
    } finally {
      w.__IWER_DEVICE__ = own;
    }
  });
});
