import type { WebGLRenderer } from 'three';

/** Session mode for the village diorama: full immersion from a standing-scale viewpoint. */
export const XR_IMMERSIVE_VR = 'immersive-vr' as const;

export const XR_SESSION_INIT: XRSessionInit = {
  optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
};

/** Minimal renderer surface the XR session needs (kept narrow for tests). */
export type XRSessionRenderer = Pick<WebGLRenderer, 'xr'> &
  Partial<Pick<WebGLRenderer, 'domElement' | 'setSize'>>;

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

  // Intercept setSize while presenting to suppress Three.js warning:
  // "THREE.WebGLRenderer: Can't change size while VR device is presenting."
  const originalSetSize = renderer.setSize?.bind(renderer);
  if (renderer.setSize && originalSetSize) {
    renderer.setSize = (width: number, height: number, updateStyle?: boolean) => {
      if (renderer.xr?.isPresenting) {
        return;
      }
      originalSetSize(width, height, updateStyle);
    };
  }

  const session = await xr.requestSession(XR_IMMERSIVE_VR, XR_SESSION_INIT);
  await renderer.xr.setSession(session);

  // In presentation / dev emulation (IWER), ensure the canvas fills 100% of the
  // presentation container without leaving letterboxed/pillared backgrounds.
  const canvas = renderer.domElement;
  if (canvas && typeof canvas === 'object' && 'style' in canvas) {
    const prevWidth = canvas.style.width;
    const prevHeight = canvas.style.height;
    const prevMaxWidth = canvas.style.maxWidth;
    const prevMaxHeight = canvas.style.maxHeight;

    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.maxWidth = '100vw';
    canvas.style.maxHeight = '100vh';

    if (canvas.parentElement && canvas.parentElement !== document.body) {
      canvas.parentElement.style.background = '#0a0d14';
    }

    if (session && typeof session.addEventListener === 'function') {
      session.addEventListener(
        'end',
        () => {
          canvas.style.width = prevWidth;
          canvas.style.height = prevHeight;
          canvas.style.maxWidth = prevMaxWidth;
          canvas.style.maxHeight = prevMaxHeight;
          if (originalSetSize && renderer.setSize) {
            renderer.setSize = originalSetSize;
          }
        },
        { once: true }
      );
    }
  }

  return session;
}
