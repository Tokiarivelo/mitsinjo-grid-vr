import { describe, expect, it, vi } from 'vitest';
import { fetchOutlineForBox } from '../outline';
import { pickConsensus, type OutlineCandidate } from '../sam-consensus';
import type { SegmentResult } from '../schemas';

const cand = (concept: string, box: OutlineCandidate['box'], score: number): OutlineCandidate => ({
  concept,
  outline: `M${concept}`,
  box,
  score,
});
const tight = { x: 0.2, y: 0.4, w: 0.3, h: 0.2 };

describe('pickConsensus (PQ-T9)', () => {
  it('two phrasings agree → kept, best overlap first', () => {
    const r = pickConsensus([
      cand('car', tight, 0.8),
      cand('vintage car', { ...tight, x: 0.205 }, 0.9),
    ]);
    expect(r?.why).toBe('agreed');
    expect(r?.agreeing).toBe(2);
    expect(r?.pick.concept).toBe('vintage car');
  });

  it('they disagree → the mask inside the box wins (Toy-Mini: one answer merges car and hedge)', () => {
    const merged = { x: 0.05, y: 0.3, w: 0.9, h: 0.4 };
    const r = pickConsensus([cand('car', merged, 0.35), cand('mini car', tight, 0.85)]);
    expect(r?.why).toBe('inside');
    expect(r?.pick.concept).toBe('mini car');
  });

  it('the majority beats a merged answer even when the merged one overlaps most', () => {
    const merged = { x: 0.05, y: 0.3, w: 0.9, h: 0.4 };
    const r = pickConsensus([
      cand('a', tight, 0.7),
      cand('b', { ...tight, y: 0.405 }, 0.68),
      cand('c', merged, 0.75),
    ]);
    expect(r?.pick.concept).toBe('a');
    expect(r?.agreeing).toBe(2);
  });

  it('one candidate → single; none over the minimum → null', () => {
    expect(pickConsensus([cand('car', tight, 0.9)])?.why).toBe('single');
    expect(pickConsensus([cand('car', tight, 0.1)])).toBeNull();
    expect(pickConsensus([])).toBeNull();
  });
});

describe('fetchOutlineForBox with consensus (PQ-T9)', () => {
  const box = { x: 0.2, y: 0.4, w: 0.3, h: 0.2 };
  const seg = (concept: string, b: [number, number, number, number] | null): SegmentResult => ({
    source: 'meta',
    model: 'sam-3.1',
    concept,
    imageWidth: 100,
    imageHeight: 100,
    instances: b
      ? [
          {
            box: { x1: b[0], y1: b[1], x2: b[2], y2: b[3] },
            outline: `M${concept}Z`,
            confidence: 0.9,
          },
        ]
      : [],
    count: b ? 1 : 0,
    boxCoverage: 0,
  });

  it('the merged first answer no longer wins: the tight phrasing does', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const answers: Record<string, SegmentResult> = {
        car: seg('car', [5, 30, 95, 70]),
        'mini car': seg('mini car', [20, 40, 49, 59]),
      };
      const out = await fetchOutlineForBox(
        async (_u, c) => answers[c] ?? seg(c, null),
        'data:x',
        'car',
        box,
        { retries: ['mini car'], consensus: true }
      );
      expect(out).toBe('Mmini carZ');
    } finally {
      info.mockRestore();
    }
  });

  it('all phrasings miss → null and the cause is reported once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = await fetchOutlineForBox(async (_u, c) => seg(c, null), 'data:x', 'pump', box, {
        retries: ['hand pump'],
        consensus: true,
      });
      expect(out).toBeNull();
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('consensus missed'))).toHaveLength(
        1
      );
    } finally {
      warn.mockRestore();
    }
  });
});
