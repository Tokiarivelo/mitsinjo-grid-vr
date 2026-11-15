import type { FaceName } from '@/lib/object-shape';

/**
 * 3D extraction in the /village VR studio (VS-T19–T22), pure: which step the viewer is in, and
 * the slides of the views carousel (the main 2D view, then each face drawn beside it).
 *
 * idle → (shot on an object) confirm → (« Extract to 3D ») views → (« Validate & build ») build
 * → (model ready, « Enter the 3D lab ») lab → (« Leave the lab ») idle. Cancel goes back to idle
 * from every step but the lab. An object whose model is already built skips the views.
 */
export type XrExtractStage = 'idle' | 'confirm' | 'views' | 'build' | 'lab';

export interface XrExtractState {
  stage: XrExtractStage;
  /** Detection being extracted (null when idle). */
  id: string | null;
}

export type XrExtractEvent =
  | { type: 'ask'; id: string }
  | { type: 'confirm'; built?: boolean }
  | { type: 'cancel' }
  | { type: 'build' }
  | { type: 'enterLab' }
  | { type: 'exitLab' };

export const XR_EXTRACT_IDLE: XrExtractState = { stage: 'idle', id: null };

export function xrExtractReducer(state: XrExtractState, event: XrExtractEvent): XrExtractState {
  switch (event.type) {
    case 'ask':
      // Another object can be picked while the question is up; never in the middle of a build.
      return state.stage === 'idle' || state.stage === 'confirm'
        ? { stage: 'confirm', id: event.id }
        : state;
    case 'confirm':
      return state.stage === 'confirm'
        ? { ...state, stage: event.built ? 'build' : 'views' }
        : state;
    case 'cancel':
      return state.stage === 'lab' ? state : XR_EXTRACT_IDLE;
    case 'build':
      return state.stage === 'views' ? { ...state, stage: 'build' } : state;
    case 'enterLab':
      return state.stage === 'build' ? { ...state, stage: 'lab' } : state;
    case 'exitLab':
      return state.stage === 'lab' ? XR_EXTRACT_IDLE : state;
  }
}

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
