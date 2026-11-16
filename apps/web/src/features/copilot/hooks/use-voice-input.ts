import { useCallback, useEffect, useRef, useState } from 'react';
import { toVoiceWav } from '../utils/wav';
import { createSpeechEndDetector } from '../utils/voice-activity';
import { createVoiceAnalyser } from '@/lib/voice-analyser';

export { VOICE_FFT_SIZE } from '@/lib/voice-analyser';

/** Longest recording; the route refuses more (60 s of 16 kHz WAV). */
export const VOICE_MAX_MS = 60_000;
/** Microphone energy sampling step for hands-free end-of-speech detection. */
const VOICE_SAMPLE_MS = 100;

export type VoiceStatus = 'idle' | 'recording' | 'transcribing';
/** i18n keys under `features.copilot.voice`. */
export type VoiceErrorKey = 'unsupported' | 'denied' | 'failed' | 'empty';

export interface UseVoiceInputOptions {
  locale: string;
  sessionId?: string;
  /** Receives the transcribed text (shown in the input, editable before sending). */
  onText: (text: string) => void;
  /** Hands-free mode (M3-T5): called with the transcript right after onText, to send at once. */
  onAutoSend?: (text: string) => void;
}

/** RMS energy (0–1) of a time-domain byte buffer. */
function rmsEnergy(buffer: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = (buffer[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * Chat microphone: tap to record, tap again to stop. The audio is turned into WAV and sent to
 * `/api/voice` (Meta Voice or the offline mock). Works in every browser with `MediaRecorder`,
 * unlike the Web Speech API (missing in Firefox and most Linux Chromium builds).
 */
export function useVoiceInput({ locale, sessionId, onText, onAutoSend }: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<VoiceErrorKey | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** Live spectrum of the microphone while recording (null when Web Audio is missing). */
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);
  /** Hands-free mode (M3-T5, off by default): silence ends the turn, the transcript auto-sends. */
  const [handsFree, setHandsFree] = useState(false);
  const handsFreeRef = useRef(false);
  const onAutoSendRef = useRef(onAutoSend);
  useEffect(() => {
    onAutoSendRef.current = onAutoSend;
  }, [onAutoSend]);
  const toggleHandsFree = useCallback(() => {
    setHandsFree((v) => {
      handsFreeRef.current = !v;
      return !v;
    });
  }, []);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const speechEndRef = useRef(createSpeechEndDetector());
  const sampleRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const supported =
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const transcribe = useCallback(
    async (recording: Blob) => {
      setStatus('transcribing');
      try {
        const form = new FormData();
        form.append('audio', await toVoiceWav(recording), 'voice.wav');
        form.append('locale', locale);
        if (sessionId) form.append('sessionId', sessionId);
        const res = await fetch('/api/voice', { method: 'POST', body: form });
        if (!res.ok) throw new Error(`voice ${res.status}`);
        const data = (await res.json()) as { text?: string };
        const text = data.text?.trim();
        if (text) {
          onTextRef.current(text);
          if (handsFreeRef.current) onAutoSendRef.current?.(text);
        } else setError('empty');
      } catch {
        setError('failed');
      } finally {
        setStatus('idle');
      }
    },
    [locale, sessionId]
  );

  /** Taps the microphone for the spectrum display. Optional: recording works without it. */
  const openAnalyser = useCallback((stream: MediaStream) => {
    const tap = createVoiceAnalyser(stream);
    audioCtxRef.current = tap?.ctx ?? null;
    analyserNodeRef.current = tap?.node ?? null;
    setAnalyser(tap?.node ?? null);
  }, []);

  const closeAnalyser = useCallback(() => {
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    analyserNodeRef.current = null;
    setAnalyser(null);
  }, []);

  const stop = useCallback(() => {
    clearTimeout(timerRef.current);
    clearInterval(sampleRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError('unsupported');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('denied');
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      closeAnalyser();
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      const recording = new Blob(chunks, { type: recorder.mimeType });
      if (recording.size === 0) {
        setStatus('idle');
        setError('empty');
        return;
      }
      void transcribe(recording);
    };
    recorderRef.current = recorder;
    openAnalyser(stream);
    recorder.start();
    setStatus('recording');
    timerRef.current = setTimeout(stop, VOICE_MAX_MS);
    // Hands-free sampling: silence after speech stops the turn (needs Web Audio).
    speechEndRef.current.reset();
    clearInterval(sampleRef.current);
    sampleRef.current = setInterval(() => {
      if (!handsFreeRef.current) return;
      const node = analyserNodeRef.current;
      if (!node) return;
      const buffer = new Uint8Array(node.fftSize);
      node.getByteTimeDomainData(buffer);
      if (speechEndRef.current.push(rmsEnergy(buffer), Date.now())) stop();
    }, VOICE_SAMPLE_MS);
  }, [supported, transcribe, stop, openAnalyser, closeAnalyser]);

  const toggle = useCallback(() => {
    if (status === 'recording') stop();
    else if (status === 'idle') void start();
  }, [status, start, stop]);

  // Leaving the page while recording releases the microphone.
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      clearInterval(sampleRef.current);
      const rec = recorderRef.current;
      if (rec?.state === 'recording') {
        rec.onstop = null;
        rec.stop();
        rec.stream.getTracks().forEach((t) => t.stop());
      }
      void audioCtxRef.current?.close().catch(() => undefined);
    },
    []
  );

  return {
    status,
    error,
    supported,
    toggle,
    analyser,
    handsFree,
    toggleHandsFree,
    clearError: () => setError(null),
  };
}
