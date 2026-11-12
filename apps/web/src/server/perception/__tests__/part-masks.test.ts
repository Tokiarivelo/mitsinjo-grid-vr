// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { SegmentInstance, SegmentResult } from '../schemas';
import { fetchPartMasks, PART_CONCEPTS, PART_MASKS_PER_CONCEPT } from '../part-masks';

const inst = (x1: number, x2: number, extra?: Partial<SegmentInstance>): SegmentInstance => ({
  box: { x1, y1: 10, x2, y2: 30 },
  ...extra,
});

const seg = (
  concept: string,
  instances: SegmentInstance[],
  extra?: Partial<SegmentResult>
): SegmentResult => ({
  source: 'meta',
  model: 'sam-3.1',
  concept,
  imageWidth: 100,
  imageHeight: 100,
  instances,
  count: instances.length,
  boxCoverage: 0.1,
  ...extra,
});

describe('fetchPartMasks (PR-2.5)', () => {
  it('vehicle: wheel + window segmented in parallel on the crop', async () => {
    const seen: string[] = [];
    const segmentImage = vi.fn(async (_url: string, concept: string) => {
      seen.push(concept);
      return seg(concept, [
        inst(10, 30, { confidence: 0.9, outline: 'M0.1 0.1L0.3 0.1L0.3 0.3Z' }),
      ]);
    });
    const masks = await fetchPartMasks(segmentImage, 'data:crop', 'vehicle');
    expect(seen.sort()).toEqual([...PART_CONCEPTS.vehicle].sort());
    expect(segmentImage.mock.calls.every((c) => c[0] === 'data:crop')).toBe(true);
    expect(masks).toHaveLength(2);
    // Inclusive pixels → crop fractions (x1/w … (x2+1)/w).
    expect(masks[0]!.concept).toBe('wheel');
    expect(masks[0]!.box.x).toBeCloseTo(0.1, 6);
    expect(masks[0]!.box.y).toBeCloseTo(0.1, 6);
    expect(masks[0]!.box.w).toBeCloseTo(0.21, 6);
    expect(masks[0]!.box.h).toBeCloseTo(0.21, 6);
    expect(masks[0]!.outline).toBe('M0.1 0.1L0.3 0.1L0.3 0.3Z');
    expect(masks[1]!.concept).toBe('window');
  });

  it('a failed concept contributes nothing, the others still land', async () => {
    const segmentImage = vi.fn(async (_url: string, concept: string) => {
      if (concept === 'wheel') throw new Error('boom');
      return seg(concept, [inst(0, 10)]);
    });
    const masks = await fetchPartMasks(segmentImage, 'data:crop', 'vehicle');
    expect(masks.map((m) => m.concept)).toEqual(['window']);
  });

  it('a hanging concept is dropped at the deadline, the batch still resolves', async () => {
    const segmentImage = vi.fn(
      (_url: string, concept: string, signal?: AbortSignal) =>
        new Promise<SegmentResult>((resolve, reject) => {
          if (concept === 'wheel') {
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
            return; // hangs until the abort
          }
          resolve(seg(concept, [inst(0, 10)]));
        })
    );
    const t0 = Date.now();
    const masks = await fetchPartMasks(segmentImage, 'data:crop', 'vehicle', { timeoutMs: 30 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(masks.map((m) => m.concept)).toEqual(['window']);
  });

  it('only real SAM answers count: mock source and fallbacks are ignored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const segmentImage = vi.fn(async (_url: string, concept: string) =>
        concept === 'wheel'
          ? seg(concept, [inst(0, 10)], { source: 'mock' })
          : seg(concept, [inst(0, 10)], { fallback: 'provider_error' })
      );
      await expect(fetchPartMasks(segmentImage, 'data:crop', 'vehicle')).resolves.toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the 8 most confident instances per concept', async () => {
    const instances = Array.from({ length: 10 }, (_, i) => inst(i, i + 5, { confidence: i / 10 }));
    const segmentImage = vi.fn(async (_url: string, concept: string) => seg(concept, instances));
    const masks = await fetchPartMasks(segmentImage, 'data:crop', 'lamp_post');
    expect(masks).toHaveLength(PART_MASKS_PER_CONCEPT);
    expect(masks.map((m) => m.box.x)).toEqual([0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02]);
  });

  it('archetypes without concepts never call SAM; unreadable boxes are dropped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const segmentImage = vi.fn(async (_url: string, concept: string) => seg(concept, []));
      await expect(fetchPartMasks(segmentImage, 'data:crop', 'tree')).resolves.toEqual([]);
      expect(segmentImage).not.toHaveBeenCalled();

      const bad = vi.fn(async (_url: string, concept: string) =>
        seg(concept, [inst(50, 50)], { imageWidth: 0, imageHeight: 0 })
      );
      await expect(fetchPartMasks(bad, 'data:crop', 'lamp_post')).resolves.toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('fetchPartMasks miss causes (FIX 1)', () => {
  const silenced = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('every concept missed → one warn naming each cause', async () => {
    const warn = silenced();
    try {
      const segmentImage = vi.fn(async (_url: string, concept: string) => {
        if (concept === 'wheel') throw new Error('boom');
        return seg(concept, []);
      });
      await expect(fetchPartMasks(segmentImage, 'data:crop', 'vehicle')).resolves.toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = warn.mock.calls[0]![0] as string;
      expect(msg).toContain('[vision] 3D part masks missed for "vehicle"');
      expect(msg).toContain('wheel call failed');
      expect(msg).toContain('window SAM found nothing');
    } finally {
      warn.mockRestore();
    }
  });

  it('a hanging concept reports a timeout; a partial batch stays silent', async () => {
    const warn = silenced();
    try {
      const hanging = vi.fn(() => new Promise<SegmentResult>(() => {}));
      await expect(
        fetchPartMasks(hanging, 'data:crop', 'lamp_post', { timeoutMs: 20 })
      ).resolves.toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        '[vision] 3D part masks missed for "lamp_post": lamp timed out'
      );

      warn.mockClear();
      const partial = vi.fn(async (_url: string, concept: string) => {
        if (concept === 'wheel') throw new Error('boom');
        return seg(concept, [inst(0, 10)]);
      });
      const masks = await fetchPartMasks(partial, 'data:crop', 'vehicle');
      expect(masks.map((m) => m.concept)).toEqual(['window']);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('part concepts are named in the panel (PQ-T37, PR #10 review)', () => {
  it('every photo-path SAM concept has a `model3dPart` label', async () => {
    const en = (await import('@/messages/en.json')).default;
    const labels = Object.keys(en.features.visionInsert.model3dPart);
    const concepts = [...new Set(Object.values(PART_CONCEPTS).flat())];
    expect(concepts.filter((c) => !labels.includes(c))).toEqual([]);
  });

  it('every SAM word of the Muse cards has a label, in the three languages', async () => {
    const { CARD_TEXT } = await import('../skills/cards.generated');
    const { listedConcept } = await import('../object-graph');
    const { partLabelKey } = await import('@/lib/object-shape');
    const words = new Set<string>();
    for (const text of Object.values(CARD_TEXT)) {
      const list = text.match(/^SAM words: (.+)\.$/m)?.[1];
      for (const w of list?.split(/,\s*/) ?? []) words.add(partLabelKey(listedConcept(w)));
    }
    expect(words.size).toBeGreaterThan(40);
    for (const locale of ['en', 'fr', 'mg'] as const) {
      const messages = (await import(`@/messages/${locale}.json`)).default;
      const labels = Object.keys(messages.features.visionInsert.model3dPart);
      expect(
        [...words].filter((w) => !labels.includes(w)),
        locale
      ).toEqual([]);
    }
  });
});

describe('part masks timing and retry (PQ-T9)', () => {
  it('the deadline is a share of the time left, bounded — null when unbounded', async () => {
    const { partMasksTimeout } = await import('../part-masks');
    expect(partMasksTimeout(60_000)).toBe(8000);
    expect(partMasksTimeout(20_000)).toBe(5000);
    expect(partMasksTimeout(2_000)).toBe(3000);
    expect(partMasksTimeout(-5)).toBe(3000);
    expect(partMasksTimeout(null)).toBeNull();
    expect(partMasksTimeout(Infinity)).toBeNull();
  });

  it('an empty first answer is asked again with another phrasing', async () => {
    const { fetchPartMasks } = await import('../part-masks');
    const asked: string[] = [];
    const seg = (concept: string, n: number) => ({
      source: 'meta' as const,
      model: 'sam-3.1',
      concept,
      imageWidth: 100,
      imageHeight: 100,
      instances: Array.from({ length: n }, () => ({
        box: { x1: 10, y1: 10, x2: 30, y2: 30 },
        confidence: 0.9,
      })),
      count: n,
      boxCoverage: 0,
    });
    const masks = await fetchPartMasks(
      async (_u: string, c: string) => {
        asked.push(c);
        return seg(c, c === 'tire' ? 2 : 0);
      },
      'data:x',
      'vehicle',
      { concepts: ['wheel'] }
    );
    expect(asked).toEqual(['wheel', 'tire']);
    expect(masks).toHaveLength(2);
    expect(masks[0]!.concept).toBe('wheel');
  });
});
