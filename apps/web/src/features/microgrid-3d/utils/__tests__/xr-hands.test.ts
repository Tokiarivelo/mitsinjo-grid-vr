import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HAND_JOINTS, setupXRHandsAndControllers } from '../xr-hands';

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
});
