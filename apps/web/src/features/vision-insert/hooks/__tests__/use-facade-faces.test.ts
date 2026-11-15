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

  it('draws right → back → left → above, each seeing the front and the faces already there', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useFacadeFaces(target, front));
    await act(async () => {
      await result.current.generateAll();
    });
    expect(calls.map((c) => c.face)).toEqual(['side', 'back', 'left', 'top']);
    expect(calls[0]!.references).toEqual(['https://r2/front.png']);
    expect(calls[1]!.references).toEqual(['https://r2/front.png', 'https://r2/side.png']);
    expect(calls[2]!.references).toEqual([
      'https://r2/front.png',
      'https://r2/side.png',
      'https://r2/back.png',
    ]);
    // The plan is drawn from the front and two elevations (3 references at most).
    expect(calls[3]!.references).toEqual([
      'https://r2/front.png',
      'https://r2/side.png',
      'https://r2/back.png',
    ]);
    expect(result.current.faces.top.status).toBe('ready');
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
      top: 'top-1',
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
      'top',
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

  it('a vehicle (PQ-T76): front → back → above → underside of its profile, never a left side', async () => {
    const calls = stubFetch();
    const car = { ...target, label: 'car' } as ShapeRequest;
    const profile: FacadeData = {
      ...front,
      imageUrl: 'https://r2/profile.png',
      archetype: 'vehicle',
    };
    const { result } = renderHook(() => useFacadeFaces(car, profile));
    expect(result.current.names).toEqual(['front', 'back', 'top', 'bottom']);
    await act(async () => {
      await result.current.generateAll();
    });
    expect(calls.map((c) => c.face)).toEqual(['front', 'back', 'top', 'bottom']);
    expect(calls[0]!.references).toEqual(['https://r2/profile.png']);
    // The plans are drawn from the elevations only, never from each other.
    expect(calls[3]!.references).toEqual([
      'https://r2/profile.png',
      'https://r2/front.png',
      'https://r2/back.png',
    ]);
    act(() => result.current.validateAll());
    expect(Object.keys(validatedFaces(result.current.faces)!.urls).sort()).toEqual([
      'back',
      'bottom',
      'front',
      'top',
    ]);
  });

  it('knows a car before its profile is drawn (archetype from the label)', () => {
    const { result } = renderHook(() =>
      useFacadeFaces({ ...target, label: 'pickup truck' } as ShapeRequest, undefined)
    );
    expect(result.current.names).toContain('bottom');
  });
});
