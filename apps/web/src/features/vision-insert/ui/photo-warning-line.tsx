import { ImageOff } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import type { PhotoConditions } from '@/lib/object-shape';
import { photoWarning } from '@/lib/photo-warning';

/**
 * Hint when the photo is too small or too blurred for the parts to be read (PQ-T7). Measured by the
 * server (`ObjectShape.conditions`), never by the model.
 */
export function PhotoWarningLine({ conditions }: { conditions: PhotoConditions | undefined }) {
  const t = useTranslations('features.visionInsert');
  const kind = photoWarning(conditions);
  if (!kind) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-text-secondary">
      <ImageOff className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{t(kind === 'small' ? 'photoTooSmall' : 'photoBlurred')}</span>
    </p>
  );
}
