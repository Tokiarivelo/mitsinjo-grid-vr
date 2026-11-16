import { describe, expect, it } from 'vitest';
import { VOICE_METER_MIN, voiceBar } from '../utils/voice-meter';

describe('voiceBar (VS-T29)', () => {
  it('spreads the bars over the width and grows each from the bottom edge', () => {
    const first = voiceBar(0, 4, 0.4, 0.1, 1);
    const last = voiceBar(3, 4, 0.4, 0.1, 0.5);
    expect(first.x).toBeCloseTo(-0.15);
    expect(last.x).toBeCloseTo(0.15);
    expect(first.h).toBeCloseTo(0.1);
    expect(first.y).toBeCloseTo(0);
    expect(last.h).toBeCloseTo(0.05);
    expect(last.y - last.h / 2).toBeCloseTo(-0.05);
  });

  it('keeps a minimum bar in silence and clamps loud or bad levels', () => {
    expect(voiceBar(0, 4, 0.4, 0.1, 0).h).toBeCloseTo(VOICE_METER_MIN * 0.1);
    expect(voiceBar(0, 4, 0.4, 0.1, Number.NaN).h).toBeCloseTo(VOICE_METER_MIN * 0.1);
    expect(voiceBar(0, 4, 0.4, 0.1, 3).h).toBeCloseTo(0.1);
  });
});
