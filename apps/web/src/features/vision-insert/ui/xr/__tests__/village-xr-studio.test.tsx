import { act, render } from '@testing-library/react';
import * as THREE from 'three';
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
const camera = new THREE.PerspectiveCamera();
camera.position.set(0, 1.6, 0);
camera.lookAt(0, 1.6, -1);
camera.updateMatrixWorld(true);
vi.mock('@react-three/fiber', () => ({ useThree: () => ({ camera }) }));
const tourMock = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('../tour/panorama-tour', () => ({
  PanoramaTour: (props: Record<string, unknown>) => {
    tourMock.props = props;
    return null;
  },
}));
vi.mock('../spatial-air-button', () => ({ SpatialAirButton: () => null }));
vi.mock('../holo-detection-target', () => ({ HoloDetectionTarget: () => null }));
vi.mock('../spawned-object-3d', () => ({ SpawnedObject3D: () => null }));
vi.mock('../village-spatial-hud', () => ({ VillageSpatialHUD: () => null }));
vi.mock('../spatial-interaction-guide', () => ({ SpatialInteractionGuide: () => null }));
vi.mock('../xr-wrist-menu', () => ({
  WristMenuButton: () => null,
  WristMenuPanel: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="wrist-menu-panel">{children}</div>
  ),
}));
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

function setup(tourMode = false) {
  const onTriggerScan = vi.fn();
  const onSelectAppliance = vi.fn();
  const view = (detections: ApplianceDetection[], isScanning: boolean) => (
    <I18nProvider>
      <VillageXRStudio
        detections={detections}
        isScanning={isScanning}
        onTriggerScan={onTriggerScan}
        onSelectAppliance={onSelectAppliance}
        tourMode={tourMode}
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

  it('gives the shot object a miniature in reach, and a tap on it connects', () => {
    const { rerender, view, onSelectAppliance } = setup();
    rerender(view([fridge], false));
    expect(blaster.props!.miniatures).toEqual([]);

    act(() => blaster.props!.onShootTarget('fridge'));
    const [mini] = blaster.props!.miniatures!;
    expect(mini?.id).toBe('fridge');
    expect(Math.hypot(mini!.position[0], mini!.position[2])).toBeLessThan(0.7);

    act(() => blaster.props!.onTapMiniature!('fridge'));
    expect(onSelectAppliance).toHaveBeenCalledTimes(2); // materialize, then connect
  });

  it('keeps the menu hidden on entry; the wrist button opens and closes it', () => {
    const { queryByTestId } = setup();
    const menu = blaster.props!.menu;
    expect(menu.open).toBe(false);
    expect(queryByTestId('wrist-menu-panel')).toBeNull();

    act(() => menu.toggle());
    expect(menu.open).toBe(true);
    expect(queryByTestId('wrist-menu-panel')).toBeTruthy();

    act(() => menu.toggle());
    expect(queryByTestId('wrist-menu-panel')).toBeNull();
  });
});

describe('VillageXRStudio — 360° tour (VS-T14)', () => {
  const capture = vi.fn(() => ({ url: 'data:image/jpeg;base64,view', expected: [] }));

  function enterTour() {
    const r = setup(true);
    act(() => {
      (tourMock.props!.onRegisterCapture as (fn: unknown) => void)(capture);
      (tourMock.props!.onArrive as (room: string, u: number) => void)('loft', 0.8);
    });
    return r;
  }

  it('shows the tour instead of the webcam wall, with floor arrows to the next rooms', () => {
    enterTour();
    expect(tourMock.props!.room).toBe('loft');
    const ids = blaster.props!.hotspots!.map((h) => h.id);
    expect(ids).toEqual(['tour-link:hall', 'tour-link:bedroom']);
    expect(blaster.props!.surface).toBeNull(); // nothing scanned yet
  });

  it('a shot on an arrow walks to that room', () => {
    enterTour();
    act(() => blaster.props!.onHotspot!('tour-link:bedroom'));
    expect(tourMock.props!.pending).toBe('bedroom');
  });

  it('a shot at the room scans the view centred on it, then resolves the object under it', () => {
    const { rerender, view, onTriggerScan, onSelectAppliance } = enterTour();
    act(() =>
      blaster.props!.onShootOutside!(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 0, -1))
    );
    expect(capture).toHaveBeenCalled();
    expect(onTriggerScan).toHaveBeenCalledWith('data:image/jpeg;base64,view');
    expect(blaster.props!.surface).not.toBeNull();

    const centre: ApplianceDetection = { ...fridge, box: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 } };
    rerender(view([], true));
    rerender(view([centre], false));
    expect(onSelectAppliance).toHaveBeenCalledWith('fridge');
  });
});
