'use client';

import { memo, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';
import { HoloFrame, HoloText } from './holo-ui';
import { HOLO } from './holo-style';

export interface SpatialInteractionGuideProps {
  position?: [number, number, number];
}

/** Guide card size (m): two rows of text read at the menu's 0.9 m. */
const GUIDE_W = 0.56;
const GUIDE_H = 0.11;

/**
 * Command guide under the scan button (wrist menu): « A/X analyse · B/Y back · Trigger select… »
 * in VR, « Aim & click with the mouse » on a screen. Laid out by the shared holo card (VS-T32):
 * the text wraps on two rows and shrinks to fit, so a long translation never runs off the card.
 */
export const SpatialInteractionGuide = memo(function SpatialInteractionGuide({
  position = [0, 1.08, -1.2],
}: SpatialInteractionGuideProps) {
  const t = useTranslations('features.visionInsert');
  const isPresenting = useThree((s) => Boolean(s.gl?.xr?.isPresenting));
  const text = isPresenting ? t('vrInteractionGuideVR') : t('vrInteractionGuideDesktop');
  const spec = useMemo(
    () => ({
      glass: false,
      align: 'center' as const,
      lines: [{ text, size: 40, weight: 700 as const }],
    }),
    [text]
  );
  return (
    <group position={position} name="spatial-interaction-guide">
      <HoloFrame width={GUIDE_W} height={GUIDE_H} color={HOLO.cyan} />
      <HoloText
        spec={spec}
        width={GUIDE_W - 0.03}
        height={GUIDE_H - 0.02}
        position={[0, 0, 0.003]}
      />
    </group>
  );
});
