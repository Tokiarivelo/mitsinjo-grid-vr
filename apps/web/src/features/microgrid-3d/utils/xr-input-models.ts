import * as THREE from 'three';
import { XRControllerModelFactory, XRHandModelFactory } from './three-xr-factories';
import { putOnInputLayer } from './xr-inputs-shown';

/**
 * Real input models in the headset (VS-T26): a skinned, articulated hand (the WebXR input
 * profiles' `generic-hand`, the shape Quest draws) and the controller the runtime reports (Quest
 * Touch / Touch Plus from its input profile), instead of joint spheres and a cylinder. Loaded once
 * a hand or a controller connects, from the WebXR input profiles CDN (three's default); until it
 * arrives, or offline, the simple fallback models stay shown.
 */

/** WebXR input profiles (pinned major, as three.js uses it). */
export const INPUT_PROFILES_PATH =
  'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles';
/** Skin of the hand model: a warm, neutral tone, lit by the scene. */
export const HAND_SKIN = '#d8a688';
/** Pale rim round the hand's outline (seen against dark rooms and bright photos alike). */
export const HAND_RIM = '#f2efe6';
export const HAND_RIM_POWER = 2.6;

/**
 * Skin material for the hand: matte skin, plus a fresnel rim that outlines the hand (the light
 * edge Quest draws round its hands). One material shared by both hands.
 */
export function createHandSkinMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: HAND_SKIN,
    roughness: 0.62,
    metalness: 0,
  });
  mat.name = 'xr-hand-skin';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: new THREE.Color(HAND_RIM) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += rimColor * pow(1.0 - facing, ${HAND_RIM_POWER.toFixed(1)});`
      );
  };
  return mat;
}

/** Puts the skin on every mesh of a loaded hand (its own grey material is dropped). */
export function skinHand(root: THREE.Object3D, skin: THREE.Material): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const old = m.material;
    (Array.isArray(old) ? old : [old]).forEach((x) => x?.dispose());
    m.material = skin;
    m.castShadow = false;
    m.frustumCulled = false;
    n++;
  });
  return n;
}

/**
 * Replays the `connected` event of an input already there: the model factories load on that
 * event, and a space built after the session started has missed it. Only to `space`'s own listeners.
 */
export function replayConnected(
  space: THREE.Object3D,
  source: XRInputSource | undefined,
  wants: 'hand' | 'controller'
): boolean {
  if (!source) return false;
  if (wants === 'hand' ? !source.hand : source.hand) return false;
  space.dispatchEvent({ type: 'connected', data: source } as never);
  return true;
}

export interface InputModelSlots {
  /** Hand joint space (`renderer.xr.getHand(i)`). */
  hand?: THREE.Object3D;
  /** Controller grip space (`renderer.xr.getControllerGrip(i)`). */
  grip?: THREE.Object3D;
  /** Simple controller shown while the real one is not loaded (`gripLoaded()` toggles it). */
  gripFallback?: THREE.Object3D;
}

let skin: THREE.MeshStandardMaterial | null = null;
let handFactory: XRHandModelFactory | null = null;
let controllerFactory: XRControllerModelFactory | null = null;

/**
 * One factory of each for the page: the controller factory caches each profile's model, so a
 * remount (or a second hand) never downloads it again.
 */
function factories() {
  if (!handFactory) {
    handFactory = new XRHandModelFactory();
    handFactory.setPath(`${INPUT_PROFILES_PATH}/generic-hand/`);
  }
  if (!controllerFactory) {
    controllerFactory = new XRControllerModelFactory();
    controllerFactory.setPath(INPUT_PROFILES_PATH);
  }
  return { hands: handFactory, controllers: controllerFactory };
}

/** A factory model has loaded once its mesh (scene) has been added under it. */
export const modelLoaded = (model: THREE.Object3D | null) => !!model && model.children.length > 0;

/**
 * Adds the real hand and controller models of input `index` (0 / 1) to their spaces. Returns
 * whether each has loaded and a dispose. Call it once per renderer (the spaces live as long as
 * it does): every call starts a new model, and the simple ones show until it loads (VS-T26: a
 * remount at each analysis left the dark stand-in on screen). Never throws: offline, the
 * fallbacks just stay.
 */
export function attachInputModels(
  gl: THREE.WebGLRenderer,
  index: number,
  slots: InputModelSlots
): { handLoaded: () => boolean; gripLoaded: () => boolean; dispose: () => void } {
  const added: Array<{ parent: THREE.Object3D; child: THREE.Object3D }> = [];
  const listeners: Array<() => void> = [];
  let handModel: THREE.Object3D | null = null;
  let gripModel: THREE.Object3D | null = null;
  let skinned = false;
  let gripLayered = false;
  if (typeof window === 'undefined')
    return { handLoaded: () => false, gripLoaded: () => false, dispose: () => undefined };
  try {
    skin ??= createHandSkinMaterial();
    const { hands, controllers } = factories();
    const source = gl.xr?.getSession?.()?.inputSources?.[index];
    const space = slots.hand;
    if (space) {
      const make = () => {
        handModel = hands.createHandModel(space, 'mesh');
        space.add(handModel);
        added.push({ parent: space, child: handModel });
        skinned = false;
      };
      make();
      replayConnected(space, source, 'hand');
      // The factory picks the hand's mesh (left / right) on its first connection: when this
      // space later gets the other hand (inputs reordered), a fresh model loads the right one.
      const onConnected = (e: { data?: XRInputSource }) => {
        const was = (handModel as { xrInputSource?: XRInputSource } | null)?.xrInputSource;
        if (!e.data?.hand || !was || was.handedness === e.data.handedness) return;
        if (handModel) space.remove(handModel);
        make();
        replayConnected(space, e.data, 'hand');
      };
      space.addEventListener('connected' as never, onConnected as never);
      listeners.push(() => space.removeEventListener('connected' as never, onConnected as never));
    }
    if (slots.grip) {
      gripModel = controllers.createControllerModel(slots.grip);
      slots.grip.add(gripModel);
      added.push({ parent: slots.grip, child: gripModel });
      replayConnected(slots.grip, source, 'controller');
    }
  } catch {
    // Offline or no WebXR: the fallback models stay.
  }
  const material = skin;
  return {
    handLoaded: () => {
      if (!modelLoaded(handModel)) return false;
      if (!skinned && material) {
        skinned = skinHand(handModel!, material) > 0;
        // Own render layer, like the stand-ins (VS-T30: hidden with one camera switch).
        if (skinned) putOnInputLayer(handModel!);
      }
      return true;
    },
    gripLoaded: () => {
      const ready = modelLoaded(gripModel);
      if (ready && !gripLayered) gripLayered = !!putOnInputLayer(gripModel!);
      if (slots.gripFallback) slots.gripFallback.visible = !ready;
      return ready;
    },
    dispose: () => {
      for (const off of listeners) off();
      for (const { parent, child } of added) parent.remove(child);
    },
  };
}

/**
 * Dev probes (`make vr-probe`, `make vr-sim-probe`): per hand space, its tracked joints, whether
 * the real hand model has its mesh, and whether the joint spheres show.
 */
export function describeXrHands(gl: THREE.WebGLRenderer) {
  return ([0, 1] as const).map((i) => {
    const h = gl.xr.getHand(i) as THREE.Object3D & { joints?: Record<string, unknown> };
    const model = h.children.find((c) => 'motionController' in c);
    return {
      joints: Object.keys(h.joints ?? {}).length,
      real: modelLoaded(model ?? null),
      spheres: h.children.some((c) => c.name === 'hand-joints-mesh' && c.visible),
    };
  });
}
