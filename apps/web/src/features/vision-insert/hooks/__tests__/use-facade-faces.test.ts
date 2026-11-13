import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FacadeData } from '../use-facade-2d';
import type { ShapeRequest } from '../use-object-shape';
import { useFacadeFaces, validatedFaces } from '../use-facade-faces';

const target = {
  id: 'det-1',
  label: 'house',
  category: 'other',
  box: { x: 0, y: 0, w: 1, h: 1 },
} as ShapeRequest;
const front: FacadeData = {
  imageUrl: 'https://r2/front.png',
  fileKey: 'front-1',
  prompt: '',
  archetype: 'house',
  detectionId: 'det-1',
  source: 'meta',
};

/** Each call answers with an image named after the face; records the references it got. */
const stubFetch = () => {
  const calls: Array<{ face: string; references: string[]; userPrompt?: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as (typeof calls)[number];
      calls.push(body);
      return {
        ok: true,
        json: async () => ({
          imageUrl: `https://r2/${body.face}.png`,
          fileKey: `${body.face}-1`,
          source: 'meta',
        }),
      };
    })
  );
  return calls;
};

describe('useFacadeFaces (PQ-T68)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws right → back → left, each seeing the front and the faces already there', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useFacadeFaces(target, front));
    await act(async () => {
      await result.current.generateAll();
    });
    expect(calls.map((c) => c.face)).toEqual(['side', 'back', 'left']);
    expect(calls[0]!.references).toEqual(['https://r2/front.png']);
    expect(calls[1]!.references).toEqual(['https://r2/front.png', 'https://r2/side.png']);
    expect(calls[2]!.references).toEqual([
      'https://r2/front.png',
      'https://r2/side.png',
      'https://r2/back.png',
    ]);
    expect(result.current.faces.left.status).toBe('ready');
  });

  it('validates face by face; a regenerated face is un-validated, the others stay', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useFacadeFaces(target, front));
    await act(async () => {
      await result.current.generateAll();
    });
    act(() => result.current.validateAll());
    expect(validatedFaces(result.current.faces)?.keys).toEqual({
      side: 'side-1',
      back: 'back-1',
      left: 'left-1',
    });
    await act(async () => {
      await result.current.generate('back', 'add a window');
    });
    expect(calls.at(-1)).toMatchObject({ face: 'back', userPrompt: 'add a window' });
    // The regenerated face saw the other two (3 references at most).
    expect(calls.at(-1)!.references).toHaveLength(3);
    expect(result.current.faces.back.validated).toBe(false);
    expect(result.current.faces.side.validated).toBe(true);
    expect(Object.keys(validatedFaces(result.current.faces)!.urls).sort()).toEqual([
      'left',
      'side',
    ]);
  });

  it('a failed face shows an error and stops « draw all » there', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }))
    );
    const { result } = renderHook(() => useFacadeFaces(target, front));
    await act(async () => {
      await result.current.generateAll();
    });
    expect(result.current.faces.side.status).toBe('error');
    expect(result.current.faces.back.status).toBe('idle');
    expect(validatedFaces(result.current.faces)).toBeUndefined();
  });

  it('another front starts from nothing, the first one keeps its faces', async () => {
    stubFetch();
    const { result, rerender } = renderHook(({ f }) => useFacadeFaces(target, f), {
      initialProps: { f: front },
    });
    await act(async () => {
      await result.current.generate('side');
    });
    rerender({ f: { ...front, fileKey: 'front-2' } });
    expect(result.current.faces.side.status).toBe('idle');
    rerender({ f: front });
    expect(result.current.faces.side.status).toBe('ready');
  });
});
