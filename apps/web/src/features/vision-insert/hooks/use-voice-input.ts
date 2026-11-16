'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createVoiceAnalyser } from '@/lib/voice-analyser';

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
  /** Live microphone spectrum while listening (the voice level meter); null otherwise. */
  analyser: AnalyserNode | null;
  start: () => void;
  stop: () => void;
}

/**
 * Dictation for the VR chat (VS-T27): the Web Speech API, one utterance per press; each settled
 * phrase goes to `onFinal`. Unsupported browsers report `supported: false` and the caller falls
 * back to the system keyboard's own dictation (Meta: « WebXR system keyboard »). While listening,
 * the microphone is also tapped for the level meter (VS-T29); without it dictation still works.
 */
export function useVoiceInput(locale: string, onFinal: (text: string) => void): VoiceInput {
  const [supported] = useState(() => recognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const rec = useRef<Recognition | null>(null);
  const mic = useRef<{ stream: MediaStream; ctx: AudioContext } | null>(null);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  });

  const closeMic = useCallback(() => {
    const m = mic.current;
    mic.current = null;
    m?.stream.getTracks().forEach((t) => t.stop());
    void m?.ctx.close().catch(() => undefined);
    setAnalyser(null);
  }, []);

  /** Taps the microphone for the meter; dropped if listening ended before it opened. */
  const openMic = useCallback(() => {
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) return;
    media.getUserMedia({ audio: true }).then(
      (stream) => {
        const tap = rec.current ? createVoiceAnalyser(stream) : null;
        if (!tap) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mic.current = { stream, ctx: tap.ctx };
        setAnalyser(tap.node);
      },
      () => undefined
    );
  }, []);

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
      closeMic();
    };
    rec.current = r;
    setError(null);
    setListening(true);
    try {
      r.start();
      openMic();
    } catch {
      rec.current = null;
      setListening(false);
      setError('start');
    }
  }, [locale, openMic, closeMic]);

  useEffect(
    () => () => {
      rec.current?.abort();
      closeMic();
    },
    [closeMic]
  );

  return { supported, listening, interim, error, analyser, start, stop };
}
