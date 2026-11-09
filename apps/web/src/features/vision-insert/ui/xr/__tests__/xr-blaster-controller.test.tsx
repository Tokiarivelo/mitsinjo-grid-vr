import { render, act, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { SpatialTarget } from '../spatial-projection';
import { projectDetectionsTo3D } from '../spatial-projection';
import { screenPoint } from '../webcam-screen';
import { AIR_BUTTON_POSITION } from '../xr-layout';
import { XRBlasterController } from '../xr-blaster-controller';

vi.mock('../xr-audio-fx', () => ({
  playLaserShootSound: vi.fn(),
  playScanRadarSound: vi.fn(),
  playTargetHitSound: vi.fn(),
}));

type Hand = THREE.Group & { joints?: Record<string, THREE.Group & { jointRadius?: number }> };

let frame: ((state: unknown, delta: number) => void) | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controller0: THREE.Group;
let controller1: THREE.Group;
let hand0: Hand;
let hand1: Hand;
let gl: {
  domElement: HTMLCanvasElement;
  xr: {
    isPresenting: boolean;
    getController: (i: number) => THREE.Group;
    getControllerGrip: () => THREE.Group;
    getHand: (i: number) => Hand;
  };
};

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({ gl, camera, scene }),
  useFrame: (cb: (state: unknown, delta: number) => void) => {
    frame = cb;
  },
}));

const EYE = new THREE.Vector3(0, 1.6, 0);

const FORWARD = new THREE.Vector3(0, 0, -1);

/** Points a controller's -Z ray (WebXR target ray) from the eye at a world point. */
function aim(ctrl: THREE.Group, at: [number, number, number], from = EYE) {
  ctrl.position.copy(from);
  const dir = new THREE.Vector3(...at).sub(from).normalize();
  ctrl.quaternion.setFromUnitVectors(FORWARD, dir);
  ctrl.updateMatrixWorld(true);
}

const [fridge] = projectDetectionsTo3D([
  {
    id: 'fridge',
    label: 'Fridge',
    category: 'fridge',
    box: { x: 0.13, y: 0.22, w: 0.17, h: 0.66 },
  },
]) as [SpatialTarget];
const fridgeOnVideo = screenPoint(0.21, 0.55);

function setup(targets: SpatialTarget[] = [fridge]) {
  const props = {
    targets,
    onHoverTarget: vi.fn(),
    onShootTarget: vi.fn(),
    onTriggerScan: vi.fn(),
    onShootScreen: vi.fn(),
  };
  const view = render(<XRBlasterController {...props} />);
  return { ...props, ...view };
}

describe('XRBlasterController (VS-T4)', () => {
  beforeEach(() => {
    frame = null;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 100);
    camera.position.copy(EYE);
    camera.lookAt(...AIR_BUTTON_POSITION);
    camera.updateMatrixWorld(true);
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    });
    controller0 = new THREE.Group();
    controller1 = new THREE.Group();
    hand0 = Object.assign(new THREE.Group(), { joints: {} });
    hand1 = Object.assign(new THREE.Group(), { joints: {} });
    gl = {
      domElement: canvas,
      xr: {
        isPresenting: false,
        getController: (i) => (i === 0 ? controller0 : controller1),
        getControllerGrip: () => new THREE.Group(),
        getHand: (i) => (i === 0 ? hand0 : hand1),
      },
    };
  });

  it('adds both XR pointers to the scene and removes them on unmount', () => {
    const { container, unmount } = setup();
    expect(container.querySelector('[name="xr-blaster-controller-root"]')).toBeTruthy();
    expect(scene.children).toEqual(expect.arrayContaining([controller0, controller1]));
    unmount();
    expect(scene.children).not.toContain(controller0);
    expect(scene.children).not.toContain(controller1);
  });

  it('presses the scan button once per trigger press (selectstart only, no select double-fire)', () => {
    const { onTriggerScan } = setup();
    aim(controller0, AIR_BUTTON_POSITION);
    act(() => {
      controller0.dispatchEvent({ type: 'selectstart' } as never);
      controller0.dispatchEvent({ type: 'select' } as never);
    });
    expect(onTriggerScan).toHaveBeenCalledTimes(1);
  });

  it('hits the object seen in the webcam video and pulses that controller', () => {
    const { onShootTarget, onShootScreen } = setup();
    const pulse = vi.fn();
    aim(controller1, fridgeOnVideo);
    act(() => {
      controller1.dispatchEvent({
        type: 'selectstart',
        data: { gamepad: { hapticActuators: [{ pulse }] } },
      } as never);
    });
    expect(onShootTarget).toHaveBeenCalledWith('fridge');
    expect(onShootScreen).not.toHaveBeenCalled();
    expect(pulse).toHaveBeenCalledTimes(1);
  });

  it('reports the image point when the video is hit outside every detection', () => {
    const { onShootTarget, onShootScreen } = setup([]);
    aim(controller0, screenPoint(0.8, 0.3));
    act(() => {
      controller0.dispatchEvent({ type: 'selectstart' } as never);
    });
    expect(onShootTarget).not.toHaveBeenCalled();
    expect(onShootScreen).toHaveBeenCalledTimes(1);
    const [u, v] = onShootScreen.mock.calls[0]!;
    expect(u).toBeCloseTo(0.8, 3);
    expect(v).toBeCloseTo(0.3, 3);
  });

  it('presses the scan button with a fingertip, once per touch', () => {
    gl.xr.isPresenting = true;
    const tip = Object.assign(new THREE.Group(), { jointRadius: 0.01 });
    tip.position.set(...AIR_BUTTON_POSITION);
    hand0.joints!['index-finger-tip'] = tip;
    const { onTriggerScan } = setup();
    act(() => {
      frame?.({}, 0.016);
      frame?.({}, 0.016);
    });
    expect(onTriggerScan).toHaveBeenCalledTimes(1);
  });

  it('does not shoot from a pinch on its own: the native select event does it (no double shot)', () => {
    gl.xr.isPresenting = true;
    const joint = (x: number, y: number, z: number) => {
      const j = Object.assign(new THREE.Group(), { jointRadius: 0.01 });
      j.position.set(x, y, z);
      return j;
    };
    hand0.joints!['wrist'] = joint(0, 1.3, -0.3);
    hand0.joints!['index-finger-tip'] = joint(0, 1.3, -0.4);
    hand0.joints!['thumb-tip'] = joint(0, 1.31, -0.4);
    const { onShootTarget, onTriggerScan } = setup();
    act(() => frame?.({}, 0.016));
    expect(onShootTarget).not.toHaveBeenCalled();
    expect(onTriggerScan).not.toHaveBeenCalled();
  });

  it('falls back to scene objects carrying userData.onSelect (HUD toggle)', () => {
    const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshBasicMaterial());
    hud.position.set(-0.78, 1.12, -0.82);
    hud.lookAt(EYE); // a plane's front (+Z) faces the viewer
    hud.userData.onSelect = vi.fn();
    scene.add(hud);
    hud.updateMatrixWorld(true);
    setup();
    aim(controller0, [-0.78, 1.12, -0.82]);
    act(() => {
      controller0.dispatchEvent({ type: 'selectstart' } as never);
    });
    expect(hud.userData.onSelect).toHaveBeenCalledTimes(1);
  });

  it('shoots with a mouse click (desktop and IWER emulator)', () => {
    const { onTriggerScan } = setup();
    act(() => {
      fireEvent.pointerDown(gl.domElement, { button: 0, clientX: 400, clientY: 300 });
    });
    expect(onTriggerScan).toHaveBeenCalledTimes(1);
  });

  it('reports hover on the target under the laser', () => {
    gl.xr.isPresenting = true;
    const { onHoverTarget } = setup();
    aim(controller0, fridgeOnVideo);
    controller1.visible = false;
    act(() => frame?.({}, 0.016));
    expect(onHoverTarget).toHaveBeenLastCalledWith('fridge');
  });
});
