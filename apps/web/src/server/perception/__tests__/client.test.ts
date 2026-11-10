import { describe, expect, it, vi } from 'vitest';
import { SpendGuard } from '@/server/spend';
import type { PerceptionBackend } from '../backend';
import { failureOf, PerceptionClient } from '../client';
import { MOCK_DETECTIONS, MockPerceptionBackend } from '../mock';

const image = 'data:image/png;base64,AA';

function fakeMeta(overrides: Partial<PerceptionBackend> = {}): PerceptionBackend {
  return {
    name: 'meta',
    transcribe: vi.fn(),
    segmentImage: vi.fn(),
    detectAppliances: vi.fn(),
    identifyRegion: vi.fn(),
    describeShape: vi.fn(),
    describeParts: vi.fn(),
    criticizeShape: vi.fn(),
    checkViews: vi.fn(),
    judgeShape: vi.fn(),
    analyzeImage: vi.fn().mockResolvedValue({
      model: 'muse-spark-1.3',
      usage: { inputTokens: 1000, outputTokens: 100 },
      result: { summary: 'Clear sky', observations: [] },
    }),
    ...overrides,
  };
}

describe('PerceptionClient', () => {
  it('uses Meta when configured and records the cost', async () => {
    const guard = new SpendGuard(1);
    const client = new PerceptionClient(fakeMeta(), new MockPerceptionBackend(), guard, 's1');
    const out = await client.analyzeImage(image, 'sky?');
    expect(out).toEqual({
      summary: 'Clear sky',
      observations: [],
      source: 'meta',
      model: 'muse-spark-1.3',
    });
    expect(guard.spentUsd('s1')).toBeGreaterThan(0);
  });

  it('falls back to the mock on a Meta error', async () => {
    const meta = fakeMeta({ analyzeImage: vi.fn().mockRejectedValue(new Error('HTTP 500')) });
    const client = new PerceptionClient(meta, new MockPerceptionBackend(), new SpendGuard(1), 's1');
    const out = await client.analyzeImage(image, 'Quel est le ciel ?');
    expect(out.source).toBe('mock');
    expect(out.fallback).toBe('provider_error');
    expect(out.observations[0]?.label).toBe('cloud_cover');
  });

  it('uses the mock without calling Meta once the spend cap is reached', async () => {
    const meta = fakeMeta();
    const client = new PerceptionClient(meta, new MockPerceptionBackend(), new SpendGuard(0), 's1');
    const out = await client.analyzeImage(image, 'sky?');
    expect(meta.analyzeImage).not.toHaveBeenCalled();
    expect(out.fallback).toBe('spend_cap');
  });

  it('marks results not_configured when Meta is wanted without a key, plain mock otherwise', async () => {
    const missingKey = new PerceptionClient(
      null,
      new MockPerceptionBackend(),
      new SpendGuard(1),
      's1',
      true
    );
    expect((await missingKey.segmentImage(image, 'roof')).fallback).toBe('not_configured');

    const mockMode = new PerceptionClient(
      null,
      new MockPerceptionBackend(),
      new SpendGuard(1),
      's1'
    );
    const out = await mockMode.segmentImage(image, 'roof');
    expect(out.source).toBe('mock');
    expect(out.fallback).toBeUndefined();
  });

  it('detection: a malformed Meta reply falls back to the mock fixture, flagged', async () => {
    const meta = fakeMeta({
      detectAppliances: vi
        .fn()
        .mockRejectedValue(new Error('Appliance detection reply is not valid JSON')),
    });
    const client = new PerceptionClient(meta, new MockPerceptionBackend(), new SpendGuard(1), 's1');
    const out = await client.detectAppliances(image);
    expect(out.source).toBe('mock');
    expect(out.fallback).toBe('provider_error');
    expect(out.detections).toEqual(MOCK_DETECTIONS);
  });
});

describe('PerceptionClient transient retry', () => {
  const shape = {
    model: 'muse-spark-1.3',
    usage: { inputTokens: 10, outputTokens: 5 },
    result: {},
  };

  it('a dropped connection (fetch failed) is retried once, then Meta answers', async () => {
    const describeShape = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(shape);
    const client = new PerceptionClient(
      fakeMeta({ describeShape }),
      new MockPerceptionBackend(),
      new SpendGuard(1),
      's1'
    );
    const out = await client.describeShape(image, { label: 'House', category: 'other' });
    expect(describeShape).toHaveBeenCalledTimes(2);
    expect(out.source).toBe('meta');
  });

  it('two network failures in a row → mock, flagged network', async () => {
    const describeShape = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = new PerceptionClient(
      fakeMeta({ describeShape }),
      new MockPerceptionBackend(),
      new SpendGuard(1),
      's1'
    );
    const out = await client.describeShape(image, { label: 'House', category: 'other' });
    expect(describeShape).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ source: 'mock', fallback: 'provider_error', failure: 'network' });
  });

  it('a timeout is not retried (the time budget is already spent)', async () => {
    const describeShape = vi.fn().mockRejectedValue(new DOMException('t', 'TimeoutError'));
    const client = new PerceptionClient(
      fakeMeta({ describeShape }),
      new MockPerceptionBackend(),
      new SpendGuard(1),
      's1'
    );
    await client.describeShape(image, { label: 'House', category: 'other' });
    expect(describeShape).toHaveBeenCalledTimes(1);
  });
});

describe('failureOf (why Meta failed)', () => {
  it('tells a time limit, a closed browser, an HTTP error and a network error apart', () => {
    expect(failureOf(new DOMException('t', 'TimeoutError'))).toBe('timeout');
    expect(failureOf(new DOMException('a', 'AbortError'))).toBe('aborted');
    expect(
      failureOf(new Error('Meta perception API error (429) on /chat/completions: slow down'))
    ).toBe('http_429');
    expect(failureOf(new TypeError('fetch failed'))).toBe('network');
  });

  it('a timed-out Meta call → mock answer with fallback + failure', async () => {
    const meta = fakeMeta({
      describeShape: vi.fn().mockRejectedValue(new DOMException('t', 'TimeoutError')),
    });
    const client = new PerceptionClient(meta, new MockPerceptionBackend(), new SpendGuard(1), 's1');
    const out = await client.describeShape(image, { label: 'Lamp', category: 'lamp' });
    expect(out).toMatchObject({ source: 'mock', fallback: 'provider_error', failure: 'timeout' });
  });
});
