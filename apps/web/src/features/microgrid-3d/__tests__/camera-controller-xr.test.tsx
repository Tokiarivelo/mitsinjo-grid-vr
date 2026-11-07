import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const three = vi.hoisted(() => ({
  state: {
    invalidate: vi.fn(),
    camera: null as unknown as THREE.Camera,
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

describe('CameraController XR (VR-T2)', () => {
  it('snaps to the VR viewpoint on entry and restores the preset on exit', () => {
    const { rerender } = render(<CameraController preset="village" reducedMotion />);
    expect(camera.position.toArray()).toEqual([...CAMERA_PRESETS.village.position]);
    expect(three.controlsProps.enabled).toBe(true);

    rerender(<CameraController preset="village" reducedMotion xrActive />);
    expect(camera.position.toArray()).toEqual([...XR_VIEWPOINT.position]);
    expect(three.controlsProps.enabled).toBe(false);

    rerender(<CameraController preset="village" reducedMotion />);
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
    expect(camera.position.toArray()).toEqual([...XR_VIEWPOINT.position]);

    rerender(<CameraController preset="village" reducedMotion focusSector="school" />);
    expect(camera.position.toArray()).toEqual(focused);
  });
});
