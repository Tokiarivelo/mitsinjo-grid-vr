import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePanoramaTour } from '../tour/use-panorama-tour';
import { expectedDetectionsFor } from '../../../utils/expected-detections';

describe('usePanoramaTour (VS-T14)', () => {
  it('starts in the loft with no arrows until the first frame sets the heading', () => {
    const { result } = renderHook(() => usePanoramaTour(true));
    expect(result.current.room).toBe('loft');
    expect(result.current.arrows).toEqual([]);
    act(() => result.current.arrive('loft', 0.8));
    expect(result.current.arrows).toHaveLength(2);
  });

  it('walks through an arrow id once (a second request during the fade is ignored)', () => {
    const { result } = renderHook(() => usePanoramaTour(true));
    act(() => result.current.arrive('loft', 0.8));
    act(() => {
      expect(result.current.walkThrough('tour-link:bedroom')).toBe(true);
      result.current.walk('hall');
    });
    expect(result.current.pending).toBe('bedroom');
    expect(result.current.walkThrough('not-an-arrow')).toBe(false);
    act(() => result.current.arrive('bedroom', 0.2));
    expect(result.current.room).toBe('bedroom');
    expect(result.current.pending).toBeNull();
  });

  it('scans: remembers the ground truth for the photo and keeps its surface while in the room', () => {
    const { result } = renderHook(() => usePanoramaTour(true));
    const expected = [
      {
        id: 'loft-fridge',
        label: 'Fridge',
        category: 'fridge' as const,
        box: { x: 0.4, y: 0.4, w: 0.1, h: 0.2 },
      },
    ];
    act(() => {
      result.current.arrive('loft', 0.8);
      result.current.registerCapture(vi.fn(() => ({ url: 'data:scan-1', expected })));
    });
    let shot: ReturnType<typeof result.current.scan> = null;
    act(() => {
      shot = result.current.scan(0, 0);
    });
    expect(shot!.url).toBe('data:scan-1');
    expect(expectedDetectionsFor('data:scan-1')).toEqual(expected);
    expect(result.current.surface).not.toBeNull();
    act(() => result.current.arrive('bedroom', 0.2));
    expect(result.current.surface).toBeNull(); // another room: old scan targets hidden
  });

  it('no capture registered yet → no scan', () => {
    const { result } = renderHook(() => usePanoramaTour(true));
    expect(result.current.scan(0, 0)).toBeNull();
  });
});
