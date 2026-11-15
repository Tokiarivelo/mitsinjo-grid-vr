'use client';

import { useMemo, useState } from 'react';
import { Settings } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { useStepModels } from '../hooks/use-step-models';
import { StepModelsModal } from './step-models-modal';

export interface StepModelsGearProps {
  /** Session the choice is stored for (`global` when the flow has none, like /village). */
  sessionId?: string;
  /** After a save: the caller drops shapes built with the previous choice. */
  onSaved?: () => void;
}

/**
 * Gear next to « Validate & Generate 3D » / « Regenerate the 3D model » (PQ-T67): opens the
 * per-step model modal. Small icon, full 44 px target.
 */
export function StepModelsGear({ sessionId, onSaved }: StepModelsGearProps) {
  const t = useTranslations('features.visionInsert');
  const [open, setOpen] = useState(false);
  const stepModels = useStepModels(sessionId ?? 'global');

  const { status, defaults, models, selection } = stepModels;
  // Stable identity: the modal syncs its draft when this object changes.
  const loaded = useMemo(
    () =>
      status === 'ready' && defaults && models && selection !== undefined
        ? { defaults, models, selection }
        : null,
    [status, defaults, models, selection]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void stepModels.load();
        }}
        aria-label={t('stepModels.gearLabel')}
        title={t('stepModels.gearLabel')}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface-elevated px-3 text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer"
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <StepModelsModal
          data={loaded}
          loadError={status === 'error'}
          saving={stepModels.saving}
          saveError={stepModels.failedSave}
          onClose={() => setOpen(false)}
          onSave={async (selection) => {
            if (await stepModels.save(selection)) {
              onSaved?.();
              setOpen(false);
            }
          }}
        />
      )}
    </>
  );
}
