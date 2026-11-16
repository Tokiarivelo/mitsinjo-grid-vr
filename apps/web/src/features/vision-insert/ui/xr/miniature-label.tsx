'use client';

import { memo, useMemo } from 'react';
import { useTranslations } from '@/lib/i18n';
import type { PanelRegistry } from './holo-panel';
import { HoloButton, HoloFrame, HoloText } from './holo-ui';
import { HOLO } from './holo-style';
import { faceOrigin, MINIATURE_LABEL_Y, type Vec3 } from './xr-layout';

export const miniatureDismissId = (id: string) => `holo:mini-dismiss-${id}`;

const CARD_W = 0.26;
const CARD_H = 0.1;
/** Read at arm's length (the miniature is ~55 cm away). */
const READ_DISTANCE = 0.6;

/**
 * Card over a 3D miniature (VS-T32): what it is, whether it is on the village grid, what a press
 * does, and « Put away » to remove the miniature (the simulation is left as it is). Turned toward
 * the viewer; the button sits on top, clear of the model, so a press on the model still
 * connects / turns it.
 */
export const MiniatureLabel = memo(function MiniatureLabel({
  id,
  name,
  slot,
  connected,
  registry,
  hoveredId,
  onDismiss,
}: {
  id: string;
  name: string;
  slot: Vec3;
  connected: boolean;
  registry: PanelRegistry;
  hoveredId: string | null;
  onDismiss: (id: string) => void;
}) {
  const t = useTranslations('features.visionInsert.vrMini');
  const spec = useMemo(
    () => ({
      glass: false,
      lines: [
        { text: name, size: 56, weight: 700 as const },
        {
          text: connected ? t('connected') : t('idle'),
          size: 40,
          weight: 600 as const,
          color: connected ? HOLO.green : HOLO.cyan,
        },
        { text: t('hint'), size: 36, weight: 400 as const },
      ],
    }),
    [t, name, connected]
  );
  const dismissId = miniatureDismissId(id);
  return (
    <group
      position={[slot[0], slot[1] + MINIATURE_LABEL_Y, slot[2]]}
      rotation={[0, faceOrigin(slot), 0]}
      name="xr-miniature-label"
    >
      <HoloFrame width={CARD_W} height={CARD_H} color={connected ? HOLO.green : HOLO.cyan} />
      <HoloText
        spec={spec}
        width={CARD_W - 0.02}
        height={CARD_H - 0.012}
        position={[0, 0, 0.003]}
      />
      <HoloButton
        registry={registry}
        id={dismissId}
        label={t('dismiss')}
        tip={t('dismissTip')}
        icon="close"
        width={0.15}
        height={0.065}
        position={[0, CARD_H / 2 + 0.045, 0.004]}
        distance={READ_DISTANCE}
        hovered={hoveredId === dismissId}
        onSelect={() => onDismiss(id)}
      />
    </group>
  );
});
