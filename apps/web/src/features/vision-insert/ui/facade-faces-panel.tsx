'use client';

import { Check, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { FACE_NAMES, type FaceName } from '@/lib/object-shape';
import type { FaceState, FacesState } from '../hooks/use-facade-faces';

export interface FacadeFacesPanelProps {
  faces: FacesState;
  onGenerate: (face: FaceName, details?: string) => void;
  onGenerateAll: () => void;
  onDetailsChange: (face: FaceName, details: string) => void;
  onValidate: (face: FaceName, validated?: boolean) => void;
  onValidateAll: () => void;
  disabled?: boolean;
}

/**
 * The other three faces of the validated front (PQ-T68): each drawn from the front and the faces
 * already there, validated, regenerated or modified (details) one by one. Optional: a face left
 * out is drawn by the 3D pipeline itself.
 */
export function FacadeFacesPanel({
  faces,
  onGenerate,
  onGenerateAll,
  onDetailsChange,
  onValidate,
  onValidateAll,
  disabled = false,
}: FacadeFacesPanelProps) {
  const t = useTranslations('features.visionInsert');
  const busy = FACE_NAMES.some((f) => faces[f].status === 'generating');
  const allReady = FACE_NAMES.every((f) => faces[f].status === 'ready');
  const allValidated = FACE_NAMES.every((f) => faces[f].validated);

  return (
    <section
      aria-label={t('facesTitle')}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h5 className="text-xs font-semibold text-text-primary">{t('facesTitle')}</h5>
          <p className="text-[11px] text-text-muted">{t('facesHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onGenerateAll}
            disabled={disabled || busy || allReady}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-ai-violet px-3 text-xs font-semibold text-surface hover:bg-ai-violet/90 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {t('facesGenerateAll')}
          </button>
          {allReady && (
            <button
              type="button"
              onClick={onValidateAll}
              disabled={disabled || busy || allValidated}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-text-primary hover:bg-surface-elevated cursor-pointer disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t('facesValidateAll')}
            </button>
          )}
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FACE_NAMES.map((face) => (
          <FaceCard
            key={face}
            face={face}
            state={faces[face]}
            disabled={disabled || busy}
            onGenerate={onGenerate}
            onDetailsChange={onDetailsChange}
            onValidate={onValidate}
          />
        ))}
      </ul>
    </section>
  );
}

function FaceCard({
  face,
  state,
  disabled,
  onGenerate,
  onDetailsChange,
  onValidate,
}: {
  face: FaceName;
  state: FaceState;
  disabled: boolean;
  onGenerate: (face: FaceName, details?: string) => void;
  onDetailsChange: (face: FaceName, details: string) => void;
  onValidate: (face: FaceName, validated?: boolean) => void;
}) {
  const t = useTranslations('features.visionInsert');
  const name = t(`faces.${face}`);
  const inputId = `face-details-${face}`;
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-canvas-sunken p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-primary">{name}</span>
        {state.validated ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-battery-green/40 bg-battery-green/10 px-2 py-0.5 text-[10px] font-medium text-battery-green">
            <Check className="h-3 w-3" aria-hidden="true" />
            {t('facesValidated')}
          </span>
        ) : (
          <span className="text-[10px] text-text-muted">
            {state.status === 'ready' ? t('facesToCheck') : t('facesNone')}
          </span>
        )}
      </div>

      <div className="flex aspect-4/3 items-center justify-center overflow-hidden rounded-sm border border-border bg-canvas">
        {state.status === 'generating' ? (
          <span
            className="flex flex-col items-center gap-1 text-[11px] text-text-secondary"
            aria-live="polite"
          >
            <Loader2
              className="h-5 w-5 animate-spin text-ai-violet motion-reduce:animate-none"
              aria-hidden="true"
            />
            {t('facesGenerating')}
          </span>
        ) : state.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={state.imageUrl} alt={name} className="h-full w-full object-contain" />
        ) : (
          <span className="px-2 text-center text-[11px] text-text-muted">{t('facesEmpty')}</span>
        )}
      </div>

      {state.status === 'error' && (
        <p role="alert" className="text-[11px] text-status-critical">
          {t('facesError')}
        </p>
      )}

      <label htmlFor={inputId} className="sr-only">
        {t('facesDetailsLabel', { face: name })}
      </label>
      <input
        id={inputId}
        type="text"
        value={state.userPrompt}
        onChange={(e) => onDetailsChange(face, e.target.value)}
        placeholder={t('facesDetailsPlaceholder')}
        disabled={disabled}
        className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-xs text-text-primary placeholder:text-text-muted focus:border-ai-violet focus:outline-hidden disabled:opacity-50"
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onGenerate(face)}
          disabled={disabled}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs font-medium text-text-secondary hover:bg-surface-elevated hover:text-text-primary cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {state.status === 'ready' || state.status === 'error'
            ? t('facesRegenerate')
            : t('facesGenerate')}
        </button>
        {state.status === 'ready' && (
          <button
            type="button"
            onClick={() => onValidate(face, !state.validated)}
            disabled={disabled}
            aria-pressed={state.validated}
            className={cn(
              'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold cursor-pointer disabled:opacity-50',
              state.validated
                ? 'border border-border bg-surface text-text-secondary hover:bg-surface-elevated'
                : 'bg-ai-violet text-surface hover:bg-ai-violet/90'
            )}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {state.validated ? t('facesUnvalidate') : t('facesValidate')}
          </button>
        )}
      </div>
    </li>
  );
}
