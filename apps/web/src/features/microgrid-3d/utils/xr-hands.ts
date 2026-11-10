import * as THREE from 'three';

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

  const gripMat = new THREE.MeshStandardMaterial({
    color: '#222831',
    roughness: 0.52,
    metalness: 0.18,
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
  const stickMat = new THREE.MeshStandardMaterial({ color: '#374151', roughness: 0.8 });
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

  return group;
}

/**
 * Creates visual representation for Touch/Quest VR directional laser pointer.
 * Extends forward along -Z in target ray space.
 */
export function createLaserRayModel(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'controller-laser-ray';

  // Laser beam extending 2.5m forward along -Z
  const rayGeo = new THREE.CylinderGeometry(0.0015, 0.0015, 2.5, 6);
  rayGeo.rotateX(-Math.PI / 2);
  rayGeo.translate(0, 0, -1.25);
  const rayMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    transparent: true,
    opacity: 0.65,
  });
  group.add(new THREE.Mesh(rayGeo, rayMat));

  // Glowing reticle dot at 2.5m
  const pipGeo = new THREE.SphereGeometry(0.008, 10, 10);
  pipGeo.translate(0, 0, -2.5);
  const pipMat = new THREE.MeshBasicMaterial({ color: '#7dd3fc' });
  group.add(new THREE.Mesh(pipGeo, pipMat));

  return group;
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
  return mesh;
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
}

interface ModelRef {
  parent: THREE.Object3D;
  child: THREE.Object3D;
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
  const modelRefs: ModelRef[] = [];
  const selectListeners: Array<{ controller: THREE.XRTargetRaySpace; listener: () => void }> = [];

  for (let i = 0; i < 2; i++) {
    // 1. Hands (Joint tracking)
    const handGroup = gl.xr.getHand(i) as THREE.Group & {
      joints?: Record<string, THREE.Group & { jointRadius?: number }>;
    };
    const handMesh = createHandMesh();
    handGroup.add(handMesh);
    rig.add(handGroup);
    hands.push({ group: handGroup, mesh: handMesh });

    // 2. Controller Target Ray (Laser Pointer)
    const controllerRay = gl.xr.getController(i);
    const laserRay = createLaserRayModel();
    controllerRay.add(laserRay);
    rig.add(controllerRay);
    modelRefs.push({ parent: controllerRay, child: laserRay });

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

      let intersects: THREE.Intersection[] = [];
      try {
        intersects = raycaster.intersectObjects(scene.children, true);
      } catch {
        intersects = [];
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
      selectListeners.push({ controller: controllerRay, listener: onSelect });
    }

    // 3. Controller Grip (Physical 3D Controller Body)
    const getGrip = (gl.xr as unknown as { getControllerGrip?: (idx: number) => THREE.Group })
      .getControllerGrip;
    if (typeof getGrip === 'function') {
      const controllerGrip = getGrip.call(gl.xr, i);
      const gripModel = createControllerGripModel();
      controllerGrip.add(gripModel);
      rig.add(controllerGrip);
      modelRefs.push({ parent: controllerGrip, child: gripModel });
    } else {
      // Fallback: attach grip model directly to controllerRay
      const gripModel = createControllerGripModel();
      controllerRay.add(gripModel);
      modelRefs.push({ parent: controllerRay, child: gripModel });
    }
  }

  const update = () => {
    for (const h of hands) updateHandMesh(h.group, h.mesh);
  };

  const dispose = () => {
    for (const item of selectListeners) {
      if (typeof item.controller.removeEventListener === 'function') {
        item.controller.removeEventListener('select', item.listener);
      }
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
