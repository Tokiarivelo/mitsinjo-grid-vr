'use client';

import { useEffect, useId, useMemo, type ReactNode } from 'react';
import { BatteryCharging, Cpu, Flame, RotateCcw, Sun, ZoomIn, ZoomOut } from 'lucide-react';
import type { SectorId, StrategyId } from '@mitsinjo/engine';
import { cn } from '@/lib/utils';
import { fmtKw, fmtPct } from '@/lib/format';
import { useTranslations } from '@/lib/i18n';
import { SectorIcon } from '@/components/ui/sector-icon';
import type {
  BreakerState,
  BuildingSceneModel,
  ControllerSceneModel,
  LineFlowSceneModel,
  SceneModel,
} from '../types';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { useZoomPan } from '../hooks/use-zoom-pan';
import { ZOOM_MAX, ZOOM_MIN, toTransform } from '../utils/zoom-pan';
import {
  DIAGRAM_H,
  DIAGRAM_SECTORS,
  DIAGRAM_W,
  applianceBranchRoute,
  applianceBranchSlots,
  diagramLayout,
  type Box,
  type DiagramLayout,
  type DiagramVariant,
  type Pt,
} from '../utils/diagram-layout';
import { toSvgPath } from '../utils/flow-path';
import { STATUS_BG_CLASS, STATUS_HEX, STATUS_TEXT_CLASS } from '../utils/scene-palette';
import { derivationSpeed } from '../utils/tap-point';
import { NO_LOAD_KW } from '../utils/feeder-tone';
import { useFeederLabels } from '../hooks/use-feeder-labels';
import { appliancesPerSector, type ApplianceMarkerSceneModel } from '../utils/appliance-markers';
import { PILL_H, appliancePills } from '../utils/appliance-pills';
import { FlowWire, type WireState } from './flow-wire';
import { DispatchShareBar, FeederChip, type DispatchSegment } from './dispatch-share-bar';

export interface GridDiagramProps {
  model: SceneModel;
  variant: DiagramVariant;
  selectedSector?: SectorId | null;
  onSelectSector?: (sector: SectorId | null) => void;
  className?: string;
  /** Plain mouse wheel zooms (full screen). Otherwise Ctrl/⌘ + wheel, pinch or the buttons. */
  wheelZoom?: boolean;
}

function sectorWireState(b: BuildingSceneModel, active: boolean): WireState {
  // A burning sector (F1) is isolated: red break mark, whatever the hour's load.
  if (b.onFire) return 'cut';
  if (active) {
    return b.mode === 'lifeline' ? 'lifeline' : 'flow';
  }
  return b.status === 'unserved' || (b.demandKw > NO_LOAD_KW && b.mode === 'off') ? 'cut' : 'idle';
}

/**
 * 2D microgrid diagram (village plan or single-line circuit). Mirrors the 3D twin:
 * same SceneModel, glowing electrons on powered cables, red break marks on shed ones.
 * Labels live in reserved boxes of the SVG itself (foreignObject), so they scale with
 * the wires and never cover a cable or each other.
 */
export function GridDiagram({
  model,
  variant,
  selectedSector = null,
  onSelectSector,
  className,
  wheelZoom = false,
}: GridDiagramProps) {
  const t = useTranslations('features.gridDiagram');
  const tSectors = useTranslations('sectors');
  const reduced = useReducedMotion();
  const animate = !reduced && !model.isModified;
  const glowId = useId().replace(/:/g, '');
  const glow = `url(#${glowId})`;

  const layout = useMemo(() => diagramLayout(variant), [variant]);
  const { viewportRef, zoom, zoomIn, zoomOut, reset, handlers } = useZoomPan({ wheelZoom });
  // A new view starts unzoomed.
  useEffect(() => reset(), [variant, reset]);
  const feeders = useFeederLabels(model);
  const { lines, solar, battery, buildings } = model;
  // Non-electric objects (VS-T40) have no branch on the electrical diagram.
  const wired = useMemo(() => model.appliances?.filter((a) => !a.nonElectric), [model.appliances]);
  const applianceCounts = useMemo(() => appliancesPerSector(wired), [wired]);
  const branchSlots = useMemo(() => applianceBranchSlots(wired ?? []), [wired]);
  // Placement depends only on which lines exist, not on the hour: recompute on that key alone.
  const pillKey = (wired ?? [])
    .map((a) => `${a.id}|${a.sector}|${a.connectionMode ?? 'branch'}`)
    .join(',');
  const pills = useMemo(
    () =>
      appliancePills(
        pillKey
          ? pillKey.split(',').map((row) => {
              const [id, sector, mode] = row.split('|');
              return {
                id: id!,
                sector: sector as SectorId,
                connectionMode: mode as 'branch' | 'ems',
              };
            })
          : [],
        variant,
        layout
      ),
    [pillKey, variant, layout]
  );
  const feederOn = lines.batteryToBus.active;

  const batteryState = !model.hasResult
    ? t('noData')
    : battery.isCharging
      ? t('charging', { kw: fmtKw(battery.flowKw) })
      : battery.isDischarging
        ? t('discharging', { kw: fmtKw(Math.abs(battery.flowKw)) })
        : t('idle');

  return (
    <div
      className={cn('flex flex-col gap-2 w-full h-full min-h-0', className)}
      data-variant={variant}
    >
      {/* Zoom/pan viewport; the content layer is transformed, layout (and cqw text) is not. */}
      <div
        ref={viewportRef}
        data-zoom={zoom.scale.toFixed(2)}
        className={cn(
          'relative flex-1 min-h-0 w-full overflow-hidden select-none',
          // Zoomed: every gesture pans. Unzoomed: one finger still scrolls the page.
          zoom.scale > 1 ? 'touch-none cursor-grab active:cursor-grabbing' : 'touch-pan-y'
        )}
        {...handlers}
      >
        {/* Fit a 16:10 box (same ratio as the viewBox) in the space the parent gives. */}
        <div
          className="absolute inset-0 flex items-center justify-center origin-top-left [container-type:size]"
          style={{ transform: toTransform(zoom) }}
        >
          <div
            role="group"
            aria-label={t(variant === 'circuit' ? 'circuitLabel' : 'topologyLabel')}
            className="relative aspect-[8/5] w-[min(100cqw,160cqh)] [container-type:size]"
          >
            <svg
              viewBox={`0 0 ${DIAGRAM_W} ${DIAGRAM_H}`}
              className="absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              <defs>
                <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="1.4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {variant === 'topology' && <TopologyGround layout={layout} />}

              {/* Circuit: EMS switchboard frame, bus bar + every breaker inside it */}
              {layout.enclosure && (
                <rect
                  x={layout.enclosure.x}
                  y={layout.enclosure.y}
                  width={layout.enclosure.w}
                  height={layout.enclosure.h}
                  rx={3}
                  strokeWidth={0.8}
                  strokeDasharray="3 2"
                  className={cn(
                    'fill-energy-cyan/5',
                    model.controller.mode === 'normal'
                      ? 'stroke-energy-cyan/60'
                      : 'stroke-warning-amber/70'
                  )}
                />
              )}

              {/* Bus bar under the feeders */}
              <line
                x1={layout.busBar[0][0]}
                y1={layout.busBar[0][1]}
                x2={layout.busBar[1][0]}
                y2={layout.busBar[1][1]}
                stroke="currentColor"
                strokeWidth={3.5}
                strokeLinecap="round"
                className={feederOn ? 'text-energy-cyan' : 'text-border-strong'}
                filter={feederOn ? glow : undefined}
              />

              <FlowWire
                points={layout.wires.solarToHub}
                line={lines.solarToBattery}
                state={lines.solarToBattery.active ? 'flow' : 'idle'}
                colorClass="text-solar-amber"
                animate={animate}
                glow={glow}
              />
              <FlowWire
                points={layout.wires.hubToBus}
                line={lines.batteryToBus}
                state={feederOn ? 'flow' : 'idle'}
                colorClass="text-energy-cyan"
                animate={animate}
                glow={glow}
              />
              {layout.wires.controllerToBus && (
                <FlowWire
                  points={layout.wires.controllerToBus}
                  line={lines.batteryToBus}
                  state={feederOn ? 'flow' : 'idle'}
                  colorClass="text-energy-cyan"
                  animate={animate}
                  glow={glow}
                />
              )}
              {DIAGRAM_SECTORS.map((id) => {
                const b = buildings[id];
                const line = lines.busToSectors[id];
                const state = sectorWireState(b, line.active);
                return (
                  <FlowWire
                    key={id}
                    points={layout.wires.busToSector[id]}
                    line={line}
                    state={state}
                    intensity={b.intensity}
                    colorClass={STATUS_TEXT_CLASS[b.onFire ? 'critical-red' : b.statusColor]}
                    animate={animate}
                    glow={glow}
                  />
                );
              })}

              {/* Inserted appliance branch lines & nodes (PI-T9) */}
              {wired?.map((appliance) => {
                const mode = appliance.connectionMode ?? 'branch';
                const pill = pills[appliance.id];
                const route = pill
                  ? { points: pill.route, node: pill.route.at(-1)! }
                  : applianceBranchRoute(
                      appliance.sector,
                      mode,
                      variant,
                      layout,
                      branchSlots[appliance.id]
                    );
                const b = buildings[appliance.sector];
                const isCut = b.onFire;
                const lineState = sectorWireState(b, appliance.running && b.connected);
                const tone = isCut ? 'critical-red' : appliance.running ? 'battery-green' : 'idle';
                const lineFlow: LineFlowSceneModel = {
                  from: [route.points[0]![0], 0, route.points[0]![1]],
                  to: [route.node[0], 0, route.node[1]],
                  active: appliance.running && !isCut,
                  flowKw: appliance.kwNow,
                  direction: appliance.running ? 'forward' : 'idle',
                  speed: derivationSpeed(appliance.kwNow),
                  color: STATUS_HEX[tone],
                  cut: isCut,
                };

                return (
                  <g key={`appliance-branch-${appliance.id}`} data-appliance-branch={appliance.id}>
                    <FlowWire
                      points={route.points}
                      line={lineFlow}
                      state={lineState}
                      intensity={appliance.running ? 1 : 0}
                      colorClass={STATUS_TEXT_CLASS[tone]}
                      animate={animate}
                      glow={glow}
                    />
                    <g
                      data-testid={`diagram-appliance-${appliance.id}`}
                      data-connection-mode={mode}
                      data-sector={appliance.sector}
                      opacity={pill ? 0 : undefined}
                    >
                      <circle
                        cx={route.node[0]}
                        cy={route.node[1]}
                        r={2.8}
                        className={cn(
                          'transition-colors',
                          isCut
                            ? 'fill-critical-red stroke-critical-red'
                            : appliance.running
                              ? 'fill-energy-cyan stroke-slate-950'
                              : 'fill-surface-elevated stroke-border'
                        )}
                        strokeWidth={1}
                      />
                      <circle
                        cx={route.node[0]}
                        cy={route.node[1]}
                        r={1.2}
                        className={appliance.running ? 'fill-slate-950' : 'fill-text-muted'}
                      />
                      <title>
                        {t('applianceTitle', {
                          name: appliance.name,
                          kw: fmtKw(appliance.kwNow),
                          feed:
                            mode === 'ems'
                              ? t('controller.shortTitle')
                              : tSectors(appliance.sector),
                        })}
                      </title>
                    </g>
                  </g>
                );
              })}

              {layout.breakers &&
                DIAGRAM_SECTORS.map((id) => (
                  <Breaker
                    key={id}
                    at={layout.breakers![id]}
                    state={model.controller.feeders[id].breaker}
                    colorClass={STATUS_TEXT_CLASS[feeders.tones[id]]}
                    tooltip={feeders.titles[id]}
                  />
                ))}
            </svg>

            {/* Labels in their reserved boxes (same geometry as the SVG) */}
            <Slot box={layout.busLabel}>
              <span
                className={cn(
                  'flex h-full items-center justify-center whitespace-nowrap rounded-full border bg-surface-elevated px-[0.9cqw] font-mono text-[1.5cqw] tracking-wide',
                  feederOn
                    ? 'border-energy-cyan/40 text-energy-cyan'
                    : 'border-border text-text-muted'
                )}
              >
                {t('bus')} · {fmtKw(model.hasResult ? lines.batteryToBus.flowKw : null)}
              </span>
            </Slot>

            <Slot box={layout.boxes.controller}>
              <ControllerNodeCard
                controller={model.controller}
                strategy={model.strategy}
                compact={variant === 'circuit'}
                segments={
                  model.hasResult
                    ? DIAGRAM_SECTORS.map((id) => ({
                        id,
                        share: model.controller.feeders[id].share,
                        tone: feeders.tones[id],
                        title: feeders.titles[id],
                      }))
                    : []
                }
              />
            </Slot>

            {/* kW the controller sends down each feeder */}
            {model.hasResult &&
              DIAGRAM_SECTORS.filter((id) => buildings[id].connected).map((id) => (
                <Slot key={`tag-${id}`} box={layout.feederTags[id]}>
                  <FeederChip
                    id={id}
                    size="sm"
                    showIcon={false}
                    kwLabel={fmtKw(buildings[id].servedKw)}
                    tone={feeders.tones[id]}
                    coveragePct={null}
                    title={feeders.titles[id]}
                  />
                </Slot>
              ))}

            <Slot box={layout.boxes.solar}>
              <NodeCard
                tone="solar"
                icon={<Sun className="h-[2.2cqw] w-[2.2cqw] text-solar-amber" />}
              >
                <span className="block truncate text-text-secondary">{t('solar')}</span>
                <span className="block truncate font-mono font-semibold text-solar-amber">
                  {fmtKw(model.hasResult ? solar.currentKw : null)}
                </span>
              </NodeCard>
            </Slot>

            <Slot box={layout.boxes.hub}>
              <NodeCard
                tone="battery"
                icon={<BatteryCharging className="h-[2.2cqw] w-[2.2cqw] text-battery-green" />}
              >
                <span className="block truncate text-text-secondary">{t('battery')}</span>
                <span className="block truncate font-mono font-semibold text-battery-green">
                  {t('soc', { pct: fmtPct(battery.socPct, 0) })}
                </span>
                <span className="block truncate font-mono text-text-muted">{batteryState}</span>
              </NodeCard>
            </Slot>

            {DIAGRAM_SECTORS.map((id) => (
              <Slot key={id} box={layout.boxes.sectors[id]}>
                <SectorCard
                  id={id}
                  name={tSectors(id)}
                  building={buildings[id]}
                  hasResult={model.hasResult}
                  statusLabel={t(`status.${buildings[id].status}`)}
                  modeLabel={t(`feederMode.${buildings[id].mode}`)}
                  noLoadLabel={t('status.noLoad')}
                  fireLabel={t('onFire')}
                  applianceLabel={
                    applianceCounts[id] > 0
                      ? t('applianceCount', { count: applianceCounts[id] })
                      : undefined
                  }
                  selected={selectedSector === id}
                  onSelect={onSelectSector}
                />
              </Slot>
            ))}

            {/* Inserted appliances: named card at the end of their branch */}
            {wired?.map((appliance) => {
              const pill = pills[appliance.id];
              if (!pill) return null;
              const mode = appliance.connectionMode ?? 'branch';
              return (
                <Slot key={`pill-${appliance.id}`} box={pill.box}>
                  <AppliancePillCard
                    appliance={appliance}
                    compact={pill.box.h < PILL_H}
                    onFire={buildings[appliance.sector].onFire}
                    title={t('applianceTitle', {
                      name: appliance.name,
                      kw: fmtKw(appliance.kwNow),
                      feed:
                        mode === 'ems' ? t('controller.shortTitle') : tSectors(appliance.sector),
                    })}
                    selected={selectedSector === appliance.sector}
                    onSelect={
                      onSelectSector
                        ? () =>
                            onSelectSector(
                              selectedSector === appliance.sector ? null : appliance.sector
                            )
                        : undefined
                    }
                  />
                </Slot>
              );
            })}
          </div>
        </div>
        <ZoomControls scale={zoom.scale} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={reset} />
      </div>

      <DiagramLegend />
    </div>
  );
}

/** Inserted appliance on the diagram: status dot, name and its engine kW this hour. */
function AppliancePillCard({
  appliance,
  compact,
  onFire,
  title,
  selected,
  onSelect,
}: {
  appliance: ApplianceMarkerSceneModel;
  /** One line: name only (kW stays in the tooltip). */
  compact: boolean;
  onFire: boolean;
  title: string;
  selected: boolean;
  onSelect?: () => void;
}) {
  const tone = onFire ? 'critical-red' : appliance.running ? 'battery-green' : 'idle';
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!onSelect}
      title={title}
      aria-label={title}
      data-testid={`diagram-appliance-pill-${appliance.id}`}
      className={cn(
        'flex h-full w-full flex-col justify-center gap-[0.3cqw] overflow-hidden rounded-[0.9cqw] border bg-surface-elevated px-[0.8cqw] text-left leading-none transition-colors',
        onFire
          ? 'border-critical-red text-critical-red'
          : selected
            ? 'border-energy-cyan text-energy-cyan'
            : appliance.running
              ? 'border-energy-cyan/50 text-text-primary'
              : 'border-border text-text-secondary',
        onSelect && 'cursor-pointer hover:border-text-secondary'
      )}
    >
      <span className="flex min-w-0 items-center gap-[0.5cqw] text-[1.3cqw] font-medium">
        <span
          className={cn('h-[0.9cqw] w-[0.9cqw] shrink-0 rounded-full', STATUS_BG_CLASS[tone])}
          aria-hidden="true"
        />
        <span className="truncate">{appliance.name}</span>
      </span>
      {!compact && (
        <span className="truncate font-mono text-[1.15cqw] text-text-muted">
          {fmtKw(appliance.kwNow)}
        </span>
      )}
    </button>
  );
}

/** Floating zoom buttons (bottom-right of the diagram viewport). */
function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  const tCommon = useTranslations('common');
  const t = useTranslations('features.gridDiagram');
  const btn =
    'flex h-10 w-10 md:h-8 md:w-8 items-center justify-center rounded-control-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none cursor-pointer';
  return (
    <div
      role="group"
      aria-label={t('zoomControls')}
      title={t('zoomHint')}
      className="absolute bottom-2 right-2 z-10 flex items-center gap-0.5 rounded-control border border-border bg-surface-elevated/90 p-0.5 shadow-xs backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onZoomOut}
        disabled={scale <= ZOOM_MIN}
        aria-label={tCommon('zoomOut')}
        title={tCommon('zoomOut')}
        className={btn}
      >
        <ZoomOut className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        className="min-w-[3ch] text-center font-mono text-[11px] text-text-muted"
        aria-live="polite"
      >
        {fmtPct(scale * 100, 0)}
      </span>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={scale >= ZOOM_MAX}
        aria-label={tCommon('zoomIn')}
        title={tCommon('zoomIn')}
        className={btn}
      >
        <ZoomIn className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={scale <= ZOOM_MIN}
        aria-label={tCommon('resetZoom')}
        title={tCommon('resetZoom')}
        className={btn}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * HTML label over its reserved diagram box. Positions are % of the 16:10 box and
 * text uses container units (cqw), so labels scale with the wires without transforms.
 */
function Slot({ box, children }: { box: Box; children: ReactNode }) {
  return (
    <div
      className="absolute"
      style={{
        left: `${(box.x / DIAGRAM_W) * 100}%`,
        top: `${(box.y / DIAGRAM_H) * 100}%`,
        width: `${(box.w / DIAGRAM_W) * 100}%`,
        height: `${(box.h / DIAGRAM_H) * 100}%`,
      }}
    >
      {children}
    </div>
  );
}

function NodeCard({
  tone,
  icon,
  children,
}: {
  tone: 'solar' | 'battery';
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex h-full items-center gap-[0.9cqw] overflow-hidden rounded-[0.9cqw] border bg-surface px-[1.2cqw] text-[1.72cqw] leading-[1.3]',
        tone === 'solar' ? 'border-solar-amber/60' : 'border-battery-green/60'
      )}
    >
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SectorCard({
  id,
  name,
  building,
  hasResult,
  statusLabel,
  modeLabel,
  noLoadLabel,
  fireLabel,
  applianceLabel,
  selected,
  onSelect,
}: {
  id: SectorId;
  name: string;
  building: BuildingSceneModel;
  hasResult: boolean;
  statusLabel: string;
  modeLabel: string;
  noLoadLabel: string;
  /** Badge + status line of a burning sector (F1). */
  fireLabel: string;
  /** « n added » when appliances from the village editor feed this sector (PV-T13). */
  applianceLabel?: string;
  selected: boolean;
  onSelect?: (sector: SectorId | null) => void;
}) {
  // A sector with no demand this hour is not "powered": show it neutral.
  const onFire = building.onFire;
  const noLoad = !onFire && hasResult && building.status === 'full' && building.demandKw <= 0.05;
  const statusColor = onFire ? 'critical-red' : noLoad ? 'idle' : building.statusColor;

  // Halo glow on building cards ∝ intensity & mode (PL-T12, using semantic @theme tokens exclusively)
  let glowClass = 'border-border shadow-none';
  if (onFire) {
    glowClass =
      'border-2 border-critical-red bg-critical-red/10 shadow-[0_0_14px_var(--color-critical-red)]' +
      (selected ? ' ring-2 ring-energy-cyan/50' : '');
  } else if (selected) {
    glowClass =
      'border-energy-cyan ring-2 ring-energy-cyan/50 shadow-[0_0_12px_var(--color-energy-cyan)]';
  } else if (hasResult && building.connected && building.intensity > 0) {
    if (building.mode === 'lifeline') {
      glowClass = 'border-warning-amber/60 shadow-[0_0_10px_var(--color-warning-amber)]';
    } else if (building.intensity > 0.6) {
      glowClass = 'border-battery-green/60 shadow-[0_0_12px_var(--color-battery-green)]';
    } else if (building.intensity > 0.2) {
      glowClass = 'border-battery-green/50 shadow-[0_0_8px_var(--color-battery-green)]';
    } else {
      glowClass = 'border-warning-amber/50 shadow-[0_0_6px_var(--color-warning-amber)]';
    }
  } else if (building.status === 'unserved') {
    glowClass = 'border-critical-red/70 shadow-none';
  }

  const modeBadgeClass =
    building.mode === 'full'
      ? 'border-battery-green/40 text-battery-green bg-battery-green/10'
      : building.mode === 'lifeline'
        ? 'border-warning-amber/50 text-warning-amber bg-warning-amber/20 font-semibold shadow-[0_0_6px_var(--color-warning-amber)]'
        : building.mode === 'limited'
          ? 'border-warning-amber/40 text-warning-amber bg-warning-amber/10'
          : 'border-border text-text-muted bg-surface-elevated/40';

  const className = cn(
    'flex h-full w-full flex-col justify-center overflow-hidden rounded-[0.9cqw] border bg-surface px-[1.2cqw] text-left text-[1.64cqw] leading-[1.2] transition-all',
    glowClass,
    onSelect && 'cursor-pointer hover:border-text-secondary'
  );
  const content = (
    <>
      <div className="flex items-center justify-between gap-[0.4cqw]">
        <span className="flex min-w-0 items-center gap-[0.6cqw]">
          <SectorIcon sector={id} className="h-[1.9cqw] w-[1.9cqw]" />
          <span className="truncate font-semibold text-text-primary">{name}</span>
        </span>
        {onFire ? (
          <span className="shrink-0 flex items-center gap-[0.3cqw] rounded-full border border-critical-red bg-critical-red/20 px-[0.5cqw] py-[0.1cqw] font-mono text-[1.05cqw] font-semibold uppercase tracking-wider text-critical-red">
            <Flame className="h-[1.2cqw] w-[1.2cqw] motion-safe:animate-pulse" aria-hidden="true" />
            {fireLabel}
          </span>
        ) : (
          hasResult &&
          building.connected && (
            <span
              className={cn(
                'shrink-0 rounded-full border px-[0.5cqw] py-[0.1cqw] font-mono text-[1.05cqw] uppercase tracking-wider',
                modeBadgeClass
              )}
            >
              {modeLabel}
            </span>
          )
        )}
      </div>
      <span className="truncate whitespace-nowrap font-mono text-[1.35cqw]">
        <span className={cn('font-semibold', STATUS_TEXT_CLASS[statusColor])}>
          {fmtKw(hasResult ? building.servedKw : null)}
        </span>
        {hasResult && <span className="text-text-muted"> / {fmtKw(building.demandKw)}</span>}
        {applianceLabel && <span className="text-energy-cyan"> · {applianceLabel}</span>}
      </span>
      <span
        className={cn('flex min-w-0 items-center gap-[0.5cqw]', STATUS_TEXT_CLASS[statusColor])}
      >
        <span
          className={cn(
            'h-[0.9cqw] w-[0.9cqw] shrink-0 rounded-full',
            STATUS_BG_CLASS[statusColor]
          )}
          aria-hidden="true"
        />
        <span className="truncate">{onFire ? fireLabel : noLoad ? noLoadLabel : statusLabel}</span>
      </span>
    </>
  );
  return onSelect ? (
    <button
      type="button"
      title={name}
      aria-pressed={selected}
      onClick={() => onSelect(selected ? null : id)}
      className={className}
    >
      {content}
    </button>
  ) : (
    <div title={name} className={className}>
      {content}
    </div>
  );
}

function ControllerNodeCard({
  controller,
  strategy,
  compact,
  segments,
}: {
  controller: ControllerSceneModel;
  strategy: StrategyId;
  /** Circuit header tab: no strategy text. */
  compact: boolean;
  segments: DispatchSegment[];
}) {
  const t = useTranslations('features.gridDiagram');
  const tStrategies = useTranslations('strategies');
  const mode = controller.mode;

  const modeBadgeClass =
    mode === 'normal'
      ? 'border-battery-green/40 text-battery-green bg-battery-green/10'
      : mode === 'lifeline_only'
        ? 'border-warning-amber/50 text-warning-amber bg-warning-amber/15 animate-pulse'
        : 'border-warning-amber/40 text-warning-amber bg-warning-amber/10';

  const dotClass = mode === 'normal' ? 'bg-battery-green' : 'bg-warning-amber';

  const tooltipText = `${t('controller.title')} (${t(`controller.mode.${mode}`)}): ${t(`controller.ruleDesc.${mode}`)} · ${tStrategies(strategy)}`;

  return (
    <div
      title={tooltipText}
      tabIndex={0}
      role="region"
      aria-label={tooltipText}
      className={cn(
        'group relative flex h-full flex-col justify-center gap-[0.4cqw] overflow-hidden rounded-[0.9cqw] border bg-surface px-[0.8cqw] text-[1.45cqw] leading-[1.15] transition-colors',
        mode === 'normal'
          ? 'border-energy-cyan/50 hover:border-energy-cyan'
          : 'border-warning-amber/60 hover:border-warning-amber ring-1 ring-warning-amber/20'
      )}
    >
      <span className="flex min-w-0 items-center gap-[0.4cqw]">
        <Cpu className="h-[1.7cqw] w-[1.7cqw] shrink-0 text-energy-cyan" aria-hidden="true" />
        <span className="truncate font-semibold text-text-primary">
          {t('controller.shortTitle')}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-[0.5cqw] font-mono text-[1.15cqw]">
        <span
          className={cn(
            'flex shrink-0 items-center gap-[0.3cqw] rounded-full border px-[0.5cqw] py-[0.1cqw]',
            modeBadgeClass
          )}
        >
          <span className={cn('h-[0.6cqw] w-[0.6cqw] rounded-full', dotClass)} aria-hidden="true" />
          <span className="whitespace-nowrap">{t(`controller.mode.${mode}`)}</span>
        </span>
        {!compact && <span className="truncate text-text-muted">{tStrategies(strategy)}</span>}
      </span>
      {segments.length > 0 && <DispatchShareBar segments={segments} className="h-[0.7cqw]" />}
    </div>
  );
}

/** IEC-style breaker with current limiter (PL-T6): closed = straight bar; limited = bar + limiter notch; open = lifted blade. */
function Breaker({
  at,
  state,
  colorClass,
  tooltip,
}: {
  at: Pt;
  state: BreakerState;
  colorClass: string;
  tooltip?: string;
}) {
  const [x, y] = at;
  return (
    <g className={colorClass} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
      {tooltip && <title>{tooltip}</title>}
      <rect
        x={x - 8}
        y={y - 6}
        width={16}
        height={12}
        rx={2}
        className="fill-canvas"
        strokeWidth={0.7}
      />
      <circle cx={x - 5} cy={y} r={1.1} fill="currentColor" stroke="none" />
      <circle cx={x + 5} cy={y} r={1.1} fill="currentColor" stroke="none" />
      {state === 'open' ? (
        <line x1={x - 5} y1={y} x2={x + 4} y2={y - 4.5} />
      ) : state === 'limited' ? (
        <>
          {/* Closed contact with current limiter symbol (IEC diagonal slash / notch) */}
          <line x1={x - 5} y1={y} x2={x + 5} y2={y} />
          <line x1={x - 2} y1={y - 3} x2={x + 2} y2={y + 3} strokeWidth={1.2} />
          <circle
            cx={x}
            cy={y}
            r={1.8}
            className="fill-warning-amber/20 stroke-warning-amber"
            strokeWidth={0.7}
          />
        </>
      ) : (
        <line x1={x - 5} y1={y} x2={x + 5} y2={y} />
      )}
    </g>
  );
}

/** Village plan texture: a pale street under every cable run. */
function TopologyGround({ layout }: { layout: DiagramLayout }) {
  const runs = [
    layout.wires.solarToHub,
    layout.wires.hubToBus,
    layout.busBar,
    ...DIAGRAM_SECTORS.map((id) => layout.wires.busToSector[id]),
  ];
  return (
    <g
      className="text-border"
      stroke="currentColor"
      strokeOpacity={0.4}
      strokeWidth={8}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      {runs.map((pts, i) => (
        <path key={i} d={toSvgPath(pts)} />
      ))}
    </g>
  );
}

function DiagramLegend() {
  const t = useTranslations('features.gridDiagram');
  const items: { key: string; swatch: ReactNode }[] = [
    {
      key: 'legendFlow',
      swatch: (
        <span className="flex items-center gap-0.5" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-energy-cyan shadow-[0_0_6px_var(--color-energy-cyan)]" />
          <span className="h-1.5 w-1.5 rounded-full bg-energy-cyan shadow-[0_0_6px_var(--color-energy-cyan)]" />
        </span>
      ),
    },
    {
      key: 'legendLifeline',
      swatch: (
        <span className="w-4 border-t-2 border-dashed border-warning-amber" aria-hidden="true" />
      ),
    },
    {
      key: 'legendLimiter',
      swatch: (
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="h-2 w-2 rounded-full border border-warning-amber bg-warning-amber/40" />
        </span>
      ),
    },
    {
      key: 'legendPartial',
      swatch: <span className="h-0.5 w-4 rounded-full bg-warning-amber" aria-hidden="true" />,
    },
    {
      key: 'legendCut',
      swatch: <span className="w-4 border-t border-dashed border-text-muted" aria-hidden="true" />,
    },
    {
      key: 'legendIdle',
      swatch: <span className="h-0.5 w-4 rounded-full bg-border-strong" aria-hidden="true" />,
    },
  ];
  return (
    <ul
      aria-label={t('legendTitle')}
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-text-muted font-sans"
    >
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-1.5">
          {it.swatch}
          <span>{t(it.key)}</span>
        </li>
      ))}
    </ul>
  );
}
