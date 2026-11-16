import type * as THREE from 'three';
import { create } from 'zustand';

/**
 * Show / hide the hand and controller models in every VR immersion (VS-T30): they live on their
 * own render layer, so one camera layer switch hides them all (both hands, both controllers, the
 * real models and their simple stand-ins) while the lasers and cursors stay. WebXR's eye cameras
 * copy the camera's layer mask each frame.
 */
export const XR_INPUT_LAYER = 4;

const STORAGE_KEY = 'mitsinjo.xr.inputsShown';

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function store(shown: boolean) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(shown));
  } catch {
    // Private window or blocked storage: the choice lasts for this page only.
  }
}

interface XrInputsShownState {
  shown: boolean;
  toggle: () => void;
  setShown: (shown: boolean) => void;
}

export const useXrInputsShown = create<XrInputsShownState>()((set, get) => ({
  shown: readStored(),
  toggle: () => get().setShown(!get().shown),
  setShown: (shown) => {
    store(shown);
    set({ shown });
  },
}));

/** Puts every object under `root` on the input-model layer only. Returns `root`. */
export function putOnInputLayer<T extends THREE.Object3D>(root: T): T {
  root.traverse((o) => o.layers.set(XR_INPUT_LAYER));
  return root;
}

/** Shows (`shown`) or hides the input-model layer for `camera`. */
export function applyInputLayer(camera: THREE.Camera, shown: boolean): void {
  if (shown) camera.layers.enable(XR_INPUT_LAYER);
  else camera.layers.disable(XR_INPUT_LAYER);
}

/** Near clip plane (m) while presenting: hands and controllers sit 0.3–0.5 m from the eyes. */
export const XR_NEAR = 0.05;

/** The near plane to use in VR for a camera whose near plane is `near` on screen. */
export function xrNear(near: number): number {
  return Math.min(near, XR_NEAR);
}
