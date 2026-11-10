/**
 * Dev-only WebXR emulation (Meta IWER + DevUI overlay). Loaded through a dynamic
 * import from `useWebXR` in development only, so production ships zero emulator code.
 * Never throws: `false` means "no emulation" and the VR button stays hidden.
 */
let installed = false;

export async function installDevXREmulator(): Promise<boolean> {
  if (installed) return true;
  if (typeof window === 'undefined') return false;
  try {
    const { XRDevice, metaQuest3 } = await import('iwer');
    const device = new XRDevice(metaQuest3);
    // Desktop Chromium ships a native `navigator.xr` with no immersive-vr device:
    // force the emulated runtime over it. Only called when native immersive-vr is
    // unsupported, so a real headset runtime is never clobbered.
    device.installRuntime({ forceInstall: true });
    // Dev-only handle so e2e scripts can drive headset, controllers and hands
    // through IWER's remote API (`device.remote.dispatch`), like the IWER MCP does.
    (window as Window & { __IWER_DEVICE__?: unknown }).__IWER_DEVICE__ = device;
    try {
      // The overlay needs WebGL; the emulated runtime works without it.
      const { DevUI } = await import('@iwer/devui');
      new DevUI(device);
    } catch {
      console.warn('[vr] DevUI overlay unavailable; emulated runtime active without it.');
    }
    installed = true;
    return true;
  } catch {
    return false;
  }
}

/** True when the WebXR runtime is the dev emulator (IWER), not a real headset. */
export function isDevXREmulated(): boolean {
  return typeof window !== 'undefined' && '__IWER_DEVICE__' in window;
}

/**
 * While an emulated session runs, the page stays on screen around the canvas: mark <html> so CSS
 * hides the app (`[data-app-root]`) and only the immersive canvas and the emulator overlay show.
 */
export function markEmulatedImmersion(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-xr-emulated', active && isDevXREmulated());
}
