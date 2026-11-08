'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { WebGLRenderer } from 'three';
import {
  Box,
  ChevronRight,
  Glasses,
  Grid3X3,
  ImagePlus,
  Plug,
  ScanSearch,
  Sparkles,
  Zap,
} from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { useWebXR } from '@/features/microgrid-3d';
import { GridSchematicPreview } from '@/features/overview';
import { selectActiveResult, selectInput, selectTimeIndex, useSimulationStore } from '@/stores';
import { readAsDataUrl } from '@/lib/files';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { isAppliance } from '@/lib/vision';
import type { ValidatedFacade } from '../hooks/use-facade-2d';
import { useDetectionLabel } from '../hooks/use-object-name';
import { shapeKey, useObjectShape } from '../hooks/use-object-shape';
import { useKeptRef, useKeptState, VILLAGE_SCOPE } from '../hooks/use-kept-state';
import { useVisionSession } from '../hooks/use-vision-session';
import { applianceIdFor, photoKey } from '../utils/appliance-draft';
import { ApplianceInsert } from './appliance-insert';
import { ApplianceList } from './appliance-list';
import { DetectionCanvas } from './detection-canvas';
import { ObjectShapePanel } from './object-shape-panel';
import { SelectedAppliance } from './selected-appliance';
import { VillageXRViewport } from './xr';

/** Photos the vision route accepts. */
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const SAMPLE_ROOM_URL = '/samples/vision-room.jpg';

/**
 * /village — Village Studio (PV): Upload/drop a photo of a village room, workshop, or clinic.
 * Modern multi-pane Studio Workbench:
 * - Left pane: High-impact responsive image viewport & SAM segmentation canvas with quick object filter palette.
 * - Right pane: Modular Studio Inspector with tabbed views (Active Object 3D & Elevation, Load & Placement,
 *   Installed Appliances inventory, and Microgrid Twin schematic) to completely eliminate vertical scroll fatigue.
 */
export function VillageEditorPage() {
  const t = useTranslations('features.visionInsert');
  const tCommon = useTranslations('common');
  const fileRef = useRef<HTMLInputElement>(null);
  // VR session for the 3D room (filled once the WebGL renderer mounts).
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const xr = useWebXR(rendererRef);
  const xrActive = xr.status === 'active';
  const [vrViewOpen, setVrViewOpen] = useState(false);

  // Photo, objects, 2D and 3D stay when the operator visits another page and comes back.
  const [imageUrl, setImageUrl] = useKeptState<string | null>(VILLAGE_SCOPE, 'photo', null);
  const [badType, setBadType] = useState(false);
  const [dragging, setDragging] = useState(false);
  const vision = useVisionSession(imageUrl, VILLAGE_SCOPE);
  const input = useSimulationStore(selectInput);
  const result = useSimulationStore(selectActiveResult);
  const timeIndex = useSimulationStore(selectTimeIndex);
  const setTimeIndex = useSimulationStore((s) => s.setTimeIndex);
  const nameOf = useDetectionLabel();
  const {
    requestShape,
    peek: peekShape,
    retry: retryShape,
    cancelImprove,
    reset: resetShape,
    clear: clearShapes,
    ...objectShape
  } = useObjectShape(VILLAGE_SCOPE);

  // Inspector tab navigation: 'inspector' (Active Object) | 'inventory' (Installed) | 'grid' (Microgrid Twin)
  const [inspectorTab, setInspectorTab] = useKeptState<'inspector' | 'inventory' | 'grid'>(
    VILLAGE_SCOPE,
    'inspectorTab',
    'inspector'
  );
  // Selected object sub-tabs: '3d' | 'load'
  const [activeSubTab, setActiveSubTab] = useKeptState<'3d' | 'load'>(
    VILLAGE_SCOPE,
    'activeSubTab',
    '3d'
  );

  const selected = vision.selected;
  const onSelectObject = (id: string) => {
    vision.select(id);
    setInspectorTab('inspector');
  };

  // Every object (appliances and scenery), once the vision model has named a drawn shape.
  const shapeTarget = selected && !vision.identifyingIds.includes(selected.id) ? selected : null;
  const targetKey = shapeTarget ? shapeKey(shapeTarget) : null;
  const photo = useMemo(() => (imageUrl ? photoKey(imageUrl) : ''), [imageUrl]);
  const detectionOf = useMemo(
    () => new Map(vision.detections.map((d) => [applianceIdFor(photo, d.id), d.id])),
    [vision.detections, photo]
  );
  const inSimulationIds = useMemo(() => {
    const ids = new Set((input.appliances ?? []).map((a) => a.id));
    return vision.detections.filter((d) => ids.has(applianceIdFor(photo, d.id))).map((d) => d.id);
  }, [input.appliances, vision.detections, photo]);

  // New photo: object ids start again, so kept shapes no longer apply (coming back keeps them).
  const shapesForRef = useKeptRef<string | null>(VILLAGE_SCOPE, 'shapesForRef', () => null);
  useEffect(() => {
    if (shapesForRef.current === imageUrl) return;
    shapesForRef.current = imageUrl;
    clearShapes();
  }, [imageUrl, clearShapes, shapesForRef]);
  const shapeRequest = shapeTarget
    ? {
        id: shapeTarget.id,
        label: shapeTarget.label,
        category: shapeTarget.category,
        ...(shapeTarget.scenery ? { scenery: shapeTarget.scenery } : {}),
        box: shapeTarget.box,
        ...(shapeTarget.outline ? { outline: shapeTarget.outline } : {}),
        ...(shapeTarget.adjusted ? { adjusted: shapeTarget.adjusted } : {}),
      }
    : null;

  // Selecting only shows a kept model: Spark runs on « Generate the 3D model ».
  useEffect(() => {
    if (!imageUrl || !shapeRequest) {
      resetShape();
      return;
    }
    peekShape(shapeRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, targetKey, peekShape, resetShape]);

  const generateShape = (facade?: ValidatedFacade) => {
    if (imageUrl && shapeRequest) {
      void requestShape(imageUrl, {
        ...shapeRequest,
        ...(facade ? { facadeUrl: facade.url, facadeKey: facade.key } : {}),
      });
    }
  };
  const regenerateShape = () => {
    if (imageUrl && shapeRequest) void requestShape(imageUrl, shapeRequest, undefined, true);
  };

  const pickPhoto = async (file: Blob) => {
    if (!PHOTO_TYPES.includes(file.type)) {
      setBadType(true);
      return;
    }
    setBadType(false);
    const url = await readAsDataUrl(file);
    if (url) setImageUrl(url);
  };

  const loadSample = async () => {
    try {
      await pickPhoto(await (await fetch(SAMPLE_ROOM_URL)).blob());
    } catch {
      // Sample not reachable (offline build): the photo picker still works.
    }
  };

  const captureLiveOrSample = async () => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
        });
        const video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;
        await video.play();
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          stream.getTracks().forEach((track) => track.stop());
          const capturedUrl = canvas.toDataURL('image/jpeg', 0.85);
          if (capturedUrl && capturedUrl.length > 100) {
            setImageUrl(capturedUrl);
            return;
          }
        }
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // Fallback to sample photo if webcam denied, unavailable, or in test
      }
    }
    await loadSample();
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void pickPhoto(file);
  };

  const pickButton =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-all cursor-pointer';

  return (
    <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-5 px-3 sm:px-6 lg:px-8 pb-20 md:pb-6">
      {/* Studio Command Header */}
      <section className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-border/80 bg-surface-elevated/70 p-4 sm:p-5 backdrop-blur-md shadow-xs md:flex-row md:items-center">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-energy-cyan/30 bg-energy-cyan/15 text-energy-cyan shadow-xs">
            <ScanSearch className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-text-primary">
                {t('pageHeading')}
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-ai-violet/30 bg-ai-violet/10 px-2 py-0.5 text-[11px] font-medium text-ai-violet">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                {t('studioBadge')}
              </span>
            </div>
            <p className="text-xs text-text-secondary sm:text-sm">{t('pageIntro')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {imageUrl && (
            <div className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs">
              <span className="flex items-center gap-1.5 text-text-secondary">
                <span className="h-2 w-2 rounded-full bg-energy-cyan animate-pulse" />
                {t('objectsDetectedBadge', { count: vision.detections.length })}
              </span>
              <span className="text-border">|</span>
              <span className="text-battery-green font-medium">
                {inSimulationIds.length} {t('filterInSim').toLowerCase()}
              </span>
            </div>
          )}

          {(xr.status === 'supported' || xrActive || vrViewOpen) && (
            <button
              type="button"
              onClick={() => {
                if (xrActive) {
                  xr.exit();
                  setVrViewOpen(false);
                } else if (vrViewOpen) {
                  setVrViewOpen(false);
                } else {
                  setVrViewOpen(true);
                  xr.enter();
                }
              }}
              aria-pressed={xrActive || vrViewOpen}
              aria-label={xr.error ?? (xrActive || vrViewOpen ? t('vrExit') : t('vrEnter'))}
              title={xr.error ?? (xrActive || vrViewOpen ? t('vrExit') : t('vrEnter'))}
              className={cn(
                'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all cursor-pointer',
                xrActive || vrViewOpen
                  ? 'border-energy-cyan bg-energy-cyan/20 text-energy-cyan shadow-xs'
                  : 'border-border bg-surface text-text-secondary hover:text-text-primary hover:border-energy-cyan/50'
              )}
            >
              <Glasses className="h-4 w-4" aria-hidden="true" />
              <span>{xrActive || vrViewOpen ? t('vrExit') : t('vrEnter')}</span>
            </button>
          )}

          <StatusBadge variant="simulated" size="sm" label={tCommon('simulatedData')} />
        </div>
      </section>

      <input
        ref={fileRef}
        type="file"
        accept={PHOTO_TYPES.join(',')}
        className="hidden"
        aria-label={t('choosePhoto')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pickPhoto(file);
          e.target.value = '';
        }}
      />

      {xrActive || vrViewOpen ? (
        <VillageXRViewport
          detections={vision.detections}
          isScanning={vision.status === 'loading' || vision.status === 'refining'}
          onTriggerScan={() => {
            if (!imageUrl) {
              void captureLiveOrSample();
            } else {
              void vision.retry();
            }
          }}
          onSelectAppliance={onSelectObject}
          rendererRef={rendererRef}
          xrActive={xrActive}
          photoKey={photo || 'studio-sample'}
          onExitVR={() => {
            if (xrActive) xr.exit();
            setVrViewOpen(false);
          }}
        />
      ) : !imageUrl ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_440px] xl:grid-cols-[minmax(0,1fr)_480px]">
          <div className="flex flex-col gap-5">
            <section
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex flex-col items-center justify-center gap-5 rounded-3xl border-2 border-dashed p-10 sm:p-14 text-center transition-all min-h-[380px]',
                dragging
                  ? 'border-energy-cyan bg-energy-cyan/5 shadow-md ring-4 ring-energy-cyan/20'
                  : 'border-border/80 bg-surface/50 hover:bg-surface/80 hover:border-energy-cyan/50 shadow-xs'
              )}
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-energy-cyan/30 bg-energy-cyan/10 text-energy-cyan shadow-sm">
                <ImagePlus className="h-8 w-8" aria-hidden="true" />
              </div>
              <div className="max-w-md">
                <p className="text-lg font-semibold tracking-tight text-text-primary">
                  {t('dropTitle')}
                </p>
                <p className="mt-1 text-sm text-text-secondary">{t('dropHint')}</p>
              </div>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    pickButton,
                    'bg-energy-cyan text-slate-950 font-semibold hover:bg-energy-cyan/90 shadow-sm'
                  )}
                >
                  <ImagePlus className="h-4 w-4" aria-hidden="true" />
                  {t('choosePhoto')}
                </button>
                <button
                  type="button"
                  onClick={() => void loadSample()}
                  className={cn(
                    pickButton,
                    'border border-border bg-surface-elevated text-text-primary hover:bg-surface-hover shadow-xs'
                  )}
                >
                  <Sparkles className="h-4 w-4 text-solar-amber" aria-hidden="true" />
                  {t('useSample')}
                </button>
              </div>
              {badType && (
                <p role="alert" className="text-sm font-medium text-critical-red">
                  {t('badType')}
                </p>
              )}
            </section>

            {/* Studio Feature Steps Highlights */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5 rounded-2xl border border-border/80 bg-surface/60 p-4 shadow-2xs">
                <div className="flex items-center gap-2 text-energy-cyan">
                  <ScanSearch className="h-4 w-4" />
                  <span className="text-xs font-semibold">{t('featureStep1Title')}</span>
                </div>
                <p className="text-xs text-text-secondary">{t('featureStep1Desc')}</p>
              </div>
              <div className="flex flex-col gap-1.5 rounded-2xl border border-border/80 bg-surface/60 p-4 shadow-2xs">
                <div className="flex items-center gap-2 text-ai-violet">
                  <Box className="h-4 w-4" />
                  <span className="text-xs font-semibold">{t('featureStep2Title')}</span>
                </div>
                <p className="text-xs text-text-secondary">{t('featureStep2Desc')}</p>
              </div>
              <div className="flex flex-col gap-1.5 rounded-2xl border border-border/80 bg-surface/60 p-4 shadow-2xs">
                <div className="flex items-center gap-2 text-battery-green">
                  <Zap className="h-4 w-4" />
                  <span className="text-xs font-semibold">{t('featureStep3Title')}</span>
                </div>
                <p className="text-xs text-text-secondary">{t('featureStep3Desc')}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <ApplianceList
              onEdit={(id) => {
                const det = detectionOf.get(id);
                if (det) vision.select(det);
              }}
              canEdit={(id) => detectionOf.has(id)}
            />
            {/* Baseline village grid state */}
            <GridSchematicPreview
              input={input}
              result={result}
              hour={timeIndex}
              onHourChange={setTimeIndex}
              stacked
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_460px] xl:grid-cols-[minmax(0,1fr)_500px] 2xl:grid-cols-[minmax(0,1fr)_540px]">
          {/* Left Column: Vision Canvas & Object Palette */}
          <div className="min-w-0">
            <section className="rounded-2xl border border-border/80 bg-surface p-4 sm:p-5 shadow-xs">
              <DetectionCanvas
                imageUrl={imageUrl}
                status={vision.status}
                detections={vision.detections}
                selectedId={vision.selectedId}
                onSelect={onSelectObject}
                onRetry={vision.retry}
                isDemo={vision.source === 'mock'}
                onSendShapes={vision.sendShapes}
                onRemoveManual={vision.removeManual}
                manualRoom={vision.manualRoom}
                identifyingIds={vision.identifyingIds}
                identifyFailed={vision.identifyFailed}
                onAdjustBox={vision.adjustBox}
                inSimulationIds={inSimulationIds}
              />
            </section>
          </div>

          {/* Right Column: Studio Inspector Hub (Zero Infinite Scroll!) */}
          <div className="flex min-w-0 flex-col gap-4">
            <aside className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-surface p-4 sm:p-5 text-sm shadow-xs">
              {/* Top Inspector Navigation Tabs */}
              <div
                className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-canvas-sunken p-1 text-xs"
                role="tablist"
                aria-label={t('selectedTitle')}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === 'inspector'}
                  onClick={() => setInspectorTab('inspector')}
                  className={cn(
                    'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-all cursor-pointer',
                    inspectorTab === 'inspector'
                      ? 'bg-surface text-text-primary shadow-xs'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  <Zap className="h-3.5 w-3.5 shrink-0 text-energy-cyan" />
                  <span className="truncate">{t('tabInspector')}</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === 'inventory'}
                  onClick={() => setInspectorTab('inventory')}
                  className={cn(
                    'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-all cursor-pointer',
                    inspectorTab === 'inventory'
                      ? 'bg-surface text-text-primary shadow-xs'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  <Plug className="h-3.5 w-3.5 shrink-0 text-battery-green" />
                  <span className="truncate">
                    {t('tabInventory', { count: inSimulationIds.length })}
                  </span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === 'grid'}
                  onClick={() => setInspectorTab('grid')}
                  className={cn(
                    'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-all cursor-pointer',
                    inspectorTab === 'grid'
                      ? 'bg-surface text-text-primary shadow-xs'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  <Grid3X3 className="h-3.5 w-3.5 shrink-0 text-solar-amber" />
                  <span className="truncate">{t('tabGrid')}</span>
                </button>
              </div>

              {/* TAB 1: ACTIVE OBJECT INSPECTOR */}
              <div className={cn('flex flex-col gap-3', inspectorTab !== 'inspector' && 'hidden')}>
                <div className="flex items-center justify-between gap-2 border-b border-border/80 pb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    {t('selectedTitle')}
                  </h3>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className={cn(
                      pickButton,
                      'border border-border bg-surface-elevated text-text-primary hover:bg-surface-hover h-8 min-h-8 px-2.5 text-xs'
                    )}
                  >
                    <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('changePhoto')}
                  </button>
                </div>

                <div
                  aria-live="polite"
                  className="rounded-xl border border-border/80 bg-surface-elevated/50 p-3"
                >
                  <SelectedAppliance selected={vision.selected} />
                </div>

                {!shapeTarget ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-canvas-sunken/60 p-8 text-center">
                    <ScanSearch className="h-8 w-8 text-text-muted" aria-hidden="true" />
                    <p className="mt-1 text-xs text-text-muted max-w-xs">{t('quickSelectHint')}</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {/* Selected Object Sub-Tabs: 3D Twin vs Load & Placement */}
                    <div
                      className="flex gap-1 rounded-xl border border-border bg-canvas-sunken p-1 text-xs"
                      role="tablist"
                      aria-label={t('selectedTitle')}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeSubTab === '3d'}
                        onClick={() => setActiveSubTab('3d')}
                        className={cn(
                          'flex-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 font-medium transition-all cursor-pointer',
                          activeSubTab === '3d'
                            ? 'bg-surface text-text-primary shadow-xs'
                            : 'text-text-muted hover:text-text-secondary'
                        )}
                      >
                        <Box className="h-3.5 w-3.5 text-ai-violet" />
                        {t('subTab3D')}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeSubTab === 'load'}
                        onClick={() => setActiveSubTab('load')}
                        className={cn(
                          'flex-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 font-medium transition-all cursor-pointer',
                          activeSubTab === 'load'
                            ? 'bg-surface text-text-primary shadow-xs'
                            : 'text-text-muted hover:text-text-secondary'
                        )}
                      >
                        <Zap className="h-3.5 w-3.5 text-energy-cyan" />
                        {t('subTabLoad')}
                      </button>
                    </div>

                    {/* Sub-Tab 1: 3D Model Panel */}
                    <div className={cn('flex flex-col gap-3', activeSubTab !== '3d' && 'hidden')}>
                      <ObjectShapePanel
                        {...objectShape}
                        detection={shapeTarget}
                        label={nameOf(shapeTarget)}
                        imageUrl={imageUrl}
                        onRetry={retryShape}
                        onRegenerate={regenerateShape}
                        onCancelImprove={cancelImprove}
                        onGenerate={generateShape}
                        scope={VILLAGE_SCOPE}
                      />
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-energy-cyan/30 bg-energy-cyan/5 p-3 text-xs">
                        <span className="text-text-secondary">
                          {isAppliance(shapeTarget)
                            ? t(`categories.${shapeTarget.category}`)
                            : t('noLoad')}
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveSubTab('load')}
                          className="inline-flex items-center gap-1 font-semibold text-energy-cyan hover:underline cursor-pointer"
                        >
                          {t('switchToLoad')}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Sub-Tab 2: Appliance Load & Placement */}
                    <div className={cn('flex flex-col gap-3', activeSubTab !== 'load' && 'hidden')}>
                      <ApplianceInsert
                        key={applianceIdFor(photo, shapeTarget.id)}
                        detection={shapeTarget}
                        name={nameOf(shapeTarget)}
                        photo={photo}
                        recipe={
                          objectShape.shape?.mode === 'recipe' ? objectShape.shape.recipe : null
                        }
                      />
                    </div>

                    <p className="flex items-start gap-1.5 text-xs text-text-muted pt-1 border-t border-border/80">
                      <Sparkles
                        className="mt-0.5 h-3 w-3 shrink-0 text-ai-violet"
                        aria-hidden="true"
                      />
                      {t('nextStepNote')}
                    </p>
                  </div>
                )}
              </div>

              {/* TAB 2: VILLAGE INVENTORY (APPLIANCES IN SIMULATION) */}
              <div className={cn('flex flex-col gap-3', inspectorTab !== 'inventory' && 'hidden')}>
                <ApplianceList
                  onEdit={(id) => {
                    const det = detectionOf.get(id);
                    if (det) {
                      vision.select(det);
                      setInspectorTab('inspector');
                      setActiveSubTab('load');
                    }
                  }}
                  canEdit={(id) => detectionOf.has(id)}
                />
              </div>

              {/* TAB 3: MICROGRID SCHEMATIC TWIN */}
              <div className={cn('flex flex-col gap-3', inspectorTab !== 'grid' && 'hidden')}>
                <GridSchematicPreview
                  input={input}
                  result={result}
                  hour={timeIndex}
                  onHourChange={setTimeIndex}
                  stacked
                />
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
