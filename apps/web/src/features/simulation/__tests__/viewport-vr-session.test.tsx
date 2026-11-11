import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { scenarios, simulate } from '@mitsinjo/engine';

const three = vi.hoisted(() => ({
  state: {
    invalidate: vi.fn(),
    camera: null as unknown as THREE.Camera,
    scene: null as unknown as THREE.Scene,
  },
  frameCb: null as null | ((state: { invalidate: () => void }, delta: number) => void),
  controlsProps: null as unknown as Record<string, unknown>,
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (s: typeof three.state) => unknown) => selector(three.state),
  useFrame: (cb: (state: { invalidate: () => void }, delta: number) => void) => {
    three.frameCb = cb;
  },
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: (props: Record<string, unknown>) => {
    three.controlsProps = props;
    return null;
  },
}));

const seen = vi.hoisted(() => ({
  rendererRef: null as unknown,
  xrActive: [] as unknown[],
}));

// Real barrel (real useWebXR, real toSceneModel): only the WebGL canvas is a harness
// that renders the real CameraController with the xrActive the viewport computes.
vi.mock('@/features/microgrid-3d', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/microgrid-3d')>();
  const { CameraController } = await import('@/features/microgrid-3d/ui/camera-controller');
  return {
    ...actual,
    useWebGLAvailable: () => true,
    LazyVillageCanvas: (props: { rendererRef?: unknown; xrActive?: boolean }) => {
      seen.rendererRef = props.rendererRef ?? null;
      seen.xrActive.push(props.xrActive ?? null);
      return <CameraController preset="village" xrActive={props.xrActive} />;
    },
  };
});

import { CAMERA_PRESETS, XR_VIEWPOINT } from '@/features/microgrid-3d/ui/camera-controller';
import { VillageViewport } from '../ui/village-viewport';

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1500);
three.state.camera = camera;
three.state.scene = new THREE.Scene();

interface CreatedSession {
  /** Fire the 'end' event exactly like a headset system gesture: no end() call. */
  gestureEnd: () => void;
  end: ReturnType<typeof vi.fn>;
}

/** Scripted stand-in for the headset runtime: enter/exit plus the system-gesture end. */
function scriptedXR() {
  const created: CreatedSession[] = [];
  const xr = {
    isSessionSupported: vi.fn(async () => true),
    requestSession: vi.fn(async () => {
      const listeners = new Set<() => void>();
      const fireEnd = () => listeners.forEach((cb) => cb());
      const end = vi.fn(async () => fireEnd());
      const session = {
        addEventListener: (type: string, cb: () => void) => {
          if (type === 'end') listeners.add(cb);
        },
        removeEventListener: (type: string, cb: () => void) => {
          if (type === 'end') listeners.delete(cb);
        },
        end,
      } as unknown as XRSession;
      created.push({ gestureEnd: fireEnd, end });
      return session;
    }),
  };
  return { xr, created };
}

function mockRendererRef() {
  return {
    current: {
      xr: { enabled: false, setSession: vi.fn(async () => undefined) },
    } as unknown as THREE.WebGLRenderer,
  };
}

/** Run captured camera frames until the tween settles (or the cap). Returns frames used. */
function driveFrames(cap = 600): number {
  let used = 0;
  for (; used < cap; used++) {
    three.frameCb?.({ invalidate: () => {} }, 1 / 60);
    if (camera.position.distanceTo(new THREE.Vector3(...CAMERA_PRESETS.village.position)) < 0.1)
      break;
  }
  return used;
}

afterEach(() => {
  vi.unstubAllGlobals();
  seen.xrActive.length = 0;
});

describe('VillageViewport VR session, single pass (enter → gesture exit → exit)', () => {
  it('drives the button, session, camera snap and restore through the public interface', async () => {
    const { xr, created } = scriptedXR();
    vi.stubGlobal('navigator', { xr });
    const input = scenarios.baseline.input;
    const result = simulate(input, 'proportional');
    const rendererRef = mockRendererRef();
    render(
      <VillageViewport
        input={input}
        result={result}
        selectedSector={null}
        onSelectSector={() => {}}
        timeIndex={12}
      />
    );

    // Detection through the real hook: the button appears, camera on the 2D preset.
    const enterButton = await screen.findByRole('button', { name: 'View in VR' });
    expect(camera.position.toArray()).toEqual([...CAMERA_PRESETS.village.position]);
    expect(three.controlsProps.enabled).toBe(true);

    // The canvas mount fills the ref (mount path covered in village-canvas-xr).
    (seen.rendererRef as { current: unknown }).current = rendererRef.current;

    // Enter: session opens, canvas flips to XR, camera snaps to the VR viewpoint.
    fireEvent.click(enterButton);
    const exitButton = await screen.findByRole('button', { name: 'Exit VR' });
    expect(exitButton).toHaveAttribute('aria-pressed', 'true');
    expect(xr.requestSession).toHaveBeenCalledWith(
      'immersive-vr',
      expect.objectContaining({ optionalFeatures: expect.arrayContaining(['local-floor']) })
    );
    // The XR flag and the camera rig land in effects after the button flips: wait for them (seen racing on CI).
    await waitFor(() => expect(seen.xrActive[seen.xrActive.length - 1]).toBe(true));
    // Headset owns the camera in XR: it hangs under a rig at the VR viewpoint.
    await waitFor(() => expect(camera.parent).toBeInstanceOf(THREE.Group));
    const world = new THREE.Vector3();
    camera.getWorldPosition(world);
    expect(world.distanceTo(new THREE.Vector3(...XR_VIEWPOINT.position))).toBeLessThan(1e-6);
    expect(three.controlsProps.enabled).toBe(false);

    // Headset system gesture ends the session outside the button: the UI resyncs …
    expect(created.length).toBe(1);
    act(() => {
      created[0]?.gestureEnd();
    });
    await screen.findByRole('button', { name: 'View in VR' });
    expect(created[0]?.end).not.toHaveBeenCalled();
    expect(seen.xrActive[seen.xrActive.length - 1]).toBe(false);

    // … and the camera tweens back across frames, then controls re-enable.
    const framesUsed = driveFrames();
    expect(framesUsed).toBeGreaterThan(1);
    expect(framesUsed).toBeLessThan(600);
    expect(
      camera.position.distanceTo(new THREE.Vector3(...CAMERA_PRESETS.village.position))
    ).toBeLessThan(0.1);
    expect(three.controlsProps.enabled).toBe(true);

    // Second session, this time exited from the button.
    fireEvent.click(await screen.findByRole('button', { name: 'View in VR' }));
    const exitAgain = await screen.findByRole('button', { name: 'Exit VR' });
    fireEvent.click(exitAgain);
    await screen.findByRole('button', { name: 'View in VR' });
    expect(seen.xrActive[seen.xrActive.length - 1]).toBe(false);
  });
});
