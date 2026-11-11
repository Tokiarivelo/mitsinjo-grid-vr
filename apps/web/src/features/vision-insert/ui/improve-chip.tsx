'use client';

import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Loader2, X } from 'lucide-react';
import { fmtPct } from '@/lib/format';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ShapeImprove } from '../hooks/use-object-shape';

/** A final state stays on screen this long, then the chip fades out. */
export const IMPROVE_FADE_MS = 4_000;

/** Share of the loop done (0–1): stages ended over the total. */
export function improveProgress(i: ShapeImprove): number {
  if (i.status !== 'running') return 1;
  const ended = i.after !== undefined ? i.index : i.index - 1;
  return Math.min(1, Math.max(0, ended / i.total));
}

/**
 * Which score line an ended stage shows: unchanged at its gate = already matched the drawing,
 * unchanged otherwise = Spark found nothing better, else before → after.
 */
export function scoreKey(i: ShapeImprove): 'score' | 'alreadyMatches' | 'noGain' {
  if (i.before === undefined || i.after === undefined) return 'score';
  if (Math.round(i.after * 100) !== Math.round(i.before * 100)) return 'score';
  if (i.stop === 'gate') return 'alreadyMatches';
  return i.stop === 'no_gain' ||
    i.stop === 'rounds' ||
    i.stop === 'repeat' ||
    i.stop === 'back_and_forth'
    ? 'noGain'
    : 'score';
}

/**
 * Improvement indicator (PG-T18) over the 3D viewer: « Improving: stage 2/4 — Roof » with a
 * spinner, a progress bar and the stage score before → after while the background stages run,
 * then « Model finalised » or « Improvement stopped: <cause> », which fades out. Announced to
 * screen readers (`aria-live="polite"`). AI output → violet. `onCancel` adds a « Cancel » button
 * while it runs (the stages have no time limit).
 */
export function ImproveChip({
  improve,
  onCancel,
}: {
  improve?: ShapeImprove;
  onCancel?: () => void;
}) {
  const t = useTranslations('features.visionInsert.model3dImprove');
  const final = improve && improve.status !== 'running';
  // Hidden once a final state has been shown for `IMPROVE_FADE_MS` (keyed by that state).
  const finalKey = final ? `${improve.status}:${improve.cause ?? ''}:${improve.index}` : null;
  const [faded, setFaded] = useState<string | null>(null);
  useEffect(() => {
    if (!finalKey) return;
    const id = setTimeout(() => setFaded(finalKey), IMPROVE_FADE_MS);
    return () => clearTimeout(id);
  }, [finalKey]);
  const hidden = !improve || (finalKey !== null && faded === finalKey);
  const pct = improve ? Math.round(improveProgress(improve) * 100) : 0;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-2 bottom-2 flex justify-start"
    >
      {!hidden && improve && (
        <div
          className={cn(
            'flex w-full max-w-xs flex-col gap-1.5 rounded-control border px-3 py-2 text-xs shadow-sm backdrop-blur-sm transition-opacity motion-reduce:transition-none',
            improve.status === 'stopped'
              ? 'border-solar-amber/40 bg-surface/90 text-text-primary'
              : 'border-ai-violet/40 bg-surface/90 text-text-primary'
          )}
        >
          <p className="flex items-center gap-1.5 font-medium">
            {improve.status === 'running' ? (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin text-ai-violet motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : improve.status === 'done' ? (
              <CircleCheck className="h-3.5 w-3.5 shrink-0 text-battery-green" aria-hidden="true" />
            ) : (
              <CircleAlert className="h-3.5 w-3.5 shrink-0 text-solar-amber" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {improve.status === 'running'
                ? t('running', {
                    index: improve.index,
                    total: improve.total,
                    stage: t(`stage.${improve.stage}`),
                  })
                : improve.status === 'done'
                  ? t('done')
                  : t('stopped', { cause: t(`cause.${improve.cause ?? 'error'}`) })}
            </span>
            {improve.status === 'running' && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label={t('cancelLabel')}
                className="pointer-events-auto -my-2 -mr-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-control px-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-ai-violet"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                {t('cancel')}
              </button>
            )}
          </p>
          {improve.status === 'running' && (
            <div
              role="progressbar"
              aria-label={t('label')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-1 w-full overflow-hidden rounded-full bg-ai-violet/15"
            >
              <div
                className="h-full rounded-full bg-ai-violet transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {improve.before !== undefined && improve.after !== undefined && (
            <p className="font-mono text-[11px] text-text-secondary">
              {t(scoreKey(improve), {
                before: fmtPct(improve.before * 100, 0),
                after: fmtPct(improve.after * 100, 0),
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
