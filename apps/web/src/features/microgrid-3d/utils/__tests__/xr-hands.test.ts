import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createHandMesh,
  HAND_JOINTS,
  setupXRHandsAndControllers,
  updateHandMesh,
} from '../xr-hands';

describe('setupXRHandsAndControllers', () => {
  it('immediately attaches hand, controller ray, and grip objects to the rig and cleans up on dispose', () => {
    const rig = new THREE.Group();
    const hand0 = new THREE.Group() as THREE.Group & {
      joints?: Record<string, THREE.Group & { jointRadius?: number }>;
    };
    const hand1 = new THREE.Group() as THREE.Group & {
      joints?: Record<string, THREE.Group & { jointRadius?: number }>;
    };
    const controller0 = new THREE.Group();
    const controller1 = new THREE.Group();
    const grip0 = new THREE.Group();
    const grip1 = new THREE.Group();

    const mockGl = {
      xr: {
        getHand: vi.fn((i: number) => (i === 0 ? hand0 : hand1)),
        getController: vi.fn((i: number) => (i === 0 ? controller0 : controller1)),
        getControllerGrip: vi.fn((i: number) => (i === 0 ? grip0 : grip1)),
      },
    } as unknown as THREE.WebGLRenderer;

    const handle = setupXRHandsAndControllers(rig, mockGl);

    // Objects are immediately attached without waiting for event races
    expect(rig.children).toContain(hand0);
    expect(rig.children).toContain(hand1);
    expect(rig.children).toContain(controller0);
    expect(rig.children).toContain(controller1);
    expect(rig.children).toContain(grip0);
    expect(rig.children).toContain(grip1);

    // Controller models exist immediately
    expect(controller0.children.length).toBeGreaterThan(0);
    expect(grip0.children.length).toBeGreaterThan(0);
    expect(hand0.children.length).toBeGreaterThan(0);

    // Simulate hand joints in active frame
    hand0.joints = {};
    for (const name of HAND_JOINTS) {
      const jGroup = new THREE.Group() as THREE.Group & { jointRadius?: number };
      jGroup.visible = true;
      jGroup.jointRadius = 0.01;
      hand0.joints[name] = jGroup;
    }

    // Call frame update
    handle.update();
    const handMesh = hand0.children[0] as THREE.InstancedMesh;
    expect(handMesh.count).toBe(HAND_JOINTS.length);
    expect(handMesh.visible).toBe(true);

    // Cleanup via callable or .dispose()
    handle.dispose();
    expect(rig.children).not.toContain(hand0);
    expect(rig.children).not.toContain(hand1);
    expect(rig.children).not.toContain(controller0);
    expect(rig.children).not.toContain(controller1);
    expect(rig.children).not.toContain(grip0);
    expect(rig.children).not.toContain(grip1);
  });

  it('triggers userData.onSelect when controller fires select event at intersecting scene object', () => {
    const rig = new THREE.Group();
    const scene = new THREE.Scene();
    const targetMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    );
    targetMesh.position.set(0, 0, -2);
    const onSelectMock = vi.fn();
    targetMesh.userData.onSelect = onSelectMock;
    scene.add(targetMesh);

    const controller0 = new THREE.Group();
    const controller1 = new THREE.Group();
    const mockGl = {
      xr: {
        getHand: vi.fn(() => new THREE.Group()),
        getController: vi.fn((i: number) => (i === 0 ? controller0 : controller1)),
        getControllerGrip: vi.fn(() => new THREE.Group()),
      },
    } as unknown as THREE.WebGLRenderer;

    const handle = setupXRHandsAndControllers(rig, mockGl, scene);

    // Controller pointing along -Z towards targetMesh at z = -2
    controller0.position.set(0, 0, 0);
    controller0.updateMatrixWorld(true);
    targetMesh.updateMatrixWorld(true);

    // Dispatch select event on controller0
    (controller0 as unknown as { dispatchEvent: (e: { type: string }) => void }).dispatchEvent({
      type: 'select',
    });

    expect(onSelectMock).toHaveBeenCalledTimes(1);

    handle.dispose();
  });

  it('safely raycasts when LineSegments2 with worldUnits=false is in the scene without logging camera errors', () => {
    const rig = new THREE.Group();
    const scene = new THREE.Scene();

    // Mock LineSegments2 behavior that logs error if raycaster.camera is missing
    const mockLine = new THREE.Object3D() as THREE.Object3D & {
      material: { worldUnits: boolean };
    };
    mockLine.material = { worldUnits: false };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockLine.raycast = function (raycaster) {
      if (raycaster.camera === null && !this.material.worldUnits) {
        console.error(
          'LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.'
        );
      }
    };
    scene.add(mockLine);

    const controller0 = new THREE.Group();
    const mockGl = {
      xr: {
        getHand: vi.fn(() => new THREE.Group()),
        getController: vi.fn(() => controller0),
        getControllerGrip: vi.fn(() => new THREE.Group()),
      },
    } as unknown as THREE.WebGLRenderer;

    const camera = new THREE.PerspectiveCamera();
    const handle = setupXRHandsAndControllers(rig, mockGl, scene, camera);

    (controller0 as unknown as { dispatchEvent: (e: { type: string }) => void }).dispatchEvent({
      type: 'select',
    });

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Raycaster.camera'));

    consoleErrorSpy.mockRestore();
    handle.dispose();
  });
});

describe('updateHandMesh', () => {
  it('packs tracked joints from index 0 so a missing joint leaves no stale instance', () => {
    // Regression: joints were written at their joint index while count = tracked joints,
    // so one untracked joint drew a 1 m identity sphere and dropped the pinky tip.
    const hand = new THREE.Group() as THREE.Group & {
      joints?: Record<string, THREE.Group & { jointRadius?: number }>;
    };
    hand.joints = {};
    HAND_JOINTS.forEach((name, i) => {
      if (name === 'wrist') return; // untracked this frame
      const j = Object.assign(new THREE.Group(), { jointRadius: 0.01 });
      j.position.set(i * 0.01, 1.2, -0.3);
      hand.joints![name] = j;
    });
    const mesh = createHandMesh();

    expect(updateHandMesh(hand, mesh)).toBe(HAND_JOINTS.length - 1);
    expect(mesh.count).toBe(HAND_JOINTS.length - 1);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    mesh.getMatrixAt(0, m);
    m.decompose(p, q, s);
    expect(p.x).toBeCloseTo(0.01); // thumb-metacarpal, not the missing wrist
    expect(s.x).toBeCloseTo(0.01);
    mesh.getMatrixAt(mesh.count - 1, m);
    m.decompose(p, q, s);
    expect(p.x).toBeCloseTo((HAND_JOINTS.length - 1) * 0.01); // pinky tip kept
  });

  it('hides the mesh when no joint is tracked', () => {
    const hand = Object.assign(new THREE.Group(), { joints: {} });
    const mesh = createHandMesh();
    expect(updateHandMesh(hand, mesh)).toBe(0);
    expect(mesh.visible).toBe(false);
  });
});
