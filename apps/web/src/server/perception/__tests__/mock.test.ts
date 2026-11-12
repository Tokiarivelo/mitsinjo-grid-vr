import { describe, expect, it } from 'vitest';
import { MOCK_PERCEPTION_MODEL, MockPerceptionBackend } from '../mock';
import {
  DetectionResultSchema,
  SegmentResultSchema,
  TranscriptSchema,
  VisionResultSchema,
  type PerceptionSource,
} from '../schemas';

const mock = new MockPerceptionBackend();
const asMock: PerceptionSource = { source: 'mock', model: MOCK_PERCEPTION_MODEL };
/** 1 s of mono 16-bit PCM at 16 kHz plus the WAV header. */
const oneSecondWav = new Blob([new Uint8Array(44 + 32_000)], { type: 'audio/wav' });

describe('MockPerceptionBackend', () => {
  it('transcribes deterministically from the file name, with the audio duration', async () => {
    const fire = await mock.transcribe(oneSecondWav, { fileName: 'fire-school.wav' });
    expect(fire.result).toEqual({ text: "Au feu à l'école !", durationMs: 1000, turns: [] });
    expect(fire.usage).toEqual({});

    const other = await mock.transcribe(oneSecondWav, { fileName: 'take-1.wav' });
    expect(other.result.text).toContain('40 %');
    expect(TranscriptSchema.parse({ ...other.result, ...asMock })).toBeTruthy();
  });

  it('returns speaker turns in diarization mode', async () => {
    const { result } = await mock.transcribe(oneSecondWav, { diarize: true });
    expect(result.turns.map((t) => t.speaker)).toEqual(['A', 'B', 'A']);
    expect(result.turns.at(-1)?.endMs).toBeLessThanOrEqual(result.durationMs);
  });

  it('answers image questions by keyword and returns nothing otherwise', async () => {
    const sky = await mock.analyzeImage('data:image/png;base64,AA', 'Quel est le ciel ?');
    expect(sky.result.observations).toEqual([
      { label: 'cloud_cover', value: 60, unit: '%', confidence: 0.5 },
    ]);
    const smoke = await mock.analyzeImage('https://x/y.png', 'Is there smoke?');
    expect(smoke.result.observations[0]?.label).toBe('smoke');
    const dust = await mock.analyzeImage('https://x/y.png', 'Is there dust on the panels?');
    expect(dust.result.observations).toEqual([
      { label: 'dusty_panel', value: 25, unit: '%', confidence: 0.5 },
    ]);
    const none = await mock.analyzeImage('https://x/y.png', 'Describe this');
    expect(none.result.observations).toEqual([]);
    expect(VisionResultSchema.parse({ ...sky.result, ...asMock })).toBeTruthy();
  });

  it('segments two boxes with their coverage', async () => {
    const { result } = await mock.segmentImage('https://x/y.png', 'solar panel');
    expect(result.count).toBe(2);
    expect(result.boxCoverage).toBeGreaterThan(0);
    expect(result.boxCoverage).toBeLessThan(1);
    expect(SegmentResultSchema.parse({ ...result, ...asMock })).toBeTruthy();
  });

  it('detects the fixed sample-room appliances, valid and without power values', async () => {
    const a = await mock.detectAppliances();
    const b = await mock.detectAppliances();
    expect(a).toEqual(b);
    expect(a.result.detections.map((d) => d.category)).toEqual([
      'fridge',
      'tv',
      'lamp',
      'fan',
      'phone_charger',
    ]);
    expect(DetectionResultSchema.parse({ ...a.result, ...asMock })).toBeTruthy();
    for (const d of a.result.detections) {
      expect(d.box.x + d.box.w).toBeLessThanOrEqual(1);
      expect(d.box.y + d.box.h).toBeLessThanOrEqual(1);
    }
  });

  it('never patches: the critic round is a no-op without Meta', async () => {
    const out = await mock.criticizeShape('data:img', 'Patch?');
    expect(out.result).toEqual({ patch: null, missingParts: [] });
  });

  it('never imagines parts: the orchestrator keeps the kit recipe', async () => {
    const out = await mock.describeParts('data:img', { label: 'Guard', archetype: 'person' });
    expect(out.result).toEqual({ recipe: null });
    expect(out.usage).toEqual({});
  });
});
