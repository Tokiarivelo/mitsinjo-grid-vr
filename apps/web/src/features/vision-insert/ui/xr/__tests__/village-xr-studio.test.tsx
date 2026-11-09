import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ApplianceDetection } from '@/lib/vision';
import type { XRBlasterControllerProps } from '../xr-blaster-controller';
import { VillageXRStudio } from '../village-xr-studio';

const blaster = vi.hoisted(() => ({ props: null as XRBlasterControllerProps | null }));

vi.mock('../xr-blaster-controller', () => ({
  AIR_BUTTON_ID: 'spatial-air-button',
  XRBlasterController: (props: XRBlasterControllerProps) => {
    blaster.props = props;
    return null;
  },
}));
vi.mock('../live-webcam-backdrop', () => ({ LiveWebcamBackdrop: () => null }));
vi.mock('../spatial-air-button', () => ({ SpatialAirButton: () => null }));
vi.mock('../holo-detection-target', () => ({ HoloDetectionTarget: () => null }));
vi.mock('../spawned-object-3d', () => ({ SpawnedObject3D: () => null }));
vi.mock('../village-spatial-hud', () => ({ VillageSpatialHUD: () => null }));
vi.mock('../spatial-interaction-guide', () => ({ SpatialInteractionGuide: () => null }));
vi.mock('../xr-audio-fx', () => ({
  playGridConnectSound: vi.fn(),
  playGridDisconnectSound: vi.fn(),
}));
vi.mock('../../../hooks/use-simulation-appliances', () => ({
  useSimulationAppliances: () => ({ list: [], upsert: vi.fn(), remove: vi.fn() }),
}));

const fridge: ApplianceDetection = {
  id: 'fridge',
  label: 'Fridge',
  category: 'fridge',
  box: { x: 0.13, y: 0.22, w: 0.17, h: 0.66 },
};

function setup() {
  const onTriggerScan = vi.fn();
  const onSelectAppliance = vi.fn();
  const view = (detections: ApplianceDetection[], isScanning: boolean) => (
    <I18nProvider>
      <VillageXRStudio
        detections={detections}
        isScanning={isScanning}
        onTriggerScan={onTriggerScan}
        onSelectAppliance={onSelectAppliance}
      />
    </I18nProvider>
  );
  const r = render(view([], false));
  return { ...r, view, onTriggerScan, onSelectAppliance };
}

describe('VillageXRStudio — shoot an object in the webcam video', () => {
  beforeEach(() => {
    blaster.props = null;
  });

  it('scans on a shot before any detection, then turns the object under the shot into 3D', () => {
    const { rerender, view, onTriggerScan, onSelectAppliance } = setup();

    act(() => blaster.props!.onShootScreen!(0.2, 0.5)); // on the fridge in the video
    expect(onTriggerScan).toHaveBeenCalledTimes(1);
    expect(onSelectAppliance).not.toHaveBeenCalled();

    rerender(view([], true)); // scanning
    rerender(view([fridge], false)); // detections arrived

    expect(onSelectAppliance).toHaveBeenCalledWith('fridge');
    expect(onTriggerScan).toHaveBeenCalledTimes(1);
  });

  it('does not rescan when the shot misses every detected object', () => {
    const { rerender, view, onTriggerScan, onSelectAppliance } = setup();
    rerender(view([fridge], false));

    act(() => blaster.props!.onShootScreen!(0.8, 0.2));
    expect(onTriggerScan).not.toHaveBeenCalled();
    expect(onSelectAppliance).not.toHaveBeenCalled();
  });

  it('materializes a detected object on the first hit', () => {
    const { rerender, view, onSelectAppliance } = setup();
    rerender(view([fridge], false));

    act(() => blaster.props!.onShootTarget('fridge'));
    expect(onSelectAppliance).toHaveBeenCalledWith('fridge');
  });
});
