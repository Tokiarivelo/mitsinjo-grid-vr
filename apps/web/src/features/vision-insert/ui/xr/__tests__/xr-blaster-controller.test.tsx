import { render, act, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { SpatialTarget } from '../spatial-projection';
import { XRBlasterController } from '../xr-blaster-controller';

// Mock WebXR audio FX
vi.mock('../xr-audio-fx', () => ({
  playLaserShootSound: vi.fn(),
  playScanRadarSound: vi.fn(),
  playTargetHitSound: vi.fn(),
}));

// Shared Three.js / R3F state mocks
let mockUseFrameCallback: ((state: any, delta: number) => void) | null = null;
let mockScene: THREE.Scene;
let mockCamera: THREE.PerspectiveCamera;
let mockGl: {
  domElement: HTMLCanvasElement;
  xr: {
    isPresenting: boolean;
    getController: ReturnType<typeof vi.fn>;
    getControllerGrip?: ReturnType<typeof vi.fn>;
    getHand?: ReturnType<typeof vi.fn>;
    getSession?: ReturnType<typeof vi.fn>;
  };
};

let controller0: THREE.Group;
let controller1: THREE.Group;
let hand0: THREE.Group & { joints?: Record<string, THREE.Group & { jointRadius?: number }> };
let hand1: THREE.Group & { joints?: Record<string, THREE.Group & { jointRadius?: number }> };

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    gl: mockGl,
    camera: mockCamera,
    scene: mockScene,
  }),
  useFrame: (cb: any) => {
    mockUseFrameCallback = cb;
  },
}));

describe('XRBlasterController (VS-T4 Interaction & Tests)', () => {
  const mockTargets: SpatialTarget[] = [
    {
      id: 'target-water-pump',
      detection: {
        id: 'target-water-pump',
        label: 'Water Pump',
        category: 'pump',
        box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      },
      position: [0.8, 1.2, -1.8],
      dimensions: [0.4, 0.6, 0.4],
      hitRadius: 0.35,
    },
  ];

  beforeEach(() => {
    mockScene = new THREE.Scene();
    mockCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    mockCamera.position.set(0, 1.45, 0);
    mockCamera.lookAt(0, 1.45, -1.2);
    mockCamera.updateProjectionMatrix();
    mockCamera.updateMatrixWorld(true);

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    });

    controller0 = new THREE.Group();
    controller1 = new THREE.Group();

    hand0 = new THREE.Group() as any;
    hand0.joints = {};
    hand1 = new THREE.Group() as any;
    hand1.joints = {};

    mockGl = {
      domElement: canvas,
      xr: {
        isPresenting: false,
        getController: vi.fn((idx: number) => (idx === 0 ? controller0 : controller1)),
        getControllerGrip: vi.fn(() => new THREE.Group()),
        getHand: vi.fn((idx: number) => (idx === 0 ? hand0 : hand1)),
        getSession: vi.fn(() => ({
          inputSources: [
            {
              gamepad: {
                hapticActuators: [{ pulse: vi.fn() }],
              },
            },
          ],
        })),
      },
    };
  });

  it('renders root controller group and registers controllers in scene', () => {
    const onHover = vi.fn();
    const onShoot = vi.fn();
    const onScan = vi.fn();

    const { container, unmount } = render(
      <XRBlasterController
        targets={mockTargets}
        materializedIds={new Set()}
        connectedIds={new Set()}
        onHoverTarget={onHover}
        onShootTarget={onShoot}
        onTriggerScan={onScan}
      />
    );

    const root = container.querySelector('[name="xr-blaster-controller-root"]');
    expect(root).toBeTruthy();
    expect(mockScene.children).toContain(controller0);
    expect(mockScene.children).toContain(controller1);

    unmount();
    expect(mockScene.children).not.toContain(controller0);
    expect(mockScene.children).not.toContain(controller1);
  });

  it('triggers onTriggerScan when Controller 0 points at the Air Button and fires select', () => {
    const onHover = vi.fn();
    const onShoot = vi.fn();
    const onScan = vi.fn();

    render(
      <XRBlasterController
        targets={mockTargets}
        materializedIds={new Set()}
        connectedIds={new Set()}
        onHoverTarget={onHover}
        onShootTarget={onShoot}
        onTriggerScan={onScan}
      />
    );

    // Position Controller 0 pointing along -Z directly towards Air Button at (0, 1.45, -1.2)
    controller0.position.set(0, 1.45, 0);
    controller0.rotation.set(0, 0, 0);
    controller0.updateMatrixWorld(true);

    // Dispatch select event on controller0
    act(() => {
      controller0.dispatchEvent({ type: 'select' });
    });

    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('triggers onShootTarget when Controller 1 points at a target and fires select', () => {
    const onHover = vi.fn();
    const onShoot = vi.fn();
    const onScan = vi.fn();

    render(
      <XRBlasterController
        targets={mockTargets}
        materializedIds={new Set()}
        connectedIds={new Set()}
        onHoverTarget={onHover}
        onShootTarget={onShoot}
        onTriggerScan={onScan}
      />
    );

    // Position Controller 1 pointing along -Z towards water pump target at (0.8, 1.2, -1.8)
    controller1.position.set(0.8, 1.2, 0);
    controller1.rotation.set(0, 0, 0);
    controller1.updateMatrixWorld(true);

    act(() => {
      controller1.dispatchEvent({ type: 'select' });
    });

    expect(onShoot).toHaveBeenCalledWith('target-water-pump');
  });

  it('triggers onTriggerScan via Direct Touch when index fingertip enters Air Button radius in WebXR', () => {
    const onHover = vi.fn();
    const onShoot = vi.fn();
    const onScan = vi.fn();

    mockGl.xr.isPresenting = true;

    // Create index finger tip joint on Hand 0
    const tipJoint = new THREE.Group() as THREE.Group & { jointRadius?: number };
    tipJoint.visible = true;
    tipJoint.jointRadius = 0.01;
    // Position directly at Air Button center (0, 1.45, -1.2)
    tipJoint.position.set(0, 1.45, -1.2);
    hand0.joints!['index-finger-tip'] = tipJoint;

    render(
      <XRBlasterController
        targets={mockTargets}
        materializedIds={new Set()}
        connectedIds={new Set()}
        onHoverTarget={onHover}
        onShootTarget={onShoot}
        onTriggerScan={onScan}
      />
    );

    // Run frame update
    act(() => {
      mockUseFrameCallback?.({}, 0.016);
    });

    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('triggers onShootTarget via Direct Touch when index fingertip touches a surrounding appliance target', () => {
    const onHover = vi.fn();
    const onShoot = vi.fn();
    const onScan = vi.fn();

    mockGl.xr.isPresenting = true;

    const tipJoint = new THREE.Group() as THREE.Group & { jointRadius?: number };
    tipJoint.visible = true;
    tipJoint.jointRadius = 0.01;
    // Target position is [0.8, 1.2, -1.8]
    tipJoint.position.set(0.8, 1.2, -1.8);
    hand0.joints!['index-finger-tip'] = tipJoint;

    render(
      <XRBlasterController
        targets={mockTargets}
        materializedIds={new Set()}
        connectedIds={new Set()}
        onHoverTarget={onHover}
        onShootTarget={onShoot}
        onTriggerScan={onScan}
      />
    );

    act(() => {
      mockUseFrameCallback?.({}, 0.016);
    });

    expect(onShoot).toHaveBeenCalledWith('target-water-pump');
  });

  it('triggers onShootTarget via Hand Pinch gesture when fingers pinch along hand ray', () => {
    const onHover = vi.fn();
    const onShoot = vi.fn();
    const onScan = vi.fn();

    mockGl.xr.isPresenting = true;

    // Hand wrist at (0.8, 1.2, 0), index tip pointing towards target at (0.8, 1.2, -1.8)
    const wristJoint = new THREE.Group() as any;
    wristJoint.visible = true;
    wristJoint.position.set(0.8, 1.2, 0);

    const tipJoint = new THREE.Group() as any;
    tipJoint.visible = true;
    tipJoint.position.set(0.8, 1.2, -0.1);

    const thumbJoint = new THREE.Group() as any;
    thumbJoint.visible = true;
    // Placed 1 cm from tip -> Pinch!
    thumbJoint.position.set(0.8, 1.21, -0.1);

    hand0.joints!['wrist'] = wristJoint;
    hand0.joints!['index-finger-tip'] = tipJoint;
    hand0.joints!['thumb-tip'] = thumbJoint;

    render(
      <XRBlasterController
        targets={mockTargets}
        materializedIds={new Set()}
        connectedIds={new Set()}
        onHoverTarget={onHover}
        onShootTarget={onShoot}
        onTriggerScan={onScan}
      />
    );

    act(() => {
      mockUseFrameCallback?.({}, 0.016);
    });

    expect(onShoot).toHaveBeenCalledWith('target-water-pump');
  });

  it('triggers scene object fallback with userData.onSelect (e.g. HUD toggle)', () => {
    const onHover = vi.fn();
    const onShoot = vi.fn();
    const onScan = vi.fn();

    const hudMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    hudMesh.position.set(-0.95, 1.55, -1.2);
    const onSelectHud = vi.fn();
    hudMesh.userData.onSelect = onSelectHud;
    mockScene.add(hudMesh);

    render(
      <XRBlasterController
        targets={mockTargets}
        materializedIds={new Set()}
        connectedIds={new Set()}
        onHoverTarget={onHover}
        onShootTarget={onShoot}
        onTriggerScan={onScan}
      />
    );

    // Controller pointing directly at HUD
    controller0.position.set(-0.95, 1.55, 0);
    controller0.updateMatrixWorld(true);
    hudMesh.updateMatrixWorld(true);

    act(() => {
      controller0.dispatchEvent({ type: 'select' });
    });

    expect(onSelectHud).toHaveBeenCalledTimes(1);
  });

  it('handles desktop mouse click directly through canvas pointerdown', () => {
    const onHover = vi.fn();
    const onShoot = vi.fn();
    const onScan = vi.fn();

    render(
      <XRBlasterController
        targets={mockTargets}
        materializedIds={new Set()}
        connectedIds={new Set()}
        onHoverTarget={onHover}
        onShootTarget={onShoot}
        onTriggerScan={onScan}
      />
    );

    // Aim camera directly at Air Button at (0, 1.45, -1.2)
    mockCamera.position.set(0, 1.45, 0);
    mockCamera.lookAt(0, 1.45, -1.2);
    mockCamera.updateProjectionMatrix();
    mockCamera.updateMatrixWorld(true);

    // Click at center of screen (400, 300) -> NDC (0, 0)
    act(() => {
      fireEvent.pointerDown(mockGl.domElement, {
        button: 0,
        clientX: 400,
        clientY: 300,
      });
    });

    expect(onScan).toHaveBeenCalledTimes(1);
  });
});
