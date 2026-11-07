import { type RefObject, useCallback, useEffect, useState, useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};
const fullscreenSupported = () => typeof document.documentElement?.requestFullscreen === 'function';

/** Fullscreen toggle for one element (the 3D viewport card). */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Server snapshot is `false`, so the server render and hydration match.
  const supported = useSyncExternalStore(noopSubscribe, fullscreenSupported, () => false);

  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === ref.current && ref.current !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);

  const enter = useCallback(() => {
    const el = ref.current;
    if (!el || document.fullscreenElement) return;
    void el.requestFullscreen?.().catch(() => {
      // Denied (iframe policy, user gesture): stay in the card.
    });
  }, [ref]);

  const exit = useCallback(() => {
    if (!document.fullscreenElement) return;
    void document.exitFullscreen?.().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void el.requestFullscreen?.().catch(() => {
        // Denied (iframe policy, user gesture): stay in the card.
      });
    }
  }, [ref]);

  return { isFullscreen, toggle, enter, exit, supported };
}
