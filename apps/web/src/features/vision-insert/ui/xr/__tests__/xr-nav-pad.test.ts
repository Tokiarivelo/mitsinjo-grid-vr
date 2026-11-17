import { describe, expect, it } from 'vitest';
import { HOLO_ICONS } from '../holo-icons';
import { FOLLOW_DOCK_X, MENU_DISTANCE } from '../wrist-menu';
import { STUDIO_DOOR_SIZE } from '../xr-layout';
import {
  NAV_PAD_BUTTON,
  NAV_PAD_BUTTONS,
  NAV_PAD_OFFSET,
  drainNavActions,
  navPadPanelId,
  navPadWidth,
  navPadX,
  pushNavAction,
} from '../xr-nav-pad';

describe('xr-nav-pad (hands-first navigation)', () => {
  it('gives the hands every stick move: both snap turns, both steps, and the help', () => {
    const actions = NAV_PAD_BUTTONS.map((b) => b.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        { type: 'turn', direction: -1 },
        { type: 'turn', direction: 1 },
        { type: 'step', direction: 1 },
        { type: 'step', direction: -1 },
        { type: 'help' },
      ])
    );
    expect(new Set(NAV_PAD_BUTTONS.map((b) => b.id)).size).toBe(NAV_PAD_BUTTONS.length);
    for (const b of NAV_PAD_BUTTONS) expect(HOLO_ICONS).toContain(b.icon);
  });

  it('registers studio buttons with the holo: prefix of every studio panel', () => {
    for (const b of NAV_PAD_BUTTONS) expect(navPadPanelId(b.id)).toBe(`holo:${b.id}`);
  });

  it('queues presses in order and empties on drain', () => {
    drainNavActions();
    pushNavAction({ type: 'turn', direction: 1 });
    pushNavAction({ type: 'step', direction: -1 });
    expect(drainNavActions()).toEqual([
      { type: 'turn', direction: 1 },
      { type: 'step', direction: -1 },
    ]);
    expect(drainNavActions()).toEqual([]);
  });

  it('lays a centred row with hit targets ≥ 22 mm', () => {
    expect(NAV_PAD_BUTTON).toBeGreaterThanOrEqual(0.022);
    const xs = NAV_PAD_BUTTONS.map((_, i) => navPadX(i));
    expect(xs[0]).toBeCloseTo(-xs[xs.length - 1]!, 4);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(NAV_PAD_BUTTON);
  });

  it('stays inside a narrow field of view and clear of the studio docks', () => {
    const half = navPadWidth() / 2;
    // Horizontal edge within ±20° and the row within 25° down, at the follow distance.
    expect(Math.atan2(half, MENU_DISTANCE)).toBeLessThan((20 * Math.PI) / 180);
    expect(Math.atan2(-NAV_PAD_OFFSET[1], MENU_DISTANCE)).toBeLessThan((25 * Math.PI) / 180);
    // The door dock (right) starts after the pad ends.
    expect(FOLLOW_DOCK_X - STUDIO_DOOR_SIZE.width / 2).toBeGreaterThan(half);
  });
});
