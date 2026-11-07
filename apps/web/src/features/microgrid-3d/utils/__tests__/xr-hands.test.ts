import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { setupXRHandsAndControllers } from '../xr-hands';

describe('setupXRHandsAndControllers', () => {
  it('attaches hand and controller objects to the rig and returns cleanup', () => {
    const rig = new THREE.Group();
    const hand0 = new THREE.Object3D();
    const hand1 = new THREE.Object3D();
    const controller0 = new THREE.Object3D();
    const controller1 = new THREE.Object3D();

    const mockGl = {
      xr: {
        getHand: vi.fn((i: number) => (i === 0 ? hand0 : hand1)),
        getController: vi.fn((i: number) => (i === 0 ? controller0 : controller1)),
      },
    } as unknown as THREE.WebGLRenderer;

    const cleanup = setupXRHandsAndControllers(rig, mockGl);

    expect(rig.children).toContain(hand0);
    expect(rig.children).toContain(hand1);
    expect(rig.children).toContain(controller0);
    expect(rig.children).toContain(controller1);

    // Simulate controller connection event
    controller0.dispatchEvent({
      type: 'connected' as never,
      data: { handedness: 'left', targetRayMode: 'tracked-pointer' },
    } as never);
    expect(controller0.children.length).toBeGreaterThan(0);

    // Cleanup
    cleanup();
    expect(rig.children).not.toContain(hand0);
    expect(rig.children).not.toContain(hand1);
    expect(rig.children).not.toContain(controller0);
    expect(rig.children).not.toContain(controller1);
  });
});
