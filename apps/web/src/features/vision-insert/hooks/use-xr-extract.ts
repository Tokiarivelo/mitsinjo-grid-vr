'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { FaceName } from '@/lib/object-shape';
import type { PieceEdits } from '@/lib/piece-edits';
import {
  canBuild,
  viewSlides,
  XR_EXTRACT_IDLE,
  xrExtractReducer,
  type ViewSlide,
  type XrExtractStage,
} from '../utils/xr-extract';
import { useFacade2d, validatedFacade } from './use-facade-2d';
import { useFacadeFaces, validatedFaces } from './use-facade-faces';
import type { ObjectShapeState, ShapeRequest } from './use-object-shape';

export interface UseXrExtractOptions {
  /** Photo the objects were found on (the scanned view). */
  imageUrl: string | null;
  /** Selected object, as the 3D call wants it (null while nothing is selected). */
  target: ShapeRequest | null;
  /** The page's model state (`useObjectShape`), and its calls. */
  shape: Pick<ObjectShapeState, 'status' | 'shape' | 'step' | 'startedAt'>;
  requestShape: (imageUrl: string, request: ShapeRequest) => unknown;
  editPieces: (pieces: PieceEdits) => void;
  /** Selects the object on the page (its model, its 2D view). */
  select: (id: string) => void;
  /** Kept-state scope (`useKeptState`): the 2D view drawn in VR is the page's one afterwards. */
  scope?: string;
}

export interface XrExtract {
  stage: XrExtractStage;
  id: string | null;
  ask: (id: string) => void;
  confirm: () => void;
  cancel: () => void;
  /** Validates the main view, sends it with the validated faces, and builds the model. */
  build: () => void;
  enterLab: () => void;
  exitLab: () => void;
  /** Leaves the studio, keeping the step and the object to come back to (VS-T26). */
  leave: () => void;
  /** Back to the studio step left (no-op when none). */
  back: () => void;
  /** Object left in the studio, to come back to (null when none). */
  awayId: string | null;
  slides: ViewSlide[];
  canBuild: boolean;
  redraw: (slide: ViewSlide['id']) => void;
  toggleValidated: (slide: ViewSlide['id']) => void;
  /** Model of the object being extracted is built. */
  ready: boolean;
  shape: UseXrExtractOptions['shape'];
  editPieces: (pieces: PieceEdits) => void;
}

/**
 * The VR extraction flow (VS-T19–T22) on top of the page's 2D pipeline, nothing re-implemented:
 * the 2D view and faces come from `useFacade2d` / `useFacadeFaces` (same calls, same kept state as
 * the 2D panel), the model from the page's `requestShape`, the lab edits go to `editPieces`.
 * Confirming draws the main view, then every face once it is there (each face sees the others);
 * the lab opens by itself once the model is built.
 */
export function useXrExtract({
  imageUrl,
  target,
  shape,
  requestShape,
  editPieces,
  select,
  scope,
}: UseXrExtractOptions): XrExtract {
  const [state, dispatch] = useReducer(xrExtractReducer, XR_EXTRACT_IDLE);
  const active = state.stage !== 'idle' && target?.id === state.id ? target : null;
  const awayId = state.away?.id ?? null;
  const facade = useFacade2d(imageUrl, active, undefined, scope);
  const faces = useFacadeFaces(active, facade.facade);
  const ready = shape.status === 'ready' && shape.shape?.detectionId === state.id;

  // Views step: draw the main view once (an error waits for « Redraw »), then the faces once.
  const drawnFor = useRef<string | null>(null);
  const { generate } = facade;
  useEffect(() => {
    if (state.stage !== 'views' || !active || facade.status !== 'idle') return;
    const key = `${imageUrl}|${active.id}`;
    if (drawnFor.current === key) return;
    drawnFor.current = key;
    void generate();
  }, [state.stage, active, facade.status, imageUrl, generate]);
  const facesFor = useRef<string | null>(null);
  const frontKey = facade.facade?.fileKey ?? null;
  const { generateAll } = faces;
  useEffect(() => {
    if (state.stage !== 'views' || !frontKey || facesFor.current === frontKey) return;
    facesFor.current = frontKey;
    void generateAll();
  }, [state.stage, frontKey, generateAll]);

  const mainStatus = facade.status;
  const mainUrl = facade.facade?.imageUrl;
  const faceStates = faces.faces;
  const faceNames = faces.names;
  const slides = useMemo(
    () =>
      viewSlides({
        main: { status: mainStatus, ...(mainUrl ? { imageUrl: mainUrl } : {}) },
        faces: faceStates,
        names: faceNames,
      }),
    [mainStatus, mainUrl, faceStates, faceNames]
  );

  const ask = useCallback(
    (id: string) => {
      select(id);
      dispatch({ type: 'ask', id });
    },
    [select]
  );
  const confirm = useCallback(() => dispatch({ type: 'confirm', built: ready }), [ready]);
  const cancel = useCallback(() => dispatch({ type: 'cancel' }), []);
  const enterLab = useCallback(() => dispatch({ type: 'enterLab' }), []);
  // The studio opens the lab by itself once the model is built (no « Enter the lab » step).
  useEffect(() => {
    if (state.stage === 'build' && ready) dispatch({ type: 'enterLab' });
  }, [state.stage, ready]);
  const exitLab = useCallback(() => dispatch({ type: 'exitLab' }), []);
  const leave = useCallback(() => dispatch({ type: 'leave' }), []);
  const back = useCallback(() => {
    if (awayId) select(awayId);
    dispatch({ type: 'return' });
  }, [awayId, select]);

  const buildable = canBuild(slides);
  const { validate } = facade;
  const build = useCallback(() => {
    if (!imageUrl || !active || !buildable || !facade.facade) return;
    validate();
    const v = validatedFacade(facade.facade, validatedFaces(faces.faces));
    void requestShape(imageUrl, {
      ...active,
      ...(v
        ? {
            facadeUrl: v.url,
            facadeKey: v.key,
            ...(v.clean ? { cleanFront: true } : {}),
            ...(v.faces ? { faceUrls: v.faces.urls, faceKeys: v.faces.keys } : {}),
          }
        : {}),
    });
    dispatch({ type: 'build' });
  }, [imageUrl, active, buildable, facade.facade, faces.faces, validate, requestShape]);

  const { retry } = facade;
  const redraw = useCallback(
    (slide: ViewSlide['id']) => {
      if (slide === 'main') retry();
      else void faces.generate(slide as FaceName);
    },
    [retry, faces]
  );
  const toggleValidated = useCallback(
    (slide: ViewSlide['id']) => {
      if (slide === 'main') return; // the main view is what the model is built from
      const face = slide as FaceName;
      faces.validate(face, !faces.faces[face].validated);
    },
    [faces]
  );

  return {
    stage: state.stage,
    id: state.id,
    ask,
    confirm,
    cancel,
    build,
    enterLab,
    exitLab,
    leave,
    back,
    awayId,
    slides,
    canBuild: buildable,
    redraw,
    toggleValidated,
    ready,
    shape,
    editPieces,
  };
}
