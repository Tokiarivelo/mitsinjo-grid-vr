import { render, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';

const webglState = vi.hoisted(() => ({ available: true }));
vi.mock('@/features/microgrid-3d', () => ({
  useWebGLAvailable: () => webglState.available,
}));

import { VillageXRViewport } from '../village-xr-viewport';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ onCreated }: any) => {
    onCreated?.({ gl: { xr: { getController: vi.fn() } } });
    return <div data-testid="mock-r3f-canvas" />;
  },
  useFrame: vi.fn(),
  useThree: () => ({
    gl: { xr: { getController: vi.fn() } },
    scene: {},
    camera: {},
  }),
}));

vi.mock('@react-three/drei', () => ({
  Billboard: ({ children }: any) => <div data-testid="mock-billboard">{children}</div>,
  OrbitControls: () => null,
  ContactShadows: () => null,
}));

vi.mock('../spatial-air-button-texture', () => ({
  getSpatialAirButtonTexture: vi.fn(() => ({})),
}));

vi.mock('../holo-target-texture', () => ({
  getHoloTargetTexture: vi.fn(() => ({})),
}));

describe('VillageXRViewport (VS-T1 / VS-T2)', () => {
  it('renders viewport HUD, canvas, and handles onExitVR', () => {
    const onExit = vi.fn();
    const onTrigger = vi.fn();
    const rendererRef = { current: null };

    const { getByTestId, getByLabelText } = render(
      <I18nProvider>
        <VillageXRViewport
          detections={[]}
          isScanning={false}
          onTriggerScan={onTrigger}
          rendererRef={rendererRef}
          xrActive={true}
          onExitVR={onExit}
        />
      </I18nProvider>
    );

    expect(getByTestId('village-xr-viewport')).toBeTruthy();
    expect(getByTestId('mock-r3f-canvas')).toBeTruthy();

    const exitBtn = getByLabelText('Exit VR immersion');
    expect(exitBtn).toBeTruthy();

    act(() => {
      fireEvent.click(exitBtn);
    });

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('renders WebGL unavailable fallback and allows onExitVR when WebGL is absent', () => {
    webglState.available = false;
    const onExit = vi.fn();

    const { getByTestId, getByText, queryByTestId } = render(
      <I18nProvider>
        <VillageXRViewport
          detections={[]}
          isScanning={false}
          onTriggerScan={vi.fn()}
          rendererRef={{ current: null }}
          xrActive={false}
          onExitVR={onExit}
        />
      </I18nProvider>
    );

    expect(getByTestId('village-xr-viewport')).toBeTruthy();
    // Canvas is not mounted
    expect(queryByTestId('mock-r3f-canvas')).toBeNull();
    // Fallback notice is displayed
    expect(getByText(/unavailable/i)).toBeTruthy();

    const exitBtn = getByText('Exit VR immersion');
    act(() => {
      fireEvent.click(exitBtn);
    });
    expect(onExit).toHaveBeenCalledTimes(1);

    // Reset
    webglState.available = true;
  });
});
