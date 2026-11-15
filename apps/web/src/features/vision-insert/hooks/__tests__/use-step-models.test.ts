import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStepModels } from '../use-step-models';

const payload = {
  defaults: {
    kit: 'muse-spark-1.3',
    parts: 'muse-spark-1.3',
    critic: 'muse-spark-1.3',
    viewsCheck: 'muse-spark-1.3',
    askPart: 'muse-spark-1.3',
    code: 'muse-wonder-1.0',
    judge: 'muse-wonder-1.0',
  },
  models: ['muse-spark-1.3', 'muse-wonder-1.0'],
  selection: null,
};

describe('useStepModels (PQ-T67)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads once, then saves the choice back', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        init?.method === 'PUT' ? { selection: JSON.parse(init.body as string).selection } : payload,
    }));
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useStepModels('global'));
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.defaults).toEqual(payload.defaults);
    await act(async () => {
      await result.current.load();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    let saved = false;
    await act(async () => {
      saved = await result.current.save({ code: 'muse-spark-1.3' });
    });
    expect(saved).toBe(true);
    expect(result.current.selection).toEqual({ code: 'muse-spark-1.3' });
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/vision/shape/step-models',
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('a failed load or save is reported, not thrown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    );
    const { result } = renderHook(() => useStepModels('global'));
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.status).toBe('error');
    let saved = true;
    await act(async () => {
      saved = await result.current.save({});
    });
    expect(saved).toBe(false);
    expect(result.current.failedSave).toBe(true);
  });
});
