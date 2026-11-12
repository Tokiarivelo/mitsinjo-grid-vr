'use client';

import { useCallback, useEffect } from 'react';
import {
  SHAPE_OUTLINE_MAX,
  ImaginedViewsResponseSchema,
  ObjectShapeSchema,
  ShapeStageEventSchema,
  ShapeStagesCheckpointEventSchema,
  ShapeStagesDoneSchema,
  ShapeStagesResumedSchema,
  ShapeStepEventSchema,
  type ImaginedAngleView,
  type ObjectRecipe,
  type ObjectShape,
  type PartKind,
  type ShapeStageId,
  type ShapeStageStop,
  type ShapeStep,
  type ShapeTarget,
} from '@/lib/object-shape';
import { readSseStream } from '@/lib/sse';
import { prepareVisionImage } from '../utils/prepare-image';
import { useKeptRef, useKeptState } from './use-kept-state';

/** `loading` = Spark is building the recipe · `ready` = recipe or silhouette to show. */
export interface ObjectShapeState {
  status: 'idle' | 'loading' | 'ready';
  shape?: ObjectShape;
  /** Server step while loading (`crop` until the first event). */
  step?: ShapeStep;
  /** `Date.now()` when the request started (elapsed-time display). */
  startedAt?: number;
  /** 6-angle 2D preview: imagined before the 3D, validated to build it. */
  viewsStatus: 'idle' | 'loading' | 'ready';
  views?: ImaginedAngleView[];
  /**
   * Live model while `loading`: the seed then each kept first-answer stage, streamed by the
   * server (real partial data, not a shape: source/model are only known at `shape_result`).
   * Cleared when the final shape lands. The viewer paints it like a 3D print in progress.
   */
  preview?: ObjectRecipe;
  /** Staged improvement of the model (PG-T17/T18), absent when the object has none. */
  improve?: ShapeImprove;
}

/** Where the staged loop is: the current stage and how it ends. */
export interface ShapeImprove {
  /** `running` while stages go on, then `done` (« Modèle finalisé ») or `stopped` + cause. */
  status: 'running' | 'done' | 'stopped';
  /** `lost` = the server no longer knows the job (restarted): the last model shown is kept. */
  cause?: 'timeout' | 'error' | 'aborted' | 'lost';
  /** Current (or last) stage, 1-based of `total`. */
  index: number;
  total: number;
  stage: ShapeStageId;
  /** Part kinds the stage works on (the viewer frames them), kept until the next stage. */
  kinds?: PartKind[];
  /** Stage score before → after (0–1), once the stage ended. */
  before?: number;
  after?: number;
  /** Why the ended stage stopped (`gate` with no change = already matched the drawing). */
  stop?: ShapeStageStop;
}

/** Reconnects to a dropped background job before giving up (« Amélioration arrêtée »). */
export const STAGE_RESUME_TRIES = 3;

const IDLE: ObjectShapeState = { status: 'idle', viewsStatus: 'idle' };

/**
 * Shown when the app server cannot be reached or answers badly (`network`, not « Meta did not answer »):
 * the silhouette needs no server. `detail` = `http_<status>`, `no_result` or `offline`.
 */
const offlineSilhouette = (detectionId: string, detail: string): ObjectShape => ({
  detectionId,
  mode: 'silhouette',
  reason: 'network',
  detail,
  source: 'mock',
  model: 'none',
});

/** Only lasting answers are kept: a timeout, Meta error, spend cap or lost connection is asked again. */
const TRANSIENT = new Set<ObjectShape['reason']>([
  'provider_error',
  'spend_cap',
  'timeout',
  'network',
]);
export const keepShape = (shape: ObjectShape) =>
  shape.mode === 'recipe' || !TRANSIENT.has(shape.reason);

/**
 * Key of one « Generate » request: the object's key plus the validated facade, so a new facade
 * asks Spark again instead of returning the model made without it (or with an older one).
 */
export const shapeRequestKey = (t: ShapeRequest) =>
  `${shapeKey(t)}${t.facadeKey ? `|facade:${t.facadeKey}` : ''}${t.archetype ? `|family:${t.archetype}` : ''}`;

/** Object to model; `adjusted` = the operator corrected its box, so the box is part of the key. */
export type ShapeRequest = ShapeTarget & { adjusted?: true };

/**
 * Same object again (id, name, category) → same shape: a reselect or a SAM box refinement costs no
 * Spark call. A box corrected by hand (« Adjust the box ») is a new key: the recipe follows the new box.
 */
export const shapeKey = (
  t: Pick<ShapeRequest, 'id' | 'label' | 'category' | 'scenery' | 'adjusted'> & {
    box?: ShapeTarget['box'];
  }
) => {
  const base = `${t.id}|${t.label}|${t.category}|${t.scenery ?? ''}`;
  if (!t.adjusted || !t.box) return base;
  const { x, y, w, h } = t.box;
  return `${base}|${[x, y, w, h].map((v) => v.toFixed(4)).join(',')}`;
};

/** Multipart body shared by the shape and views routes: photo + target (+ session). */
async function shapeForm(imageDataUrl: string, target: ShapeRequest, sessionId?: string) {
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
      ...(target.facadeUrl ? { facadeUrl: target.facadeUrl } : {}),
      ...(target.facadeKey ? { facadeKey: target.facadeKey } : {}),
      ...(target.cleanFront ? { cleanFront: true } : {}),
      ...(target.archetype ? { archetype: target.archetype } : {}),
    })
  );
  if (sessionId) form.append('sessionId', sessionId);
  return form;
}

/**
 * 3D shape of the selected object (PV-T9), on demand (`peek` on select, `requestShape` on « Generate »): asks `/api/vision/shape` (SSE: live `step`, then the shape)
 * for a Spark recipe; any failure ends in `silhouette` mode with its reason (never an error state). A new
 * request cancels the previous one. Lasting answers are kept per object until `clear()` (new photo);
 * transient failures (`keepShape`) are not, so a reselect asks again.
 * `requestViews` previews the 6 imagined 2D angles first (cheap, no Spark call); validating them runs
 * `requestShape`.
 */
export function useObjectShape(scope?: string) {
  const [state, setState] = useKeptState<ObjectShapeState>(scope, 'shape', IDLE);
  const abortRef = useKeptRef<AbortController | null>(scope, 'shapeAbort', () => null);
  const cacheRef = useKeptRef(scope, 'shapeCache', () => new Map<string, ObjectShape>());
  const viewsCacheRef = useKeptRef(
    scope,
    'viewsCache',
    () => new Map<string, ImaginedAngleView[]>()
  );
  /** Validated facade per object: « Regenerate » / « Retry » keep using it. */
  const facadesRef = useKeptRef(
    scope,
    'shapeFacades',
    () => new Map<string, Pick<ShapeRequest, 'facadeUrl' | 'facadeKey' | 'cleanFront'>>()
  );
  /** Family the operator picked per object (PQ-T41): « Regenerate » keeps asking with it. */
  const familiesRef = useKeptRef(scope, 'shapeFamilies', () => new Map<string, string>());
  const lastRef = useKeptRef<{ image: string; target: ShapeRequest; sessionId?: string } | null>(
    scope,
    'shapeLast',
    () => null
  );
  /** Object (`shapeKey`) the state is about: a kept page coming back to it leaves it running. */
  const forKeyRef = useKeptRef<string | null>(scope, 'shapeFor', () => null);

  /** Background stage job being followed (PG-T18), cancelled when it would be overwritten. */
  const jobRef = useKeptRef<string | null>(scope, 'shapeJob', () => null);

  /** Stops following the background stages and tells the server to stop them (saves Spark calls). */
  const cancelJob = useCallback(() => {
    const id = jobRef.current;
    jobRef.current = null;
    if (!id) return;
    void fetch(`/api/vision/shape/stages?job=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
  }, [jobRef]);

  // Leaving the page cancels the running request, unless the state is kept (it goes on then).
  useEffect(() => {
    if (scope) return;
    return () => abortRef.current?.abort();
  }, [scope, abortRef]);

  const requestViews = useCallback(
    async (imageDataUrl: string, target: ShapeRequest) => {
      abortRef.current?.abort();
      const key = shapeKey(target);
      const cached = viewsCacheRef.current.get(key);
      if (cached) {
        setState((s) => ({ ...s, viewsStatus: 'ready', views: cached }));
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) => ({ ...s, viewsStatus: 'loading', views: undefined }));
      try {
        const res = await fetch('/api/vision/views', {
          method: 'POST',
          body: await shapeForm(imageDataUrl, target),
          signal: controller.signal,
        });
        if (res.ok) {
          const parsed = ImaginedViewsResponseSchema.safeParse(await res.json());
          if (parsed.success && !controller.signal.aborted) {
            viewsCacheRef.current.set(key, parsed.data.views);
            setState((s) => ({ ...s, viewsStatus: 'ready', views: parsed.data.views }));
            return;
          }
          if (!parsed.success)
            console.warn('[vision] 6-angle views reply not readable:', parsed.error.issues[0]);
        }
      } catch (err) {
        if (!controller.signal.aborted) console.warn('[vision] 6-angle views request failed:', err);
      }
      if (controller.signal.aborted) return;
      // No preview, no drama: the operator can still generate the 3D model directly.
      setState((s) => (s.viewsStatus === 'loading' ? { ...s, viewsStatus: 'idle' } : s));
    },
    [abortRef, viewsCacheRef, setState]
  );

  const requestShape = useCallback(
    async (imageDataUrl: string, request: ShapeRequest, sessionId?: string, force = false) => {
      abortRef.current?.abort();
      const objectKey = shapeKey(request);
      if (request.facadeUrl && request.facadeKey) {
        facadesRef.current.set(objectKey, {
          facadeUrl: request.facadeUrl,
          facadeKey: request.facadeKey,
          ...(request.cleanFront ? { cleanFront: true } : {}),
        });
      }
      const family = familiesRef.current.get(objectKey);
      const target = {
        ...(request.facadeUrl ? request : { ...request, ...facadesRef.current.get(objectKey) }),
        ...(family ? { archetype: family } : {}),
      };
      lastRef.current = { image: imageDataUrl, target, ...(sessionId ? { sessionId } : {}) };
      forKeyRef.current = objectKey;
      const key = shapeRequestKey(target);
      const cached = force ? undefined : cacheRef.current.get(key);
      if (cached) {
        setState((s) => ({
          ...s,
          status: 'ready',
          shape: cached,
          preview: undefined,
          improve: undefined,
        }));
        return;
      }
      cancelJob();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) => ({
        ...s,
        status: 'loading',
        step: 'crop',
        startedAt: Date.now(),
        preview: undefined,
        improve: undefined,
      }));
      const job: { id?: string; seq: number; done: boolean } = { seq: -1, done: false };
      /** Checkpoint of a loop cut by the request limit: posted back to go on (Vercel, 300 s). */
      let pending: Record<string, unknown> | null = null;
      let finalized = false;
      /** The first answer: shown at once (the stream may go on with background stages). */
      const finalize = (shape: ObjectShape) => {
        finalized = true;
        if (keepShape(shape)) {
          cacheRef.current.set(key, shape);
          // A reselect (`peek`, no facade) shows the latest model, facade-based or not.
          cacheRef.current.set(objectKey, shape);
        }
        setState((s) => ({
          ...s,
          status: 'ready',
          shape,
          preview: undefined,
          // First-answer stages only: the model is final now.
          ...(s.improve && !job.id ? { improve: { ...s.improve, status: 'done' as const } } : {}),
        }));
      };
      const onEvent = (event: string, data: Record<string, unknown>) => {
        if (controller.signal.aborted) return;
        if (typeof data.seq === 'number') job.seq = Math.max(job.seq, data.seq);
        if (event === 'shape_step') {
          const step = ShapeStepEventSchema.safeParse(data);
          if (step.success) setState((s) => ({ ...s, step: step.data.step }));
        } else if (event === 'shape_result') {
          const parsed = ObjectShapeSchema.safeParse(data.shape);
          if (typeof data.jobId === 'string') {
            job.id = data.jobId;
            jobRef.current = data.jobId;
          }
          if (parsed.success) finalize(parsed.data);
          else console.warn('[vision] 3D shape reply not readable:', parsed.error.issues[0]);
        } else if (event === 'shape_stage') {
          const e = ShapeStageEventSchema.safeParse(data);
          if (!e.success) return;
          const st = e.data;
          setState((s) => {
            const kinds = st.kinds ?? (s.improve?.stage === st.stage ? s.improve.kinds : undefined);
            const improve: ShapeImprove = {
              status: 'running',
              index: st.index,
              total: st.total,
              stage: st.stage,
              ...(kinds ? { kinds } : {}),
              ...(st.state === 'done' && st.before !== undefined ? { before: st.before } : {}),
              ...(st.state === 'done' && st.after !== undefined ? { after: st.after } : {}),
              ...(st.state === 'done' && st.stop ? { stop: st.stop } : {}),
            };
            // A background stage that kept a patch: swap the model in (and keep it).
            if (st.phase === 'background' && st.recipe && finalized && s.shape?.mode === 'recipe') {
              const shape = { ...s.shape, recipe: st.recipe };
              cacheRef.current.set(key, shape);
              cacheRef.current.set(objectKey, shape);
              return { ...s, shape, improve };
            }
            // A first-answer stage (seed, then each kept patch): live preview while loading.
            if (st.phase === 'first' && st.recipe && !finalized) {
              return { ...s, preview: st.recipe, improve };
            }
            return { ...s, improve };
          });
        } else if (event === 'shape_stages_resumed') {
          const r = ShapeStagesResumedSchema.safeParse(data);
          if (!r.success) return;
          job.id = r.data.jobId;
          jobRef.current = r.data.jobId;
        } else if (event === 'shape_stages_checkpoint') {
          const c = ShapeStagesCheckpointEventSchema.safeParse(data);
          if (!c.success) return;
          job.done = true;
          jobRef.current = null;
          pending = c.data.checkpoint;
        } else if (event === 'shape_stages_done') {
          const d = ShapeStagesDoneSchema.safeParse(data);
          if (!d.success) return;
          job.done = true;
          jobRef.current = null;
          setState((s) =>
            s.improve
              ? {
                  ...s,
                  improve: {
                    ...s.improve,
                    status: d.data.status,
                    ...(d.data.cause ? { cause: d.data.cause } : {}),
                  },
                }
              : s
          );
        }
      };
      let detail = 'no_result';
      try {
        const form = await shapeForm(imageDataUrl, target, sessionId);
        const res = await fetch('/api/vision/shape', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          detail = `http_${res.status}`;
        } else {
          await readSseStream(res.body, onEvent);
        }
      } catch (err) {
        detail = 'offline';
        if (!controller.signal.aborted) console.warn('[vision] 3D shape request failed:', err);
      }
      if (controller.signal.aborted) return;
      if (!finalized) finalize(offlineSilhouette(target.id, detail));
      /**
       * Background stages: a dropped stream resumes from the last event seen; a job that ends
       * neither done nor checkpointed shows « stopped » (`lost` when the server forgot it).
       * `expectJob`: a resumed slice always has a job, the first answer only when stages are left.
       */
      const followDropped = async (expectJob: boolean): Promise<'ok' | 'aborted'> => {
        let lost = false;
        for (let tries = 0; job.id && !job.done && tries < STAGE_RESUME_TRIES; tries++) {
          try {
            const res = await fetch(
              `/api/vision/shape/stages?job=${encodeURIComponent(job.id)}&from=${job.seq + 1}`,
              { signal: controller.signal }
            );
            // 404: the job is gone (server restarted or job expired), nothing to resume.
            lost = res.status === 404;
            if (!res.ok || !res.body) break;
            await readSseStream(res.body, onEvent);
          } catch (err) {
            if (controller.signal.aborted) return 'aborted';
            console.warn('[vision] 3D stages stream dropped:', err);
          }
          if (controller.signal.aborted) return 'aborted';
        }
        if (!job.done && (job.id || expectJob)) {
          jobRef.current = null;
          setState((s) =>
            s.improve
              ? {
                  ...s,
                  improve: { ...s.improve, status: 'stopped', cause: lost ? 'lost' : 'error' },
                }
              : s
          );
        }
        return 'ok';
      };
      if ((await followDropped(false)) === 'aborted') return;
      // Cut by the request limit: each checkpoint is posted back and a new request goes on, until
      // the loop is done or « Cancel » (which aborts this controller).
      while (pending) {
        const checkpoint: Record<string, unknown> = pending;
        pending = null;
        Object.assign(job, { id: undefined, seq: -1, done: false });
        let started = false;
        for (let tries = 0; !started && tries < STAGE_RESUME_TRIES; tries++) {
          try {
            const res = await fetch('/api/vision/shape/stages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ checkpoint, ...(sessionId ? { sessionId } : {}) }),
              signal: controller.signal,
            });
            // A refused checkpoint will not pass on a retry either.
            if (res.status === 400 || res.status === 413) break;
            if (!res.ok || !res.body) continue;
            started = true;
            await readSseStream(res.body, onEvent);
          } catch (err) {
            if (controller.signal.aborted) return;
            console.warn('[vision] 3D stages resume failed:', err);
          }
          if (controller.signal.aborted) return;
        }
        if (!started) {
          setState((s) =>
            s.improve ? { ...s, improve: { ...s.improve, status: 'stopped', cause: 'error' } } : s
          );
          return;
        }
        if ((await followDropped(true)) === 'aborted') return;
      }
    },
    [cancelJob, abortRef, cacheRef, facadesRef, familiesRef, lastRef, forKeyRef, jobRef, setState]
  );

  /**
   * Object selected: show its kept shape and views, else nothing (idle) — Spark is only asked on
   * « Generate » (`requestShape`), so picking objects to adjust their box costs no call. Cancels a
   * running request.
   */
  const peek = useCallback(
    (target: ShapeRequest) => {
      const key = shapeKey(target);
      // Back on a kept page with the same object: keep what is shown (or still being built).
      if (scope && forKeyRef.current === key) return;
      forKeyRef.current = key;
      abortRef.current?.abort();
      cancelJob();
      const cached = cacheRef.current.get(key);
      const views = viewsCacheRef.current.get(key);
      setState({
        ...(cached ? { status: 'ready' as const, shape: cached } : { status: 'idle' as const }),
        ...(views ? { viewsStatus: 'ready' as const, views } : { viewsStatus: 'idle' as const }),
      });
    },
    [cancelJob, scope, abortRef, cacheRef, viewsCacheRef, forKeyRef, setState]
  );

  /** « Try the AI shape again »: same object, cache skipped (Spark answers vary). */
  const retry = useCallback(() => {
    const last = lastRef.current;
    if (last) void requestShape(last.image, last.target, last.sessionId, true);
  }, [requestShape, lastRef]);

  /** « Regenerate the 3D model »: re-request the shape skipping cache (force = true). */
  const regenerate = useCallback(() => {
    const last = lastRef.current;
    if (last) void requestShape(last.image, last.target, last.sessionId, true);
  }, [requestShape, lastRef]);

  /**
   * The operator answers « Which is it? » (PQ-T41): the family becomes the hint of the next call
   * (and of every later « Regenerate » of this object); the cache is skipped.
   */
  const chooseFamily = useCallback(
    (archetype: string) => {
      const last = lastRef.current;
      if (!last) return;
      familiesRef.current.set(shapeKey(last.target), archetype);
      void requestShape(last.image, last.target, last.sessionId, true);
    },
    [requestShape, lastRef, familiesRef]
  );

  /**
   * « Cancel » on the improvement chip: stops the background stages on the server (the stages
   * otherwise wait for Meta with no time limit, request after request); the last model is kept.
   */
  const cancelImprove = useCallback(() => {
    cancelJob();
    // Also stops a resumed slice (the server cancels it when its request closes).
    abortRef.current?.abort();
    setState((s) =>
      s.improve?.status === 'running'
        ? { ...s, improve: { ...s.improve, status: 'stopped', cause: 'aborted' } }
        : s
    );
  }, [cancelJob, abortRef, setState]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    cancelJob();
    forKeyRef.current = null;
    setState(IDLE);
  }, [cancelJob, abortRef, forKeyRef, setState]);

  /** New photo: forget every kept shape and preview (ids repeat across photos). */
  const clear = useCallback(() => {
    cacheRef.current.clear();
    viewsCacheRef.current.clear();
    facadesRef.current.clear();
    familiesRef.current.clear();
    lastRef.current = null;
    forKeyRef.current = null;
    abortRef.current?.abort();
    cancelJob();
    setState(IDLE);
  }, [
    cancelJob,
    abortRef,
    cacheRef,
    viewsCacheRef,
    facadesRef,
    familiesRef,
    lastRef,
    forKeyRef,
    setState,
  ]);

  return {
    ...state,
    requestShape,
    requestViews,
    peek,
    retry,
    regenerate,
    chooseFamily,
    cancelImprove,
    reset,
    clear,
  };
}
