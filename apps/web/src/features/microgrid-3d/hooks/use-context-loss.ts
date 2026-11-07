import { useCallback, useEffect, useRef, useState } from 'react';

/** Wait before rebuilding the canvas after its WebGL context is lost. */
export const CONTEXT_REMOUNT_MS = 600;
/** Give up after this many rebuilds (the device keeps dropping the context). */
export const MAX_CONTEXT_REMOUNTS = 3;

export interface ContextLoss {
  /** True from the loss until the rebuilt canvas mounts: show a placeholder, not a white box. */
  lost: boolean;
  /** Bump to remount the `<Canvas>` (use it in its `key`): a fresh context. */
  epoch: number;
  /**
   * Call from `<Canvas onCreated>` with `gl.domElement` and a check that the R3F root is
   * still live (`() => get().internal.active`).
   */
  attach: (canvas: HTMLCanvasElement, isLive?: () => boolean) => void;
  /**
   * Report a context that failed at creation (the browser blocks new contexts after
   * repeated losses): same placeholder + bounded-remount cycle, then a stuck placeholder.
   */
  reportCreationFailed: () => void;
}

/**
 * Recovers from a lost WebGL context (browser context limit, GPU reset, driver crash):
 * the canvas would otherwise stay white. Remounts the canvas instead of relying on
 * `webglcontextrestored`, which three.js only partly supports.
 */
export function useContextLoss(): ContextLoss {
  const [lost, setLost] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const detach = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!lost || epoch >= MAX_CONTEXT_REMOUNTS) return;
    const id = window.setTimeout(() => {
      setEpoch((e) => e + 1);
      setLost(false);
    }, CONTEXT_REMOUNT_MS);
    return () => window.clearTimeout(id);
  }, [lost, epoch]);

  useEffect(() => () => detach.current?.(), []);

  const attach = useCallback((canvas: HTMLCanvasElement, isLive: () => boolean = () => true) => {
    detach.current?.();
    const onLost = (event: Event) => {
      // R3F itself forces a context loss when it unmounts a canvas (tier switch, remount,
      // navigation): that one is expected. Reacting to it would remount in a loop.
      if (!canvas.isConnected || !isLive()) return;
      event.preventDefault();
      setLost(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    detach.current = () => canvas.removeEventListener('webglcontextlost', onLost);
  }, []);

  const reportCreationFailed = useCallback(() => setLost(true), []);

  return { lost, epoch, attach, reportCreationFailed };
}
