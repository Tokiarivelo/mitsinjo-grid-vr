import { act, fireEvent, render } from '@testing-library/react';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ApplianceDetection } from '@/lib/vision';
import type { XRBlasterControllerProps } from '../xr-blaster-controller';
import { VillageXRStudio } from '../village-xr-studio';
import type { XrExtract } from '../../../hooks/use-xr-extract';

const blaster = vi.hoisted(() => ({ props: null as XRBlasterControllerProps | null }));

vi.mock('../xr-blaster-controller', () => ({
  AIR_BUTTON_ID: 'spatial-air-button',
  createAimReadout: () => ({ pointers: [{}, {}] }),
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
vi.mock('../studio-walk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../studio-walk')>()),
  StudioWalk: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const panelsMock = vi.hoisted(() => ({ dialog: null as Record<string, unknown> | null }));
vi.mock('../xr-control-hints', () => ({
  XrAimHint: () => null,
  XrControlLegend: () => null,
}));
const controls = vi.hoisted(() => ({
  onAction: null as null | ((a: { type: string; direction?: number }) => void),
}));
vi.mock('../xr-controls-driver', () => ({
  XrControlsDriver: ({ onAction }: { onAction: (a: { type: string }) => void }) => {
    controls.onAction = onAction;
    return null;
  },
}));
vi.mock('../tour/photo-anchored', () => ({
  PhotoAnchored: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../holo-extract-panels', () => ({
  usePanelAnchor: (key: string | null) => (key ? { position: [0, 1.5, -1.1], yaw: 0 } : null),
  HoloScanProgress: () => <div data-testid="scan-progress" />,
  HoloExtractDialog: (props: Record<string, unknown>) => {
    panelsMock.dialog = props;
    return <div data-testid="extract-dialog" />;
  },
  AnchoredPanel: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../xr-extract-studio', () => ({
  StudioRoom: () => <div data-testid="studio-room" />,
  HoloBuildStage: () => <div data-testid="build-stage" />,
  HoloGenerationColumn: (props: { stage: string; onToLab?: () => void }) => (
    <div data-testid="generation-column" data-stage={props.stage}>
      {props.onToLab && (
        <button type="button" onClick={props.onToLab}>
          3D lab
        </button>
      )}
    </div>
  ),
}));
vi.mock('../holo-ui', () => ({
  HoloButton: ({ label, onSelect }: { label: string; onSelect?: () => void }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {label}
    </button>
  ),
}));
vi.mock('../holo-views-carousel', () => ({
  HoloViewsCarousel: () => <div data-testid="views-carousel" />,
}));
vi.mock('../xr-object-lab', () => ({
  XrObjectLab: (props: { onToViews?: () => void }) => (
    <div data-testid="xr-lab">
      {props.onToViews && (
        <button type="button" onClick={props.onToViews}>
          2D lab
        </button>
      )}
    </div>
  ),
}));
// The desks turntable animates in a frame loop: here the desk ahead only.
vi.mock('../studio-desks', () => ({
  StudioDesks: (p: { desk: string; twoD: React.ReactNode; threeD: React.ReactNode }) => (
    <div data-testid="studio-desks" data-desk={p.desk}>
      {p.desk === '2d' ? p.twoD : p.threeD}
    </div>
  ),
}));
vi.mock('../holo-detection-target', () => ({ HoloDetectionTarget: () => null }));
vi.mock('../spawned-object-3d', () => ({ SpawnedObject3D: () => null }));
vi.mock('../village-spatial-hud', () => ({ VillageSpatialHUD: () => null }));
vi.mock('../spatial-interaction-guide', () => ({ SpatialInteractionGuide: () => null }));
vi.mock('../xr-wrist-menu', () => ({
  WristMenuButton: () => null,
  FollowGroup: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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

function setup(tourMode = false, extract?: XrExtract) {
  const onTriggerScan = vi.fn();
  const onSelectAppliance = vi.fn();
  const view = (
    detections: ApplianceDetection[],
    isScanning: boolean,
    ex = extract,
    more: Partial<React.ComponentProps<typeof VillageXRStudio>> = {}
  ) => (
    <I18nProvider>
      <VillageXRStudio
        {...more}
        detections={detections}
        isScanning={isScanning}
        onTriggerScan={onTriggerScan}
        onSelectAppliance={onSelectAppliance}
        tourMode={tourMode}
        {...(ex ? { extract: ex } : {})}
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

describe('VillageXRStudio — 3D extraction (VS-T18–T22)', () => {
  const extractAt = (stage: XrExtract['stage'], id: string | null = 'fridge'): XrExtract => ({
    stage,
    id,
    ask: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    build: vi.fn(),
    enterLab: vi.fn(),
    exitLab: vi.fn(),
    toViews: vi.fn(),
    toLab: vi.fn(),
    leave: vi.fn(),
    back: vi.fn(),
    awayId: null,
    slides: [],
    canBuild: false,
    redraw: vi.fn(),
    toggleValidated: vi.fn(),
    chatOf: () => [],
    sendChat: vi.fn(),
    ready: false,
    shape: { status: 'idle' },
    editPieces: vi.fn(),
  });

  it('shows « Analysing the view… » over the scanned area while the scan runs', () => {
    const { rerender, view, queryByTestId } = setup();
    expect(queryByTestId('scan-progress')).toBeNull();
    rerender(view([], true));
    expect(queryByTestId('scan-progress')).toBeTruthy();
  });

  it('a shot on an object asks « Extract to 3D? » instead of making a miniature', () => {
    const idle = extractAt('idle', null);
    const { rerender, view } = setup(false, idle);
    rerender(view([fridge], false));
    act(() => blaster.props!.onShootTarget('fridge'));
    expect(idle.ask).toHaveBeenCalledWith('fridge');
    expect(blaster.props!.miniatures).toEqual([]);
  });

  it('a shot that starts the analysis never opens « Extract to 3D? » by itself (regression)', () => {
    const idle = extractAt('idle', null);
    const { rerender, view, onTriggerScan, onSelectAppliance } = setup(false, idle);
    act(() => blaster.props!.onShootScreen!(0.2, 0.5)); // on the fridge, nothing detected yet
    expect(onTriggerScan).toHaveBeenCalledTimes(1);
    rerender(view([], true, idle)); // scanning
    rerender(view([fridge], false, idle)); // outlines arrived
    expect(idle.ask).not.toHaveBeenCalled();
    expect(onSelectAppliance).not.toHaveBeenCalled();
    // The operator then shoots the outlined object: now it asks.
    act(() => blaster.props!.onShootTarget('fridge'));
    expect(idle.ask).toHaveBeenCalledWith('fridge');
  });

  it('opens the dialog, then nothing behind it takes a shot', () => {
    const { rerender, view, getByTestId } = setup(false, extractAt('confirm'));
    rerender(view([fridge], false));
    expect(getByTestId('extract-dialog')).toBeTruthy();
    expect(panelsMock.dialog!.name).toBe('Fridge');
    expect(blaster.props!.targets).toEqual([]);
    expect(blaster.props!.surface).toBeNull();
    expect(blaster.props!.panels).toBeDefined();
  });

  it('B / Y (back) cancels the open question; A / X (analyse) scans when nothing is open', () => {
    // VS-T23: the controller buttons drive the flow without aiming at a panel.
    const asking = extractAt('confirm');
    const { rerender, view, onTriggerScan } = setup(false, asking);
    rerender(view([fridge], false));
    act(() => controls.onAction!({ type: 'analyse' }));
    expect(onTriggerScan).not.toHaveBeenCalled();
    act(() => controls.onAction!({ type: 'back' }));
    expect(asking.cancel).toHaveBeenCalledOnce();

    rerender(view([], false, extractAt('idle', null)));
    act(() => controls.onAction!({ type: 'analyse' }));
    expect(onTriggerScan).toHaveBeenCalledOnce();
  });

  it('« Leave the studio » leaves from any studio step; the lab keeps its object (VS-T26)', () => {
    const views = extractAt('views');
    const { rerender, view, getByRole } = setup(false, views);
    rerender(view([fridge], false));
    fireEvent.click(getByRole('button', { name: 'Leave the studio' }));
    expect(views.leave).toHaveBeenCalledOnce();

    const inLab = extractAt('lab');
    rerender(view([fridge], false, inLab));
    fireEvent.click(getByRole('button', { name: 'Leave the studio' }));
    expect(inLab.exitLab).toHaveBeenCalledOnce();
  });

  it('cancels a running analysis (button or B/Y), then offers a retry (VS-T26)', () => {
    const onCancelScan = vi.fn();
    const onRetryScan = vi.fn();
    const { rerender, view, getByRole } = setup(false, extractAt('idle', null));
    rerender(view([], true, extractAt('idle', null), { onCancelScan, onRetryScan }));
    fireEvent.click(getByRole('button', { name: 'Cancel the analysis' }));
    expect(onCancelScan).toHaveBeenCalledOnce();
    act(() => controls.onAction!({ type: 'back' }));
    expect(onCancelScan).toHaveBeenCalledTimes(2);
    rerender(
      view([], false, extractAt('idle', null), { onCancelScan, onRetryScan, scanStopped: true })
    );
    fireEvent.click(getByRole('button', { name: 'Retry the analysis' }));
    expect(onRetryScan).toHaveBeenCalledOnce();
  });

  it('« Back to the studio » shows in the 360° view once the studio was left', () => {
    const left = { ...extractAt('idle', null), awayId: 'fridge' };
    const { rerender, view, getByRole, queryByRole } = setup(false, extractAt('idle', null));
    rerender(view([fridge], false));
    expect(queryByRole('button', { name: /Back to the studio/ })).toBeNull();
    rerender(view([fridge], false, left));
    fireEvent.click(getByRole('button', { name: 'Back to the studio · « Fridge »' }));
    expect(left.back).toHaveBeenCalledOnce();
  });

  it('B / Y (back) in the lab leaves it, keeping the object as a miniature', () => {
    const inLab = extractAt('lab');
    const { rerender, view } = setup(false, inLab);
    rerender(view([fridge], false));
    act(() => controls.onAction!({ type: 'back' }));
    expect(inLab.exitLab).toHaveBeenCalledOnce();
  });

  it('« Extract in 3D » opens the studio: views with the generation column, build, then lab', () => {
    // VS-T24: the question stays in the 360° view; every later step is in the studio room.
    const { rerender, view, queryByTestId } = setup(false, extractAt('confirm'));
    rerender(view([fridge], false));
    expect(queryByTestId('studio-room')).toBeNull();

    rerender(view([fridge], false, extractAt('views')));
    expect(queryByTestId('studio-room')).toBeTruthy();
    expect(queryByTestId('views-carousel')).toBeTruthy();
    expect(queryByTestId('generation-column')?.dataset.stage).toBe('views');

    rerender(view([fridge], false, extractAt('build')));
    expect(queryByTestId('studio-room')).toBeTruthy();
    expect(queryByTestId('build-stage')).toBeTruthy();
    expect(queryByTestId('generation-column')?.dataset.stage).toBe('build');
    expect(queryByTestId('views-carousel')).toBeNull();

    rerender(view([fridge], false, extractAt('lab')));
    expect(queryByTestId('studio-room')).toBeTruthy();
    expect(queryByTestId('generation-column')).toBeNull();
  });
});

describe('VillageXRStudio — 2D lab / 3D lab desks (VS-T31)', () => {
  const base = (stage: XrExtract['stage'], ready: boolean): XrExtract => ({
    stage,
    id: 'fridge',
    ask: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    build: vi.fn(),
    enterLab: vi.fn(),
    exitLab: vi.fn(),
    toViews: vi.fn(),
    toLab: vi.fn(),
    leave: vi.fn(),
    back: vi.fn(),
    awayId: null,
    slides: [],
    canBuild: false,
    redraw: vi.fn(),
    toggleValidated: vi.fn(),
    chatOf: () => [],
    sendChat: vi.fn(),
    ready,
    shape: ready
      ? {
          status: 'ready',
          shape: { detectionId: 'fridge', mode: 'recipe' } as XrExtract['shape']['shape'],
        }
      : { status: 'idle' },
    editPieces: vi.fn(),
  });

  it('the 3D lab has « 2D lab », the 2D lab has « 3D lab » once the model exists', () => {
    const lab = base('lab', true);
    const { rerender, view, getByRole, getByTestId, queryByRole } = setup(false, lab);
    const more = { imageUrl: 'data:image/jpeg;base64,scan' };
    rerender(view([fridge], false, lab, more));
    expect(getByTestId('studio-desks').dataset.desk).toBe('3d');
    fireEvent.click(getByRole('button', { name: '2D lab' }));
    expect(lab.toViews).toHaveBeenCalledOnce();

    const views = base('views', true);
    rerender(view([fridge], false, views, more));
    expect(getByTestId('studio-desks').dataset.desk).toBe('2d');
    fireEvent.click(getByRole('button', { name: '3D lab' }));
    expect(views.toLab).toHaveBeenCalledOnce();

    // No model yet: no way to the 3D lab from the views.
    rerender(view([fridge], false, base('views', false), more));
    expect(queryByRole('button', { name: '3D lab' })).toBeNull();
  });
});

describe('VillageXRStudio — controls help (VS-T24)', () => {
  it('the menu « Help » button hides and shows the controls legends', () => {
    const { getByRole } = setup();
    act(() => blaster.props!.menu.toggle());
    const hide = getByRole('button', { name: 'Hide the controls help' });
    act(() => hide.click());
    expect(getByRole('button', { name: 'Show the controls help' })).toBeTruthy();
  });
});
