'use client';

import { useState, type MouseEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Crop,
  Loader2,
  RotateCcw,
  ScanSearch,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  boxPath,
  isAppliance,
  MAX_REGIONS,
  polygonBounds,
  type ApplianceDetection,
  type NormBox,
} from '@/lib/vision';
import type { VisionStatus } from '../hooks/use-vision-detection';
import { categoryHint } from '../utils/labels';
import { markStyle } from '../utils/mark-color';
import { paintOrder, pickAt } from '../utils/stacking';
import { useDetectionLabel, useObjectName } from '../hooks/use-object-name';
import { useEdgeMap } from '../hooks/use-edge-map';
import { useShapeEditor } from '../hooks/use-shape-editor';
import { usePhotoZoom } from '../hooks/use-photo-zoom';
import { boxPoints, toNormPoint, type DrawnShape, type DrawTool } from '../utils/shapes';
import { DrawOverlay } from './draw-overlay';
import { DrawPanel } from './draw-panel';
import { ZoomControls } from './zoom-controls';

export interface DetectionCanvasProps {
  imageUrl: string;
  status: VisionStatus;
  detections: ApplianceDetection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry?: () => void;
  /** Stops the running analysis (VS-T26). Absent = no « Cancel » button. */
  onCancel?: () => void;
  /** The mock answered instead of the vision model (offline or fallback). */
  isDemo?: boolean;
  /**
   * Send shapes drawn around missing objects to the vision model (PV-T8); `fallbackLabel` names an
   * object the operator left unnamed. Absent = no « Draw » button.
   */
  onSendShapes?: (shapes: DrawnShape[], fallbackLabel: string) => boolean;
  onRemoveManual?: (id: string) => void;
  /** How many more objects can be drawn on this photo. */
  manualRoom?: number;
  /** Drawn objects the model is still identifying. */
  identifyingIds?: readonly string[];
  /** The last identification failed: drawn objects keep the operator's text. */
  identifyFailed?: boolean;
  /** The operator corrected an object's box. Absent = no « Adjust the box » button. */
  onAdjustBox?: (id: string, box: NormBox) => void;
  /** Objects whose load line is in the simulation (« In simulation » chip). */
  inSimulationIds?: readonly string[];
}

/**
 * Photo with one outline per detected appliance (PV-T7). Pointer: hover highlights, click selects.
 * Keyboard and screen readers use the list under the photo (same highlight on focus).
 */
export function DetectionCanvas({
  imageUrl,
  status,
  detections,
  selectedId,
  onSelect,
  onRetry,
  onCancel,
  isDemo,
  onSendShapes,
  onRemoveManual,
  manualRoom = MAX_REGIONS,
  identifyingIds = [],
  identifyFailed,
  onAdjustBox,
  inSimulationIds,
}: DetectionCanvasProps) {
  const t = useTranslations('features.visionInsert');
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = detections.find((d) => d.id === activeId) ?? null;
  const busy = status === 'loading';
  // Drawn boxes stay visible even when the AI failed.
  const showList =
    status === 'refining' || status === 'ready' || (status === 'error' && detections.length > 0);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<DrawTool>('box');
  // Edges are computed only once the lasso is picked.
  const edges = useEdgeMap(imageUrl, drawing && tool === 'lasso');
  const editor = useShapeEditor({
    maxShapes: Math.max(0, Math.min(MAX_REGIONS, manualRoom)),
    edgeMap: edges.status === 'ready' ? edges.map : null,
    tool,
  });
  const [panOn, setPanOn] = useState(false);
  // Box correction: one box loaded in a second editor (move + corner handles, no new shape).
  const adjustEditor = useShapeEditor({ maxShapes: 1, edgeMap: null, tool: 'box' });
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  // Picking another object (list) ends the correction without saving.
  const adjusting =
    adjustingId && adjustingId === selectedId
      ? (detections.find((d) => d.id === adjustingId) ?? null)
      : null;
  const selectedDetection = detections.find((d) => d.id === selectedId) ?? null;
  // Colour = position in the list (same as the list rows), whatever the paint order.
  const colorIndex = new Map(detections.map((d, i) => [d.id, i]));
  /** Click on the photo → smallest box under the pointer; again on the same spot → the one under it. */
  const pickUnder = (e: MouseEvent<SVGPathElement>, fallback: string) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return fallback;
    const point = toNormPoint(e.clientX, e.clientY, svg.getBoundingClientRect());
    return pickAt(detections, point, selectedId) ?? fallback;
  };
  const { viewportRef, contentStyle, onImageLoad, centreOn, ...zoom } = usePhotoZoom(
    imageUrl,
    adjusting?.box ?? null
  );
  const canDraw = !!onSendShapes && status !== 'idle' && status !== 'loading';
  const canAdjust =
    !!onAdjustBox &&
    !!selectedDetection &&
    !drawing &&
    !adjusting &&
    !busy &&
    !identifyingIds.includes(selectedDetection.id);
  const startAdjust = (d: ApplianceDetection) => {
    const { x, y, w, h } = d.box;
    adjustEditor.load([
      { id: d.id, tool: 'box', points: boxPoints([x, y], [x + w, y + h]), hint: '' },
    ]);
    setAdjustingId(d.id);
    centreOn(d.box);
  };
  const stopAdjust = () => {
    adjustEditor.clear();
    setAdjustingId(null);
    setPanOn(false);
  };
  const saveAdjust = () => {
    const shape = adjustEditor.shapes[0];
    if (adjusting && shape) onAdjustBox?.(adjusting.id, polygonBounds(shape.points));
    stopAdjust();
  };
  const editing = drawing || !!adjusting;
  const stopDrawing = () => {
    editor.clear();
    setDrawing(false);
    setPanOn(false);
  };
  const send = () => {
    if (onSendShapes?.(editor.shapes, t('drawnObject'))) stopDrawing();
  };
  const objectName = useObjectName();
  const nameOf = useDetectionLabel();
  const hint = (d: ApplianceDetection) => categoryHint(nameOf(d), objectName(d));

  const [filter, setFilter] = useState<'all' | 'appliances' | 'scenery' | 'insim'>('all');
  const filteredDetections = detections.filter((d) => {
    if (filter === 'appliances') return isAppliance(d);
    if (filter === 'scenery') return !isAppliance(d);
    if (filter === 'insim') return inSimulationIds?.includes(d.id);
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-md border border-ai-violet/40 bg-ai-violet/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-ai-violet">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {t('aiLabel')}
        </span>
        {isDemo && <span className="text-text-muted">{t('demoNote')}</span>}
        {status === 'refining' && (
          <span role="status" className="inline-flex items-center gap-1 text-text-secondary">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            {t('refining')}
          </span>
        )}
        {status === 'refining' && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-energy-cyan"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {t('cancelAnalysis')}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {onRetry && !busy && !editing && (
            <button
              type="button"
              onClick={onRetry}
              aria-label={t('retryDetection')}
              title={t('retryDetection')}
              className="flex h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface-elevated px-2 text-text-primary hover:bg-surface-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-energy-cyan"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <ZoomControls
            zoom={zoom}
            pan={
              editing && zoom.zoom > 1
                ? { on: panOn, toggle: () => setPanOn((on) => !on) }
                : undefined
            }
          />
        </div>
      </div>

      {/* Scroll box: pans the zoomed photo (bars, wheel, touch). The content is exactly the photo,
          so every overlay below stays in photo fractions at any zoom. */}
      <div
        ref={viewportRef}
        className="relative min-h-[440px] sm:min-h-[500px] lg:min-h-[560px] xl:min-h-[620px] max-h-[72vh] w-full overflow-auto rounded-2xl border border-border/80 bg-canvas-sunken shadow-inner flex items-center justify-center [-webkit-overflow-scrolling:touch]"
      >
        <div className="relative mx-auto" style={contentStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={t('imageAlt')}
            onLoad={onImageLoad}
            className={cn('block h-auto w-full', busy && 'opacity-60')}
          />
          {showList && detections.length > 0 && (
            <svg
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              {paintOrder(detections).map((d) => {
                // The box being corrected is drawn by the editor layer.
                if (d.id === adjusting?.id) return null;
                const selected = d.id === selectedId;
                const hot = d.id === activeId;
                return (
                  <path
                    key={d.id}
                    data-detection={d.id}
                    data-mark=""
                    style={markStyle(colorIndex.get(d.id) ?? 0)}
                    d={d.outline ?? boxPath(d.box)}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={selected ? 4 : hot ? 3 : 2}
                    strokeDasharray={d.manual ? '6 4' : undefined}
                    className={cn(
                      'cursor-pointer stroke-(--mark) transition-[fill,stroke-width]',
                      selected
                        ? 'fill-(--mark)/35'
                        : hot
                          ? 'fill-(--mark)/25'
                          : isAppliance(d)
                            ? 'fill-(--mark)/10'
                            : 'fill-(--mark)/5'
                    )}
                    onPointerEnter={() => setActiveId(d.id)}
                    onPointerLeave={() => setActiveId((id) => (id === d.id ? null : id))}
                    onClick={(e) => onSelect(pickUnder(e, d.id))}
                  />
                );
              })}
              {/* Selected outline again on top (no pointer): visible even under smaller boxes. */}
              {selectedDetection && selectedDetection.id !== adjusting?.id && (
                <path
                  data-mark=""
                  style={markStyle(colorIndex.get(selectedDetection.id) ?? 0)}
                  d={selectedDetection.outline ?? boxPath(selectedDetection.box)}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={4}
                  className="pointer-events-none fill-none stroke-(--mark)"
                />
              )}
            </svg>
          )}
          {showList && active && (
            <span
              className="pointer-events-none absolute max-w-[70%] truncate rounded-lg bg-surface-elevated/95 backdrop-blur-md px-2.5 py-1 text-xs font-semibold text-text-primary shadow-lg border border-border/80"
              style={{
                left: `${Math.min(active.box.x, 0.98) * 100}%`,
                top: `${active.box.y * 100}%`,
                transform: active.box.y > 0.08 ? 'translateY(-115%)' : 'translateY(6px)',
              }}
            >
              {hint(active) ? `${nameOf(active)} · ${hint(active)}` : nameOf(active)}
            </span>
          )}
          {drawing && <DrawOverlay editor={editor} tool={tool} passThrough={panOn} />}
          {adjusting && <DrawOverlay editor={adjustEditor} tool="box" passThrough={panOn} />}
          {busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm font-medium text-text-primary">
              <span role="status" className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t('loading')}
              </span>
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated/95 px-3 text-sm font-medium text-text-primary shadow-sm hover:bg-surface-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-energy-cyan"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  {t('cancelAnalysis')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {adjusting ? (
        <div className="flex flex-col gap-2 rounded-lg border border-solar-amber/40 bg-solar-amber/5 p-3">
          <p className="text-sm text-text-primary">
            {t('adjustTitle', { label: nameOf(adjusting) })}
          </p>
          <p className="text-xs text-text-secondary">{t('adjustHint')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveAdjust}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-energy-cyan px-3 text-sm font-medium text-slate-950 hover:bg-energy-cyan/90 cursor-pointer"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {t('adjustSave')}
            </button>
            <button
              type="button"
              onClick={stopAdjust}
              className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface-elevated px-3 text-sm font-medium text-text-primary hover:bg-surface-hover cursor-pointer"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : drawing && onSendShapes ? (
        <DrawPanel
          editor={editor}
          tool={tool}
          onToolChange={setTool}
          edges={edges}
          onSend={send}
          onCancel={stopDrawing}
        />
      ) : (
        canDraw && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={manualRoom <= 0}
              onClick={() => setDrawing(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 text-sm font-medium text-text-primary hover:bg-surface-hover cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SquareDashedMousePointer className="h-4 w-4" aria-hidden="true" />
              {t('drawButton')}
            </button>
            {canAdjust && selectedDetection && (
              <button
                type="button"
                onClick={() => startAdjust(selectedDetection)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 text-sm font-medium text-text-primary hover:bg-surface-hover cursor-pointer"
              >
                <Crop className="h-4 w-4" aria-hidden="true" />
                {t('adjustButton', { label: nameOf(selectedDetection) })}
              </button>
            )}
            {manualRoom <= 0 && <span className="text-xs text-text-muted">{t('manualLimit')}</span>}
          </div>
        )
      )}
      {identifyFailed && (
        <p role="status" className="text-xs text-text-secondary">
          {t('identifyError')}
        </p>
      )}

      {status === 'error' && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-critical-red/40 bg-critical-red/10 p-3 text-sm text-text-primary"
        >
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-critical-red" aria-hidden="true" />
            {t('error')}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text-primary hover:bg-surface-hover cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('retry')}
            </button>
          )}
        </div>
      )}

      {status === 'cancelled' && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-text-primary"
        >
          <span className="inline-flex items-center gap-2">
            <X className="h-4 w-4 text-text-muted" aria-hidden="true" />
            {t('analysisCancelled')}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 text-sm font-medium text-text-primary hover:bg-surface-hover cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('retry')}
            </button>
          )}
        </div>
      )}

      {showList && detections.length === 0 && !drawing && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <ScanSearch className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <div>
            <p className="font-medium text-text-primary">{t('empty')}</p>
            <p className="text-text-secondary">{t('emptyHint')}</p>
          </div>
        </div>
      )}

      {showList && detections.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-text-secondary">
              {t('listTitle', { count: detections.length })}
            </h4>
            <div
              className="flex items-center gap-1 text-[11px]"
              role="tablist"
              aria-label={t('listTitle', { count: detections.length })}
            >
              {(
                [
                  { id: 'all' as const, label: t('filterAll') },
                  { id: 'appliances' as const, label: t('filterAppliances') },
                  { id: 'scenery' as const, label: t('filterScenery') },
                  { id: 'insim' as const, label: t('filterInSim') },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={cn(
                    'rounded-md px-2 py-0.5 font-medium transition-colors cursor-pointer',
                    filter === id
                      ? 'bg-surface-elevated text-text-primary shadow-xs'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {filteredDetections.map((d) => {
              const selected = d.id === selectedId;
              const idx = colorIndex.get(d.id) ?? 0;
              return (
                <li key={d.id} className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    aria-pressed={selected}
                    data-mark=""
                    style={markStyle(idx)}
                    onClick={() => onSelect(d.id)}
                    onMouseEnter={() => setActiveId(d.id)}
                    onMouseLeave={() => setActiveId((id) => (id === d.id ? null : id))}
                    onFocus={() => setActiveId(d.id)}
                    onBlur={() => setActiveId((id) => (id === d.id ? null : id))}
                    className={cn(
                      'flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border-2 border-(--mark) px-3 py-2 text-left text-sm text-text-primary transition-all cursor-pointer',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-energy-cyan',
                      selected
                        ? 'bg-(--mark)/15 ring-2 ring-(--mark)/40 shadow-xs'
                        : 'bg-surface hover:bg-(--mark)/10'
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-(--mark)"
                        aria-hidden="true"
                      />
                      <span className="truncate font-medium">{nameOf(d)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-secondary">
                      {hint(d)}
                      {identifyingIds.includes(d.id) && (
                        <span className="inline-flex items-center gap-1 text-text-secondary">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          {t('identifying')}
                        </span>
                      )}
                      {inSimulationIds?.includes(d.id) && (
                        <span className="rounded border border-battery-green/60 px-1 py-px text-[10px] uppercase tracking-wide text-battery-green">
                          {t('inSimBadge')}
                        </span>
                      )}
                      {d.manual && (
                        <span className="rounded border border-solar-amber/50 px-1 py-px text-[10px] uppercase tracking-wide text-text-secondary">
                          {t('manualBadge')}
                        </span>
                      )}
                      {d.adjusted && (
                        <span className="rounded border border-border px-1 py-px text-[10px] uppercase tracking-wide text-text-secondary">
                          {t('adjustedBadge')}
                        </span>
                      )}
                      {!isAppliance(d) && (
                        <span className="rounded border border-border px-1 py-px text-[10px] uppercase tracking-wide text-text-muted">
                          {t('noLoad')}
                        </span>
                      )}
                    </span>
                  </button>
                  {d.manual && onRemoveManual && (
                    <button
                      type="button"
                      onClick={() => onRemoveManual(d.id)}
                      aria-label={t('removeManual', { label: nameOf(d) })}
                      className="flex w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-critical-red cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
