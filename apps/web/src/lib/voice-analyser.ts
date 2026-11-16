/** FFT size of the voice spectrum: ≈ 11.7 Hz per bin at 48 kHz, fine enough for voice pitch. */
export const VOICE_FFT_SIZE = 4096;

export interface VoiceAnalyser {
  ctx: AudioContext;
  node: AnalyserNode;
}

/**
 * Taps a microphone stream for a live spectrum (copilot chat, VR views chat). Null when Web Audio
 * is missing or refuses: the caller then simply shows no meter. The caller closes `ctx`.
 */
export function createVoiceAnalyser(stream: MediaStream): VoiceAnalyser | null {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  try {
    const ctx = new AudioContext();
    const node = ctx.createAnalyser();
    node.fftSize = VOICE_FFT_SIZE;
    node.smoothingTimeConstant = 0.6;
    node.minDecibels = -90;
    node.maxDecibels = -20;
    ctx.createMediaStreamSource(stream).connect(node);
    return { ctx, node };
  } catch {
    return null;
  }
}
