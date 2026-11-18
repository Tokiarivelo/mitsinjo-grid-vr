'use client';

import { useEffect, useRef, useState } from 'react';
import { easeToward, settled } from '../utils/ease-toward';
import { useReducedMotion } from './use-reduced-motion';

/**
 * Eases a set of visual levels (0..1, keyed) toward their targets over about a second, so lights dim
 * or brighten gradually when the engine serves a sector less or more. Runs a short
 * requestAnimationFrame loop only while a value moves (state updates outside R3F's frame loop, which
 * re-render and invalidate the scene). Reduced motion or the first render: the targets at once.
 */
export function useEasedLevels<K extends string>(targets: Record<K, number>): Record<K, number> {
  const reduced = useReducedMotion();
  const [values, setValues] = useState<Record<K, number>>(targets);
  const current = useRef<Record<K, number>>(targets);
  const key = JSON.stringify(targets);

  useEffect(() => {
    const goal = JSON.parse(key) as Record<K, number>;
    if (reduced) {
      current.current = goal;
      return;
    }
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = { ...current.current };
      for (const k of Object.keys(goal) as K[])
        next[k] = easeToward(next[k] ?? goal[k], goal[k], dt);
      current.current = next;
      setValues(next);
      if (!settled(next, goal)) raf = requestAnimationFrame(step);
    };
    if (!settled(current.current, goal)) raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key, reduced]);

  return reduced ? targets : values;
}
