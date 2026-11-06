import { describe, expect, it } from 'vitest';
import { installDevXREmulator } from '../dev-xr-emulator';
import { isImmersiveVRSupported } from '../xr-session';

describe('installDevXREmulator (real IWER packages)', () => {
  it('installs the emulated runtime, reports immersive-vr, and is idempotent', async () => {
    expect(navigator.xr).toBeUndefined();
    await expect(installDevXREmulator()).resolves.toBe(true);
    expect(navigator.xr).toBeDefined();
    await expect(isImmersiveVRSupported()).resolves.toBe(true);
    await expect(installDevXREmulator()).resolves.toBe(true);
  });
});
