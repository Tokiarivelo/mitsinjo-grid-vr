import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  playLaserShootSound,
  playTargetHitSound,
  playGridConnectSound,
  playGridDisconnectSound,
  playScanRadarSound,
  _resetAudioContextForTesting,
} from '../xr-audio-fx';

describe('XR Audio FX', () => {
  let fakeContext: { createOscillator: ReturnType<typeof vi.fn> } & Record<string, unknown>;
  let originalAudioContext: unknown;
  const g = globalThis as unknown as { AudioContext?: unknown };

  beforeEach(() => {
    _resetAudioContextForTesting();
    fakeContext = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => ({
        type: 'sine',
        frequency: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      })),
      resume: vi.fn(),
    };

    originalAudioContext = g.AudioContext;
    g.AudioContext = vi.fn(() => fakeContext);
  });

  afterEach(() => {
    g.AudioContext = originalAudioContext;
  });

  it('plays laser blaster shoot sound without error', () => {
    expect(() => playLaserShootSound()).not.toThrow();
    expect(fakeContext.createOscillator).toHaveBeenCalled();
  });

  it('plays target hit sound without error', () => {
    expect(() => playTargetHitSound()).not.toThrow();
    expect(fakeContext.createOscillator).toHaveBeenCalled();
  });

  it('plays grid connect sound chord without error', () => {
    expect(() => playGridConnectSound()).not.toThrow();
    expect(fakeContext.createOscillator).toHaveBeenCalled();
  });

  it('plays grid disconnect sound without error', () => {
    expect(() => playGridDisconnectSound()).not.toThrow();
    expect(fakeContext.createOscillator).toHaveBeenCalled();
  });

  it('plays scan radar sonar sound without error', () => {
    expect(() => playScanRadarSound()).not.toThrow();
    expect(fakeContext.createOscillator).toHaveBeenCalled();
  });
});
