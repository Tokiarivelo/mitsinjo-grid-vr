'use client';

import { memo, useMemo } from 'react';
import { useTranslations } from '@/lib/i18n';
import {
  NAV_PAD_BUTTON,
  NAV_PAD_BUTTONS,
  NAV_PAD_OFFSET,
  navPadX,
  pushNavAction,
} from '@/features/vision-insert/ui/xr/xr-nav-pad';
import { useHandsOnly } from '@/features/vision-insert/ui/xr/use-hands-only';
import { HoloButton, type PanelButton } from './sim-xr-holo';
import { RigFollow } from './sim-xr-minimap';

/** Leaned back toward the eyes like the menus (rad, about X). */
const PAD_TILT = -0.35;

/**
 * Hands-first navigation pad of the /simulation walk (xr-nav-pad): the same pinchable snap turns,
 * 80 cm steps and help as the /village studio, lazy-following low in the view. Hidden while a
 * panel or the big map is open (they take the pinch).
 */
export const SimXrNavPad = memo(function SimXrNavPad() {
  const tc = useTranslations('features.visionInsert.vrControls');
  const buttons = useMemo<PanelButton[]>(
    () =>
      NAV_PAD_BUTTONS.map((b) => ({
        id: b.id,
        label: tc(b.labelKey),
        icon: b.icon,
        onPress: () => pushNavAction(b.action),
      })),
    [tc]
  );
  // Controllers have their sticks: the pad is for hands only.
  const handsOnlyNow = useHandsOnly();
  if (!handsOnlyNow) return null;
  return (
    <RigFollow offset={NAV_PAD_OFFSET} tilt={PAD_TILT} name="sim-xr-nav-pad">
      {buttons.map((b, i) => (
        <HoloButton
          key={b.id}
          button={b}
          position={[navPadX(i), 0, 0]}
          size={[NAV_PAD_BUTTON, NAV_PAD_BUTTON]}
        />
      ))}
    </RigFollow>
  );
});
