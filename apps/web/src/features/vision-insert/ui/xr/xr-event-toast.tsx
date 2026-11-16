'use client';

import { memo, useMemo } from 'react';
import { HoloFrame, HoloText } from './holo-ui';
import { HOLO } from './holo-style';
import { FollowGroup } from './xr-wrist-menu';
import { EVENT_TOAST_OFFSET, EVENT_TOAST_OFFSET_MENU } from './xr-layout';

const TOAST_W = 0.5;
const TOAST_H = 0.09;

/**
 * Short notice of what just happened (« Fridge connected », « Hands hidden »…) for a few
 * seconds, in front of the viewer just under the line of sight (VS-T32: replaces the event line
 * of the removed telemetry HUD). World-locked, lazy-following like the menu; above the scan
 * button's crystal while the menu is open. Nothing drawn without a message.
 */
export const XrEventToast = memo(function XrEventToast({
  message,
  menuOpen,
}: {
  message: string | null;
  menuOpen: boolean;
}) {
  const spec = useMemo(
    () => ({
      glass: false,
      align: 'center' as const,
      lines: [{ text: message ?? '', size: 44, weight: 700 as const }],
    }),
    [message]
  );
  if (!message) return null;
  return (
    <FollowGroup
      offset={menuOpen ? EVENT_TOAST_OFFSET_MENU : EVENT_TOAST_OFFSET}
      spawn
      name="xr-event-toast"
    >
      <HoloFrame width={TOAST_W} height={TOAST_H} color={HOLO.amber} active />
      <HoloText
        spec={spec}
        width={TOAST_W - 0.03}
        height={TOAST_H - 0.02}
        position={[0, 0, 0.003]}
      />
    </FollowGroup>
  );
});
