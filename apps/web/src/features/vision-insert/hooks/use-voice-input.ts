'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** The part of the Web Speech API the chat uses (Chromium ships it prefixed). */
interface RecognitionResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

/** Speech recognition constructor of this browser, or null (Quest Browser, Firefox, tests). */
export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Recognition language of an app locale; Malagasy is not offered by browsers: French. */
export const speechLang = (locale: string) =>
  locale.startsWith('fr') || locale.startsWith('mg') ? 'fr-FR' : 'en-US';

export interface VoiceInput {
  supported: boolean;
  listening: boolean;
  /** What is being heard and not settled yet (shown in the field meanwhile). */
  interim: string;
  /** Last failure (`not-allowed`, `no-speech`…), cleared on the next start. */
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Dictation for the VR chat (VS-T27): the Web Speech API, one utterance per press; each settled
 * phrase goes to `onFinal`. Unsupported browsers report `supported: false` and the caller falls
 * back to the system keyboard's own dictation (Meta: « WebXR system keyboard »).
 */
export function useVoiceInput(locale: string, onFinal: (text: string) => void): VoiceInput {
  const [supported] = useState(() => recognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  });

  const stop = useCallback(() => rec.current?.stop(), []);
  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = speechLang(locale);
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const said = res[0].transcript;
        if (res.isFinal) {
          if (said.trim()) onFinalRef.current(said.trim());
        } else pending += said;
      }
      setInterim(pending.trim());
    };
    r.onerror = (e) => setError(e.error);
    r.onend = () => {
      rec.current = null;
      setListening(false);
      setInterim('');
    };
    rec.current = r;
    setError(null);
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
      setError('start');
    }
  }, [locale]);

  useEffect(() => () => rec.current?.abort(), []);

  return { supported, listening, interim, error, start, stop };
}
