'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FACE_NAMES, type FaceName } from '@/lib/object-shape';
import type { FacadeData } from './use-facade-2d';
import type { ShapeRequest } from './use-object-shape';

/** One face of the 2D views (PQ-T68): drawn from the front and the other faces, validated one by one. */
export interface FaceState {
  status: 'idle' | 'generating' | 'ready' | 'error';
  imageUrl?: string;
  fileKey?: string;
  source?: 'meta' | 'mock';
  validated: boolean;
  /** The operator's details for the next (re)generation of this face. */
  userPrompt: string;
  error?: string;
}

export type FacesState = Record<FaceName, FaceState>;

const IDLE_FACE: FaceState = { status: 'idle', validated: false, userPrompt: '' };
const idle = (): FacesState => ({ side: IDLE_FACE, back: IDLE_FACE, left: IDLE_FACE });

/** Faces a validation hands to the 3D call: the validated ones only. */
export interface ValidatedFaces {
  urls: Partial<Record<FaceName, string>>;
  keys: Partial<Record<FaceName, string>>;
}

export const validatedFaces = (faces: FacesState): ValidatedFaces | undefined => {
  const urls: ValidatedFaces['urls'] = {};
  const keys: ValidatedFaces['keys'] = {};
  for (const f of FACE_NAMES) {
    const s = faces[f];
    if (s.validated && s.imageUrl && s.fileKey) {
      urls[f] = s.imageUrl;
      keys[f] = s.fileKey;
    }
  }
  return Object.keys(urls).length ? { urls, keys } : undefined;
};

/**
 * Right side, back and left side of the validated front. Each face is drawn from the front AND the
 * faces already there (at most 3 references), so the four views agree; « Generate all » goes
 * right → back → left for that reason. A new front (another file key) starts again from nothing.
 * Regenerating a face un-validates it only: the others stay as the operator checked them.
 */
export function useFacadeFaces(target: ShapeRequest | null, front?: FacadeData) {
  const frontKey = front?.fileKey ?? '';
  /** Faces per front, so switching objects keeps each one's faces. */
  const [store, setStore] = useState<Record<string, FacesState>>({});
  /** Latest store for the async steps (written only where the store is, never during render). */
  const storeRef = useRef(store);
  const abortRef = useRef<AbortController | null>(null);

  // A new front (or leaving) drops the drawing in flight.
  useEffect(() => () => abortRef.current?.abort(), [frontKey]);

  const faces = store[frontKey] ?? idle();

  const patch = useCallback((face: FaceName, next: Partial<FaceState>, forKey: string) => {
    const cur = storeRef.current[forKey] ?? idle();
    const updated = {
      ...storeRef.current,
      [forKey]: { ...cur, [face]: { ...cur[face], ...next } },
    };
    storeRef.current = updated;
    setStore(updated);
  }, []);

  const generate = useCallback(
    async (face: FaceName, userPrompt?: string) => {
      if (!front || !target) return;
      const forKey = front.fileKey;
      const current = storeRef.current[forKey] ?? idle();
      const details = userPrompt ?? current[face].userPrompt;
      // The front first, then the other faces already drawn (3 references at most).
      const others = FACE_NAMES.filter((f) => f !== face)
        .map((f) => current[f].imageUrl)
        .filter((u): u is string => !!u);
      const references = [front.imageUrl, ...others].slice(0, 3);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      patch(
        face,
        { status: 'generating', validated: false, userPrompt: details, error: undefined },
        forKey
      );
      try {
        const res = await fetch('/api/vision/facade/face', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: {
              id: target.id,
              label: target.label,
              category: target.category,
              ...(target.scenery ? { scenery: target.scenery } : {}),
              ...(target.archetype ? { archetype: target.archetype } : {}),
            },
            face,
            references,
            ...(details.trim() ? { userPrompt: details.trim() } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`http_${res.status}`);
        const data = (await res.json()) as {
          imageUrl: string;
          fileKey: string;
          source: 'meta' | 'mock';
        };
        if (controller.signal.aborted) return;
        patch(
          face,
          { status: 'ready', imageUrl: data.imageUrl, fileKey: data.fileKey, source: data.source },
          forKey
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        patch(
          face,
          { status: 'error', error: err instanceof Error ? err.message : 'failed' },
          forKey
        );
      }
    },
    [front, target, patch]
  );

  /** Every face not drawn yet, in order, each one seeing the previous ones. */
  const generateAll = useCallback(async () => {
    const statusOf = (f: FaceName) => (storeRef.current[frontKey] ?? idle())[f].status;
    for (const f of FACE_NAMES) {
      if (statusOf(f) === 'ready') continue;
      await generate(f);
      if (statusOf(f) !== 'ready') return;
    }
  }, [generate, frontKey]);

  const setUserPrompt = useCallback(
    (face: FaceName, userPrompt: string) => patch(face, { userPrompt }, frontKey),
    [patch, frontKey]
  );
  const validate = useCallback(
    (face: FaceName, validated = true) => patch(face, { validated }, frontKey),
    [patch, frontKey]
  );
  const validateAll = useCallback(() => {
    for (const f of FACE_NAMES)
      if ((storeRef.current[frontKey] ?? idle())[f].status === 'ready')
        patch(f, { validated: true }, frontKey);
  }, [patch, frontKey]);

  return { faces, generate, generateAll, setUserPrompt, validate, validateAll };
}
