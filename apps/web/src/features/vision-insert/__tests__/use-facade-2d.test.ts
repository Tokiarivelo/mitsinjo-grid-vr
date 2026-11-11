import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShapeTarget } from '@/lib/object-shape';
vi.mock('../utils/prepare-image', () => ({
  prepareVisionImage: vi.fn(async () => new Blob([new Uint8Array(4)], { type: 'image/jpeg' })),
}));

import { useFacade2d, validatedFacade } from '../index';

const house: ShapeTarget = {
  id: 'det-1',
  label: 'House',
  category: 'other',
  scenery: 'building',
  box: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 },
};
const shed: ShapeTarget = { ...house, id: 'det-2', label: 'Shed' };
const reply = (id: string) =>
  new Response(
    JSON.stringify({
      ok: true,
      imageUrl: `https://r2.example/${id}.png`,
      fileKey: `vision/facades/${id}.png`,
      prompt: 'p',
      archetype: 'house',
      detectionId: id,
      source: 'mock',
    })
  );

const originalFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
    reply(JSON.parse((init.body as FormData).get('target') as string).id)
  );
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe('useFacade2d', () => {
  it('each object keeps its own facade; a new photo forgets them', async () => {
    const { result, rerender } = renderHook(({ photo, target }) => useFacade2d(photo, target), {
      initialProps: { photo: 'data:image/png;base64,P1', target: house },
    });
    await act(() => result.current.generate());
    expect(result.current.status).toBe('ready');
    expect(validatedFacade(result.current.facade)).toEqual({
      url: 'https://r2.example/det-1.png',
      key: 'vision/facades/det-1.png',
    });

    // Another object: no facade carried over (it would be sent with the wrong 3D request).
    rerender({ photo: 'data:image/png;base64,P1', target: shed });
    expect(result.current.status).toBe('idle');
    expect(result.current.facade).toBeUndefined();

    // Back to the house: its facade, without a new Muse call.
    rerender({ photo: 'data:image/png;base64,P1', target: house });
    expect(result.current.facade?.fileKey).toBe('vision/facades/det-1.png');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // New photo (ids repeat across photos): nothing kept.
    rerender({ photo: 'data:image/png;base64,P2', target: house });
    expect(result.current.status).toBe('idle');
  });

  it('a clean front is remembered with its request: « Retry » asks for a clean front again (PQ-T23)', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const id = JSON.parse(form.get('target') as string).id as string;
      const body = (await reply(id).json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...body, clean: form.has('cleanFront') }));
    });
    const request = { hiddenBy: ['hedge'], visibleParts: ['wheel'] };
    const props = { photo: 'data:image/png;base64,P1', target: house };
    const first = renderHook(({ photo, target }) => useFacade2d(photo, target, undefined, 'kept'), {
      initialProps: props,
    });
    await act(() => first.result.current.generate(undefined, request));
    expect(validatedFacade(first.result.current.facade)).toMatchObject({ clean: true });
    first.unmount();

    // Back on the page (kept session): the retry of that drawing still carries the request.
    const again = renderHook(({ photo, target }) => useFacade2d(photo, target, undefined, 'kept'), {
      initialProps: props,
    });
    expect(again.result.current.facade?.clean).toBe(true);
    await act(async () => again.result.current.retry('four doors'));
    const sent = fetchMock.mock.calls.at(-1)![1].body as FormData;
    expect(JSON.parse(sent.get('cleanFront') as string)).toEqual(request);
    expect(sent.get('userPrompt')).toBe('four doors');

    // A plain facade asked afterwards is not a clean front any more.
    await act(() => again.result.current.generate());
    expect(again.result.current.facade?.clean).toBeUndefined();
    expect(validatedFacade(again.result.current.facade)).not.toHaveProperty('clean');
  });
});
