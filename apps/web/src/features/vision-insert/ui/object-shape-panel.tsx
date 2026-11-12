'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Box,
  Check,
  Circle,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Loader2,
  Move3d,
  RotateCcw,
  Ruler,
  Sparkles,
  Target,
} from 'lucide-react';
import { useWebGLAvailable } from '@/features/microgrid-3d';
import { fmtPct } from '@/lib/format';
import { useTranslations } from '@/lib/i18n';
import {
  SHAPE_STEPS,
  type DimStatus,
  type ObjectRecipe,
  type ObjectShape,
  type ShapeStep,
} from '@/lib/object-shape';
import type { ApplianceDetection } from '@/lib/vision';
import { CleanFrontOffer } from './clean-front-offer';
import { FamilyQuestion } from './family-question';
import { PartCoverageLine } from './part-coverage-line';
import { PhotoWarningLine } from './photo-warning-line';
import { cn } from '@/lib/utils';
import { useElapsedSeconds } from '../hooks/use-elapsed-seconds';
import type { ObjectShapeState } from '../hooks/use-object-shape';
import { recipeMaterials } from '../utils/surface-look';
import { ImproveChip } from './improve-chip';
import { ObjectDisplayControls } from './object-display-controls';
import { Facade2dPanel } from './facade-2d-panel';
import { useFacade2d, validatedFacade, type ValidatedFacade } from '../hooks/use-facade-2d';

/** Placeholder while the viewer chunk loads or Spark builds the recipe. */
function ViewerSkeleton() {
  return <div className="h-full w-full animate-pulse rounded-control bg-surface-hover/60" />;
}

export const LazyObjectEditor3d = dynamic(
  () => import('./object-editor-3d').then((m) => m.ObjectEditor3d),
  { ssr: false, loading: () => <ViewerSkeleton /> }
);

/** Note under an outline fallback: says why the AI shape is missing. */
const NOTE_KEY: Record<NonNullable<ObjectShape['reason']>, string> = {
  timeout: 'model3dTimeoutNote',
  provider_error: 'model3dOfflineNote',
  spend_cap: 'model3dSpendNote',
  network: 'model3dNetworkNote',
  malformed: 'model3dOutlineNote',
  no_body: 'model3dOutlineNote',
};

/** `http_429` → `HTTP 429`; other causes as sent. */
const causeText = (detail: string) => detail.replace(/^http_/, 'HTTP ');

const DIM_ORDER = ['eave', 'depth', 'yaw', 'scale'] as const;
const DIM_STATUS_ORDER: ReadonlyArray<DimStatus> = ['measured', 'estimated', 'inferred', 'unknown'];

/**
 * « Dimensions : mesuré — toiture · estimé — profondeur… » + hidden-parts note (PR-2.15):
 * which key dims the photo measured, estimated or inferred. Unknown dims show in dev only;
 * parts hidden under the photo (inferred) always earn their note.
 */
function DimStatusLine({ recipe }: { recipe: ObjectRecipe }) {
  const t = useTranslations('features.visionInsert');
  const dims = recipe.dimStatus;
  if (!dims) return null;
  const showUnknown = process.env.NODE_ENV === 'development';
  const groups = DIM_STATUS_ORDER.map((status) => ({
    status,
    dims: DIM_ORDER.filter((d) => dims[d] === status && (status !== 'unknown' || showUnknown)),
  })).filter((g) => g.dims.length > 0);
  const partGroups = DIM_STATUS_ORDER.map((status) => ({
    status,
    count: recipe.parts.filter((p) => p.status === status).length,
  })).filter((g) => g.count > 0 && (g.status !== 'unknown' || showUnknown));
  const hidden = recipe.parts.some((p) => p.status === 'inferred');
  if (groups.length === 0 && partGroups.length === 0 && !hidden) return null;
  return (
    <>
      {groups.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-text-secondary">
          <Ruler className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {t('model3dDims', {
            list: groups
              .map(
                (g) =>
                  `${t(`model3dDimStatus.${g.status}`)} — ${g.dims.map((d) => t(`model3dDim.${d}`)).join(', ')}`
              )
              .join(' · '),
          })}
        </p>
      )}
      {partGroups.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-text-secondary">
          <Box className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {t('model3dParts', {
            list: partGroups
              .map((g) => `${t(`model3dDimStatus.${g.status}`)} : ${g.count}`)
              .join(' · '),
          })}
        </p>
      )}
      {hidden && (
        <p className="flex items-start gap-1.5 text-xs text-text-muted">
          <EyeOff className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {t('model3dHiddenNote')}
        </p>
      )}
    </>
  );
}

/**
 * Live list of the server steps (crop → Spark → fit), current one spinning with its seconds; the
 * AI check (views path only) joins the list when it starts.
 */
function ShapeSteps({ step, seconds }: { step: ShapeStep; seconds: number }) {
  const t = useTranslations('features.visionInsert');
  const steps = SHAPE_STEPS.filter((s) => s !== 'check' || step === 'check');
  const current = steps.indexOf(step);
  return (
    <div className="flex flex-col gap-1.5 rounded-control border border-ai-violet/30 bg-ai-violet/5 p-3">
      <ol aria-label={t('model3dStepsLabel')} className="flex flex-col gap-1.5 text-xs">
        {steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'todo';
          return (
            <li
              key={s}
              aria-current={state === 'active' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2',
                state === 'todo' ? 'text-text-muted' : 'text-text-primary',
                state === 'active' && 'font-medium'
              )}
            >
              {state === 'done' ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-battery-green" aria-hidden="true" />
              ) : state === 'active' ? (
                <Loader2
                  className="h-3.5 w-3.5 shrink-0 animate-spin text-ai-violet motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">{t(`model3dStep.${s}`)}</span>
              {state === 'active' && (
                <span className="shrink-0 font-mono text-text-secondary">
                  {t('model3dSeconds', { s: seconds })}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {step === 'model' && <p className="text-[11px] text-text-muted">{t('model3dWaitHint')}</p>}
    </div>
  );
}

export interface ObjectShapePanelProps extends ObjectShapeState {
  detection: ApplianceDetection;
  /** Name shown to the operator (page language). */
  label: string;
  imageUrl: string;
  /** Ask Spark again (outline fallback only). */
  onRetry?: () => void;
  /** « Regenerate the 3D model »: re-run Spark for an existing 3D model, skipping cache. */
  onRegenerate?: () => void;
  /** The operator picked a family when the model doubted it (PQ-T41): rebuilds with it as the hint. */
  onChooseFamily?: (archetype: string) => void;
  /** « Cancel » on the improvement chip: stops the background stages. */
  onCancelImprove?: () => void;
  /** « Generate the 3D model »: nothing is asked to Spark before (selecting only shows a kept model). */
  /** `facade` = the validated 2D elevation, used as a reference image by the 3D call. */
  onGenerate?: (facade?: ValidatedFacade) => void;
  sessionId?: string;
  /** Keeps the 2D facade across page visits (see `useKeptState`). */
  scope?: string;
}

type ShapeTab = 'model' | 'facade';

/**
 * « 3D model » block of the selected appliance (PV-T10): first the AI imagines the 2D elevation
 * with Meta Muse (validated with « Validate & Generate 3D »), then Spark builds the recipe
 * (« AI shape », violet = AI output) or the outline fallback (« Outline shape » + note), on a studio
 * backdrop that stays lighter than dark objects in both themes. No WebGL → a note.
 */
export function ObjectShapePanel({
  status,
  shape,
  step,
  startedAt,
  preview,
  improve,
  detection,
  label,
  imageUrl,
  onRetry,
  onRegenerate,
  onChooseFamily,
  onCancelImprove,
  onGenerate,
  sessionId,
  scope,
}: ObjectShapePanelProps) {
  const t = useTranslations('features.visionInsert');
  const webgl = useWebGLAvailable();
  const facade = useFacade2d(imageUrl ?? null, detection, sessionId, scope);
  const ready = status === 'ready' && shape?.detectionId === detection.id;
  const materials = ready && shape?.recipe ? recipeMaterials(shape.recipe) : [];
  const loading = status === 'loading';
  // Live print: while loading, the viewer paints the streamed preview (or the free local
  // silhouette) instead of a skeleton, so the model builds up like a 3D print.
  const liveViewer =
    ready || (loading && (preview !== undefined || detection.outline !== undefined));
  const seconds = useElapsedSeconds(startedAt, status === 'loading');
  const showTabs = ready && Boolean(facade.facade);
  // Tab choice is per object: a new detection restarts on the model tab.
  const [tabState, setTabState] = useState({ id: detection.id, tab: 'model' as ShapeTab });
  const setTab = (tab: ShapeTab) => setTabState({ id: detection.id, tab });
  const userTab = tabState.id === detection.id ? tabState.tab : 'model';
  // Display tweaks are per object too (PV-T11b, visual only, never stored).
  const [display, setDisplayState] = useState({
    id: detection.id,
    scale: 1,
    tint: null as string | null,
  });
  const shown = display.id === detection.id ? display : { id: detection.id, scale: 1, tint: null };
  const setDisplay = (patch: Partial<{ scale: number; tint: string | null }>) =>
    setDisplayState({ id: detection.id, scale: shown.scale, tint: shown.tint, ...patch });
  const activeTab: ShapeTab = ready ? userTab : 'model';

  return (
    <section className="flex flex-col gap-2" aria-labelledby="object-3d-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="object-3d-title" className="text-xs font-semibold text-text-secondary">
          {t('model3dTitle')}
        </h4>
        <div aria-live="polite">
          {!ready && !loading ? (
            <span className="text-xs text-text-muted">{t('model3dNotBuilt')}</span>
          ) : !ready ? (
            <span className="inline-flex items-center gap-1 text-xs text-text-muted">
              <Loader2
                className="h-3 w-3 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              {t('model3dLoading')}
            </span>
          ) : shape.mode === 'recipe' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-ai-violet/40 bg-ai-violet/10 px-2 py-0.5 text-xs text-ai-violet">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {t('model3dAi')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
              <Box className="h-3 w-3" aria-hidden="true" />
              {t('model3dOutline')}
            </span>
          )}
        </div>
      </div>

      {showTabs && webgl && (
        <div
          className="flex gap-1 rounded-control border border-border bg-canvas-sunken p-1"
          role="tablist"
          aria-label={t('model3dTitle')}
        >
          {[
            { id: 'model' as const, label: t('model3dModelTab'), Icon: Box },
            { id: 'facade' as const, label: t('facade2dTab'), Icon: ImageIcon },
          ].map(({ id, label: tabLabel, Icon }) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(id)}
                className={cn(
                  'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium cursor-pointer transition-colors',
                  selected
                    ? 'bg-surface text-text-primary shadow-xs'
                    : 'text-text-muted hover:text-text-primary'
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{tabLabel}</span>
              </button>
            );
          })}
        </div>
      )}

      {!webgl ? (
        <p className="rounded-control border border-border bg-canvas-sunken p-3 text-xs text-text-muted">
          {t('model3dNoWebgl')}
        </p>
      ) : (
        <>
          {loading && step && <ShapeSteps step={step} seconds={seconds} />}
          {activeTab === 'facade' || (!ready && !loading) ? (
            <Facade2dPanel
              status={facade.status}
              facade={facade.facade}
              userPrompt={facade.userPrompt}
              onUserPromptChange={facade.setUserPrompt}
              onGenerate={() => facade.generate()}
              onRetry={(prompt) => facade.retry(prompt)}
              onDelete={() => facade.deleteFacade()}
              onValidate={() => {
                facade.validate();
                setTab('model');
                onGenerate?.(validatedFacade(facade.facade));
              }}
              isValidating3D={loading}
            />
          ) : (
            <div className="relative">
              <div
                role="img"
                aria-label={t('model3dCanvas', { label })}
                className="viewer-studio h-60 w-full overflow-hidden rounded-control border border-border sm:h-72"
              >
                {liveViewer ? (
                  <LazyObjectEditor3d
                    {...(ready && shape ? { shape } : {})}
                    {...(!ready && preview ? { preview } : {})}
                    detection={detection}
                    imageUrl={imageUrl}
                    scale={shown.scale}
                    tint={shown.tint}
                    {...(improve ? { improve } : {})}
                  />
                ) : (
                  <ViewerSkeleton />
                )}
              </div>
              {/* Staged build (PG-T18): live progress while it prints, then it keeps improving.
                  No Cancel while loading: it would abort the whole generation, not just the rest. */}
              {(ready || loading) && improve && (
                <ImproveChip
                  improve={improve}
                  {...(ready && onCancelImprove ? { onCancel: onCancelImprove } : {})}
                />
              )}
            </div>
          )}
        </>
      )}

      {ready && activeTab === 'model' && (
        <>
          {webgl && (
            <ObjectDisplayControls
              scale={shown.scale}
              tint={shown.tint}
              onScale={(scale) => setDisplay({ scale })}
              onTint={(tint) => setDisplay({ tint })}
              onReset={() => setDisplay({ scale: 1, tint: null })}
            />
          )}

          {shape.mode === 'silhouette' && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-xs text-text-muted">
                {t(NOTE_KEY[shape.reason ?? 'malformed'])}
                {shape.detail && (
                  <span className="block font-mono text-[11px] text-text-secondary">
                    {t('model3dCause', { cause: causeText(shape.detail) })}
                  </span>
                )}
              </p>
              {(onRetry ?? onRegenerate) && (
                <button
                  type="button"
                  onClick={onRetry ?? onRegenerate}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 text-xs font-medium text-text-primary hover:bg-surface-hover cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('model3dRetry')}
                </button>
              )}
            </div>
          )}
          {shape.mode === 'recipe' && (onRegenerate ?? onRetry) && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onRegenerate ?? onRetry}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 text-xs font-medium text-text-primary hover:bg-surface-hover cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {t('model3dRegenerate')}
              </button>
            </div>
          )}
          {shape?.fit && (
            <p className="flex items-center gap-1.5 text-xs text-text-secondary">
              <Target className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t('model3dFit', { pct: fmtPct(shape.fit.iou * 100, 0) })}
            </p>
          )}
          {materials.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-ai-violet">
              <Layers className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {t('model3dMaterials', {
                list: materials.map((m) => t(`model3dMaterial.${m}`)).join(' · '),
              })}
            </p>
          )}
          {shape.mode === 'recipe' && shape.recipe && <DimStatusLine recipe={shape.recipe} />}
          {shape.mode === 'recipe' && shape.coverage && (
            <PartCoverageLine coverage={shape.coverage} />
          )}
          {shape.mode === 'recipe' && <PhotoWarningLine conditions={shape.conditions} />}
          {shape.mode === 'recipe' && shape.ask && onChooseFamily && (
            <FamilyQuestion archetypes={shape.ask.archetypes} onChoose={onChooseFamily} />
          )}
          {shape.mode === 'recipe' && (
            <CleanFrontOffer
              hidden={shape.conditions?.hidden}
              busy={facade.status === 'generating'}
              onDraw={() => {
                const evidence = shape.kit?.evidence;
                facade.generate(undefined, {
                  hiddenBy: evidence?.hiddenBy ?? [],
                  visibleParts: evidence?.visibleParts ?? [],
                });
                setTab('facade');
              }}
            />
          )}
          {webgl && (
            <p className="flex items-center gap-1.5 text-xs text-text-muted">
              <Move3d className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t('model3dHint')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
