'use client';

import { useEffect, useRef } from 'react';
import {
  readImmersionQuery,
  withImmersionQuery,
  type ImmersionQuery,
} from '../utils/immersion-query';

/** Pathname another page's immersion is navigating to (« Go to the simulation », VS-T29). */
let leavingTo: string | null = null;

/**
 * Call before `router.push(href)` out of an immersion: until the URL reaches `href`'s path, the
 * page being left stops writing its own URL. Its session ends during the navigation and its
 * `replaceState` back to it made Next.js drop the pending push (VS-T36 regression). A navigation
 * that never lands gives the URL back after `LEAVE_TIMEOUT_MS`.
 */
export const LEAVE_TIMEOUT_MS = 10_000;
export function leaveImmersionFor(href: string): void {
  const to = href.split(/[?#]/)[0] || null;
  leavingTo = to;
  setTimeout(() => {
    if (leavingTo === to) leavingTo = null;
  }, LEAVE_TIMEOUT_MS);
}

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
    if (leavingTo !== null) {
      if (pathname !== leavingTo) return; // the page being left: never touch the URL
      leavingTo = null; // arrived
    }
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
