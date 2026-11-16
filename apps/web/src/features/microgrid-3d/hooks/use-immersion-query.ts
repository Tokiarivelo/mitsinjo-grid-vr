'use client';

import { useEffect, useRef } from 'react';
import {
  readImmersionQuery,
  withImmersionQuery,
  type ImmersionQuery,
} from '../utils/immersion-query';

/**
 * Keeps `?immersion=vr` (and `lab=`) in the URL in step with the page's immersion (VS-T33), with
 * `history.replaceState` (no navigation, no history entry; Next.js syncs `useSearchParams`).
 * Arriving on a URL that already says « immersion » while the page is not in it yet: `onArrive`
 * runs once with that query instead of the param being stripped (the page then opens it).
 */
export function useImmersionQuery(
  q: ImmersionQuery,
  onArrive?: (from: ImmersionQuery) => void
): void {
  const arrived = useRef(false);
  const arrive = useRef(onArrive);
  useEffect(() => {
    arrive.current = onArrive;
  }, [onArrive]);
  const { immersion } = q;
  const lab = q.lab ?? null;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const { pathname, search, hash } = window.location;
    if (!arrived.current) {
      arrived.current = true;
      const from = readImmersionQuery(search);
      if (from.immersion && !immersion && arrive.current) {
        arrive.current(from);
        return;
      }
    }
    const next = withImmersionQuery(search, { immersion, lab });
    if (next === search) return;
    window.history.replaceState(null, '', pathname + next + hash);
  }, [immersion, lab]);
}
