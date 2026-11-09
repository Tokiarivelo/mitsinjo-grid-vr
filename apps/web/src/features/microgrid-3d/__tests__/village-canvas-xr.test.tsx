import { Children, isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { scenarios, simulate } from '@mitsinjo/engine';
import type { WebGLRenderer } from 'three';

interface CapturedCanvasProps {
  frameloop?: unknown;
  onCreated?: (state: {
    gl: unknown;
    get: () => { internal: { active: boolean } };
    scene: unknown;
    camera: unknown;
  }) => void;
  children?: ReactNode;
}

const captured = vi.hoisted(() => ({ props: null as CapturedCanvasProps | null }));

// Capture the Canvas props (frameloop, onCreated, children) without rendering the
// scene: children elements are created but never mounted, so their hooks never run.
vi.mock('@react-three/fiber', () => ({
  Canvas: (props: CapturedCanvasProps) => {
    captured.props = props;
    return <div data-testid="mock-canvas" />;
  },
}));

// Explicit members only: a catch-all Proxy answers a function for `then`, turning the
// mocked namespace into a thenable that never settles and hangs module loading.
vi.mock('@react-three/drei', () => {
  const stub = () => null;
  const useGLTF = Object.assign(() => ({ nodes: {}, materials: {} }), { preload: () => {} });
  return {
    Instance: stub,
    Instances: stub,
    OrbitControls: stub,
    useGLTF,
    Html: stub,
    ContactShadows: stub,
    Line: stub,
    Environment: stub,
  };
});

// Stubbed: the real module pulls the CJS `postprocessing` lib, which dual-loads
// three.js in this runtime (pre-existing graph trait, noisy here). The test pins
// VillageCanvas's conditional, so the stub is faithful for this purpose.
vi.mock('../ui/post-effects', () => ({ PostEffects: () => null }));

import { VillageCanvas } from '../ui/village-canvas';
import { PostEffects } from '../ui/post-effects';
import { toSceneModel } from '../utils/to-scene-model';
import { resetSceneQualityForTests } from '../hooks/use-scene-quality';

function containsType(node: ReactNode, type: unknown): boolean {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    if (child.type === type) return true;
    const children = (child.props as { children?: ReactNode } | undefined)?.children;
    if (containsType(children, type)) return true;
  }
  return false;
}

function renderCanvas(xrActive = false) {
  resetSceneQualityForTests();
  const input = scenarios.baseline.input;
  const result = simulate(input, 'proportional');
  const rendererRef = { current: null as WebGLRenderer | null };
  const view = render(
    <VillageCanvas
      model={toSceneModel({ input, result, timeIndex: 12 })}
      selectedSector={null}
      onSelectSector={() => {}}
      quality="high"
      rendererRef={rendererRef}
      xrActive={xrActive}
    />
  );
  return { rendererRef, ...view };
}

describe('VillageCanvas XR (VR-T2)', () => {
  it('renders on demand in 2D, continuously in XR', () => {
    const { rerender, unmount } = renderCanvas(false);
    expect(captured.props?.frameloop).toBe('demand');

    const input = scenarios.baseline.input;
    const result = simulate(input, 'proportional');
    rerender(
      <VillageCanvas
        model={toSceneModel({ input, result, timeIndex: 12 })}
        selectedSector={null}
        onSelectSector={() => {}}
        quality="high"
        xrActive
      />
    );
    expect(captured.props?.frameloop).toBe('always');
    unmount();
  });

  it('fills rendererRef from onCreated', () => {
    const { rendererRef, unmount } = renderCanvas(false);
    const gl = { domElement: document.createElement('canvas') };
    act(() => {
      captured.props?.onCreated?.({
        gl,
        get: () => ({ internal: { active: true } }),
        scene: {},
        camera: {},
      });
    });
    expect(rendererRef.current).toBe(gl);
    unmount();
  });

  it('drops post-processing while XR presents (it breaks stereo rendering)', () => {
    const { unmount } = renderCanvas(false);
    expect(containsType(captured.props?.children, PostEffects)).toBe(true);
    unmount();

    const rerendered = renderCanvas(true);
    expect(containsType(captured.props?.children, PostEffects)).toBe(false);
    rerendered.unmount();
  });
});
