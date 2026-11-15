'use client';

import { useState, type ReactNode } from 'react';
import { Check, Image as ImageIcon, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FacadeData } from '../hooks/use-facade-2d';

export interface Facade2dPanelProps {
  status: 'idle' | 'generating' | 'ready' | 'deleting' | 'error';
  facade?: FacadeData;
  userPrompt: string;
  onUserPromptChange: (prompt: string) => void;
  onGenerate: () => void;
  onRetry: (prompt: string) => void;
  onDelete: () => void;
  onValidate: () => void;
  isValidating3D?: boolean;
  /** Gear opening the per-step model modal, beside « Validate & Generate 3D ». */
  modelsGear?: ReactNode;
  /** The other faces (right, back, left) to draw and validate under the front (PQ-T68). */
  faces?: ReactNode;
  /** A vehicle (PQ-T76): its main 2D view is its profile, the copy says so. */
  vehicle?: boolean;
}

export function Facade2dPanel({
  status,
  facade,
  userPrompt,
  onUserPromptChange,
  onGenerate,
  onRetry,
  onDelete,
  onValidate,
  isValidating3D = false,
  modelsGear,
  faces,
  vehicle = false,
}: Facade2dPanelProps) {
  const t = useTranslations('features.visionInsert');
  /** The copy of the main 2D view: a vehicle's is its profile. */
  const v = (
    key: 'facade2dTitle' | 'facade2dSubtitle' | 'facade2dGenerate' | 'facade2dGenerating'
  ) => t(vehicle ? `${key}Vehicle` : key);
  const [localPrompt, setLocalPrompt] = useState(userPrompt);

  const handlePromptChange = (val: string) => {
    setLocalPrompt(val);
    onUserPromptChange(val);
  };

  return (
    <div className="flex flex-col gap-3 rounded-control border border-border bg-canvas-sunken p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-ai-violet" aria-hidden="true" />
          <h4 className="text-xs font-semibold text-text-primary">{v('facade2dTitle')}</h4>
        </div>
        <span className="rounded-full border border-ai-violet/30 bg-ai-violet/10 px-2 py-0.5 text-[10px] font-medium text-ai-violet">
          {v('facade2dSubtitle')}
        </span>
      </div>

      {status === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-xs text-text-secondary">{t('facade2dRequiredHint')}</p>
          <button
            type="button"
            onClick={onGenerate}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ai-violet px-4 text-xs font-semibold text-surface shadow-xs hover:bg-ai-violet/90 cursor-pointer transition-colors"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {v('facade2dGenerate')}
          </button>
        </div>
      )}

      {status === 'generating' && (
        <div
          className="flex flex-col items-center justify-center gap-2 py-8 text-center"
          aria-live="polite"
        >
          <Loader2
            className="h-6 w-6 animate-spin text-ai-violet motion-reduce:animate-none"
            aria-hidden="true"
          />
          <p className="text-xs font-medium text-text-secondary">{v('facade2dGenerating')}</p>
        </div>
      )}

      {status === 'deleting' && (
        <div
          className="flex flex-col items-center justify-center gap-2 py-8 text-center"
          aria-live="polite"
        >
          <Loader2
            className="h-6 w-6 animate-spin text-status-warning motion-reduce:animate-none"
            aria-hidden="true"
          />
          <p className="text-xs font-medium text-text-secondary">{t('facade2dDeleting')}</p>
        </div>
      )}

      {status === 'ready' && facade && (
        <div className="flex flex-col gap-3">
          {/* Image preview with consultation link */}
          <div className="relative overflow-hidden rounded-md border border-border bg-surface shadow-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={facade.imageUrl}
              alt={v('facade2dTitle')}
              className="max-h-72 w-full object-contain bg-canvas"
            />
            <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-canvas-sunken/80 px-1.5 py-0.5 text-[10px] text-text-muted backdrop-blur-xs">
              <span className="capitalize">{facade.archetype}</span>
              <span>•</span>
              <span className="uppercase">{facade.source}</span>
            </div>
          </div>

          {/* User additional prompt input */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="facade-prompt-input"
              className="text-xs font-medium text-text-secondary"
            >
              {t('facade2dPromptLabel')}
            </label>
            <input
              id="facade-prompt-input"
              type="text"
              value={localPrompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              placeholder={t('facade2dPromptPlaceholder')}
              className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-ai-violet focus:outline-hidden"
            />
          </div>

          {faces}

          {/* Action buttons: Retry, Delete, Validate */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onRetry(localPrompt)}
              disabled={isValidating3D}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-text-secondary hover:bg-surface-elevated hover:text-text-primary cursor-pointer disabled:opacity-50 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('facade2dRetry')}</span>
            </button>

            <button
              type="button"
              onClick={onDelete}
              disabled={isValidating3D}
              aria-label={t('facade2dDelete')}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-text-muted hover:border-status-critical/40 hover:text-status-critical cursor-pointer disabled:opacity-50 transition-colors"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only md:not-sr-only md:ml-1">{t('facade2dDelete')}</span>
            </button>

            {modelsGear}

            <button
              type="button"
              onClick={onValidate}
              disabled={isValidating3D}
              className={cn(
                'inline-flex min-h-11 flex-2 items-center justify-center gap-1.5 rounded-md bg-ai-violet px-4 text-xs font-semibold text-surface shadow-xs hover:bg-ai-violet/90 cursor-pointer disabled:opacity-50 transition-colors'
              )}
            >
              {isValidating3D ? (
                <>
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <span>{t('model3dLoading')}</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>{t('facade2dValidate')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-xs text-status-critical">{t('identifyError')}</p>
          <button
            type="button"
            onClick={onGenerate}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-surface px-3 text-xs font-medium text-text-primary border border-border hover:bg-surface-elevated cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('facade2dRetry')}
          </button>
        </div>
      )}
    </div>
  );
}
