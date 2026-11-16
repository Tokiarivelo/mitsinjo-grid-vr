import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DESK_TURN_SECONDS } from '../xr-layout';

const frame = vi.hoisted(() => ({ cb: null as null | ((s: unknown, delta: number) => void) }));
vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (s: unknown, delta: number) => void) => {
    frame.cb = cb;
  },
}));

import { StudioDesks } from '../studio-desks';

const anchor = { position: [0, 1.5, -1.1] as [number, number, number], yaw: 0 };

/** jsdom draws the R3F groups as unknown elements: give them a rotation to turn. */
function tick(container: HTMLElement, seconds: number) {
  for (const el of container.querySelectorAll('[name^="xr-desk-"]')) {
    const g = el as unknown as { rotation?: { y: number } };
    g.rotation ??= { y: 0 };
  }
  // Frames of 50 ms (the turntable caps a frame at 100 ms).
  for (let t = 0; t < seconds - 1e-9; t += 0.05)
    act(() => frame.cb!({}, Math.min(0.05, seconds - t)));
}
const yawOf = (container: HTMLElement, name: string) =>
  (container.querySelector(`[name="${name}"]`) as unknown as { rotation: { y: number } }).rotation
    .y;

const desks = (desk: '2d' | '3d') => (
  <StudioDesks
    anchor={anchor}
    desk={desk}
    twoD={<i data-testid="views" />}
    threeD={<i data-testid="lab" />}
  />
);

describe('StudioDesks (VS-T31)', () => {
  beforeEach(() => {
    frame.cb = null;
    vi.spyOn(console, 'error').mockImplementation(() => {}); // unknown R3F tags in jsdom
  });

  it('shows only the desk ahead at rest', () => {
    const { queryByTestId } = render(desks('2d'));
    expect(queryByTestId('views')).toBeTruthy();
    expect(queryByTestId('lab')).toBeNull();
  });

  it('turns right to left to the 3D lab, both desks drawn until it stops', () => {
    const { container, rerender, queryByTestId } = render(desks('2d'));
    rerender(desks('3d'));
    expect(queryByTestId('views')).toBeTruthy();
    expect(queryByTestId('lab')).toBeTruthy();
    tick(container, DESK_TURN_SECONDS / 2);
    // Half way: the 2D desk has slid to the left (+yaw), the 3D one comes from the right.
    expect(yawOf(container, 'xr-desk-2d')).toBeCloseTo(Math.PI / 2, 1);
    expect(yawOf(container, 'xr-desk-3d')).toBeCloseTo(-Math.PI / 2, 1);
    tick(container, 0.1);
    tick(container, DESK_TURN_SECONDS);
    expect(queryByTestId('views')).toBeNull();
    expect(queryByTestId('lab')).toBeTruthy();
  });

  it('turns back left to right to the 2D lab', () => {
    const { container, rerender, queryByTestId } = render(desks('3d'));
    rerender(desks('2d'));
    tick(container, DESK_TURN_SECONDS / 4);
    expect(yawOf(container, 'xr-desk-2d')).toBeGreaterThan(Math.PI / 2);
    tick(container, 0.1);
    tick(container, DESK_TURN_SECONDS);
    expect(queryByTestId('lab')).toBeNull();
    expect(queryByTestId('views')).toBeTruthy();
  });
});
