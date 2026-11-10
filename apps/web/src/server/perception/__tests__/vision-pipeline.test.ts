import { describe, expect, it, vi } from 'vitest';
import { MOCK_DETECTIONS } from '../mock';
import type { DetectionResult, SegmentResult } from '../schemas';
import { runVisionPipeline, withExpectedDetections } from '../vision-pipeline';

const meta = (detections = MOCK_DETECTIONS): DetectionResult => ({
  source: 'meta',
  model: 'muse-spark-1.3',
  detections,
});

const fridgeSeg: SegmentResult = {
  source: 'meta',
  model: 'sam-3.1',
  concept: 'fridge',
  imageWidth: 1000,
  imageHeight: 1000,
  instances: [
    { box: { x1: 60, y1: 220, x2: 259, y2: 879 }, outline: 'M0.06 0.22L0.26 0.22L0.26 0.88Z' },
  ],
  count: 1,
  boxCoverage: 0.13,
};

describe('runVisionPipeline (PV-T6)', () => {
  it('Meta: emits boxes first, then outlines refined by SAM', async () => {
    const emit = vi.fn();
    const segmentImage = vi.fn(async (_u: string, concept: string) =>
      concept === 'fridge' ? fridgeSeg : { ...fridgeSeg, concept, instances: [], count: 0 }
    );
    await runVisionPipeline({ detectAppliances: async () => meta(), segmentImage }, 'data:x', emit);

    expect(emit.mock.calls.map((c) => [c[0], c[1].phase])).toEqual([
      ['vision_detections', 'boxes'],
      ['vision_detections', 'outlines'],
    ]);
    const outlines = emit.mock.calls[1]![1];
    expect(outlines.refined).toBe(1);
    expect(outlines.detections[0].outline).toBe('M0.06 0.22L0.26 0.22L0.26 0.88Z');
    expect(segmentImage).toHaveBeenCalledTimes(MOCK_DETECTIONS.length);
  });

  it('mock or fallback answer: boxes only, no SAM call', async () => {
    const emit = vi.fn();
    const segmentImage = vi.fn();
    await runVisionPipeline(
      {
        detectAppliances: async () => ({ ...meta(), source: 'mock', fallback: 'spend_cap' }),
        segmentImage,
      },
      'data:x',
      emit
    );
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![1].fallback).toBe('spend_cap');
    expect(segmentImage).not.toHaveBeenCalled();
  });

  it('no appliance on the photo: one empty event, no SAM call', async () => {
    const emit = vi.fn();
    const segmentImage = vi.fn();
    await runVisionPipeline(
      { detectAppliances: async () => meta([]), segmentImage },
      'data:x',
      emit
    );
    expect(emit.mock.calls).toEqual([
      [
        'vision_detections',
        { phase: 'boxes', detections: [], source: 'meta', model: 'muse-spark-1.3' },
      ],
    ]);
    expect(segmentImage).not.toHaveBeenCalled();
  });

  it('an unexpected error becomes vision_error, never a throw', async () => {
    const emit = vi.fn();
    await runVisionPipeline(
      {
        detectAppliances: async () => {
          throw new Error('boom');
        },
        segmentImage: vi.fn(),
      },
      'data:x',
      emit
    );
    expect(emit.mock.calls).toEqual([
      ['vision_error', { code: 'VISION_FAILED', message: 'Appliance detection failed' }],
    ]);
  });

  it('hosted link refused by Meta: retries once with the inline photo, SAM gets the inline photo too', async () => {
    const emit = vi.fn();
    const detectAppliances = vi.fn(async (url: string) =>
      url.startsWith('https://')
        ? { ...meta(), source: 'mock' as const, fallback: 'provider_error' as const }
        : meta()
    );
    const segmentImage = vi.fn(async (_u: string, concept: string) => ({
      ...fridgeSeg,
      concept,
      instances: [],
      count: 0,
    }));
    await runVisionPipeline(
      { detectAppliances, segmentImage },
      { url: 'https://r2.example/vision/a.jpg', inlineUrl: 'data:image/jpeg;base64,AA' },
      emit
    );
    expect(detectAppliances.mock.calls.map((c) => c[0])).toEqual([
      'https://r2.example/vision/a.jpg',
      'data:image/jpeg;base64,AA',
    ]);
    expect(emit.mock.calls[0]![1].source).toBe('meta');
    expect(segmentImage.mock.calls.every((c) => c[0] === 'data:image/jpeg;base64,AA')).toBe(true);
  });

  it('hosted link that works: one detection call, SAM reads the same link', async () => {
    const detectAppliances = vi.fn(async () => meta());
    const segmentImage = vi.fn(async (_u: string, concept: string) => ({
      ...fridgeSeg,
      concept,
      instances: [],
      count: 0,
    }));
    await runVisionPipeline(
      { detectAppliances, segmentImage },
      { url: 'https://r2.example/vision/a.jpg', inlineUrl: 'data:x' },
      vi.fn()
    );
    expect(detectAppliances).toHaveBeenCalledTimes(1);
    expect(segmentImage.mock.calls.every((c) => c[0] === 'https://r2.example/vision/a.jpg')).toBe(
      true
    );
  });
});

describe('withExpectedDetections (VS-T14, 360° test tour)', () => {
  const fridge = {
    ...MOCK_DETECTIONS[0]!,
    id: 'loft-fridge',
    box: { x: 0.6, y: 0.4, w: 0.05, h: 0.2 },
  };
  const segmentImage = vi.fn();

  it('replaces a mock answer with the labelled objects in view', async () => {
    const detectAppliances = vi.fn(async (): Promise<DetectionResult> => ({
      source: 'mock',
      model: 'mock',
      detections: MOCK_DETECTIONS,
    }));
    const out = await withExpectedDetections({ detectAppliances, segmentImage }, [
      fridge,
    ]).detectAppliances('img');
    expect(out.detections).toEqual([fridge]);
    expect(out.source).toBe('mock');
  });

  it('never touches a Meta answer, and is a no-op without expected objects', async () => {
    const detectAppliances = vi.fn(async () => meta());
    const p = { detectAppliances, segmentImage };
    expect((await withExpectedDetections(p, [fridge]).detectAppliances('img')).detections).toEqual(
      MOCK_DETECTIONS
    );
    expect(withExpectedDetections(p, undefined)).toBe(p);
  });
});
