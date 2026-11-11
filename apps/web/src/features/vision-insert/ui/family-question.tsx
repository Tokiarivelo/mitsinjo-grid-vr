import { CircleHelp } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import en from '@/messages/en.json';

/** Families with a `model3dFamily` name (every locale carries the same keys). */
const NAMED: ReadonlySet<string> = new Set(Object.keys(en.features.visionInsert.model3dFamily));

/**
 * « Not sure what this is. Pick the closest » (PQ-T41): shown when the model doubts the object's family (low
 * confidence, or two samples that disagree). One tap on a family rebuilds the model with it as the hint.
 * Both choices are 44 px targets in one row that wraps on a phone. The families come from the server
 * (`ObjectShape.ask`); a family without a name is not offered.
 */
export function FamilyQuestion({
  archetypes,
  onChoose,
}: {
  archetypes: ReadonlyArray<string>;
  onChoose: (archetype: string) => void;
}) {
  const t = useTranslations('features.visionInsert');
  const offered = archetypes.filter((a) => NAMED.has(a));
  if (offered.length < 2) return null;
  return (
    <div
      role="group"
      aria-label={t('askFamily')}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface-elevated p-3"
    >
      <p className="flex items-start gap-1.5 text-xs text-text-secondary">
        <CircleHelp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{t('askFamily')}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {offered.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onChoose(a)}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-primary hover:bg-surface-hover cursor-pointer"
          >
            {t('askFamilyChoose', { name: t(`model3dFamily.${a}`) })}
          </button>
        ))}
      </div>
    </div>
  );
}
