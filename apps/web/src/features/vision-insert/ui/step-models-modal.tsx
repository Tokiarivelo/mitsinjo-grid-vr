'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Settings, X } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { STEP_MODEL_STEPS, type StepModelsSelection } from '@/lib/step-models';
import type { StepModelsData } from '../hooks/use-step-models';

export interface StepModelsModalProps {
  /** Null while loading; the rows render once the defaults arrive. */
  data: StepModelsData | null;
  loadError: boolean;
  saving: boolean;
  saveError: boolean;
  onClose: () => void;
  onSave: (selection: StepModelsSelection) => void;
}

/** One step row: label + model select (`Default (…)` = the server setting). */
function StepRow({
  step,
  label,
  models,
  defaultModel,
  value,
  onChange,
}: {
  step: string;
  label: string;
  models: readonly string[];
  defaultModel: string;
  value: string;
  onChange: (step: string, model: string) => void;
}) {
  const t = useTranslations('features.visionInsert');
  const id = `step-model-${step}`;
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <label htmlFor={id} className="text-xs font-medium text-text-secondary sm:w-44 sm:shrink-0">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(step, e.target.value)}
        className="min-h-11 w-full min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-surface px-3 font-mono text-xs text-text-primary focus:border-ai-violet focus:outline-hidden"
      >
        <option value="">{t('stepModels.defaultOption', { model: defaultModel })}</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * « 3D step models » modal (PQ-T67): one model per 3D step, opened from the gear next to
 * « Validate & Generate 3D » / « Regenerate ». Same shell as `VisionDialog` (portal: a glass
 * panel would trap a fixed overlay).
 */
export function StepModelsModal({
  data,
  loadError,
  saving,
  saveError,
  onClose,
  onSave,
}: StepModelsModalProps) {
  const t = useTranslations('features.visionInsert');
  const [synced, setSynced] = useState<StepModelsData | null>(null);
  const [draft, setDraft] = useState<StepModelsSelection>({});
  // The draft follows the stored selection whenever it arrives (open, reload).
  if (data !== synced) {
    setSynced(data);
    setDraft(data?.selection ?? {});
  }
  const ready = synced !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const change = (step: string, model: string) =>
    setDraft((d) => {
      const next = { ...d };
      if (model)
        next[step as keyof StepModelsSelection] =
          model as StepModelsSelection[keyof StepModelsSelection];
      else delete next[step as keyof StepModelsSelection];
      return next;
    });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-models-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="flex max-h-[96vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-elevated px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="rounded-lg bg-ai-violet/15 p-1.5 text-ai-violet">
              <Settings className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 id="step-models-title" className="text-sm font-semibold text-text-primary">
                {t('stepModels.title')}
              </h3>
              <p className="text-[11px] text-text-secondary">{t('stepModels.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface hover:text-text-primary cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto p-4 [-webkit-overflow-scrolling:touch]">
          {!ready || !data ? (
            <p
              className="flex items-center gap-2 py-6 text-xs text-text-secondary"
              aria-live="polite"
            >
              {loadError ? (
                t('stepModels.loadError')
              ) : (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  {t('model3dLoading')}
                </>
              )}
            </p>
          ) : (
            STEP_MODEL_STEPS.map((s) => (
              <StepRow
                key={s}
                step={s}
                label={t(`stepModels.steps.${s}`)}
                models={data.models}
                defaultModel={data.defaults[s]}
                value={draft[s] ?? ''}
                onChange={change}
              />
            ))
          )}
          {saveError && (
            <p role="alert" className="text-xs text-status-critical">
              {t('stepModels.saveError')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-elevated px-4 py-3">
          <button
            type="button"
            onClick={() => setDraft({})}
            disabled={!ready || saving}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-xs font-medium text-text-secondary hover:text-text-primary cursor-pointer disabled:opacity-50"
          >
            {t('stepModels.reset')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-4 text-xs font-medium text-text-primary hover:bg-surface-elevated cursor-pointer"
            >
              {t('stepModels.cancel')}
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              disabled={!ready || saving}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-ai-violet px-4 text-xs font-semibold text-surface shadow-xs hover:bg-ai-violet/90 cursor-pointer disabled:opacity-50"
            >
              {saving && (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {t(saving ? 'stepModels.saving' : 'stepModels.save')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
