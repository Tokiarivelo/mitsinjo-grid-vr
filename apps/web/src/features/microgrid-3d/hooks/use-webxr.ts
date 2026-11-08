'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { WebGLRenderer } from 'three';
import { isImmersiveVRSupported, startImmersiveVRSession } from '../utils/xr-session';
import { installDevXREmulator } from '../utils/dev-xr-emulator';

export type WebXRStatus = 'checking' | 'unsupported' | 'supported' | 'active';

export interface UseWebXRResult {
  status: WebXRStatus;
  /** Last `enter`/`exit` failure (shown on the button tooltip, never thrown). */
  error: string | null;
  enter: () => void;
  exit: () => void;
}

/**
 * Own the `immersive-vr` session for the renderer's canvas. In development, when
 * no native immersive-vr device exists (desktop without a headset), the Meta IWER
 * emulator is installed first so the session still opens.
 */
export function useWebXR(rendererRef: RefObject<WebGLRenderer | null>): UseWebXRResult {
  const [status, setStatus] = useState<WebXRStatus>('checking');
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<XRSession | null>(null);
  const isStartingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await isImmersiveVRSupported()) && process.env.NODE_ENV === 'development') {
        await installDevXREmulator().catch(() => false);
      }
      if (!cancelled) setStatus((await isImmersiveVRSupported()) ? 'supported' : 'unsupported');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Leaving the page mid-session: close it quietly.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      void session?.end()?.catch(() => undefined);
    },
    []
  );

  const enter = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || sessionRef.current || isStartingRef.current) return;
    setError(null);
    isStartingRef.current = true;
    startImmersiveVRSession(renderer).then(
      (session) => {
        isStartingRef.current = false;
        sessionRef.current = session;
        // Sync back when the session ends outside the button (headset system gesture).
        session.addEventListener(
          'end',
          () => {
            sessionRef.current = null;
            setStatus('supported');
          },
          { once: true }
        );
        setStatus('active');
      },
      (cause: unknown) => {
        isStartingRef.current = false;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
  }, [rendererRef]);

  const exit = useCallback(() => {
    sessionRef.current
      ?.end()
      ?.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  return { status, error, enter, exit };
}
