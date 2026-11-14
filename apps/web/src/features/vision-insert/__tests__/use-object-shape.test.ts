import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_ANGLES,
  SHAPE_OUTLINE_MAX,
  type ObjectShape,
  type ShapeTarget,
} from '@/lib/object-shape';
vi.mock('../utils/prepare-image', () => ({
  prepareVisionImage: vi.fn(async () => new Blob([new Uint8Array(4)], { type: 'image/jpeg' })),
}));

import { useObjectShape } from '../index';

const target: ShapeTarget = {
  id: 'det-1',
  label: 'Fridge',
  category: 'fridge',
  box: { x: 0.1, y: 0.1, w: 0.2, h: 0.6 },
};
const recipeShape: ObjectShape = {
  detectionId: 'det-1',
  mode: 'recipe',
  recipe: {
    proportions: { w: 0.5, h: 1, d: 0.5 },
    parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#eeeeee', front: true }],
  },
  source: 'meta',
  model: 'muse-spark-1.3',
};

/** What the route streams: steps, then the shape. */
const sse = (shape: unknown) =>
  new Response(
    ['crop', 'model', 'fit']
      .map((step) => `event: shape_step\ndata: ${JSON.stringify({ step })}\n\n`)
      .join('') +
      `event: shape_result\ndata: ${JSON.stringify({ shape })}\n\nevent: done\ndata: {}\n\n`
  );

const originalFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe('useObjectShape (PV-T9)', () => {
  it('posts the photo and target, then holds the recipe', async () => {
    fetchMock.mockResolvedValue(sse(recipeShape));
    const { result } = renderHook(() => useObjectShape());
    expect(result.current.status).toBe('idle');
    act(() => {
      void result.current.requestShape('data:image/png;base64,AA', target, 's1');
    });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.shape).toEqual(recipeShape);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/vision/shape');
    const body = init.body as FormData;
    expect(JSON.parse(body.get('target') as string)).toEqual(target);
    expect(body.get('sessionId')).toBe('s1');
  });

  it('sends the SAM outline for the colour measure, not one past the limit (PF-T2)', async () => {
    fetchMock.mockImplementation(async () => sse(recipeShape));
    const { result } = renderHook(() => useObjectShape());
    const outline = 'M0.1 0.1L0.3 0.1L0.3 0.7Z';
    await act(() =>
      result.current.requestShape('data:image/png;base64,AA', { ...target, outline })
    );
    const sent = (i: number) =>
      JSON.parse(
        ((fetchMock.mock.calls[i] as [string, RequestInit])[1].body as FormData).get(
          'target'
        ) as string
      );
    expect(sent(0)).toEqual({ ...target, outline });
    const huge = `M0 0${'L0.5 0.5'.repeat(SHAPE_OUTLINE_MAX / 8 + 1)}Z`;
    await act(() =>
      result.current.requestShape('data:image/png;base64,AA', {
        ...target,
        id: 'det-9',
        outline: huge,
      })
    );
    expect(sent(1)).not.toHaveProperty('outline');
  });

  it('falls back to the silhouette on a network error, an HTTP error or a bad reply', async () => {
    for (const answer of [
      () => fetchMock.mockRejectedValueOnce(new Error('offline')),
      () => fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 })),
      () => fetchMock.mockResolvedValueOnce(sse({ mode: 'cube' })),
    ]) {
      answer();
      const { result } = renderHook(() => useObjectShape());
      await act(() => result.current.requestShape('data:image/png;base64,AA', target));
      expect(result.current).toMatchObject({
        status: 'ready',
        shape: { detectionId: 'det-1', mode: 'silhouette', reason: 'network' },
      });
    }
  });

  it('server-side failures (timeout…) are shown but not kept: a reselect asks again', async () => {
    const timeout = { ...recipeShape, mode: 'silhouette', recipe: undefined, reason: 'timeout' };
    fetchMock.mockImplementation(async () => sse(timeout));
    const { result } = renderHook(() => useObjectShape());
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    expect(result.current.shape?.reason).toBe('timeout');
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loading carries the server step and its start time', async () => {
    let finish: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (finish = r)));
    const { result } = renderHook(() => useObjectShape());
    act(() => {
      void result.current.requestShape('data:image/png;base64,AA', target);
    });
    expect(result.current).toMatchObject({ status: 'loading', step: 'crop' });
    expect(typeof result.current.startedAt).toBe('number');
    await act(async () => finish(sse(recipeShape)));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('keeps answers per object until clear(); offline silhouettes are retried', async () => {
    fetchMock.mockResolvedValue(sse(recipeShape));
    const { result } = renderHook(() => useObjectShape());
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    fetchMock.mockImplementation(async () => sse(recipeShape));
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.shape).toEqual(recipeShape);
    // A renamed object (manual shape identified) is a new request.
    await act(() =>
      result.current.requestShape('data:image/png;base64,AA', { ...target, label: 'Freezer' })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => result.current.clear());
    expect(result.current.status).toBe('idle');
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const other = { ...target, id: 'det-2' };
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await act(() => result.current.requestShape('data:image/png;base64,AA', other));
    expect(result.current.shape?.mode).toBe('silhouette');
    await act(() => result.current.requestShape('data:image/png;base64,AA', other));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('retry asks Spark again for the same object, skipping the kept answer', async () => {
    fetchMock.mockImplementation(async () => sse(recipeShape));
    const { result } = renderHook(() => useObjectShape());
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => result.current.retry());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('regenerate asks Spark again for the same object, skipping the kept answer', async () => {
    fetchMock.mockImplementation(async () => sse(recipeShape));
    const { result } = renderHook(() => useObjectShape());
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => result.current.regenerate());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('a validated facade is sent, asks again past a kept model, and stays for Regenerate', async () => {
    fetchMock.mockImplementation(async () => sse(recipeShape));
    const sent = (i: number) =>
      JSON.parse(
        ((fetchMock.mock.calls[i] as [string, RequestInit])[1].body as FormData).get(
          'target'
        ) as string
      ) as ShapeTarget;
    const { result } = renderHook(() => useObjectShape());
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    const facade = { facadeUrl: 'https://r2.example/f1.png', facadeKey: 'vision/facades/f1.png' };
    // Same object, now with a facade: the model made without it is not reused.
    await act(() =>
      result.current.requestShape('data:image/png;base64,AA', { ...target, ...facade })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(1)).toMatchObject(facade);
    // Same facade again → kept answer, no new call.
    await act(() =>
      result.current.requestShape('data:image/png;base64,AA', { ...target, ...facade })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Regenerate from a request without the facade fields still sends the remembered facade.
    await act(() =>
      result.current.requestShape('data:image/png;base64,AA', target, undefined, true)
    );
    expect(sent(2)).toMatchObject(facade);
    // New photo: the facade is forgotten.
    act(() => result.current.clear());
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    expect(sent(3).facadeUrl).toBeUndefined();
  });

  it('the family the operator picks becomes the hint of the next call and of every Regenerate (PQ-T41)', async () => {
    fetchMock.mockImplementation(async () => sse(recipeShape));
    const sent = (i: number) =>
      JSON.parse(
        ((fetchMock.mock.calls[i] as [string, RequestInit])[1].body as FormData).get(
          'target'
        ) as string
      ) as ShapeTarget;
    const { result } = renderHook(() => useObjectShape());
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    expect(sent(0).archetype).toBeUndefined();
    await act(async () => result.current.chooseFamily('cabinet'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sent(1).archetype).toBe('cabinet');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.regenerate());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(sent(2).archetype).toBe('cabinet');
    // New photo: the pick is forgotten.
    act(() => result.current.clear());
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    expect(sent(3).archetype).toBeUndefined();
  });

  it('requestViews previews the 6 angles once per object; a failure keeps direct generation', async () => {
    const views = CANONICAL_ANGLES.map((angle, i) => ({
      angle,
      labelKey: `angle${i}`,
      angleDeg: i * 90,
      description: `${angle} view`,
      imageUrl: 'data:image/png;base64,AA',
      features: ['a', 'b'],
    }));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, views, detectionId: 'det-1' }))
    );
    const { result } = renderHook(() => useObjectShape());
    await act(() => result.current.requestViews('data:image/png;base64,AA', target));
    expect(result.current).toMatchObject({ viewsStatus: 'ready', views });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/vision/views');
    await act(() => result.current.requestViews('data:image/png;base64,AA', target));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A reselect shows the kept preview without a new call.
    await act(() => result.current.peek({ ...target, id: 'det-2' }));
    expect(result.current.viewsStatus).toBe('idle');
    await act(() => result.current.peek(target));
    expect(result.current).toMatchObject({ viewsStatus: 'ready', views });
    // A failed preview falls back to idle: direct generation still works.
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const other = { ...target, id: 'det-3' };
    await act(() => result.current.requestViews('data:image/png;base64,AA', other));
    expect(result.current.viewsStatus).toBe('idle');
  });

  it('a box adjusted by hand is a new request; the flag is not sent', async () => {
    fetchMock.mockImplementation(async () => sse(recipeShape));
    const { result } = renderHook(() => useObjectShape());
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    const moved = { ...target, box: { ...target.box, w: 0.1 }, adjusted: true as const };
    await act(() => result.current.requestShape('data:image/png;base64,AA', moved));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as FormData;
    expect(JSON.parse(body.get('target') as string)).toEqual({ ...target, box: moved.box });
    // SAM refining an unadjusted box: same key, no new call.
    await act(() =>
      result.current.requestShape('data:image/png;base64,AA', {
        ...target,
        box: { ...target.box, x: 0.11 },
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('peek shows a kept shape, else stays idle and asks nothing', async () => {
    fetchMock.mockImplementation(async () => sse(recipeShape));
    const { result } = renderHook(() => useObjectShape());
    act(() => result.current.peek(target));
    expect(result.current.status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    act(() => result.current.reset());
    act(() => result.current.peek(target));
    expect(result.current).toMatchObject({ status: 'ready', shape: recipeShape });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reset goes back to idle', async () => {
    fetchMock.mockResolvedValue(sse(recipeShape));
    const { result } = renderHook(() => useObjectShape());
    await act(() => result.current.requestShape('data:image/png;base64,AA', target));
    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
  });
});

describe('useObjectShape code rounds (PQ-T60)', () => {
  const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const better = {
    ...recipeShape.recipe!,
    parts: [{ ...recipeShape.recipe!.parts[0]!, color: '#cc8844' }],
  };
  it('streams first-answer stage recipes as a live preview, cleared when the shape lands', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        const enc = new TextEncoder();
        c.enqueue(
          enc.encode(
            ev('shape_stage', {
              phase: 'first',
              index: 1,
              total: 4,
              stage: 'massing',
              state: 'running',
              kinds: ['wall'],
              recipe: better,
            })
          )
        );
        await gate;
        c.enqueue(enc.encode(ev('shape_result', { shape: recipeShape })));
        c.enqueue(enc.encode(ev('done', {})));
        c.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(body));
    const { result } = renderHook(() => useObjectShape());
    act(() => {
      void result.current.requestShape('data:image/png;base64,AA', target);
    });
    await waitFor(() => expect(result.current.preview).toEqual(better));
    expect(result.current.status).toBe('loading');
    expect(result.current.improve).toMatchObject({ status: 'running', stage: 'massing' });
    act(() => finish());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.preview).toBeUndefined();
    expect(result.current.shape).toEqual(recipeShape);
  });

  it('first-answer stages only: the model is final with the answer', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        ev('shape_stage', {
          phase: 'first',
          index: 4,
          total: 4,
          stage: 'accessories',
          state: 'done',
          before: 0.6,
          after: 0.7,
          stop: 'gate',
        }) +
          ev('shape_result', { shape: recipeShape }) +
          ev('done', {})
      )
    );
    const { result } = renderHook(() => useObjectShape());
    act(() => {
      void result.current.requestShape('data:image/png;base64,AA', target);
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.improve).toMatchObject({
      status: 'done',
      index: 4,
      before: 0.6,
      after: 0.7,
    });
  });
});

describe('useObjectShape restyle (PQ-T71)', () => {
  const drawnShape: ObjectShape = {
    ...recipeShape,
    recipe: {
      ...recipeShape.recipe!,
      faces: {
        atlas: 'data:image/png;base64,AAAA',
        views: ['front', 'right'],
        hull: { grid: [4, 4, 4], boxes: [[0, 4, 0, 4, 0, 4]] },
      },
    },
  };

  it('restyles a surface of a drawn model, with no server call, and keeps it on reselect', async () => {
    fetchMock.mockResolvedValue(sse(drawnShape));
    const { result } = renderHook(() => useObjectShape());
    act(() => {
      void result.current.requestShape('data:image/png;base64,AA', target);
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.restyle('roof', { material: 'tile', color: '#aa4422' }));
    expect(result.current.shape?.recipe?.faces?.surfaces).toEqual({
      roof: { material: 'tile', color: '#aa4422' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Another object, then back: the kept model still has the look.
    act(() => result.current.peek({ ...target, id: 'det-2' }));
    act(() => result.current.peek(target));
    expect(result.current.shape?.recipe?.faces?.surfaces?.roof?.material).toBe('tile');
    act(() => result.current.restyle('roof', null));
    expect(result.current.shape?.recipe?.faces?.surfaces).toBeUndefined();
  });

  it('does nothing on a model without drawings', async () => {
    fetchMock.mockResolvedValue(sse(recipeShape));
    const { result } = renderHook(() => useObjectShape());
    act(() => {
      void result.current.requestShape('data:image/png;base64,AA', target);
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.restyle('roof', { material: 'tile' }));
    expect(result.current.shape).toEqual(recipeShape);
  });
});
