'use client';

import { useCallback, useEffect } from 'react';
import { readSseStream } from '@/lib/sse';
import {
  VisionDetectionsEventSchema,
  type ApplianceDetection,
  type VisionDetectionsEvent,
} from '@/lib/vision';
import { prepareVisionImage } from '../utils/prepare-image';
import { expectedDetectionsFor } from '../utils/expected-detections';
import { useKeptRef, useKeptState } from './use-kept-state';

/** `loading` = waiting for boxes · `refining` = boxes shown, SAM outlines coming · `ready` · `error`. */
export type VisionStatus = 'idle' | 'loading' | 'refining' | 'ready' | 'error';

export interface VisionState {
  status: VisionStatus;
  detections: ApplianceDetection[];
  source?: VisionDetectionsEvent['source'];
  fallback?: VisionDetectionsEvent['fallback'];
}

const IDLE: VisionState = { status: 'idle', detections: [] };

/**
 * Sends a photo to `/api/vision` and follows its event stream. A new call cancels the previous one.
 * With a `scope` (see `useKeptState`) the result outlives an unmount and a running call goes on.
 */
export function useVisionDetection(scope?: string) {
  const [state, setState] = useKeptState<VisionState>(scope, 'vision', IDLE);
  /** Photo the state belongs to (lets a kept session skip asking again). */
  const [detectedFor, setDetectedFor] = useKeptState<string | null>(scope, 'visionFor', null);
  const abortRef = useKeptRef<AbortController | null>(scope, 'visionAbort', () => null);

  useEffect(() => {
    if (scope) return;
    return () => abortRef.current?.abort();
  }, [scope, abortRef]);

  const detect = useCallback(
    async (imageDataUrl: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setDetectedFor(imageDataUrl);
      setState({ status: 'loading', detections: [] });

      try {
        const form = new FormData();
        form.append('image', await prepareVisionImage(imageDataUrl), 'photo.jpg');
        // 360° test tour scan: its labelled objects, for offline (mock) answers.
        const expected = expectedDetectionsFor(imageDataUrl);
        if (expected) form.append('expected', JSON.stringify(expected));
        const res = await fetch('/api/vision', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        let failed = false;
        await readSseStream(res.body, (event, data) => {
          if (event === 'vision_error') {
            failed = true;
            return;
          }
          if (event !== 'vision_detections') return;
          const parsed = VisionDetectionsEventSchema.safeParse(data);
          if (!parsed.success) return;
          const e = parsed.data;
          const moreComing =
            e.phase === 'boxes' && e.source === 'meta' && !e.fallback && e.detections.length > 0;
          setState({
            status: moreComing ? 'refining' : 'ready',
            detections: e.detections,
            source: e.source,
            ...(e.fallback ? { fallback: e.fallback } : {}),
          });
        });
        if (controller.signal.aborted) return;
        setState((prev) =>
          failed && prev.detections.length === 0
            ? { status: 'error', detections: [] }
            : { ...prev, status: prev.status === 'error' ? 'error' : 'ready' }
        );
      } catch {
        if (controller.signal.aborted) return;
        setState({ status: 'error', detections: [] });
      }
    },
    [abortRef, setDetectedFor, setState]
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setDetectedFor(null);
    setState(IDLE);
  }, [abortRef, setDetectedFor, setState]);

  return { ...state, detectedFor, detect, reset };
}
