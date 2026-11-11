import { Fragment } from 'react';
import { ListChecks, TriangleAlert } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { partLabelKey, type PartCoverage } from '@/lib/object-shape';
import en from '@/messages/en.json';

/**
 * Part concepts with a `model3dPart` label (same keys in every locale): the server's `PART_CONCEPTS` and the
 * SAM words of the Muse cards. Any other word the kit lists is counted under « Other parts ».
 */
const LABELLED: ReadonlySet<string> = new Set(Object.keys(en.features.visionInsert.model3dPart));

/**
 * « Parts seen on the photo: Wheels 2/2 · Windows 1/3 (not built: 2) » (PQ-T37): per SAM part kind, the
 * parts the photo shows and the ones the model builds. Computed by the server, never by the model.
 * Missing parts carry a warning icon; their text stays in the body colour (AA in both themes).
 * One text block after the icon, so a wrapped line lines up with the text like the other lines.
 */
export function PartCoverageLine({ coverage }: { coverage: ReadonlyArray<PartCoverage> }) {
  const t = useTranslations('features.visionInsert');
  // A concept without a label (a free word of the kit) is never shown as a raw key: it is counted under
  // « Other parts », so every part seen is on the line, built or not.
  const labelled = coverage.filter((c) => LABELLED.has(partLabelKey(c.concept)));
  const rest = coverage.filter((c) => !LABELLED.has(partLabelKey(c.concept)));
  const named = [
    ...labelled.map((c) => ({
      key: c.concept,
      name: t(`model3dPart.${partLabelKey(c.concept)}`),
      seen: c.seen,
      built: c.built,
    })),
    ...(rest.length
      ? [
          {
            key: 'other',
            name: t('model3dPartOther'),
            seen: rest.reduce((n, c) => n + c.seen, 0),
            built: rest.reduce((n, c) => n + c.built, 0),
          },
        ]
      : []),
  ];
  if (named.length === 0) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-text-secondary">
      <ListChecks className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        <span>{t('model3dCoverage')}</span>{' '}
        {named.map((c, i) => {
          const missing = c.seen - c.built;
          return (
            <Fragment key={c.key}>
              {i > 0 && ' · '}
              <span className="whitespace-nowrap">
                {t('model3dCoverageItem', {
                  name: c.name,
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
