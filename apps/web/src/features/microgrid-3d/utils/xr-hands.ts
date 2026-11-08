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
function createControllerGripModel(): THREE.Group {
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
function createLaserRayModel(): THREE.Group {
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
function createHandMesh(): THREE.InstancedMesh {
  const geo = new THREE.SphereGeometry(1, 10, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: '#e2e8f0',
    roughness: 0.35,
    metalness: 0.2,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, HAND_JOINTS.length);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.name = 'hand-joints-mesh';
  return mesh;
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
  gl: THREE.WebGLRenderer
): XRHandsHandle {
  if (!gl?.xr?.getHand || !gl?.xr?.getController) {
    const noop = (() => undefined) as XRHandsHandle;
    noop.update = () => undefined;
    noop.dispose = () => undefined;
    return noop;
  }

  const hands: HandData[] = [];
  const modelRefs: ModelRef[] = [];
  const matrixTmp = new THREE.Matrix4();
  const scaleTmp = new THREE.Vector3();

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
    const controllerRay = gl.xr.getController(i) as THREE.Group;
    const laserRay = createLaserRayModel();
    controllerRay.add(laserRay);
    rig.add(controllerRay);
    modelRefs.push({ parent: controllerRay, child: laserRay });

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
    for (const h of hands) {
      const joints = h.group.joints;
      if (!joints || Object.keys(joints).length === 0) {
        h.mesh.visible = false;
        continue;
      }
      let activeCount = 0;
      const defaultRadius = 0.009;
      for (let j = 0; j < HAND_JOINTS.length; j++) {
        const name = HAND_JOINTS[j];
        if (!name) continue;
        const joint = joints[name];
        if (joint && joint.visible) {
          scaleTmp.setScalar(joint.jointRadius || defaultRadius);
          matrixTmp.compose(joint.position, joint.quaternion, scaleTmp);
          h.mesh.setMatrixAt(j, matrixTmp);
          activeCount++;
        }
      }
      h.mesh.count = activeCount;
      h.mesh.visible = activeCount > 0;
      if (activeCount > 0) {
        h.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  };

  const dispose = () => {
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
