import type { SlideId, ViewSlide } from './xr-extract';

/**
 * Chat of the 2D views in the VR studio (VS-T27): one history per view (main view or face). The
 * operator asks for a change; the AI is the drawing call (the same one as the 2D panel's details +
 * « Redraw »), so the bot's lines are the drawing's status, never invented text.
 */
export type ChatKind = 'prompt' | 'working' | 'done' | 'error';

export interface ChatMessage {
  id: number;
  role: 'user' | 'bot';
  kind: ChatKind;
  /** The operator's request (`prompt` only). */
  text?: string;
  /** `working` only: the view was seen drawing since the request (its result is the answer). */
  seen?: boolean;
}

export interface FaceChatState {
  /** Object the histories belong to: another object starts again from nothing. */
  objectId: string | null;
  bySlide: Partial<Record<SlideId, ChatMessage[]>>;
  seq: number;
}

export const FACE_CHAT_EMPTY: FaceChatState = { objectId: null, bySlide: {}, seq: 0 };

/** Longest request kept (the drawing call's details field is short). */
export const CHAT_MAX_CHARS = 280;

export type FaceChatEvent =
  | { type: 'send'; objectId: string; slide: SlideId; text: string }
  /**
   * The views' statuses changed: a `working` line becomes `done` / `error` once its view has been
   * seen drawing and has stopped (a status still showing the previous drawing never answers it).
   */
  | { type: 'settle'; objectId: string; slides: readonly ViewSlide[] };

const forObject = (s: FaceChatState, objectId: string): FaceChatState =>
  s.objectId === objectId ? s : { objectId, bySlide: {}, seq: s.seq };

/** Trimmed request, cut to `CHAT_MAX_CHARS`; empty when there is nothing to send. */
export const chatText = (text: string) => text.trim().slice(0, CHAT_MAX_CHARS);

export function faceChatReducer(state: FaceChatState, event: FaceChatEvent): FaceChatState {
  switch (event.type) {
    case 'send': {
      const text = chatText(event.text);
      if (!text) return state;
      const s = forObject(state, event.objectId);
      const list = s.bySlide[event.slide] ?? [];
      return {
        ...s,
        seq: s.seq + 2,
        bySlide: {
          ...s.bySlide,
          [event.slide]: [
            ...list,
            { id: s.seq + 1, role: 'user', kind: 'prompt', text },
            { id: s.seq + 2, role: 'bot', kind: 'working', seen: false },
          ],
        },
      };
    }
    case 'settle': {
      if (state.objectId !== event.objectId) return state;
      let changed = false;
      const bySlide = { ...state.bySlide };
      for (const slide of event.slides) {
        const list = bySlide[slide.id];
        const last = list?.[list.length - 1];
        if (!list || !last || last.kind !== 'working') continue;
        let next: ChatMessage | null = null;
        if (slide.status === 'generating') next = last.seen ? null : { ...last, seen: true };
        else if (last.seen && (slide.status === 'ready' || slide.status === 'error'))
          next = { id: last.id, role: 'bot', kind: slide.status === 'ready' ? 'done' : 'error' };
        if (!next) continue;
        bySlide[slide.id] = [...list.slice(0, -1), next];
        changed = true;
      }
      return changed ? { ...state, bySlide } : state;
    }
  }
}

/** History of one view of the object (empty for another object). */
export function chatOf(state: FaceChatState, objectId: string | null, slide: SlideId | undefined) {
  if (!objectId || !slide || state.objectId !== objectId) return [];
  return state.bySlide[slide] ?? [];
}

/** The bot is working on one of this object's views (its head shows it). */
export const chatBusy = (messages: readonly ChatMessage[]) =>
  messages[messages.length - 1]?.kind === 'working';
