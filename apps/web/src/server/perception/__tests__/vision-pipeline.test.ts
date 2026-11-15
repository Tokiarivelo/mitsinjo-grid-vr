import sharp from 'sharp';
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
    // PQ-T42: each phase carries its duration.
    for (const c of emit.mock.calls) {
      expect(typeof c[1].ms).toBe('number');
      expect(c[1].ms).toBeGreaterThanOrEqual(0);
    }
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
        {
          phase: 'boxes',
          detections: [],
          // PQ-T47: without pixels the refusal carries the generic cause.
          route: { imageType: 'none', family: 'parametric', action: 'refuse', cause: 'no_object' },
          ms: expect.any(Number),
          source: 'meta',
          model: 'muse-spark-1.3',
        },
      ],
    ]);
    expect(segmentImage).not.toHaveBeenCalled();
  });

  it('nothing listed on a minuscule photo: refused too_small', async () => {
    const emit = vi.fn();
    const buffer = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer();
    await runVisionPipeline(
      { detectAppliances: async () => meta([]), segmentImage: vi.fn() },
      'data:x',
      emit,
      undefined,
      { buffer, width: 40, height: 30 }
    );
    expect(emit.mock.calls[0]![1].route).toEqual({
      imageType: 'none',
      family: 'parametric',
      action: 'refuse',
      cause: 'too_small',
    });
  });

  it('nothing listed on a flat photo: refused too_blurry; on a sharp one: no_object', async () => {
    const flat = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer();
    // Checkerboard: edges everywhere, sharpness high.
    const board = await sharp({
      create: {
        width: 320,
        height: 240,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="320" height="240">${Array.from({ length: 8 }, (_, j) =>
              Array.from({ length: 8 }, (_, i) =>
                (i + j) % 2
                  ? `<rect x="${i * 40}" y="${j * 30}" width="40" height="30" fill="white"/>`
                  : ''
              ).join('')
            ).join('')}</svg>`
          ),
        },
      ])
      .jpeg()
      .toBuffer();
    const perception = (detections: never[]) => ({
      detectAppliances: async () => meta(detections),
      segmentImage: vi.fn(),
    });
    const emitFlat = vi.fn();
    await runVisionPipeline(perception([]), 'data:x', emitFlat, undefined, {
      buffer: flat,
      width: 320,
      height: 240,
    });
    expect(emitFlat.mock.calls[0]![1].route.cause).toBe('too_blurry');
    const emitBoard = vi.fn();
    await runVisionPipeline(perception([]), 'data:x', emitBoard, undefined, {
      buffer: board,
      width: 320,
      height: 240,
    });
    expect(emitBoard.mock.calls[0]![1].route).toMatchObject({
      action: 'refuse',
      cause: 'no_object',
    });
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
