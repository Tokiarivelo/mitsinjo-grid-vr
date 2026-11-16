import type { FaceName } from '@/lib/object-shape';

/**
 * 3D extraction in the /village VR studio (VS-T19–T22), pure: which step the viewer is in, and
 * the slides of the views carousel (the main 2D view, then each face drawn beside it).
 *
 * idle → (shot on an object) confirm → (« Extract to 3D ») views → (« Validate & build ») build
 * → (model ready: opened by itself, VS-T24) lab → (« Leave the lab ») idle. From views on, the
 * viewer is in the 3D studio room. Cancel goes back to idle
 * from every step but the lab. An object whose model is already built skips the views.
 *
 * Leaving the studio (« Leave the studio », or leaving the lab) keeps where the viewer was
 * (`away`, VS-T26): « Back to the studio » returns there, and extracting the same object again
 * resumes it (its lab, its model) instead of starting over. Confirming another object forgets it.
 *
 * Two desks in the studio (VS-T31): the 2D lab (views) and the 3D lab (build, lab). Once the model
 * exists, « 2D lab » goes back from the lab to the views and « 3D lab » from the views to the lab.
 */
export type XrExtractStage = 'idle' | 'confirm' | 'views' | 'build' | 'lab';

export interface XrExtractState {
  stage: XrExtractStage;
  /** Detection being extracted (null when idle). */
  id: string | null;
  /** The studio step left, to come back to (absent when nothing was left). */
  away?: { id: string; stage: StudioStage };
}

/** Steps spent in the 3D studio room. */
export type StudioStage = 'views' | 'build' | 'lab';
export const isStudioStage = (stage: XrExtractStage): stage is StudioStage =>
  stage === 'views' || stage === 'build' || stage === 'lab';

export type XrExtractEvent =
  | { type: 'ask'; id: string }
  | { type: 'confirm'; built?: boolean }
  | { type: 'cancel' }
  | { type: 'build' }
  | { type: 'enterLab' }
  | { type: 'exitLab' }
  | { type: 'toViews' }
  | { type: 'toLab'; built: boolean }
  | { type: 'leave' }
  | { type: 'return' };

export const XR_EXTRACT_IDLE: XrExtractState = { stage: 'idle', id: null };

const keepAway = (away: XrExtractState['away']) => (away ? { away } : {});

export function xrExtractReducer(state: XrExtractState, event: XrExtractEvent): XrExtractState {
  switch (event.type) {
    case 'ask':
      // Another object can be picked while the question is up; never in the middle of a build.
      return state.stage === 'idle' || state.stage === 'confirm'
        ? { stage: 'confirm', id: event.id, ...keepAway(state.away) }
        : state;
    case 'confirm':
      if (state.stage !== 'confirm' || !state.id) return state;
      // The object left in the studio: back where it was (its lab keeps its model).
      if (state.away?.id === state.id) return { stage: state.away.stage, id: state.id };
      return { stage: event.built ? 'build' : 'views', id: state.id };
    case 'cancel':
      if (state.stage === 'lab') return state;
      // Cancelling the question keeps what was left; cancelling a studio step drops it.
      return state.stage === 'confirm'
        ? { ...XR_EXTRACT_IDLE, ...keepAway(state.away) }
        : XR_EXTRACT_IDLE;
    case 'build':
      return state.stage === 'views' ? { ...state, stage: 'build' } : state;
    case 'enterLab':
      return state.stage === 'build' ? { ...state, stage: 'lab' } : state;
    case 'toViews':
      return state.stage === 'lab' ? { ...state, stage: 'views' } : state;
    case 'toLab':
      return state.stage === 'views' && event.built ? { ...state, stage: 'lab' } : state;
    case 'exitLab':
    case 'leave':
      if (event.type === 'exitLab' && state.stage !== 'lab') return state;
      return isStudioStage(state.stage) && state.id
        ? { ...XR_EXTRACT_IDLE, away: { id: state.id, stage: state.stage } }
        : state;
    case 'return':
      return state.stage === 'idle' && state.away
        ? { stage: state.away.stage, id: state.away.id }
        : state;
  }
}

/** Studio desk of a step (VS-T31): the 2D lab for the views, the 3D lab for the build and the lab. */
export type StudioDesk = '2d' | '3d';
export const deskOf = (stage: XrExtractStage): StudioDesk | null =>
  stage === 'views' ? '2d' : stage === 'build' || stage === 'lab' ? '3d' : null;

/** A modal step: the 360° photo, its outlines and floor arrows take no shot meanwhile. */
export const isModalStage = (stage: XrExtractStage) => stage !== 'idle';

export type SlideId = 'main' | FaceName;
export type SlideStatus = 'idle' | 'generating' | 'ready' | 'error';

export interface ViewSlide {
  id: SlideId;
  status: SlideStatus;
  imageUrl?: string;
  validated: boolean;
}

/** What the slides read from the 2D facade and face hooks (`useFacade2d`, `useFacadeFaces`). */
export interface SlideSources {
  main: { status: 'idle' | 'generating' | 'ready' | 'deleting' | 'error'; imageUrl?: string };
  faces: Partial<Record<FaceName, { status: SlideStatus; imageUrl?: string; validated: boolean }>>;
  names: ReadonlyArray<FaceName>;
}

/** Main view first (validated when the model is built from it), then the faces in drawing order. */
export function viewSlides({ main, faces, names }: SlideSources): ViewSlide[] {
  const mainStatus: SlideStatus =
    main.status === 'deleting' ? 'generating' : main.status === 'ready' ? 'ready' : main.status;
  return [
    {
      id: 'main',
      status: mainStatus,
      ...(main.imageUrl ? { imageUrl: main.imageUrl } : {}),
      validated: mainStatus === 'ready',
    },
    ...names.map((f) => {
      const s = faces[f] ?? { status: 'idle' as const, validated: false };
      return {
        id: f,
        status: s.status,
        ...(s.imageUrl ? { imageUrl: s.imageUrl } : {}),
        validated: s.validated,
      };
    }),
  ];
}

/** The model can be built once the main view is drawn; faces still drawing must finish first. */
export function canBuild(slides: readonly ViewSlide[]): boolean {
  return slides[0]?.status === 'ready' && !slides.some((s) => s.status === 'generating');
}

/** Carousel index nearest to a continuous scroll `offset`, inside the slides. */
export function snapIndex(offset: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offset)));
}
