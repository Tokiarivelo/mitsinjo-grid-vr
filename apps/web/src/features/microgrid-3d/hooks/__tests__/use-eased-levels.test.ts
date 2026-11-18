import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('../use-reduced-motion', () => ({ useReducedMotion: () => motion.reduced }));

import { useEasedLevels } from '../use-eased-levels';

let now = 0;
let queue: Array<FrameRequestCallback> = [];
const frame = () => {
  now += 16;
  const run = queue;
  queue = [];
  run.forEach((cb) => cb(now));
};

beforeEach(() => {
  now = 0;
  queue = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = [];
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  motion.reduced = false;
});

describe('useEasedLevels', () => {
  it('starts at the targets, then dims gradually to a new target', () => {
    const { result, rerender } = renderHook(({ t }) => useEasedLevels({ house: t }), {
      initialProps: { t: 1 },
    });
    expect(result.current.house).toBe(1);
    rerender({ t: 0.25 });
    act(frame);
    const first = result.current.house;
    expect(first).toBeLessThan(1);
    expect(first).toBeGreaterThan(0.25);
    for (let i = 0; i < 200 && queue.length; i++) act(frame);
    expect(result.current.house).toBe(0.25);
    expect(queue).toHaveLength(0); // the loop stops once settled
  });

  it('jumps at once under reduced motion', () => {
    motion.reduced = true;
    const { result, rerender } = renderHook(({ t }) => useEasedLevels({ house: t }), {
      initialProps: { t: 1 },
    });
    rerender({ t: 0 });
    expect(result.current.house).toBe(0);
    expect(queue).toHaveLength(0);
  });
});
