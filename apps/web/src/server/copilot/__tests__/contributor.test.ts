import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseModel,
  contributorVariant,
  fetchPreferringContributor,
  pauseContributor,
  resetContributorPauses,
} from '../providers/contributor';

const response = (status: number) => ({ ok: status < 400, status }) as Response;

beforeEach(() => resetContributorPauses());

describe('contributor model preference', () => {
  it('only Spark 1.2 / 1.3 have a contributor variant', () => {
    expect(contributorVariant('muse-spark-1.3')).toBe('muse-spark-1.3-contributor');
    expect(contributorVariant('muse-spark-1.2')).toBe('muse-spark-1.2-contributor');
    expect(contributorVariant('muse-spark-1.1')).toBeNull();
    expect(contributorVariant('muse-wonder-1.0')).toBeNull();
  });

  it('picks the contributor id only when preferred and not paused', () => {
    expect(chooseModel('muse-spark-1.3', true, 0)).toBe('muse-spark-1.3-contributor');
    expect(chooseModel('muse-spark-1.3', false, 0)).toBe('muse-spark-1.3');
    pauseContributor('muse-spark-1.3-contributor', 429, 0);
    expect(chooseModel('muse-spark-1.3', true, 30_000)).toBe('muse-spark-1.3');
    expect(chooseModel('muse-spark-1.3', true, 61_000)).toBe('muse-spark-1.3-contributor');
  });

  it('resends on the standard model after a rate limit, then skips the contributor', async () => {
    const send = vi.fn().mockResolvedValueOnce(response(429)).mockResolvedValue(response(200));
    const first = await fetchPreferringContributor('muse-spark-1.3', true, send);
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      'muse-spark-1.3-contributor',
      'muse-spark-1.3',
    ]);
    expect(first).toMatchObject({ model: 'muse-spark-1.3', res: { ok: true } });

    send.mockClear();
    await fetchPreferringContributor('muse-spark-1.3', true, send);
    expect(send.mock.calls.map((c) => c[0])).toEqual(['muse-spark-1.3']);
  });

  it('does not retry other errors, nor a standard model', async () => {
    const send = vi.fn().mockResolvedValue(response(500));
    const out = await fetchPreferringContributor('muse-spark-1.3', true, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(out.model).toBe('muse-spark-1.3-contributor');

    const std = vi.fn().mockResolvedValue(response(429));
    await fetchPreferringContributor('muse-spark-1.3', false, std);
    expect(std).toHaveBeenCalledTimes(1);
  });

  it('a contributor id chosen on purpose falls back to its standard id, even with the preference off', async () => {
    const send = vi.fn().mockResolvedValueOnce(response(403)).mockResolvedValue(response(200));
    const out = await fetchPreferringContributor('muse-spark-1.3-contributor', false, send);
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      'muse-spark-1.3-contributor',
      'muse-spark-1.3',
    ]);
    expect(out.model).toBe('muse-spark-1.3');
    send.mockClear();
    await fetchPreferringContributor('muse-spark-1.3-contributor', false, send);
    expect(send.mock.calls.map((c) => c[0])).toEqual(['muse-spark-1.3']);
  });
});
