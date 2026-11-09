import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const three = vi.hoisted(() => ({
  state: {
    invalidate: vi.fn(),
    camera: null as unknown as THREE.Camera,
    scene: null as unknown as THREE.Scene,
  },
  controlsProps: null as unknown as Record<string, unknown>,
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (s: typeof three.state) => unknown) => selector(three.state),
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: (props: Record<string, unknown>) => {
    three.controlsProps = props;
    return null;
  },
}));

import { CAMERA_PRESETS, CameraController, XR_VIEWPOINT } from '../ui/camera-controller';

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1500);
three.state.camera = camera;
three.state.scene = new THREE.Scene();

/** The headset pose overwrites the camera each frame, so XR entry parents it to a rig. */
function expectRiggedAtViewpoint() {
  const rig = camera.parent;
  expect(rig).toBeInstanceOf(THREE.Group);
  expect(rig?.position.toArray()).toEqual([...XR_VIEWPOINT.position]);
  // Headset drives the camera relative to the rig: local transform is identity …
  expect(camera.position.toArray()).toEqual([0, 0, 0]);
  expect(camera.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  // … world viewpoint sits on XR_VIEWPOINT, aimed at its target.
  const world = new THREE.Vector3();
  camera.getWorldPosition(world);
  expect(world.distanceTo(new THREE.Vector3(...XR_VIEWPOINT.position))).toBeLessThan(1e-6);
  const aimed = new THREE.Vector3(...XR_VIEWPOINT.target)
    .sub(new THREE.Vector3(...XR_VIEWPOINT.position))
    .normalize();
  expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(aimed)).toBeLessThan(1e-6);
  return rig as THREE.Group;
}

describe('CameraController XR (VR-T2)', () => {
  it('rigs the camera at the VR viewpoint on entry and restores the preset on exit', () => {
    const { rerender } = render(<CameraController preset="village" reducedMotion />);
    expect(camera.position.toArray()).toEqual([...CAMERA_PRESETS.village.position]);
    expect(three.controlsProps.enabled).toBe(true);

    rerender(<CameraController preset="village" reducedMotion xrActive />);
    const rig = expectRiggedAtViewpoint();
    expect(three.controlsProps.enabled).toBe(false);

    rerender(<CameraController preset="village" reducedMotion />);
    expect(camera.parent).toBe(three.state.scene);
    expect(three.state.scene.children).not.toContain(rig);
    expect(camera.position.toArray()).toEqual([...CAMERA_PRESETS.village.position]);
    expect(three.controlsProps.enabled).toBe(true);
  });

  it('restores the focused sector on exit, not the preset', () => {
    const { rerender } = render(
      <CameraController preset="village" reducedMotion focusSector="school" />
    );
    const focused = camera.position.toArray();
    expect(focused).not.toEqual([...CAMERA_PRESETS.village.position]);

    rerender(<CameraController preset="village" reducedMotion focusSector="school" xrActive />);
    const rig = expectRiggedAtViewpoint();

    rerender(<CameraController preset="village" reducedMotion focusSector="school" />);
    expect(camera.parent).toBe(three.state.scene);
    expect(three.state.scene.children).not.toContain(rig);
    expect(camera.position.toArray()).toEqual(focused);
  });
});
