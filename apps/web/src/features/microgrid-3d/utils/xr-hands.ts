import * as THREE from 'three';
import { attachInputModels } from './xr-input-models';
import { putOnInputLayer } from './xr-inputs-shown';
import { createSurroundingProbe } from './xr-ray-contrast';
import { createRayVisual, type RayVisual } from './xr-ray-visual';
import { dragPoint, findDraggable, type XrDraggable } from './xr-drag';

export const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export type HandJointName = (typeof HAND_JOINTS)[number];

export interface XRHandsHandle {
  (): void;
  update(): void;
  dispose(): void;
}

/**
 * Creates visual representation for Touch/Quest VR controller grip body.
 * Modeled at 1:1 scale for natural hand placement in grip space.
 */
export function createControllerGripModel(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'controller-grip-visual';

  // Light grey, like the Quest 3 Touch Plus the real model shows (a dark stand-in read as a
  // different controller while the real one loads).
  const gripMat = new THREE.MeshStandardMaterial({
    color: '#d9dde3',
    roughness: 0.6,
    metalness: 0,
  });

  // Handle (ergonomic rounded cylinder angled forward in the palm)
  const handleGeo = new THREE.CylinderGeometry(0.016, 0.02, 0.12, 16);
  handleGeo.rotateX(THREE.MathUtils.degToRad(14));
  handleGeo.translate(0, -0.02, 0.02);
  group.add(new THREE.Mesh(handleGeo, gripMat));

  // Top angled disc / faceplate
  const faceGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16);
  faceGeo.rotateX(THREE.MathUtils.degToRad(32));
  faceGeo.translate(0, 0.038, -0.01);
  group.add(new THREE.Mesh(faceGeo, gripMat));

  // Thumbstick
  const stickGeo = new THREE.CylinderGeometry(0.008, 0.006, 0.012, 12);
  stickGeo.rotateX(THREE.MathUtils.degToRad(32));
  stickGeo.translate(0, 0.048, -0.012);
  const stickMat = new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.8 });
  group.add(new THREE.Mesh(stickGeo, stickMat));

  // Buttons A & B (or X & Y)
  const btn1Geo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.005, 10);
  btn1Geo.rotateX(THREE.MathUtils.degToRad(32));
  btn1Geo.translate(0.01, 0.043, -0.002);
  const btn1Mat = new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.4 });
  group.add(new THREE.Mesh(btn1Geo, btn1Mat));

  const btn2Geo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.005, 10);
  btn2Geo.rotateX(THREE.MathUtils.degToRad(32));
  btn2Geo.translate(0.013, 0.035, -0.014);
  const btn2Mat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.4 });
  group.add(new THREE.Mesh(btn2Geo, btn2Mat));

  // Index trigger on the front
  const triggerGeo = new THREE.BoxGeometry(0.012, 0.022, 0.018);
  triggerGeo.translate(0, 0.012, -0.026);
  group.add(new THREE.Mesh(triggerGeo, gripMat));

  // Halo / tracking collar
  const ringGeo = new THREE.TorusGeometry(0.042, 0.005, 8, 20);
  ringGeo.rotateX(THREE.MathUtils.degToRad(42));
  ringGeo.translate(0, 0.03, -0.015);
  group.add(new THREE.Mesh(ringGeo, gripMat));

  // Own render layer: « hands & controllers » hides it with one camera switch (VS-T30).
  return putOnInputLayer(group);
}

/**
 * Creates 25 articulated joint spheres for realistic hand tracking.
 */
export function createHandMesh(): THREE.InstancedMesh {
  // Unit sphere scaled per joint; 0.8 × joint radius keeps fingers distinct.
  const geo = new THREE.SphereGeometry(0.8, 10, 10);
  // Holographic cyan reads as "your hand" against both the video and the dark studio.
  const mat = new THREE.MeshStandardMaterial({
    color: '#7dd3fc',
    emissive: '#0ea5e9',
    emissiveIntensity: 0.35,
    roughness: 0.4,
    metalness: 0.1,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, HAND_JOINTS.length);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.name = 'hand-joints-mesh';
  return putOnInputLayer(mesh);
}

const _handMatrix = new THREE.Matrix4();
const _handScale = new THREE.Vector3();
const DEFAULT_JOINT_RADIUS = 0.009;

type HandGroup = THREE.Group & {
  joints?: Record<string, THREE.Group & { jointRadius?: number }>;
};

/**
 * Copies the tracked joints of one XR hand into its instanced sphere mesh.
 * Visible joints are packed from index 0, so a missing joint never leaves a stale
 * (identity, 1 m) instance on screen. Returns how many joints are tracked.
 */
export function updateHandMesh(group: HandGroup, mesh: THREE.InstancedMesh): number {
  const joints = group.joints;
  let count = 0;
  if (joints) {
    for (const name of HAND_JOINTS) {
      const joint = joints[name];
      if (!joint || !joint.visible) continue;
      _handScale.setScalar(joint.jointRadius || DEFAULT_JOINT_RADIUS);
      _handMatrix.compose(joint.position, joint.quaternion, _handScale);
      mesh.setMatrixAt(count++, _handMatrix);
    }
  }
  mesh.count = count;
  mesh.visible = count > 0;
  if (count > 0) mesh.instanceMatrix.needsUpdate = true;
  return count;
}

interface HandData {
  group: THREE.Group & {
    joints?: Record<string, THREE.Group & { jointRadius?: number }>;
  };
  mesh: THREE.InstancedMesh;
  /** The real hand model has loaded: the joint spheres hide. */
  real: () => boolean;
}

interface RayData {
  space: THREE.XRTargetRaySpace;
  visual: RayVisual;
  pressed: boolean;
  /** What the held trigger drags (a fader, VS-T34), null otherwise. */
  drag: XrDraggable | null;
}

/** Things a pointer can use: panels (`userData.xrUi`) and anything with a select handler. */
function usableObjects(scene: THREE.Scene): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const h = o as THREE.Object3D & { __r3f?: { handlers?: { onClick?: unknown } } };
    if (
      o.userData?.xrUi ||
      o.userData?.onSelect ||
      o.userData?.onDrag ||
      o.userData?.onClick ||
      h.__r3f?.handlers?.onClick
    )
      out.push(o);
  });
  return out;
}

/**
 * Hits of `caster` on the usable objects, nearest first, into `out`. Each object is tried alone:
 * one that throws (a `Line2` cable, a sprite without camera…) is skipped instead of emptying the
 * whole pick. Before, a click raycast the whole scene in one call and a throw anywhere on the ray
 * made it hit nothing: « Close » or the left laser did nothing while the beam sat on a button.
 */
export function pickUsable(
  caster: THREE.Raycaster,
  objects: readonly THREE.Object3D[],
  out: THREE.Intersection[]
): THREE.Intersection[] {
  out.length = 0;
  for (const o of objects) {
    try {
      caster.intersectObject(o, true, out);
    } catch {
      // Not pickable from this ray: ignore it.
    }
  }
  out.sort((a, b) => a.distance - b.distance);
  // A usable object inside another usable one is hit twice: keep its nearest hit only.
  let n = 0;
  for (let i = 0; i < out.length; i++) {
    const h = out[i]!;
    let seen = false;
    for (let j = 0; j < n && !seen; j++) seen = out[j]!.object === h.object;
    if (!seen) out[n++] = h;
  }
  out.length = n;
  return out;
}

/** Frames between two refreshes of the usable objects list (they rarely change). */
const USABLE_REFRESH_FRAMES = 30;
const _rayCaster = new THREE.Raycaster();
const _rayHits: THREE.Intersection[] = [];
const _rayO = new THREE.Vector3();
const _rayD = new THREE.Vector3();
const _rayLocalO = new THREE.Vector3(0, 0, 0);
const _rayLocalD = new THREE.Vector3(0, 0, -1);
const _rayEnd = new THREE.Vector3();
const _dragCaster = new THREE.Raycaster();
const _dragO = new THREE.Vector3();
const _dragD = new THREE.Vector3();
const _dragLocal = new THREE.Vector3();

interface ModelRef {
  parent: THREE.Object3D;
  child: THREE.Object3D;
}

/**
 * Creates the XR controller, grip and hand spaces up front (canvas creation), so three.js tracks
 * the inputs that connect when the session starts. Built later (on the rig, after `xrActive`),
 * they were never connected: rays, grips and legends stayed hidden (VSIM-T1 regression).
 */
export function primeXrInputs(gl: THREE.WebGLRenderer): void {
  const xr = gl?.xr as
    (THREE.WebXRManager & { getControllerGrip?: (i: number) => THREE.Group }) | undefined;
  if (!xr?.getController) return;
  for (let i = 0; i < 2; i++) {
    xr.getController(i);
    xr.getControllerGrip?.(i);
    xr.getHand?.(i);
  }
}

/**
 * Sets up articulated hands and controller visuals on the XR camera rig.
 * Immediately initializes visuals without relying on missed event listener races.
 * Returns a handle with .update() for useFrame and .dispose() for session exit.
 */
export function setupXRHandsAndControllers(
  rig: THREE.Group,
  gl: THREE.WebGLRenderer,
  scene?: THREE.Scene,
  camera?: THREE.Camera
): XRHandsHandle {
  if (!gl?.xr?.getHand || !gl?.xr?.getController) {
    const noop = (() => undefined) as XRHandsHandle;
    noop.update = () => undefined;
    noop.dispose = () => undefined;
    return noop;
  }

  const hands: HandData[] = [];
  const rays: RayData[] = [];
  const models: Array<{ gripLoaded: () => boolean; dispose: () => void }> = [];
  const modelRefs: ModelRef[] = [];
  const selectListeners: Array<{
    controller: THREE.XRTargetRaySpace;
    listener: () => void;
    type: 'select' | 'selectstart' | 'selectend';
  }> = [];

  for (let i = 0; i < 2; i++) {
    // 1. Hands (Joint tracking)
    const handGroup = gl.xr.getHand(i) as THREE.Group & {
      joints?: Record<string, THREE.Group & { jointRadius?: number }>;
    };
    const handMesh = createHandMesh();
    handGroup.add(handMesh);
    rig.add(handGroup);

    // 2. Controller Target Ray: a short beam + cursor ring (Meta ray spec, VS-T26).
    const controllerRay = gl.xr.getController(i);
    const ray: RayData = {
      space: controllerRay,
      visual: createRayVisual(),
      pressed: false,
      drag: null,
    };
    controllerRay.add(ray.visual.group);
    rig.add(controllerRay);
    rays.push(ray);
    const onPress = () => {
      ray.pressed = true;
      // Trigger pressed on a fader: it follows the ray until release (VS-T34).
      if (!scene) return;
      controllerRay.updateMatrixWorld(true);
      controllerRay.getWorldPosition(_dragO);
      _dragD.set(0, 0, -1).transformDirection(controllerRay.matrixWorld);
      _dragCaster.set(_dragO, _dragD);
      _dragCaster.camera = (gl.xr.isPresenting ? gl.xr.getCamera() : camera) ?? _dragCaster.camera;
      const hits = pickUsable(_dragCaster, usableObjects(scene), []);
      ray.drag = findDraggable(hits);
      if (ray.drag && dragPoint(ray.drag, _dragO, _dragD, _dragLocal)) {
        ray.drag.userData.onDrag?.(_dragLocal);
      }
    };
    const onLift = () => {
      ray.pressed = false;
      const held = ray.drag;
      ray.drag = null;
      held?.userData.onDragEnd?.();
    };
    controllerRay.addEventListener?.('selectstart', onPress);
    controllerRay.addEventListener?.('selectend', onLift);
    selectListeners.push({ controller: controllerRay, listener: onPress, type: 'selectstart' });
    selectListeners.push({ controller: controllerRay, listener: onLift, type: 'selectend' });

    // WebXR Trigger / Select event handler: raycast along laser pointer to trigger interactive objects
    const onSelect = () => {
      if (!scene) return;
      const raycaster = new THREE.Raycaster();
      // LineSegments2 / Line2 in the scene (power lines, cables) require raycaster.camera
      // when worldUnits is false. Set camera from WebXR presentation or viewport fallback.
      const activeCamera =
        (gl?.xr?.isPresenting ? gl.xr.getCamera() : null) ||
        camera ||
        new THREE.PerspectiveCamera();
      raycaster.camera = activeCamera;

      const origin = new THREE.Vector3();
      const direction = new THREE.Vector3(0, 0, -1);
      controllerRay.getWorldPosition(origin);
      direction.transformDirection(controllerRay.matrixWorld).normalize();
      raycaster.set(origin, direction);

      const intersects = pickUsable(raycaster, usableObjects(scene), []);
      // Panels drawn on top of everything (`userData.xrUi`) win over what the ray crosses first
      // (a house wall between you and the panel when you stand against it).
      const ui = intersects.find((h) => h.object.userData?.xrUi && h.object.userData?.onSelect);
      if (ui) {
        ui.object.userData.onSelect({ stopPropagation: () => {} });
        return;
      }
      for (const hit of intersects) {
        let curr: THREE.Object3D | null = hit.object;
        while (curr) {
          const handler =
            curr.userData?.onSelect ||
            curr.userData?.onClick ||
            (curr as unknown as { __r3f?: { handlers?: { onClick?: (e: unknown) => void } } }).__r3f
              ?.handlers?.onClick;
          if (typeof handler === 'function') {
            handler({ stopPropagation: () => {} });
            return;
          }
          curr = curr.parent;
        }
      }
    };

    if (typeof controllerRay.addEventListener === 'function') {
      controllerRay.addEventListener('select', onSelect);
      selectListeners.push({ controller: controllerRay, listener: onSelect, type: 'select' });
    }

    // 3. Controller Grip (Physical 3D Controller Body)
    const getGrip = (gl.xr as unknown as { getControllerGrip?: (idx: number) => THREE.Group })
      .getControllerGrip;
    let controllerGrip: THREE.Group | null = null;
    let gripModel: THREE.Group | null = null;
    if (typeof getGrip === 'function') {
      controllerGrip = getGrip.call(gl.xr, i);
      gripModel = createControllerGripModel();
      controllerGrip.add(gripModel);
      rig.add(controllerGrip);
      modelRefs.push({ parent: controllerGrip, child: gripModel });
    } else {
      // Fallback: attach grip model directly to controllerRay
      const gripModel = createControllerGripModel();
      controllerRay.add(gripModel);
      modelRefs.push({ parent: controllerRay, child: gripModel });
    }

    // 4. Real hand and controller models; the simple ones stay until they load (offline: always).
    const real = attachInputModels(gl, i, {
      hand: handGroup,
      ...(controllerGrip ? { grip: controllerGrip } : {}),
      ...(gripModel ? { gripFallback: gripModel } : {}),
    });
    models.push(real);
    hands.push({ group: handGroup, mesh: handMesh, real: real.handLoaded });
  }

  let usable: THREE.Object3D[] = [];
  let frame = 0;
  let last = performance.now();
  const probe = createSurroundingProbe();
  const update = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const h of hands) {
      updateHandMesh(h.group, h.mesh);
      if (h.real()) h.mesh.visible = false;
    }
    for (const m of models) m.gripLoaded(); // shows the simple controller only until the real one
    if (scene && frame++ % USABLE_REFRESH_FRAMES === 0) usable = usableObjects(scene);
    for (const r of rays) {
      if (!r.space.visible) {
        r.visual.hide();
        continue;
      }
      r.space.updateMatrixWorld(true);
      r.space.getWorldPosition(_rayO);
      _rayD.set(0, 0, -1).transformDirection(r.space.matrixWorld);
      if (r.drag && dragPoint(r.drag, _rayO, _rayD, _dragLocal))
        r.drag.userData.onDrag?.(_dragLocal);
      _rayCaster.set(_rayO, _rayD);
      _rayCaster.camera = (gl.xr.isPresenting ? gl.xr.getCamera() : camera) ?? _rayCaster.camera;
      pickUsable(_rayCaster, usable, _rayHits);
      const hit = _rayHits[0];
      // The visual lives in the controller's space: the hit is put back in it (the rig may be
      // scaled, VS-T33: world metres ÷ that scale).
      const spaceScale = r.space.matrixWorld.getMaxScaleOnAxis() || 1;
      _rayEnd.set(0, 0, -(hit ? hit.distance / spaceScale : 2.5));
      r.visual.update({
        origin: _rayLocalO,
        direction: _rayLocalD,
        end: _rayEnd,
        usable: !!hit,
        input: 'controller',
        pressed: r.pressed,
        tint: '#7dd3fc',
        surrounding: scene
          ? probe(rays.indexOf(r) as 0 | 1, scene, _rayO, _rayD, _rayCaster.camera)
          : 0,
        dt,
      });
    }
  };

  const dispose = () => {
    for (const item of selectListeners) {
      if (typeof item.controller.removeEventListener === 'function') {
        item.controller.removeEventListener(item.type, item.listener);
      }
    }
    for (const m of models) m.dispose();
    for (const r of rays) {
      r.space.remove(r.visual.group);
      r.visual.dispose();
      rig.remove(r.space);
    }
    for (const h of hands) {
      rig.remove(h.group);
      h.group.remove(h.mesh);
      h.mesh.geometry.dispose();
      (h.mesh.material as THREE.Material).dispose();
    }
    for (const ref of modelRefs) {
      ref.parent.remove(ref.child);
      rig.remove(ref.parent);
      ref.child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material?.dispose();
          }
        }
      });
    }
  };

  const handle = (() => dispose()) as XRHandsHandle;
  handle.update = update;
  handle.dispose = dispose;
  return handle;
}
