import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handsOnly } from '../xr-nav-pad';
import { useHandsOnly } from '../use-hands-only';

const frames: Array<() => void> = [];
const xr = {
  isPresenting: false,
  session: { inputSources: [] as Array<{ hand?: unknown }> },
  getSession() {
    return this.session;
  },
};

vi.mock('@react-three/fiber', () => ({
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: { xr } }),
  useFrame: (fn: () => void) => {
    frames.push(fn);
  },
}));

const tick = () => act(() => frames.at(-1)?.());

describe('handsOnly', () => {
  it('is true with tracked hands and no controller', () => {
    expect(handsOnly([{ hand: {} }])).toBe(true);
    expect(handsOnly([{ hand: {} }, { hand: {} }])).toBe(true);
  });
  it('is false as soon as a controller is used, or with no input at all', () => {
    expect(handsOnly([{ hand: {} }, {}])).toBe(false);
    expect(handsOnly([{}, {}])).toBe(false);
    expect(handsOnly([])).toBe(false);
  });
});

describe('useHandsOnly', () => {
  beforeEach(() => {
    frames.length = 0;
    xr.isPresenting = false;
    xr.session.inputSources = [];
  });

  it('is false off the headset', () => {
    xr.session.inputSources = [{ hand: {} }];
    const { result } = renderHook(() => useHandsOnly());
    tick();
    expect(result.current).toBe(false);
  });

  it('follows the live input sources: hands → true, a controller picked up → false', () => {
    xr.isPresenting = true;
    xr.session.inputSources = [{ hand: {} }, { hand: {} }];
    const { result } = renderHook(() => useHandsOnly());
    tick();
    expect(result.current).toBe(true);
    xr.session.inputSources = [{ hand: {} }, {}];
    tick();
    expect(result.current).toBe(false);
  });
});
