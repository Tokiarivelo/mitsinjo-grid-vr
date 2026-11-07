import * as THREE from 'three';

const HAND_JOINTS = [
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

interface XREventTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

class LocalXRHandModel extends THREE.Object3D {
  controller: THREE.Object3D;
  handMesh: THREE.InstancedMesh | null = null;
  private readonly matrixTmp = new THREE.Matrix4();
  private readonly scaleTmp = new THREE.Vector3();

  constructor(controller: THREE.Object3D) {
    super();
    this.controller = controller;

    (controller as unknown as XREventTarget).addEventListener('connected', (event: unknown) => {
      const ev = event as { data?: { hand?: unknown } };
      if (ev.data?.hand && !this.handMesh) {
        const geo = new THREE.SphereGeometry(1, 10, 10);
        const mat = new THREE.MeshStandardMaterial({
          color: '#e2e8f0',
          roughness: 0.35,
          metalness: 0.2,
        });
        this.handMesh = new THREE.InstancedMesh(geo, mat, HAND_JOINTS.length);
        this.handMesh.frustumCulled = false;
        this.handMesh.castShadow = true;
        this.add(this.handMesh);
      }
    });

    (controller as unknown as XREventTarget).addEventListener('disconnected', () => {
      if (this.handMesh) {
        this.remove(this.handMesh);
        this.handMesh.geometry.dispose();
        (this.handMesh.material as THREE.Material).dispose();
        this.handMesh = null;
      }
    });
  }

  override updateMatrixWorld(force?: boolean) {
    super.updateMatrixWorld(force);

    if (!this.handMesh) return;
    const joints = (
      this.controller as unknown as {
        joints?: Record<
          string,
          {
            visible: boolean;
            position: THREE.Vector3;
            quaternion: THREE.Quaternion;
            jointRadius?: number;
          }
        >;
      }
    ).joints;
    if (!joints) return;

    let count = 0;
    const defaultRadius = 0.009;

    for (let i = 0; i < HAND_JOINTS.length; i++) {
      const name = HAND_JOINTS[i];
      if (!name) continue;
      const joint = joints[name];
      if (joint?.visible) {
        this.scaleTmp.setScalar(joint.jointRadius || defaultRadius);
        this.matrixTmp.compose(joint.position, joint.quaternion, this.scaleTmp);
        this.handMesh.setMatrixAt(i, this.matrixTmp);
        count++;
      }
    }

    this.handMesh.count = count;
    this.handMesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Creates visual representation for Touch/Quest VR controllers.
 * Includes an ergonomic grip body and a subtle directional pointing beam.
 */
function createControllerVisual(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'controller-visual';

  // Handle grip
  const gripGeo = new THREE.CylinderGeometry(0.016, 0.02, 0.12, 12);
  gripGeo.rotateX(Math.PI / 4);
  gripGeo.translate(0, -0.03, 0.04);
  const gripMat = new THREE.MeshStandardMaterial({
    color: '#262d35',
    roughness: 0.5,
    metalness: 0.2,
  });
  const gripMesh = new THREE.Mesh(gripGeo, gripMat);
  group.add(gripMesh);

  // Controller face / tracking ring
  const ringGeo = new THREE.TorusGeometry(0.045, 0.006, 8, 16);
  ringGeo.rotateX(Math.PI / 3);
  ringGeo.translate(0, 0.02, -0.02);
  const ringMesh = new THREE.Mesh(ringGeo, gripMat);
  group.add(ringMesh);

  // Directional laser pointer ray (2 meters forward along -Z)
  const rayGeo = new THREE.CylinderGeometry(0.0015, 0.0015, 2.0, 6);
  rayGeo.rotateX(-Math.PI / 2);
  rayGeo.translate(0, 0, -1.0);
  const rayMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    transparent: true,
    opacity: 0.45,
  });
  const rayMesh = new THREE.Mesh(rayGeo, rayMat);
  group.add(rayMesh);

  // Targeting pip / reticle dot at 2m
  const pipGeo = new THREE.SphereGeometry(0.008, 8, 8);
  pipGeo.translate(0, 0, -2.0);
  const pipMat = new THREE.MeshBasicMaterial({ color: '#7dd3fc' });
  const pipMesh = new THREE.Mesh(pipGeo, pipMat);
  group.add(pipMesh);

  return group;
}

/**
 * Sets up articulated hands and controller visuals on the XR camera rig.
 * Returns a teardown function to cleanly remove models and listeners.
 */
export function setupXRHandsAndControllers(rig: THREE.Group, gl: THREE.WebGLRenderer): () => void {
  if (!gl?.xr?.getHand || !gl?.xr?.getController) {
    return () => undefined;
  }

  const hands: THREE.Object3D[] = [];
  const controllers: THREE.Object3D[] = [];
  const listeners: Array<() => void> = [];

  for (let i = 0; i < 2; i++) {
    const hand = gl.xr.getHand(i) as THREE.Object3D;
    const handModel = new LocalXRHandModel(hand);
    hand.add(handModel);
    rig.add(hand);
    hands.push(hand);

    const controller = gl.xr.getController(i) as THREE.Object3D;
    let visualGroup: THREE.Group | null = null;

    const onConnected = () => {
      if (visualGroup) controller.remove(visualGroup);
      visualGroup = createControllerVisual();
      controller.add(visualGroup);
    };

    const onDisconnected = () => {
      if (visualGroup) {
        controller.remove(visualGroup);
        visualGroup = null;
      }
    };

    (controller as unknown as XREventTarget).addEventListener('connected', onConnected);
    (controller as unknown as XREventTarget).addEventListener('disconnected', onDisconnected);
    rig.add(controller);
    controllers.push(controller);

    listeners.push(() => {
      (controller as unknown as XREventTarget).removeEventListener('connected', onConnected);
      (controller as unknown as XREventTarget).removeEventListener('disconnected', onDisconnected);
      if (visualGroup) {
        controller.remove(visualGroup);
        visualGroup = null;
      }
    });
  }

  return () => {
    for (const removeListeners of listeners) {
      removeListeners();
    }
    for (const hand of hands) {
      rig.remove(hand);
      while (hand.children.length > 0) {
        const child = hand.children[0];
        if (child) hand.remove(child);
      }
    }
    for (const controller of controllers) {
      rig.remove(controller);
      while (controller.children.length > 0) {
        const child = controller.children[0];
        if (child) controller.remove(child);
      }
    }
  };
}
