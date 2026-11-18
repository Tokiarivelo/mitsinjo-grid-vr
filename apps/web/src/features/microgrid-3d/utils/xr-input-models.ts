import type * as THREE from 'three';
import {
  iwsdkInputFor,
  iwsdkInputOf,
  iwsdkVisual,
  releaseIwsdkInput,
  sideOf,
  tickIwsdkInput,
  type IwsdkInput,
} from './iwsdk-input';

/**
 * Real input models in the headset (VS-T26, IW-T1): Meta's Immersive Web SDK draws the hands
 * (Quest-style outlined hand, `generic-hand` profile) and the controller the runtime reports
 * (Touch / Touch Plus, from its WebXR input profile), animated from the XR frame. Until a model
 * has loaded, or offline, our simple stand-ins (joint spheres, grey grip) stay shown.
 */

/** A model has loaded once its mesh has been added under it. */
export const modelLoaded = (model: THREE.Object3D | null) => !!model && model.children.length > 0;

export interface InputModelSlots {
  /** Simple controller shown while the real one is not loaded (`gripLoaded()` toggles it). */
  gripFallback?: THREE.Object3D;
}

export interface InputModelScene {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Where IWSDK's rig hangs: the scene, or the (scaled) camera rig. Default: the scene. */
  parent?: THREE.Object3D;
}

export interface InputModels {
  /** Runs IWSDK for this frame (once per frame, whoever calls it first). */
  tick: () => void;
  handLoaded: () => boolean;
  gripLoaded: () => boolean;
  dispose: () => void;
}

/** No real models (no IWSDK, no scene): the stand-ins stay. */
export const NO_INPUT_MODELS: InputModels = {
  tick: () => undefined,
  handLoaded: () => false,
  gripLoaded: () => false,
  dispose: () => undefined,
};

/**
 * The real hand and controller models of input `index` (0 / 1). Call once per renderer and scene;
 * `tick()` every frame from the caller's loop. Never throws: without IWSDK the stand-ins stay.
 */
export function attachInputModels(
  gl: THREE.WebGLRenderer,
  index: number,
  slots: InputModelSlots,
  where: InputModelScene
): InputModels {
  const parent = where.parent ?? where.scene;
  const rt: IwsdkInput | null = iwsdkInputFor(gl, where.scene, where.camera, parent);
  if (!rt) return NO_INPUT_MODELS;
  let released = false;
  return {
    tick: () => tickIwsdkInput(gl, rt),
    handLoaded: () => modelLoaded(iwsdkVisual(rt, 'hand', sideOf(gl, index))),
    gripLoaded: () => {
      const ready = modelLoaded(iwsdkVisual(rt, 'controller', sideOf(gl, index)));
      if (slots.gripFallback) slots.gripFallback.visible = !ready;
      return ready;
    },
    dispose: () => {
      if (released) return;
      released = true;
      releaseIwsdkInput(rt, parent);
    },
  };
}

/**
 * Dev probes (`make vr-probe`, `make vr-sim-probe`): per input, its tracked joints, whether the
 * real (IWSDK) hand model has its mesh, and whether the joint spheres show.
 */
export function describeXrHands(gl: THREE.WebGLRenderer) {
  const rt = iwsdkInputOf(gl);
  return ([0, 1] as const).map((i) => {
    const h = gl.xr.getHand(i) as THREE.Object3D & { joints?: Record<string, unknown> };
    return {
      joints: Object.keys(h.joints ?? {}).length,
      real: rt ? modelLoaded(iwsdkVisual(rt, 'hand', sideOf(gl, i))) : false,
      spheres: h.children.some((c) => c.name === 'hand-joints-mesh' && c.visible),
    };
  });
}
