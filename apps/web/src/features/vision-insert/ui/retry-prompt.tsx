'use client';

import { Check, X } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface RetryPromptProps {
  /** What failed, ending with the question (« … Try again? »). */
  message: string;
  onYes: () => void;
  onNo: () => void;
  className?: string;
}

/**
 * « Retry? Yes / No » after a failed generation (a 2D face, the main 2D view, the 3D model):
 * Yes runs it again, No goes back to what was there before. The server already retried 3 times.
 */
export function RetryPrompt({ message, onYes, onNo, className }: RetryPromptProps) {
  const t = useTranslations('features.visionInsert.retryPrompt');
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-2 rounded-md border border-status-critical/40 bg-status-critical/10 p-2',
        className
      )}
    >
      <p className="text-[11px] text-text-primary">{message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onYes}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-ai-violet px-2 text-xs font-semibold text-surface hover:bg-ai-violet/90 cursor-pointer"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {t('yes')}
        </button>
        <button
          type="button"
          onClick={onNo}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs font-medium text-text-secondary hover:bg-surface-elevated hover:text-text-primary cursor-pointer"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {t('no')}
        </button>
      </div>
    </div>
  );
}

export interface CancelButtonProps {
  onCancel: () => void;
  className?: string;
}

/** « Cancel » under a generation in progress (2D face, main 2D view). */
export function CancelGenerationButton({ onCancel, className }: CancelButtonProps) {
  const t = useTranslations('features.visionInsert.retryPrompt');
  return (
    <button
      type="button"
      onClick={onCancel}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-text-secondary hover:bg-surface-elevated hover:text-text-primary cursor-pointer',
        className
      )}
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
      {t('cancel')}
    </button>
  );
}
