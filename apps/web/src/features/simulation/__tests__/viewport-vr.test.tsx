import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { scenarios } from '@mitsinjo/engine';
import { VillageViewport } from '../ui/village-viewport';

const seen = vi.hoisted(() => ({ rendererRef: null as unknown, xrActive: null as unknown }));

// Real 3D needs WebGL: stub the canvas and expose the XR props it receives.
vi.mock('@/features/microgrid-3d', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/microgrid-3d')>();
  return {
    ...actual,
    useWebGLAvailable: () => true,
    LazyVillageCanvas: (props: { rendererRef?: unknown; xrActive?: boolean }) => {
      seen.rendererRef = props.rendererRef ?? null;
      seen.xrActive = props.xrActive ?? null;
      return <div data-testid="canvas" />;
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VillageViewport VR button (VR-T3)', () => {
  const input = scenarios.baseline.input;

  function renderViewport() {
    return render(
      <VillageViewport
        input={input}
        selectedSector={null}
        onSelectSector={() => {}}
        timeIndex={12}
      />
    );
  }

  it('stays hidden without an immersive-vr runtime (no fake control)', () => {
    vi.stubGlobal('navigator', { xr: undefined });
    renderViewport();
    expect(screen.queryByRole('button', { name: 'View in VR' })).toBeNull();
  });

  it('appears when immersive-vr is supported and plumbs the session props', async () => {
    vi.stubGlobal('navigator', { xr: { isSessionSupported: async () => true } });
    renderViewport();
    const button = await screen.findByRole('button', { name: 'View in VR' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(seen.rendererRef).toMatchObject({ current: null });
    expect(seen.xrActive).toBe(false);
  });
});
