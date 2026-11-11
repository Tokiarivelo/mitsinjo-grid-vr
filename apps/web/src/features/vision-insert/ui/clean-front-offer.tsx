import { PencilRuler } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { CLEAN_FRONT_MIN_HIDDEN } from '@/lib/object-shape';

/**
 * « Draw a clean front » (PQ-T23): offered when 30 % or more of the object is hidden (measured, PQ-T7). The
 * operator asks Muse Image for a front view with nothing in front, validates it like a facade, and the 3D model
 * is rebuilt from it with the added parts marked as inferred. One 44 px action, full width on a phone.
 */
export function CleanFrontOffer({
  hidden,
  busy = false,
  onDraw,
}: {
  /** Hidden share of the object, 0–1 (`ObjectShape.conditions.hidden`). */
  hidden: number | undefined;
  busy?: boolean;
  onDraw: () => void;
}) {
  const t = useTranslations('features.visionInsert');
  if (hidden === undefined || hidden < CLEAN_FRONT_MIN_HIDDEN) return null;
  return (
    <div
      role="group"
      aria-label={t('cleanFrontTitle')}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface-elevated p-3"
    >
      <p className="flex items-start gap-1.5 text-xs text-text-secondary">
        <PencilRuler className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{t('cleanFrontHint', { pct: Math.round(hidden * 100) })}</span>
      </p>
      <button
        type="button"
        onClick={onDraw}
        disabled={busy}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-ai-violet/40 bg-ai-violet/10 px-3 text-xs font-medium text-ai-violet hover:bg-ai-violet/20 cursor-pointer disabled:opacity-50"
      >
        {t('cleanFrontDraw')}
      </button>
    </div>
  );
}
