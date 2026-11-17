import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n';
import en from '@/messages/en.json';
import type { PanelButton } from '../ui/sim-xr-holo';

const seen = vi.hoisted(() => ({
  buttons: new Map<string, PanelButton>(),
  offset: null as unknown,
}));
vi.mock('../ui/sim-xr-holo', () => ({
  HoloButton: ({ button }: { button: PanelButton }) => {
    seen.buttons.set(button.id, button);
    return <i data-id={button.id} />;
  },
}));
vi.mock('../ui/sim-xr-minimap', () => ({
  RigFollow: ({ offset, children }: { offset: unknown; children: React.ReactNode }) => {
    seen.offset = offset;
    return <>{children}</>;
  },
}));

import { SimXrBackToLab } from '../ui/sim-xr-back-to-lab';
import {
  backToLabFarAngle,
  BACK_TO_LAB_CHIP,
  BACK_TO_LAB_CHIP_X,
  BACK_TO_LAB_OFFSET,
  BACK_TO_LAB_SIZE,
} from '../utils/xr-world';
import { MINI_MAP_OFFSET } from '../utils/sim-xr-minimap';
import { NAV_PAD_BUTTON, NAV_PAD_OFFSET } from '@/features/vision-insert/ui/xr/xr-nav-pad';
import { FOLLOW_ANGLE } from '@/features/vision-insert/ui/xr/wrist-menu';

const c = en.features.simulation.vrControls;
const shownIds = (root: HTMLElement) =>
  [...root.querySelectorAll('i')].map((n) => n.getAttribute('data-id'));

describe('« Back to the lab » in the /village VR world (VS-T49)', () => {
  it('labels the button and calls back on a press', () => {
    const onBack = vi.fn();
    render(
      <I18nProvider>
        <SimXrBackToLab onBack={onBack} />
      </I18nProvider>
    );
    expect(seen.buttons.get('back-to-lab')?.label).toBe(c.backToLab);
    seen.buttons.get('back-to-lab')?.onPress();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(seen.offset).toEqual(BACK_TO_LAB_OFFSET);
  });

  it('the chip hides the button, then shows it again', () => {
    const { container } = render(
      <I18nProvider>
        <SimXrBackToLab onBack={() => {}} />
      </I18nProvider>
    );
    expect(shownIds(container)).toEqual(['back-to-lab', 'back-to-lab-toggle']);
    expect(seen.buttons.get('back-to-lab-toggle')?.label).toBe(c.backToLabHide);
    act(() => seen.buttons.get('back-to-lab-toggle')?.onPress());
    expect(shownIds(container)).toEqual(['back-to-lab-toggle']);
    expect(seen.buttons.get('back-to-lab-toggle')?.label).toBe(c.backToLabShow);
    act(() => seen.buttons.get('back-to-lab-toggle')?.onPress());
    expect(shownIds(container)).toEqual(['back-to-lab', 'back-to-lab-toggle']);
  });

  it('sits low left at the minimap height, clear of the hands pad', () => {
    expect(BACK_TO_LAB_OFFSET[0]).toBeLessThan(0);
    expect(BACK_TO_LAB_OFFSET[1]).toBe(MINI_MAP_OFFSET[1]);
    expect(BACK_TO_LAB_OFFSET[1] - BACK_TO_LAB_SIZE[1] / 2).toBeGreaterThan(
      NAV_PAD_OFFSET[1] + NAV_PAD_BUTTON / 2
    );
  });

  it('stays in the follow dead zone: looking at it never re-centres it away (regression)', () => {
    // Before: x = -0.72 m at 0.9 m = 38.7° > FOLLOW_ANGLE (34°), so turning toward it moved it.
    expect(backToLabFarAngle()).toBeLessThan(FOLLOW_ANGLE - (3 * Math.PI) / 180);
    const chipRight = BACK_TO_LAB_OFFSET[0] + BACK_TO_LAB_CHIP_X + BACK_TO_LAB_CHIP / 2;
    expect(chipRight).toBeLessThan(0);
  });
});
