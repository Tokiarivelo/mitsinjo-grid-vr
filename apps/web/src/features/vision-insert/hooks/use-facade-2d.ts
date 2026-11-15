'use client';

import { useCallback, useEffect, type SetStateAction } from 'react';
import type { ShapeRequest } from './use-object-shape';
import { shapeKey } from './use-object-shape';
import { prepareVisionImage } from '../utils/prepare-image';
import { useKeptRef, useKeptState } from './use-kept-state';
import { SHAPE_OUTLINE_MAX, type FaceName } from '@/lib/object-shape';

export interface FacadeData {
  imageUrl: string;
  fileKey: string;
  prompt: string;
  archetype: string;
  detectionId: string;
  source: 'meta' | 'mock';
  /** A clean front drawn from a hidden object (PQ-T23): its parts will be inferred. */
  clean?: boolean;
  /** What that clean front was asked with: « Retry » asks for a clean front again, also after a remount. */
  cleanFront?: CleanFrontRequest;
}

/** What the 3D call needs from a validated facade: the image and its storage key (unique per generation). */
export interface ValidatedFacade {
  url: string;
  key: string;
  clean?: boolean;
  /** Faces validated beside the front in the 2D panel (PQ-T68). */
  faces?: { urls: Partial<Record<FaceName, string>>; keys: Partial<Record<FaceName, string>> };
}

/** What the kit saw of a hidden object, sent with « draw a clean front » (Clean front card blanks). */
export interface CleanFrontRequest {
  hiddenBy: string[];
  visibleParts: string[];
}

export const validatedFacade = (
  f?: FacadeData,
  faces?: ValidatedFacade['faces']
): ValidatedFacade | undefined =>
  f
    ? {
        url: f.imageUrl,
        key: f.fileKey,
        ...(f.clean ? { clean: true } : {}),
        ...(faces ? { faces } : {}),
      }
    : undefined;

export interface FacadeState {
  status: 'idle' | 'generating' | 'ready' | 'deleting' | 'error';
  facade?: FacadeData;
  userPrompt: string;
  isValidated: boolean;
  error?: string;
}

const IDLE_STATE: FacadeState = {
  status: 'idle',
  userPrompt: '',
  isValidated: false,
};

/** The facade state and the object (photo + `shapeKey`) it belongs to. */
interface ShownFacade {
  photo: string | null;
  key: string;
  state: FacadeState;
}

/**
 * 2D facade of the selected object. With a `scope` (see `useKeptState`) facades, the one shown
 * and a running generation outlive an unmount (navigating away and back).
 */
export function useFacade2d(
  imageDataUrl: string | null,
  target: ShapeRequest | null,
  sessionId?: string,
  scope?: string
) {
  /** Facades per object of one photo: switching objects shows that object's own facade. */
  const cache = useKeptRef(scope, 'facadeCache', () => ({
    photo: null as string | null,
    byKey: new Map<string, FacadeData>(),
  }));
  const abortRef = useKeptRef<AbortController | null>(scope, 'facadeAbort', () => null);
  /** Object the running generation belongs to (kept sessions only). */
  const abortForRef = useKeptRef<string | null>(scope, 'facadeAbortFor', () => null);

  const objectKey = target ? shapeKey(target) : '';
  if (cache.current.photo !== imageDataUrl) {
    cache.current = { photo: imageDataUrl, byKey: new Map() };
  }
  const [shown, setShown] = useKeptState<ShownFacade | null>(scope, 'facadeShown', null);
  /** Another object (or photo) → its own kept facade, never the previous object's one. */
  const fresh = (): FacadeState => {
    const kept = cache.current.byKey.get(objectKey);
    return kept ? { ...IDLE_STATE, status: 'ready', facade: kept } : IDLE_STATE;
  };
  const state =
    shown && shown.photo === imageDataUrl && shown.key === objectKey ? shown.state : fresh();
  const setState = useCallback(
    (next: SetStateAction<FacadeState>) =>
      setShown((cur) => {
        const prev =
          cur && cur.photo === imageDataUrl && cur.key === objectKey ? cur.state : fresh();
        const value = typeof next === 'function' ? next(prev) : next;
        return { photo: imageDataUrl, key: objectKey, state: value };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fresh` reads the same inputs
    [imageDataUrl, objectKey, setShown]
  );
  const cacheKey = `${imageDataUrl ?? ''}|${objectKey}`;

  // A facade still being imagined for the previous object is dropped (and on unmount unless kept).
  useEffect(() => {
    if (!scope) return () => abortRef.current?.abort();
    if (abortForRef.current !== cacheKey) {
      abortRef.current?.abort();
      abortForRef.current = cacheKey;
    }
  }, [scope, cacheKey, abortRef, abortForRef]);

  const generate = useCallback(
    async (extraPrompt?: string, cleanFront?: CleanFrontRequest) => {
      if (!imageDataUrl || !target) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((s) => ({
        ...s,
        status: 'generating',
        error: undefined,
        userPrompt: extraPrompt !== undefined ? extraPrompt : s.userPrompt,
      }));

      try {
        const form = new FormData();
        form.append('image', await prepareVisionImage(imageDataUrl), 'photo.jpg');
        form.append(
          'target',
          JSON.stringify({
            id: target.id,
            label: target.label,
            category: target.category,
            ...(target.scenery ? { scenery: target.scenery } : {}),
            box: target.box,
            ...(target.outline && target.outline.length <= SHAPE_OUTLINE_MAX
              ? { outline: target.outline }
              : {}),
          })
        );
        const promptToSend = extraPrompt !== undefined ? extraPrompt : state.userPrompt;
        if (promptToSend.trim()) {
          form.append('userPrompt', promptToSend.trim());
        }
        if (cleanFront) form.append('cleanFront', JSON.stringify(cleanFront));
        if (sessionId) {
          form.append('sessionId', sessionId);
        }

        const res = await fetch('/api/vision/facade', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          ok: boolean;
          imageUrl: string;
          fileKey: string;
          prompt: string;
          archetype: string;
          detectionId: string;
          source: 'meta' | 'mock';
          clean?: boolean;
        };

        if (controller.signal.aborted) return;

        const facadeData: FacadeData = {
          imageUrl: data.imageUrl,
          fileKey: data.fileKey,
          prompt: data.prompt,
          archetype: data.archetype,
          detectionId: data.detectionId,
          source: data.source,
          ...(data.clean ? { clean: true, ...(cleanFront ? { cleanFront } : {}) } : {}),
        };

        if (cache.current.photo === imageDataUrl) {
          cache.current.byKey.set(shapeKey(target), facadeData);
        }

        setState((s) => ({
          ...s,
          status: 'ready',
          facade: facadeData,
          error: undefined,
        }));
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('[useFacade2d] Generation error:', err);
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : 'Generation failed',
        }));
      }
    },
    [imageDataUrl, target, sessionId, state.userPrompt, cache, abortRef, setState]
  );

  const retry = useCallback(
    (extraPrompt?: string, cleanFront?: CleanFrontRequest) => {
      void generate(extraPrompt, cleanFront ?? state.facade?.cleanFront);
    },
    [generate, state.facade?.cleanFront]
  );

  const deleteFacade = useCallback(async () => {
    if (!state.facade?.fileKey) return;

    setState((s) => ({ ...s, status: 'deleting' }));

    try {
      const res = await fetch(
        `/api/vision/facade?key=${encodeURIComponent(state.facade.fileKey)}`,
        {
          method: 'DELETE',
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to delete facade (HTTP ${res.status})`);
      }

      if (target) cache.current.byKey.delete(shapeKey(target));

      setState({
        status: 'idle',
        facade: undefined,
        userPrompt: '',
        isValidated: false,
      });
    } catch (err) {
      console.error('[useFacade2d] Deletion error:', err);
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'Deletion failed',
      }));
    }
  }, [state.facade, target, cache, setState]);

  const validate = useCallback(() => {
    setState((s) => ({ ...s, isValidated: true }));
  }, [setState]);

  const setUserPrompt = useCallback(
    (prompt: string) => {
      setState((s) => ({ ...s, userPrompt: prompt }));
    },
    [setState]
  );

  const reset = useCallback(() => {
    setState(IDLE_STATE);
  }, [setState]);

  return {
    ...state,
    generate,
    retry,
    deleteFacade,
    validate,
    setUserPrompt,
    reset,
  };
}
