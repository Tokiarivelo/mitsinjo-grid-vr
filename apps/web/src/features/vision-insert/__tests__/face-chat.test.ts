import { describe, expect, it } from 'vitest';
import {
  CHAT_MAX_CHARS,
  chatBusy,
  chatOf,
  FACE_CHAT_EMPTY,
  faceChatReducer,
} from '../utils/face-chat';
import type { ViewSlide } from '../utils/xr-extract';

const slide = (id: ViewSlide['id'], status: ViewSlide['status']): ViewSlide => ({
  id,
  status,
  validated: false,
});

describe('faceChatReducer (VS-T27)', () => {
  it('logs the request and a working bot line, per view', () => {
    const s = faceChatReducer(FACE_CHAT_EMPTY, {
      type: 'send',
      objectId: 'o1',
      slide: 'side',
      text: '  red roof ',
    });
    expect(chatOf(s, 'o1', 'side')).toEqual([
      { id: 1, role: 'user', kind: 'prompt', text: 'red roof' },
      { id: 2, role: 'bot', kind: 'working', seen: false },
    ]);
    expect(chatOf(s, 'o1', 'back')).toEqual([]);
    expect(chatBusy(chatOf(s, 'o1', 'side'))).toBe(true);
  });

  it('ignores an empty request and cuts a long one', () => {
    expect(
      faceChatReducer(FACE_CHAT_EMPTY, { type: 'send', objectId: 'o', slide: 'main', text: '  ' })
    ).toBe(FACE_CHAT_EMPTY);
    const long = faceChatReducer(FACE_CHAT_EMPTY, {
      type: 'send',
      objectId: 'o',
      slide: 'main',
      text: 'x'.repeat(CHAT_MAX_CHARS + 50),
    });
    expect(chatOf(long, 'o', 'main')[0]!.text).toHaveLength(CHAT_MAX_CHARS);
  });

  it('answers only after the view was seen drawing: done, or error', () => {
    let s = faceChatReducer(FACE_CHAT_EMPTY, {
      type: 'send',
      objectId: 'o',
      slide: 'side',
      text: 'a',
    });
    s = faceChatReducer(s, { type: 'send', objectId: 'o', slide: 'back', text: 'b' });
    // Still the previous drawing on screen: no answer.
    const same = faceChatReducer(s, {
      type: 'settle',
      objectId: 'o',
      slides: [slide('side', 'ready'), slide('back', 'error')],
    });
    expect(same).toBe(s);
    s = faceChatReducer(s, {
      type: 'settle',
      objectId: 'o',
      slides: [slide('side', 'generating'), slide('back', 'generating')],
    });
    s = faceChatReducer(s, {
      type: 'settle',
      objectId: 'o',
      slides: [slide('side', 'ready'), slide('back', 'error')],
    });
    expect(chatOf(s, 'o', 'side').at(-1)!.kind).toBe('done');
    expect(chatOf(s, 'o', 'back').at(-1)!.kind).toBe('error');
    expect(chatBusy(chatOf(s, 'o', 'side'))).toBe(false);
  });

  it('another object starts from an empty history, ids keep growing', () => {
    let s = faceChatReducer(FACE_CHAT_EMPTY, {
      type: 'send',
      objectId: 'o1',
      slide: 'side',
      text: 'a',
    });
    s = faceChatReducer(s, { type: 'send', objectId: 'o2', slide: 'side', text: 'b' });
    expect(chatOf(s, 'o1', 'side')).toEqual([]);
    expect(chatOf(s, 'o2', 'side').map((m) => m.id)).toEqual([3, 4]);
    expect(faceChatReducer(s, { type: 'settle', objectId: 'o1', slides: [] })).toBe(s);
  });
});
