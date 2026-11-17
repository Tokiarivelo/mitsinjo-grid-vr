'use client';

import { memo } from 'react';
import { useTranslations } from '@/lib/i18n';
import { HoloButton } from './holo-ui';
import type { PanelRegistry } from './holo-panel';
import { FollowGroup } from './xr-wrist-menu';
import { useHandsOnly } from './use-hands-only';
import {
  NAV_PAD_BUTTON,
  NAV_PAD_BUTTONS,
  NAV_PAD_OFFSET,
  navPadPanelId,
  navPadX,
  pushNavAction,
} from './xr-nav-pad';

/**
 * Hands-first navigation pad of the /village studio and tour (xr-nav-pad): pinchable snap turns,
 * 80 cm steps and the help, lazy-following low in the view. Pressed through `XRBlasterController`
 * (ray pinch, trigger or mouse) like every studio panel.
 */
export const XrNavPad = memo(function XrNavPad({
  registry,
  hoveredId,
}: {
  registry: PanelRegistry;
  hoveredId: string | null;
}) {
  const tc = useTranslations('features.visionInsert.vrControls');
  // Controllers have their sticks: the pad is for hands only.
  const handsOnlyNow = useHandsOnly();
  if (!handsOnlyNow) return null;
  return (
    <FollowGroup offset={NAV_PAD_OFFSET} name="xr-nav-pad">
      {NAV_PAD_BUTTONS.map((b, i) => (
        <HoloButton
          key={b.id}
          registry={registry}
          id={navPadPanelId(b.id)}
          label={tc(b.labelKey)}
          tip={tc('navTip')}
          icon={b.icon}
          iconOnly
          width={NAV_PAD_BUTTON}
          height={NAV_PAD_BUTTON}
          position={[navPadX(i), 0, 0]}
          hovered={hoveredId === navPadPanelId(b.id)}
          onSelect={() => pushNavAction(b.action)}
        />
      ))}
    </FollowGroup>
  );
});
