import * as THREE from 'three';
import { XRInputManager } from './iwsdk-xr-input';
import { putOnInputLayer } from './xr-inputs-shown';

/**
 * Meta's Immersive Web SDK input (`@iwsdk/xr-input`, IW-T1) inside our R3F scenes: its animated
 * hands and controllers (WebXR input profiles, tracked by IWSDK from the XR frame) replace the
 * three.js model factories. Only the visuals: IWSDK's own pointers (ray, grab, touch) stay off, so
 * `XRBlasterController` / `setupXRHandsAndControllers` remain the single input source (one select
 * per press, VS-T19). One manager per renderer, shared by every scene drawing on it; its rig
 * (`xrOrigin`) hangs under the latest attached parent (scene, or the scaled camera rig, VS-T33).
 */

export type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];
/** IWSDK sub-pointers, all turned off (our blaster owns selection). */
export const IWSDK_POINTER_KINDS = ['ray', 'grab', 'touch'] as const;

export interface IwsdkInput {
  manager: XRInputManager;
  /** Parents the rig was put under, latest last (the rig follows the top one). */
  parents: THREE.Object3D[];
  /** `XRFrame` the manager last ran on (several loops may tick it in one frame). */
  lastFrame: XRFrame | null;
  last: number;
  /** Visual models already put on the input layer (hide / show inputs, VS-T30). */
  layered: WeakSet<THREE.Object3D>;
}

const runtimes = new WeakMap<THREE.WebGLRenderer, IwsdkInput>();

/** The renderer's IWSDK input if one was started (dev probes), else null. */
export const iwsdkInputOf = (gl: THREE.WebGLRenderer): IwsdkInput | null =>
  runtimes.get(gl) ?? null;

/** Our pointers only: every IWSDK sub-pointer off, on both hands. */
export function disableIwsdkPointers(manager: Pick<XRInputManager, 'multiPointers'>): void {
  for (const side of SIDES)
    for (const kind of IWSDK_POINTER_KINDS)
      manager.multiPointers[side].toggleSubPointer(kind, false);
}

/**
 * The renderer's IWSDK input, created on first use (null off the browser or when IWSDK cannot
 * start: the fallback models then stay). `parent` receives the rig.
 */
export function iwsdkInputFor(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  parent: THREE.Object3D = scene
): IwsdkInput | null {
  if (typeof window === 'undefined') return null;
  let rt = runtimes.get(gl);
  if (!rt) {
    try {
      const manager = new XRInputManager({ scene, camera: camera as THREE.PerspectiveCamera });
      disableIwsdkPointers(manager);
      rt = { manager, parents: [], lastFrame: null, last: 0, layered: new WeakSet() };
      runtimes.set(gl, rt);
    } catch (err) {
      console.warn('[iwsdk] input manager not started, simple models stay:', err);
      return null;
    }
  }
  rt.parents.push(parent);
  parent.add(rt.manager.xrOrigin);
  return rt;
}

/** Drops one attach of `parent`; the rig goes back under the previous one (or leaves the scene). */
export function releaseIwsdkInput(rt: IwsdkInput, parent: THREE.Object3D): void {
  const at = rt.parents.lastIndexOf(parent);
  if (at >= 0) rt.parents.splice(at, 1);
  const top = rt.parents[rt.parents.length - 1];
  if (top) top.add(rt.manager.xrOrigin);
  else rt.manager.xrOrigin.removeFromParent();
}

/**
 * Runs IWSDK once per XR frame (poses, hand skinning, button animation). Safe to call from every
 * loop of the frame: the second call on the same `XRFrame` does nothing. Off-session it lets the
 * manager tidy up (session end).
 */
export function tickIwsdkInput(gl: THREE.WebGLRenderer, rt: IwsdkInput): void {
  const frame = gl.xr?.isPresenting ? (gl.xr.getFrame?.() ?? null) : null;
  if (frame && frame === rt.lastFrame) return;
  rt.lastFrame = frame;
  const now = performance.now();
  const delta = rt.last ? Math.min(0.1, (now - rt.last) / 1000) : 0;
  rt.last = now;
  try {
    rt.manager.update(gl.xr, delta, now / 1000);
  } catch (err) {
    console.warn('[iwsdk] input update failed:', err);
  }
}

/** The IWSDK visual of `side` (`hand` or `controller`) once its model has loaded, else null. */
export function iwsdkVisual(rt: IwsdkInput, kind: 'hand' | 'controller', side: Side) {
  const model = rt.manager.visualAdapters[kind][side].visual?.model;
  if (!model) return null;
  // Own render layer, like our models (VS-T30: hidden with one camera switch).
  if (!rt.layered.has(model)) {
    putOnInputLayer(model);
    rt.layered.add(model);
  }
  return model;
}

/** Handedness of input `index` this frame ('left' when unknown). */
export function sideOf(gl: THREE.WebGLRenderer, index: number): Side {
  const h = gl.xr?.getSession?.()?.inputSources?.[index]?.handedness;
  return h === 'right' ? 'right' : 'left';
}
