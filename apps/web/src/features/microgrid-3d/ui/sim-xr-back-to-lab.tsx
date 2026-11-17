'use client';

import { memo, useMemo, useState } from 'react';
import { useTranslations } from '@/lib/i18n';
import { HOLO } from '@/features/vision-insert/ui/xr/holo-style';
import { HoloButton, type PanelButton } from './sim-xr-holo';
import { RigFollow } from './sim-xr-minimap';
import {
  BACK_TO_LAB_CHIP,
  BACK_TO_LAB_CHIP_X,
  BACK_TO_LAB_OFFSET,
  BACK_TO_LAB_SIZE,
} from '../utils/xr-world';

/** Leaned back toward the eyes like the minimap (rad, about X). */
const TILT = -0.35;

/**
 * « Back to the lab » of the /village VR world (VS-T49): the village of the simulation opened in
 * the lab's own XR session; this button plays the hand-over back, still in the headset. Low left
 * (the minimap's mirror), with a chip that hides it or shows it again.
 */
export const SimXrBackToLab = memo(function SimXrBackToLab({ onBack }: { onBack: () => void }) {
  const t = useTranslations('features.simulation.vrControls');
  const [shown, setShown] = useState(true);
  const back = useMemo<PanelButton>(
    () => ({ id: 'back-to-lab', label: t('backToLab'), onPress: onBack, tone: HOLO.amber }),
    [t, onBack]
  );
  const chip = useMemo<PanelButton>(
    () => ({
      id: 'back-to-lab-toggle',
      label: shown ? t('backToLabHide') : t('backToLabShow'),
      icon: shown ? 'close' : 'back',
      onPress: () => setShown((v) => !v),
    }),
    [t, shown]
  );
  return (
    <RigFollow offset={BACK_TO_LAB_OFFSET} tilt={TILT} name="sim-xr-back-to-lab">
      {shown && <HoloButton button={back} position={[0, 0, 0]} size={BACK_TO_LAB_SIZE} />}
      <HoloButton
        button={chip}
        position={[BACK_TO_LAB_CHIP_X, 0, 0]}
        size={[BACK_TO_LAB_CHIP, BACK_TO_LAB_CHIP]}
      />
    </RigFollow>
  );
});
