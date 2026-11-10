/**
 * Dev-only WebXR emulation (Meta IWER + DevUI overlay). Loaded through a dynamic
 * import from `useWebXR` in development only, so production ships zero emulator code.
 * Never throws: `false` means "no emulation" and the VR button stays hidden.
 */
let installing: Promise<boolean> | null = null;

/** Installs once: concurrent callers (React effects run twice in dev) share the same install. */
export function installDevXREmulator(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  installing ??= install().then((ok) => {
    if (!ok) installing = null;
    return ok;
  });
  return installing;
}

async function install(): Promise<boolean> {
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
      // The overlay needs WebGL; the emulated runtime works without it. Installed through the
      // device (not `new DevUI(device)`): IWER only mounts the panels (controllers, Play Mode,
      // exit) of a DevUI it knows about, when the session starts.
      const { DevUI } = await import('@iwer/devui');
      device.installDevUI(DevUI);
    } catch {
      console.warn('[vr] DevUI overlay unavailable; emulated runtime active without it.');
    }
    return true;
  } catch {
    return false;
  }
}

/** Globals set by an emulated WebXR runtime: our dev IWER, or the Immersive Web Emulator extension. */
const EMULATOR_GLOBALS = ['__IWER_DEVICE__', '__IWE_XR_DEVICE__'] as const;

/**
 * True when the WebXR runtime is an emulator, not a real headset. The browser extension reports
 * immersive-vr as native (so our IWER is never installed) and fakes a Quest user agent: only its
 * device global tells it apart.
 */
export function isDevXREmulated(): boolean {
  return typeof window !== 'undefined' && EMULATOR_GLOBALS.some((key) => key in window);
}

/**
 * While an emulated session runs, the page stays on screen around the canvas: mark <html> so CSS
 * hides the app (`[data-app-root]`) and only the immersive canvas and the emulator overlay show.
 */
export function markEmulatedImmersion(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-xr-emulated', active && isDevXREmulated());
}
