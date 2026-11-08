'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMediaQuery } from '@/lib/use-media-query';
import { useElementHeight } from '@/lib/use-element-height';
import { GlassPanel } from '@/components/ui/glass-panel';
import {
  Battery,
  Box,
  Camera,
  Gauge,
  Glasses,
  Hand,
  Maximize2,
  Minimize2,
  Sparkles,
  Zap,
  MapPin,
  Plug,
  RotateCcw,
  Sun,
  SquareTerminal,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { WebGLRenderer } from 'three';
import { CopilotTerminal } from '@/features/copilot';
import { FireAlertBanner, ReportFireControl, useActiveFires } from '@/features/fire-alert';
import type { SectorId, SimulationInput, SimulationResult, WeatherId } from '@mitsinjo/engine';
import { WEATHER_VISUALS } from '../utils/weather';
import { cn } from '@/lib/utils';
import { fmtHour, fmtKw, fmtPct } from '@/lib/format';
import { SectorIcon } from '@/components/ui/sector-icon';
import { ViewModeToggle } from '@/components/ui/view-mode-toggle';
import { useTranslations } from '@/lib/i18n';
import { usePlacedModelsStore, useSimulationStore } from '@/stores';
import { dayEvents } from '@/lib/day-events';
import {
  toSceneModel,
  useWebGLAvailable,
  LazyVillageCanvas,
  GridDiagram,
  useFullscreen,
  useSceneQuality,
  useWebXR,
  type CameraPreset,
  type SceneQuality,
} from '@/features/microgrid-3d';

export interface VillageViewportProps {
  input: SimulationInput;
  result?: SimulationResult;
  selectedSector: SectorId | null;
  onSelectSector: (sector: SectorId | null) => void;
  timeIndex: number;
  /** Store status is `modified`: show the last result dimmed and frozen. */
  isModified?: boolean;
  /** Weather of the day shown: drives the 3D sky, clouds and rain. Default sunny. */
  weather?: WeatherId;
  /** Full screen only: docked under the scene, e.g. the 24 h timeline; gets the minimize state. */
  fullscreenDock?: (dock: FullscreenDockState) => ReactNode;
  /** Full screen only: content of the toggleable glass « Controls » drawer. */
  fullscreenControls?: ReactNode;
  className?: string;
}

/** Minimize state of the full-screen dock, owned by the viewport. */
export interface FullscreenDockState {
  compact: boolean;
  onToggleCompact: () => void;
}

const QUALITY_KEYS: { id: SceneQuality; labelKey: string }[] = [
  { id: 'high', labelKey: 'qualityHigh' },
  { id: 'low', labelKey: 'qualityLow' },
];

const CAMERA_PRESET_KEYS: { id: CameraPreset; labelKey: string }[] = [
  { id: 'village', labelKey: 'presetVillage' },
  { id: 'solar', labelKey: 'presetSolar' },
  { id: 'battery', labelKey: 'presetBattery' },
  { id: 'controller', labelKey: 'presetController' },
  { id: 'essential', labelKey: 'presetEssential' },
  { id: 'immersion', labelKey: 'presetImmersion' },
];

export function VillageViewport({
  input,
  result,
  selectedSector,
  onSelectSector,
  timeIndex,
  isModified = false,
  weather = 'sunny',
  fullscreenDock,
  fullscreenControls,
  className,
}: VillageViewportProps) {
  const tSim = useTranslations('features.simulation');
  const tWeather = useTranslations('features.simulation.workflow.weather');
  const { icon: WeatherIcon, tone: weatherTone } = WEATHER_VISUALS[weather];
  const tSectors = useTranslations('sectors');
  const tCommon = useTranslations('common');
  const tCopilot = useTranslations('features.copilot');

  const hasWebGL = useWebGLAvailable();
  const rootRef = useRef<HTMLDivElement>(null);
  const {
    isFullscreen,
    toggle: toggleFullscreen,
    supported: fullscreenSupported,
  } = useFullscreen(rootRef);
  const { quality, userChosen, setQuality } = useSceneQuality();
  // VR session for the 3D canvas (filled by the canvas once its renderer mounts).
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const xr = useWebXR(rendererRef);
  const xrActive = xr.status === 'active';

  const handleVREnter = useCallback(() => {
    xr.enter();
  }, [xr]);

  const handleVRExit = useCallback(() => {
    xr.exit();
  }, [xr]);

  const [userViewMode, setUserViewMode] = useState<'3d' | 'schematic' | 'circuit' | null>(null);
  const viewMode = userViewMode ?? (hasWebGL ? '3d' : 'schematic');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('village');
  // Glass copilot terminal and controls in full screen; closed in VR immersion.
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [dockCompact, setDockCompact] = useState(false);
  // 2D diagrams keep their sector buttons above the dock.
  const { ref: dockRef, height: dockHeight } = useElementHeight();
  // Phones fit one glass panel at a time: opening one closes the other.
  const isWide = useMediaQuery('(min-width: 768px)');
  const showTerminal = !xrActive && isFullscreen && terminalOpen;
  const showControls =
    !xrActive &&
    isFullscreen &&
    Boolean(fullscreenControls) &&
    controlsOpen &&
    (isWide || !terminalOpen);
  const showDock = !xrActive && isFullscreen && (isWide || (!showTerminal && !showControls));
  const toggleTerminal = () => {
    if (!terminalOpen && !isWide) setControlsOpen(false);
    setTerminalOpen((open) => !open);
  };
  const toggleControls = () => {
    if (!showControls && !isWide) setTerminalOpen(false);
    setControlsOpen(!showControls);
  };
  const [cameraResetKey, setCameraResetKey] = useState(0);
  // Inserted appliance the camera is framing (bottom bar chip); hand tool = drag pans.
  const [focusApplianceId, setFocusApplianceId] = useState<string | null>(null);
  const [panMode, setPanMode] = useState(false);
  const applyPreset = (preset: CameraPreset) => {
    setFocusApplianceId(null);
    setCameraPreset(preset);
    // Re-apply even when the preset is unchanged (user orbited away).
    setCameraResetKey((k) => k + 1);
  };

  const step = result?.steps[timeIndex];
  const solarKw = step?.solarKw ?? 0;
  const socPct = step?.socPct ?? input.battery.initialSocPct;
  const demandKw = step?.demandKw ?? null;

  // Scene model for 3D visualization (pure mapping)
  const fires = useActiveFires();
  const placedModels = usePlacedModelsStore((s) => s.models);
  // Fires of the day shown: a multi-day run keeps reported fires on its days.
  const workflow = useSimulationStore((s) => s.workflow);
  const dayIndex = useSimulationStore((s) => s.dayIndex);
  const events = useMemo(
    () => dayEvents(input.events, workflow, dayIndex),
    [input.events, workflow, dayIndex]
  );
  const sceneModel = useMemo(
    () =>
      toSceneModel({
        input,
        events,
        result,
        timeIndex,
        isModified,
        strategy: result?.strategy ?? 'proportional',
        weather,
        placedModels,
      }),
    [input, result, timeIndex, isModified, weather, placedModels, events]
  );

  const sectorIds = input.sectors.map((sec) => sec.id);

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative flex flex-col justify-between rounded-card bg-canvas-sunken border border-border overflow-hidden shadow-inner',
        isFullscreen
          ? 'w-full h-full min-h-full rounded-none border-0'
          : cn('min-h-[360px] sm:min-h-[460px]', className)
      )}
    >
      {/* Top Floating HUD bar */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10 pointer-events-none flex-wrap gap-2">
        {/* Left: Mode Title & Time Status */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="px-2.5 py-1 rounded-control bg-surface-elevated/90 backdrop-blur border border-border text-xs font-mono flex items-center gap-1.5 text-text-primary shadow-xs">
            <span className="h-2 w-2 rounded-full bg-energy-cyan animate-pulse" />
            <span className="font-semibold text-energy-cyan">
              {viewMode === '3d'
                ? tSim('view3d')
                : viewMode === 'schematic'
                  ? tSim('villageTopology')
                  : tSim('circuitBus')}
            </span>
            <span className="text-text-muted">· {fmtHour(timeIndex)}</span>
          </div>

          <div className="flex items-center gap-1 px-2 py-1 rounded-control bg-surface/80 backdrop-blur border border-border text-[11px] font-sans text-text-secondary">
            <WeatherIcon className={cn('h-3.5 w-3.5', weatherTone)} aria-hidden="true" />
            <span>{tWeather(weather)}</span>
          </div>

          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-control bg-surface/80 backdrop-blur border border-border text-[11px] font-sans text-text-muted">
            <MapPin className="h-3 w-3 text-solar-amber" aria-hidden="true" />
            <span>{tSim('siteLocation')}</span>
          </div>
        </div>

        {/* Center: 3D Camera Presets & Reset (visible in 3D mode, hidden in VR where headset drives camera) */}
        {viewMode === '3d' && hasWebGL && !xrActive && (
          <div className="flex items-center gap-1 p-0.5 rounded-control bg-surface-elevated/90 backdrop-blur border border-border pointer-events-auto shadow-xs overflow-x-auto max-w-full">
            <div className="flex items-center gap-1 px-1.5 text-[11px] font-mono text-text-muted border-r border-border pr-2 shrink-0">
              <Camera className="h-3 w-3 text-energy-cyan" aria-hidden="true" />
              <span className="hidden md:inline">{tSim('cameraLabel')}</span>
            </div>
            {CAMERA_PRESET_KEYS.map(({ id, labelKey }) => (
              <button
                key={id}
                type="button"
                onClick={() => applyPreset(id)}
                aria-pressed={cameraPreset === id}
                className={cn(
                  'px-1.5 sm:px-2 py-0.5 rounded-control-sm text-[11px] sm:text-xs font-sans transition-colors cursor-pointer shrink-0',
                  cameraPreset === id
                    ? 'bg-energy-cyan/20 text-energy-cyan font-medium'
                    : 'text-text-muted hover:text-text-primary'
                )}
              >
                {tSim(labelKey)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => applyPreset('village')}
              aria-label={tSim('resetCamera')}
              title={tSim('resetCamera')}
              className="p-1 rounded-control-sm text-text-muted hover:text-text-primary hover:bg-surface transition-colors cursor-pointer ml-0.5 shrink-0"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setPanMode((on) => !on)}
              aria-pressed={panMode}
              aria-label={panMode ? tSim('panModeOff') : tSim('panMode')}
              title={panMode ? tSim('panModeOff') : tSim('panMode')}
              className={cn(
                'p-1 rounded-control-sm transition-colors cursor-pointer shrink-0',
                panMode
                  ? 'bg-energy-cyan/20 text-energy-cyan'
                  : 'text-text-muted hover:text-text-primary hover:bg-surface'
              )}
            >
              <Hand className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Render quality tier + fullscreen (3D only) */}
        {viewMode === '3d' && hasWebGL && (
          <div className="flex items-center gap-1 p-0.5 rounded-control bg-surface-elevated/90 backdrop-blur border border-border pointer-events-auto shadow-xs">
            <div
              className="flex items-center gap-1 px-1.5 text-[11px] font-mono text-text-muted border-r border-border pr-2"
              title={!userChosen && quality === 'low' ? tSim('qualityAutoLowered') : undefined}
            >
              {quality === 'high' ? (
                <Sparkles className="h-3 w-3 text-solar-amber" aria-hidden="true" />
              ) : (
                <Gauge className="h-3 w-3 text-text-secondary" aria-hidden="true" />
              )}
              <span className="hidden md:inline">{tSim('qualityLabel')}</span>
            </div>
            {QUALITY_KEYS.map(({ id, labelKey }) => (
              <button
                key={id}
                type="button"
                onClick={() => setQuality(id)}
                aria-pressed={quality === id}
                className={cn(
                  'px-2 py-0.5 rounded-control-sm text-xs font-sans transition-colors cursor-pointer',
                  quality === id
                    ? 'bg-energy-cyan/20 text-energy-cyan font-medium'
                    : 'text-text-muted hover:text-text-primary'
                )}
              >
                {tSim(labelKey)}
              </button>
            ))}
            {(xr.status === 'supported' || xrActive) && (
              <VRButton
                active={xrActive}
                error={xr.error}
                onClick={xrActive ? handleVRExit : handleVREnter}
              />
            )}
            {!xrActive && fullscreenSupported && (
              <FullscreenButton
                isFullscreen={isFullscreen}
                onToggle={toggleFullscreen}
                className="ml-1 border-l border-border pl-1.5"
              />
            )}
          </div>
        )}

        {/* 2D views: full screen gives the narrow diagrams the whole display */}
        {viewMode !== '3d' && fullscreenSupported && (
          <div className="flex items-center p-0.5 rounded-control bg-surface-elevated/90 backdrop-blur border border-border pointer-events-auto shadow-xs">
            <FullscreenButton
              isFullscreen={isFullscreen}
              onToggle={toggleFullscreen}
              className="flex h-10 w-10 md:h-7 md:w-7 items-center justify-center"
            />
          </div>
        )}

        {/* Full screen: show / hide the glass controls drawer and copilot terminal */}
        {isFullscreen && (
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {fullscreenControls && (
              <HudToggle
                pressed={showControls}
                onClick={toggleControls}
                label={showControls ? tSim('fsControls.close') : tSim('fsControls.open')}
                text={tSim('fsControls.toggle')}
                icon={<SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
                tone="cyan"
              />
            )}
            <HudToggle
              pressed={showTerminal}
              onClick={toggleTerminal}
              label={showTerminal ? tCopilot('terminal.close') : tCopilot('terminal.open')}
              text={tCopilot('terminal.toggle')}
              icon={<SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />}
              tone="violet"
            />
          </div>
        )}

        {/* Safety: report a fire in any view (3D, topology, circuit), full screen included */}
        <ReportFireControl className="pointer-events-auto" />

        {/* Right: View Mode Toggle (3D vs 2D Topology vs Circuit) */}
        {!xrActive && (
          <ViewModeToggle
            label={tSim('viewModeLabel')}
            value={viewMode}
            onChange={setUserViewMode}
            className="pointer-events-auto shadow-xs"
            options={[
              ...(hasWebGL
                ? [
                    {
                      id: '3d' as const,
                      label: tSim('view3d'),
                      icon: <Box className="h-3 w-3" aria-hidden="true" />,
                    },
                  ]
                : []),
              { id: 'schematic' as const, label: tSim('viewTopology') },
              { id: 'circuit' as const, label: tSim('viewCircuit') },
            ]}
          />
        )}
      </div>

      {/* Fire alarm in the view itself (also in full screen, where the page banner is hidden) */}
      {fires.length > 0 && (
        <FireAlertBanner
          compact
          fires={fires}
          className="absolute z-20 top-16 sm:top-14 left-1/2 -translate-x-1/2 max-w-[calc(100%-1.5rem)]"
        />
      )}

      {/* Main Viewport Content Area */}
      {viewMode === '3d' && hasWebGL ? (
        <div className="relative flex-1 w-full h-full min-h-[360px] sm:min-h-[460px]">
          <LazyVillageCanvas
            model={sceneModel}
            selectedSector={selectedSector}
            onSelectSector={(sector) => {
              setFocusApplianceId(null);
              onSelectSector(sector);
            }}
            cameraPreset={cameraPreset}
            onSelectPreset={applyPreset}
            cameraResetKey={cameraResetKey}
            focusApplianceId={focusApplianceId}
            panMode={panMode}
            rendererRef={rendererRef}
            xrActive={xrActive}
            immersionActive={xrActive || isFullscreen || cameraPreset === 'immersion'}
            className={cn(
              'w-full h-full absolute inset-0 transition-opacity',
              isModified && 'opacity-60'
            )}
          />

          {isModified && (
            <div
              role="status"
              className="absolute top-14 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1 rounded-control bg-surface-elevated/90 backdrop-blur border border-warning-amber/40 text-[11px] font-sans text-warning-amber"
            >
              {tSim('scenarioModified3D')}
            </div>
          )}

          {/* Adjacent 2D Sector Selector mirror bar (bottom-left) for quick accessibility */}
          <div
            className={cn(
              // Wraps (no hidden scroll) so every inserted appliance stays in sight.
              'absolute bottom-9 left-3 right-3 z-10 hidden flex-wrap items-center gap-1.5 bg-surface/85 backdrop-blur p-1.5 rounded-control border border-border',
              !isFullscreen && !xrActive && 'sm:flex'
            )}
          >
            {sectorIds.map((id) => {
              const isSelected = selectedSector === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setFocusApplianceId(null);
                    onSelectSector(isSelected ? null : id);
                  }}
                  aria-pressed={isSelected}
                  className={cn(
                    'px-2 py-1 rounded-control-sm text-xs font-sans flex items-center gap-1 border transition-all cursor-pointer shrink-0 whitespace-nowrap',
                    isSelected
                      ? 'bg-surface-elevated border-energy-cyan text-energy-cyan font-semibold'
                      : 'border-border/60 text-text-secondary hover:text-text-primary hover:border-text-secondary'
                  )}
                >
                  <SectorIcon sector={id} tinted={!isSelected} className="h-3 w-3" />
                  <span>{tSectors(id)}</span>
                </button>
              );
            })}
            {/* Inserted appliances: same chips, the camera flies to the object */}
            {sceneModel.appliances.map((a) => {
              const isFocused = focusApplianceId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setFocusApplianceId(isFocused ? null : a.id)}
                  aria-pressed={isFocused}
                  aria-label={tSim('focusAppliance', { name: a.name })}
                  title={tSim('focusAppliance', { name: a.name })}
                  data-testid={`appliance-chip-${a.id}`}
                  className={cn(
                    'px-2 py-1 rounded-control-sm text-xs font-sans flex items-center gap-1 border transition-all cursor-pointer shrink-0 whitespace-nowrap',
                    isFocused
                      ? 'bg-surface-elevated border-energy-cyan text-energy-cyan font-semibold'
                      : 'border-energy-cyan/30 text-text-secondary hover:text-text-primary hover:border-text-secondary'
                  )}
                >
                  <Plug
                    className={cn('h-3 w-3', !isFocused && 'text-energy-cyan')}
                    aria-hidden="true"
                  />
                  <span>{a.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* 2D village plan / single-line circuit: same model as the 3D twin */
        <div
          className={cn(
            // Top padding clears the floating HUD (two rows in the card, one in full screen).
            'flex-1 flex flex-col gap-2 px-3 sm:px-4 pt-24 sm:pt-20 pb-16 min-h-[360px] sm:min-h-[460px]',
            isFullscreen && 'sm:pt-14',
            // Wide full screen: the diagram stays between the glass panels, never under them.
            showControls && 'md:pl-[404px]',
            showTerminal && 'md:pr-[472px]'
          )}
          style={showDock && dockHeight ? { paddingBottom: dockHeight + 20 } : undefined}
        >
          {!hasWebGL && (
            <div className="max-w-2xl mx-auto w-full p-2 rounded-control bg-surface-elevated/80 border border-border text-[11px] font-sans text-text-muted flex items-center gap-2">
              <Box className="h-3.5 w-3.5 text-solar-amber shrink-0" aria-hidden="true" />
              <span>{tSim('webglUnavailable')}</span>
            </div>
          )}
          <GridDiagram
            model={sceneModel}
            variant={viewMode === 'circuit' ? 'circuit' : 'topology'}
            selectedSector={selectedSector}
            onSelectSector={onSelectSector}
            wheelZoom={isFullscreen}
            className={cn('flex-1', isModified && 'opacity-60')}
          />
        </div>
      )}

      {/* Full screen: engine values of the hour + docked timeline (between the two glass panels) */}
      {showDock && (
        <div
          ref={dockRef}
          className={cn(
            'absolute z-20 bottom-3 inset-x-3 flex flex-col gap-2 max-h-[45%] overflow-y-auto',
            showControls ? 'md:left-[404px]' : 'md:left-4',
            showTerminal ? 'md:right-[472px]' : 'md:right-4'
          )}
        >
          {!dockCompact && (
            <div className="self-start max-w-full overflow-x-auto flex items-center gap-4 px-4 py-2.5 rounded-card bg-surface/85 backdrop-blur border border-border">
              <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted border-r border-border pr-4">
                {tCommon('simulatedData')}
              </span>
              <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-solar-amber" aria-hidden="true" />
                <div className="leading-tight">
                  <span className="block text-[10px] text-text-muted">{tSim('liveOutput')}</span>
                  <span className="font-mono text-sm text-text-primary">
                    {result ? fmtKw(solarKw) : fmtKw(null)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Battery className="h-4 w-4 text-battery-green" aria-hidden="true" />
                <div className="leading-tight">
                  <span className="block text-[10px] text-text-muted">{tSim('bessBattery')}</span>
                  <span className="font-mono text-sm text-text-primary">
                    {tSim('socValue', { pct: fmtPct(socPct) })}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-energy-cyan" aria-hidden="true" />
                <div className="leading-tight">
                  <span className="block text-[10px] text-text-muted">{tSim('villageDemand')}</span>
                  <span className="font-mono text-sm text-text-primary">{fmtKw(demandKw)}</span>
                </div>
              </div>
            </div>
          )}
          {/* Same timeline as the page, restyled as glass. */}
          <div className="[&>*]:bg-surface/45 [&>*]:backdrop-blur-2xl [&>*]:backdrop-saturate-150 [&>*]:border-border/50 [&>*]:shadow-glass-glow [&>*]:rounded-[24px]">
            {fullscreenDock?.({
              compact: dockCompact,
              onToggleCompact: () => setDockCompact((c) => !c),
            })}
          </div>
        </div>
      )}

      {showControls && (
        <section
          aria-label={tSim('fsControls.title')}
          className="absolute z-30 flex flex-col inset-x-3 bottom-3 h-[72%] md:inset-x-auto md:left-4 md:top-24 md:bottom-4 md:h-auto md:w-[372px]"
        >
          <GlassPanel
            className="flex-1 min-h-0 flex flex-col"
            innerClassName="flex-1 min-h-0 flex flex-col"
          >
            <header className="flex items-center gap-2 px-4 py-2 border-b border-border/40">
              <SlidersHorizontal className="h-4 w-4 text-energy-cyan" aria-hidden="true" />
              <h2 className="flex-1 font-mono text-xs font-semibold text-text-primary">
                {tSim('fsControls.title')}
              </h2>
              <button
                type="button"
                onClick={() => setControlsOpen(false)}
                aria-label={tSim('fsControls.close')}
                title={tSim('fsControls.close')}
                className="min-h-10 min-w-10 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-surface/60 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>
            {/* Same panel as the Controls tab, without its own card so the glass shows through. */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3 [&>*]:bg-transparent [&>*]:border-0 [&>*]:shadow-none [&>*]:p-0 [&>*]:rounded-none">
              {fullscreenControls}
            </div>
          </GlassPanel>
        </section>
      )}

      {showTerminal && <CopilotTerminal onClose={() => setTerminalOpen(false)} />}

      {/* Bottom status hint bar */}
      <div
        className={cn(
          'absolute bottom-2 left-3 right-3 flex items-center justify-between text-[11px] text-text-muted font-sans pointer-events-none',
          isFullscreen && 'hidden'
        )}
      >
        <span>
          {viewMode === '3d' ? tSim(panMode ? 'hint3dPan' : 'hint3d') : tSim('clickNodeToInspect')}
        </span>
        <span className="font-mono text-[10px] text-energy-cyan">{tCommon('simulatedData')}</span>
      </div>
    </div>
  );
}

function VRButton({
  active,
  error,
  onClick,
}: {
  active: boolean;
  error: string | null;
  onClick: () => void;
}) {
  const tSim = useTranslations('features.simulation');
  const label = active ? tSim('vrExit') : tSim('vrEnter');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={error ?? label}
      title={error ?? label}
      className={cn(
        'p-1 rounded-control-sm transition-colors cursor-pointer',
        active
          ? 'bg-energy-cyan/20 text-energy-cyan'
          : 'text-text-muted hover:text-text-primary hover:bg-surface'
      )}
    >
      <Glasses className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

function FullscreenButton({
  isFullscreen,
  onToggle,
  className,
}: {
  isFullscreen: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const tSim = useTranslations('features.simulation');
  const label = isFullscreen ? tSim('fullscreenExit') : tSim('fullscreenEnter');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isFullscreen}
      aria-label={label}
      title={label}
      className={cn(
        'p-1 rounded-control-sm text-text-muted hover:text-text-primary hover:bg-surface transition-colors cursor-pointer',
        className
      )}
    >
      {isFullscreen ? (
        <Minimize2 className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Maximize2 className="h-3 w-3" aria-hidden="true" />
      )}
    </button>
  );
}

function HudToggle({
  pressed,
  onClick,
  label,
  text,
  icon,
  tone,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  text: string;
  icon: ReactNode;
  tone: 'violet' | 'cyan';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={cn(
        'min-h-10 md:min-h-8 px-3 flex items-center gap-1.5 rounded-full border backdrop-blur text-xs font-mono transition-colors cursor-pointer shadow-xs',
        pressed
          ? tone === 'violet'
            ? 'bg-ai-violet/20 border-ai-violet/60 text-ai-violet'
            : 'bg-energy-cyan/15 border-energy-cyan/60 text-energy-cyan'
          : 'bg-surface-elevated/90 border-border text-text-secondary hover:text-text-primary'
      )}
    >
      {icon}
      <span>{text}</span>
    </button>
  );
}
