import type { WebGLRenderer } from 'three';

/** Session mode for the village diorama: full immersion from a standing-scale viewpoint. */
export const XR_IMMERSIVE_VR = 'immersive-vr' as const;

export const XR_SESSION_INIT: XRSessionInit = {
  optionalFeatures: ['local-floor', 'bounded-floor'],
};

/** Minimal renderer surface the XR session needs (kept narrow for tests). */
export type XRSessionRenderer = Pick<WebGLRenderer, 'xr'>;

/** True when the browser can open an `immersive-vr` session. Never throws. */
export async function isImmersiveVRSupported(
  xr: XRSystem | undefined = globalThis.navigator?.xr
): Promise<boolean> {
  if (!xr || typeof xr.isSessionSupported !== 'function') return false;
  try {
    return await xr.isSessionSupported(XR_IMMERSIVE_VR);
  } catch {
    return false;
  }
}

/**
 * Open an `immersive-vr` session on `renderer`. Must run in a user gesture.
 * Rejects when WebXR is missing or the user / runtime refuses the session.
 */
export async function startImmersiveVRSession(renderer: XRSessionRenderer): Promise<XRSession> {
  const xr = globalThis.navigator?.xr;
  if (!xr) throw new Error('WebXR is not available in this browser.');
  renderer.xr.enabled = true;
  const session = await xr.requestSession(XR_IMMERSIVE_VR, XR_SESSION_INIT);
  await renderer.xr.setSession(session);
  return session;
}
