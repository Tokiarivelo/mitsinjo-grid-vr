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
