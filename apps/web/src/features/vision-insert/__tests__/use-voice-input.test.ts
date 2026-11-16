import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechLang, useVoiceInput } from '../hooks/use-voice-input';

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  interimResults = false;
  continuous = true;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
}
const result = (transcript: string, isFinal: boolean) =>
  Object.assign([{ transcript }], { isFinal });

describe('useVoiceInput (VS-T27)', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });

  it('maps the app locale to a recognition language (Malagasy → French)', () => {
    expect(speechLang('en')).toBe('en-US');
    expect(speechLang('fr')).toBe('fr-FR');
    expect(speechLang('mg')).toBe('fr-FR');
  });

  it('reports unsupported without a speech API', () => {
    const { result: r } = renderHook(() => useVoiceInput('en', vi.fn()));
    expect(r.current.supported).toBe(false);
    act(() => r.current.start());
    expect(r.current.listening).toBe(false);
  });

  it('listens, shows what it hears, hands over each settled phrase, and stops', () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    const onFinal = vi.fn();
    const { result: r } = renderHook(() => useVoiceInput('fr', onFinal));
    expect(r.current.supported).toBe(true);
    act(() => r.current.start());
    const rec = FakeRecognition.last!;
    expect(rec.lang).toBe('fr-FR');
    expect(rec.start).toHaveBeenCalled();
    expect(r.current.listening).toBe(true);
    act(() => rec.onresult!({ resultIndex: 0, results: [result('toit ro', false)] }));
    expect(r.current.interim).toBe('toit ro');
    act(() => rec.onresult!({ resultIndex: 0, results: [result(' toit rouge ', true)] }));
    expect(onFinal).toHaveBeenCalledWith('toit rouge');
    act(() => r.current.stop());
    expect(r.current.listening).toBe(false);
    expect(r.current.interim).toBe('');
  });

  it('keeps the error to show it', () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    const { result: r } = renderHook(() => useVoiceInput('en', vi.fn()));
    act(() => r.current.start());
    act(() => FakeRecognition.last!.onerror!({ error: 'not-allowed' }));
    expect(r.current.error).toBe('not-allowed');
  });
});
