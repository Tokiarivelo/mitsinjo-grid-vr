'use client';

import { useMemo, useState } from 'react';
import { connectedSectorIds } from '@mitsinjo/engine';
import {
  Activity,
  BatteryCharging,
  Bot,
  Building2,
  Check,
  ChevronDown,
  Copy,
  Download,
  Factory,
  Flame,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  ScrollText,
  Sliders,
  Sun,
} from 'lucide-react';
import {
  useSimulationStore,
  selectActiveMetrics,
  selectActiveResult,
  selectActiveSteps,
  selectActiveStrategy,
  selectActiveWorkflowResult,
  selectDayIndex,
  selectComparison,
  selectInput,
  selectIsPlaying,
  selectPlaybackSpeed,
  selectFollowsDevice,
  selectDeviceHourMs,
  selectIsRunning,
  selectSelectedSector,
  selectStatus,
  selectTimeIndex,
  selectWorkflow,
} from '@/stores';
import { fmtKwh, fmtNum, fmtPct } from '@/lib/format';
import {
  buildExportData,
  copyToClipboard,
  downloadJsonFile,
  generateSummaryMarkdown,
  type Translate,
} from '@/lib/export';
import { useAppLocale, useTranslations } from '@/lib/i18n';
import { fillCopilotPrompt } from '@/lib/copilot-fill';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { ChartCard } from '@/components/ui/chart-card';
import { EnergyBar } from '@/components/ui/energy-bar';
import { ImpactBanner } from '@/components/ui/impact-banner';
import { EnergyOverTimeChart } from '@/components/charts';
import { CopilotProvider, CopilotWorkspace } from '@/features/copilot';
import { SimControlsPanel } from './sim-controls-panel';
import { TimelineScrubber, type TimelineScrubberProps } from './timeline-scrubber';
import { BuildingInspectorPanel } from './building-inspector-panel';
import { SectorLoadPanel } from './sector-load-panel';
import { ApplianceList } from '@/features/vision-insert';
import { VillageViewport } from './village-viewport';
import { PlaybackActions } from './playback-actions';
import { DeckFocusHeader } from './deck-focus-header';
import { ReportFireControl, useActiveFires } from '@/features/fire-alert';
import {
  AutopilotPanel,
  ConstitutionCard,
  DispatchLogPanel,
  useAutonomousDispatch,
} from '@/features/autopilot';
import { WeatherWorkflowPanel } from './weather-workflow-panel';
import { HardwareLinkSection } from '@/features/hardware-link';
import { DayStrip } from './day-strip';
import { usePlaybackTicker } from '../hooks/use-playback-ticker';
import { simStatusBadgeVariant } from '../utils/playback';

export type SimulationTab = 'metrics' | 'controls' | 'buildings' | 'copilot' | 'log';

const TABS: { id: SimulationTab; labelKey: string; icon: typeof Activity }[] = [
  { id: 'metrics', labelKey: 'tabMetrics', icon: Activity },
  { id: 'controls', labelKey: 'tabControls', icon: Sliders },
  { id: 'buildings', labelKey: 'tabBuildings', icon: Building2 },
  { id: 'copilot', labelKey: 'tabCopilot', icon: Bot },
  { id: 'log', labelKey: 'tabLog', icon: ScrollText },
];

export function SimulationPage() {
  const tCommon = useTranslations('common');
  const tSim = useTranslations('features.simulation');
  const tOverview = useTranslations('overview');
  const tSectors = useTranslations('sectors');
  const tActions = useTranslations('actions');
  const tDispatch = useTranslations('features.dispatch');
  const tRootRaw = useTranslations();
  const tRoot: Translate = (key, values) => tRootRaw(key as never, values as never);

  const input = useSimulationStore(selectInput);
  const status = useSimulationStore(selectStatus);
  const activeStrategy = useSimulationStore(selectActiveStrategy);
  const selectedSector = useSimulationStore(selectSelectedSector);
  const timeIndex = useSimulationStore(selectTimeIndex);
  const result = useSimulationStore(selectActiveResult);
  const metrics = useSimulationStore(selectActiveMetrics);
  const steps = useSimulationStore(selectActiveSteps);
  const comparison = useSimulationStore(selectComparison);
  const isRunning = useSimulationStore(selectIsRunning);
  const isPlaying = useSimulationStore(selectIsPlaying);
  const followsDevice = useSimulationStore(selectFollowsDevice);
  const deviceHourMs = useSimulationStore(selectDeviceHourMs);
  const workflow = useSimulationStore(selectWorkflow);
  const dayIndex = useSimulationStore(selectDayIndex);
  const workflowResult = useSimulationStore(selectActiveWorkflowResult);

  // Autonomous dispatch loop, mounted once here so it runs even when the deck is hidden (PA-T3b)
  const { locale } = useAppLocale();
  useAutonomousDispatch(locale);

  const patchInput = useSimulationStore((s) => s.patchInput);
  const resetScenario = useSimulationStore((s) => s.reset);
  const selectStrategy = useSimulationStore((s) => s.selectStrategy);
  const selectSector = useSimulationStore((s) => s.selectSector);
  const setTimeIndex = useSimulationStore((s) => s.setTimeIndex);
  const pauseSimulation = useSimulationStore((s) => s.pause);
  const stopSimulation = useSimulationStore((s) => s.stop);
  const restartSimulation = useSimulationStore((s) => s.restart);
  const togglePlaySimulation = useSimulationStore((s) => s.togglePlay);
  const playbackSpeed = useSimulationStore(selectPlaybackSpeed);
  const setPlaybackSpeed = useSimulationStore((s) => s.setPlaybackSpeed);
  const addWorkflowDay = useSimulationStore((s) => s.addWorkflowDay);
  const removeWorkflowDay = useSimulationStore((s) => s.removeWorkflowDay);
  const setDayWeather = useSimulationStore((s) => s.setDayWeather);
  const setDayIndex = useSimulationStore((s) => s.setDayIndex);
  const loadChaosWorkflow = useSimulationStore((s) => s.loadChaosWorkflow);

  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<SimulationTab>('metrics');
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [deckFocus, setDeckFocus] = useState<'tabs' | 'top'>('top');
  const dispatchMode = useSimulationStore((s) => s.dispatchMode);
  const activeFires = useActiveFires();

  usePlaybackTicker(isPlaying);

  const hasResults = status === 'complete' && Boolean(result);

  const stepAtTime = steps[timeIndex] ?? null;

  // Jumping to a day takes over from playback, like scrubbing the timeline.
  const handleSelectDay = (day: number) => {
    if (isPlaying) pauseSimulation();
    setDayIndex(day);
  };

  // Peak solar computed from input
  const peakSolarKw = input.solar.peakKw;

  const handleCopySummary = async () => {
    const md = generateSummaryMarkdown(tRoot, input, result, comparison, activeStrategy);
    const success = await copyToClipboard(md);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadJson = () => {
    const exportData = buildExportData(input, result, comparison, activeStrategy);
    const filename = `mitsinjo-${input.scenarioId}-${activeStrategy}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    downloadJsonFile(filename, exportData);
  };

  const handleSelectSector = (sec: Parameters<typeof selectSector>[0]) => {
    selectSector(sec);
    if (sec) {
      setIsPanelOpen(true);
      setActiveTab('buildings');
      setDeckFocus('tabs');
    }
  };

  // Connected sectors only (a disconnected one is managed in the Buildings tab).
  const sectorsOrder = useMemo(() => connectedSectorIds(input), [input]);

  // Shared by the page and the full-screen village (glass dock / Controls drawer).
  const timelineProps = {
    timeIndex: timeIndex,
    onTimeChange: setTimeIndex,
    stepResult: stepAtTime,
    hasResults: hasResults,
    isPlaying: isPlaying,
    onTogglePlay: togglePlaySimulation,
    onPause: pauseSimulation,
    onStop: stopSimulation,
    onRestart: restartSimulation,
    followsDevice: followsDevice,
    deviceHourMs: deviceHourMs,
    playbackSpeed: playbackSpeed,
    onPlaybackSpeedChange: setPlaybackSpeed,
  } satisfies TimelineScrubberProps;
  const timeline = <TimelineScrubber {...timelineProps} />;
  const controlsPanel = (
    <SimControlsPanel
      input={input}
      activeStrategy={activeStrategy}
      status={status}
      isPlaying={isPlaying}
      hasResults={hasResults}
      onPatch={patchInput}
      onStrategyChange={selectStrategy}
      onRun={togglePlaySimulation}
      onReset={resetScenario}
      onStop={stopSimulation}
      onRestart={restartSimulation}
      followsDevice={followsDevice}
    />
  );

  return (
    // One copilot conversation for the Copilot tab and the full-screen glass terminal.
    <CopilotProvider>
      <div className="flex flex-col gap-6 max-w-[1720px] w-full mx-auto">
        {/* Top Banner & Header Row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <StatusBadge variant="simulated" label={tCommon('simulatedData')} />
              <StatusBadge variant={simStatusBadgeVariant(status, isPlaying)} size="sm" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-display text-text-primary tracking-tight">
              {tSim('title')}
            </h1>
            <p className="text-text-secondary text-xs sm:text-sm mt-0.5">{tSim('description')}</p>
          </div>

          {/* Header Action Buttons: Run/Play/Pause/Stop/Restart, Toggle Deck, Copy Summary & Download JSON */}
          <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
            {/* Primary simulation transport controls outside Controls tab */}
            {!followsDevice && !(isPanelOpen && activeTab === 'controls') && (
              <PlaybackActions
                status={status}
                isPlaying={isPlaying}
                hasResults={hasResults}
                onTogglePlay={togglePlaySimulation}
                onStop={stopSimulation}
                onRestart={restartSimulation}
              />
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsPanelOpen((prev) => !prev)}
              icon={
                isPanelOpen ? (
                  <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5 text-energy-cyan" aria-hidden="true" />
                )
              }
              aria-label={isPanelOpen ? tSim('togglePanelCollapse') : tSim('togglePanelExpand')}
              title={isPanelOpen ? tSim('togglePanelCollapse') : tSim('togglePanelExpand')}
            >
              {isPanelOpen ? tSim('hideDeck') : tSim('showDeck')}
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopySummary}
              icon={
                copied ? (
                  <Check className="h-3.5 w-3.5 text-battery-green" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )
              }
              aria-label={tActions('copySummary')}
            >
              {copied ? tActions('copied') : tActions('copySummary')}
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownloadJson}
              icon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
              aria-label={tActions('downloadJson')}
            >
              {tActions('downloadJson')}
            </Button>
          </div>
        </div>

        {/* Main Split: Dominant 3D Viewport on Left (or Full Width) + Collapsible Multi-Tab Panel on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left / Center: Massive 3D Village Viewport + Dedicated Curseur Temporel 24h Docked Below */}
          <div
            className={cn(
              'flex flex-col gap-4 min-w-0 transition-all duration-300 lg:sticky lg:top-2 self-start',
              isPanelOpen ? 'lg:col-span-7 xl:col-span-8' : 'lg:col-span-12'
            )}
          >
            {/* 3D Digital Twin Viewport */}
            <div className="relative">
              <VillageViewport
                input={input}
                result={result}
                selectedSector={selectedSector}
                onSelectSector={handleSelectSector}
                timeIndex={timeIndex}
                isModified={status === 'modified'}
                weather={workflow[dayIndex]?.weather ?? workflow[0]?.weather}
                fullscreenDock={(dock) => <TimelineScrubber {...timelineProps} {...dock} />}
                fullscreenControls={controlsPanel}
                className="min-h-[380px] sm:min-h-[480px] lg:min-h-[640px] h-[400px] sm:h-[520px] lg:h-[640px]"
              />

              {/* Quick Floating Open Deck Button if panel is collapsed */}
              {!isPanelOpen && (
                <button
                  type="button"
                  onClick={() => setIsPanelOpen(true)}
                  aria-label={tSim('openDeck')}
                  className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-surface-elevated/95 backdrop-blur border border-energy-cyan/50 text-energy-cyan shadow-lg hover:bg-surface transition-all cursor-pointer font-sans text-xs font-medium"
                >
                  <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                  <span>{tSim('openDeck')}</span>
                </button>
              )}
            </div>

            {/* Weather workflow day selector (multi-day runs only) */}
            {workflow.length > 1 && (
              <DayStrip
                workflow={workflow}
                dayIndex={dayIndex}
                workflowResult={hasResults ? workflowResult : undefined}
                onSelectDay={handleSelectDay}
              />
            )}

            {/* Dedicated 24h Timeline Scrubber ('Curseur Temporel 24h') — Permanently visible outside tabs */}
            {timeline}
          </div>

          {/* Right Side: Collapsible Multi-Tab Drawer */}
          {isPanelOpen && (
            <aside
              aria-label={tSim('deckTitle')}
              className="lg:col-span-5 xl:col-span-4 flex flex-col rounded-card bg-surface border border-border shadow-md overflow-hidden lg:sticky lg:top-2 lg:max-h-[calc(100vh-80px)]"
            >
              {/* ACCORDION: top controls open, or a compact strip while a tab is focused */}
              <DeckFocusHeader
                expanded={deckFocus === 'top'}
                title={deckFocus === 'top' ? tSim('deckTitle') : tSim('controlsOverview')}
                onToggle={() => setDeckFocus(deckFocus === 'top' ? 'tabs' : 'top')}
                onClose={() => setIsPanelOpen(false)}
                badges={
                  deckFocus === 'tabs' && (
                    <>
                      <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-surface border border-border text-text-muted shrink-0">
                        {dispatchMode === 'autonomous' ? (
                          <>
                            <Bot
                              className="h-3 w-3 text-ai-violet animate-pulse"
                              aria-hidden="true"
                            />
                            <span className="text-ai-violet font-semibold">
                              {tDispatch('modeAutonomous')}
                            </span>
                          </>
                        ) : dispatchMode === 'assisted' ? (
                          <>
                            <Sliders className="h-3 w-3 text-energy-cyan" aria-hidden="true" />
                            <span className="text-energy-cyan font-semibold">
                              {tDispatch('modeAssisted')}
                            </span>
                          </>
                        ) : (
                          <>
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-text-muted"
                              aria-hidden="true"
                            />
                            <span>{tDispatch('modeManual')}</span>
                          </>
                        )}
                      </span>
                      {activeFires.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-critical-red/10 border border-critical-red/40 text-critical-red shrink-0">
                          <Flame
                            className="h-3 w-3 motion-safe:animate-bounce"
                            aria-hidden="true"
                          />
                          <span>{activeFires.length}</span>
                        </span>
                      )}
                    </>
                  )
                }
              />
              {deckFocus === 'top' && (
                <div className="flex flex-col border-b border-border bg-surface shrink-0">
                  {/* Safety: report a fire from the deck, whatever tab is open (M2-T2) */}
                  <div className="px-4 py-2.5 border-b border-border">
                    <ReportFireControl variant="panel" />
                  </div>

                  {/* Rule-based autopilot: one suggestion per simulated hour, off by default (M10-T1) */}
                  <div className="px-4 py-2.5 border-b border-border">
                    <AutopilotPanel
                      onOpenLog={() => {
                        setActiveTab('log');
                        setDeckFocus('tabs');
                      }}
                    />
                  </div>

                  {/* Village constitution: plain-word rules the autopilot is verified against (M10-T2) */}
                  <div className="px-4 py-2">
                    <ConstitutionCard defaultOpen={false} />
                  </div>
                </div>
              )}

              {/* TAB NAVIGATION BAR */}
              <div
                role="tablist"
                aria-label={tSim('deckTitle')}
                className="grid grid-cols-5 border-b border-border bg-canvas-sunken/60 p-1 gap-1 shrink-0"
              >
                {TABS.map(({ id, labelKey, icon: Icon }) => {
                  const isActive = activeTab === id;
                  return (
                    <button
                      key={id}
                      role="tab"
                      type="button"
                      id={`tab-${id}`}
                      aria-controls={`panel-${id}`}
                      aria-selected={isActive}
                      onClick={() => {
                        setActiveTab(id);
                        setDeckFocus('tabs');
                      }}
                      className={cn(
                        'flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-control-sm text-[11px] font-sans transition-all cursor-pointer',
                        isActive && deckFocus === 'tabs'
                          ? 'bg-surface-elevated text-energy-cyan font-semibold shadow-xs border border-border/80'
                          : isActive && deckFocus === 'top'
                            ? 'bg-surface/50 text-text-secondary border border-border/40'
                            : 'text-text-muted hover:text-text-primary hover:bg-surface/50'
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-3.5 w-3.5',
                          isActive && deckFocus === 'tabs' ? 'text-energy-cyan' : 'text-text-muted'
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate max-w-full">{tSim(labelKey)}</span>
                    </button>
                  );
                })}
              </div>

              {/* Tab Panels Container: expanded when deckFocus === 'tabs', hidden when collapsed */}
              <div
                hidden={deckFocus !== 'tabs'}
                className={cn(
                  'flex-1 min-h-0',
                  deckFocus !== 'tabs' && 'hidden',
                  activeTab === 'copilot'
                    ? 'flex flex-col p-2 sm:p-2.5 overflow-hidden h-[560px] lg:h-auto'
                    : 'p-4 overflow-y-auto'
                )}
              >
                {/* TAB 1: METRICS & CHARTS */}
                <div
                  id="panel-metrics"
                  role="tabpanel"
                  aria-labelledby="tab-metrics"
                  hidden={activeTab !== 'metrics'}
                  className={cn('space-y-4', activeTab !== 'metrics' && 'hidden')}
                >
                  {/* 4 Metric Cards in 2x2 grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Solar PV Card */}
                    <MetricCard
                      variant="solar"
                      label={tOverview('solarPeak')}
                      value={hasResults ? fmtNum(peakSolarKw) : fmtNum(null)}
                      unit="kW"
                      empty={!hasResults}
                      loading={isRunning}
                      caption={
                        hasResults && metrics
                          ? tOverview('solarCaption', { kwh: fmtKwh(metrics.solarKwh) })
                          : undefined
                      }
                      icon={<Sun className="h-4 w-4 text-solar-amber" aria-hidden="true" />}
                    />

                    {/* Battery SoC Card */}
                    <MetricCard
                      variant="battery"
                      label={tOverview('batterySoc')}
                      value={fmtNum(hasResults ? metrics?.socEndPct : null, 0)}
                      unit="%"
                      empty={!hasResults}
                      loading={isRunning}
                      caption={
                        hasResults && metrics
                          ? tOverview('batteryCaption', {
                              min: fmtPct(metrics.socMinPct, 0),
                              kwh: fmtKwh(input.battery.capacityKwh, 0),
                            })
                          : undefined
                      }
                      status={
                        metrics && metrics.socEndPct < input.battery.minSocPct + 5
                          ? 'warning'
                          : 'normal'
                      }
                      icon={
                        <BatteryCharging
                          className="h-4 w-4 text-battery-green"
                          aria-hidden="true"
                        />
                      }
                    />

                    {/* Total Demand Card */}
                    <MetricCard
                      variant="demand"
                      label={tOverview('totalDemand')}
                      value={fmtNum(hasResults ? metrics?.demandKwh : null)}
                      unit="kWh"
                      empty={!hasResults}
                      loading={isRunning}
                      caption={
                        hasResults && metrics
                          ? tOverview('unservedEnergy', {
                              kwh: fmtKwh(metrics.unservedKwh),
                            })
                          : undefined
                      }
                      status={metrics && metrics.unservedKwh > 0.1 ? 'warning' : 'normal'}
                      icon={<Factory className="h-4 w-4 text-energy-cyan" aria-hidden="true" />}
                    />

                    {/* Essential Services Coverage Card */}
                    <MetricCard
                      variant="essential"
                      label={tOverview('essentialServices')}
                      value={fmtNum(hasResults ? metrics?.criticalCoveragePct : null)}
                      unit="%"
                      empty={!hasResults}
                      loading={isRunning}
                      status={metrics && metrics.criticalUnservedKwh > 0.05 ? 'critical' : 'normal'}
                      caption={
                        hasResults && metrics
                          ? metrics.criticalUnservedKwh > 0.05
                            ? tOverview('criticalDeficitWarning', {
                                kwh: fmtKwh(metrics.criticalUnservedKwh),
                                hours: metrics.criticalUnmetHours,
                              })
                            : tOverview('criticalProtected')
                          : undefined
                      }
                      icon={<Activity className="h-4 w-4 text-critical-red" aria-hidden="true" />}
                    />
                  </div>

                  {/* 24h Generation vs Demand Chart */}
                  <ChartCard
                    title={tOverview('chartTitle')}
                    subtitle={tOverview('chartSubtitle')}
                    summary={tOverview('energyOverTimeSummary')}
                    empty={!hasResults}
                    legend={
                      <span className="text-[10px] font-mono text-text-muted px-2 py-0.5 rounded-control-sm bg-surface-elevated border border-border">
                        {tSim('cursorAt', { hour: timeIndex })}
                      </span>
                    }
                  >
                    {/* Recharts can't measure a hidden tab (0×0): mount only when shown. */}
                    {activeTab === 'metrics' && (
                      <EnergyOverTimeChart
                        steps={steps}
                        cursorHour={hasResults ? timeIndex : undefined}
                        height={220}
                      />
                    )}
                  </ChartCard>

                  {/* Service Allocation Breakdown */}
                  <div className="p-4 rounded-card bg-surface-elevated/40 border border-border">
                    <div className="flex items-center justify-between pb-3 border-b border-border/60">
                      <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-text-primary">
                        {tOverview('serviceAllocationTitle')}
                      </h3>
                      <span className="text-[10px] font-mono text-text-muted">
                        {tOverview('sectorsCount', { count: sectorsOrder.length })}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-col gap-2.5">
                      {sectorsOrder.map((sec) => {
                        const secMetrics = metrics?.perSector[sec];
                        const priority = input.sectors.find((s) => s.id === sec)?.priority;

                        return (
                          <EnergyBar
                            key={sec}
                            sectorId={sec}
                            label={tSectors(sec)}
                            valuePct={secMetrics?.coveragePct ?? 0}
                            empty={!hasResults || !secMetrics}
                            demandKwh={secMetrics?.demandKwh}
                            servedKwh={secMetrics?.servedKwh}
                            priority={priority}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* TAB 2: CONTROLS & PARAMETERS */}
                <div
                  id="panel-controls"
                  role="tabpanel"
                  aria-labelledby="tab-controls"
                  hidden={activeTab !== 'controls'}
                  className={cn('space-y-4', activeTab !== 'controls' && 'hidden')}
                >
                  {controlsPanel}
                  <WeatherWorkflowPanel
                    workflow={workflow}
                    dayIndex={dayIndex}
                    workflowResult={hasResults ? workflowResult : undefined}
                    onAddDay={() => addWorkflowDay()}
                    onRemoveDay={removeWorkflowDay}
                    onSetWeather={setDayWeather}
                    onSelectDay={handleSelectDay}
                    onLoadChaos={() => loadChaosWorkflow()}
                  />
                  <HardwareLinkSection />
                </div>

                {/* TAB 3: BUILDING INSPECTOR */}
                <div
                  id="panel-buildings"
                  role="tabpanel"
                  aria-labelledby="tab-buildings"
                  hidden={activeTab !== 'buildings'}
                  className={cn('space-y-4', activeTab !== 'buildings' && 'hidden')}
                >
                  <SectorLoadPanel />
                  <ApplianceList editorHref="/village" />
                  <BuildingInspectorPanel
                    selectedSector={selectedSector}
                    onSelectSector={handleSelectSector}
                    result={result}
                    input={input}
                    timeIndex={timeIndex}
                  />
                </div>

                {/* TAB 4: AI COPILOT */}
                <div
                  id="panel-copilot"
                  role="tabpanel"
                  aria-labelledby="tab-copilot"
                  hidden={activeTab !== 'copilot'}
                  className={cn(
                    'flex-1 min-h-0 flex flex-col',
                    activeTab !== 'copilot' && 'hidden'
                  )}
                >
                  {/* Impact Alerts Banner if active warnings exist */}
                  {result && result.warnings.length > 0 && (
                    <div className="shrink-0 mb-2">
                      <ImpactBanner warnings={result.warnings} />
                    </div>
                  )}

                  {/* Copilot conversational workspace in panel mode */}
                  <div className="flex-1 min-h-0 flex flex-col rounded-card bg-surface-elevated/30 border border-border overflow-hidden">
                    <CopilotWorkspace mode="panel" />
                  </div>
                </div>

                {/* TAB 5: DISPATCH EVENT LOG (PA-T4b) */}
                <div
                  id="panel-log"
                  role="tabpanel"
                  aria-labelledby="tab-log"
                  hidden={activeTab !== 'log'}
                  className={cn('space-y-4', activeTab !== 'log' && 'hidden')}
                >
                  <DispatchLogPanel
                    onAskWhy={(entry) => {
                      setActiveTab('copilot');
                      setDeckFocus('tabs');
                      const sec = entry.incident?.sector ?? entry.action?.sector;
                      const targetSector = sec ? tSectors(sec) : '';
                      const actionDesc = entry.action
                        ? tDispatch(`actions.${entry.action.kind}` as never)
                        : entry.incident
                          ? tDispatch(`incidents.${entry.incident.kind}` as never)
                          : '';
                      fillCopilotPrompt(
                        targetSector
                          ? tDispatch('askWhyPromptSector', {
                              action: actionDesc,
                              sector: targetSector,
                              hour: entry.hour,
                            })
                          : tDispatch('askWhyPrompt', { action: actionDesc, hour: entry.hour })
                      );
                    }}
                    onAskCopilot={(prompt) => {
                      setActiveTab('copilot');
                      setDeckFocus('tabs');
                      fillCopilotPrompt(prompt);
                    }}
                  />
                </div>
              </div>

              {deckFocus === 'top' && (
                /* Collapsed tab hint when deckFocus === 'top' */
                <button
                  type="button"
                  onClick={() => setDeckFocus('tabs')}
                  className="p-3 text-xs font-semibold text-energy-cyan bg-energy-cyan/5 hover:bg-energy-cyan/10 border-t border-energy-cyan/20 flex items-center justify-center gap-2 cursor-pointer transition-colors group shrink-0"
                >
                  <Layers
                    className="h-4 w-4 text-energy-cyan group-hover:scale-110 transition-transform shrink-0"
                    aria-hidden="true"
                  />
                  <span>{tSim('expandTabs')}</span>
                  <ChevronDown
                    className="h-3.5 w-3.5 text-energy-cyan shrink-0"
                    aria-hidden="true"
                  />
                </button>
              )}
            </aside>
          )}
        </div>
      </div>
    </CopilotProvider>
  );
}
