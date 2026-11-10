import { Fragment } from 'react';
import { ListChecks, TriangleAlert } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import type { PartCoverage } from '@/lib/object-shape';

/**
 * « Parts seen on the photo: Wheels 2/2 · Windows 1/3 (not built: 2) » (PQ-T37): per SAM part kind, the
 * parts the photo shows and the ones the model builds. Computed by the server, never by the model.
 * Missing parts carry a warning icon; their text stays in the body colour (AA in both themes).
 * One text block after the icon, so a wrapped line lines up with the text like the other lines.
 */
export function PartCoverageLine({ coverage }: { coverage: ReadonlyArray<PartCoverage> }) {
  const t = useTranslations('features.visionInsert');
  if (coverage.length === 0) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-text-secondary">
      <ListChecks className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        <span>{t('model3dCoverage')}</span>{' '}
        {coverage.map((c, i) => {
          const missing = c.seen - c.built;
          return (
            <Fragment key={c.concept}>
              {i > 0 && ' · '}
              <span className="whitespace-nowrap">
                {t('model3dCoverageItem', {
                  name: t(`model3dPart.${c.concept}`),
                  built: c.built,
                  seen: c.seen,
                })}
                {missing > 0 && (
                  <span className="font-medium text-text-primary">
                    {' '}
                    <TriangleAlert
                      className="inline h-3 w-3 -translate-y-px text-warning-amber"
                      aria-hidden="true"
                    />{' '}
                    {t('model3dCoverageMissing', { count: missing })}
                  </span>
                )}
              </span>
            </Fragment>
          );
        })}
      </span>
    </p>
  );
}
