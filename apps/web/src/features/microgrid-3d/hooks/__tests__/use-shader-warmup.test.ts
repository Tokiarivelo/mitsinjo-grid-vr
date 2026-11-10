import * as THREE from 'three';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShaderWarmup, WARMUP_TIMEOUT_MS, type WarmupTarget } from '../use-shader-warmup';

/** Fake renderer: `compile` hands back the materials; each program says whether it is linked. */
function fakeRenderer(count = 2) {
  const materials = Array.from({ length: count }, () => new THREE.MeshBasicMaterial());
  const linked = new Map(materials.map((m) => [m, false]));
  const props = new Map<THREE.Material, { currentProgram?: { isReady: () => boolean } }>(
    materials.map((m) => [m, { currentProgram: { isReady: () => linked.get(m)! } }])
  );
  const compile = vi.fn(() => new Set<THREE.Material>(materials));
  const target: WarmupTarget = {
    gl: {
      compile,
      properties: { get: (m: THREE.Material) => props.get(m) ?? {} },
    } as unknown as WarmupTarget['gl'],
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
  };
  return { target, compile, materials, linked, props };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useShaderWarmup (PT-7)', () => {
  it('waits for a target, compiles its scene once and turns ready when every program is linked', () => {
    const r = fakeRenderer();
    const { result, rerender } = renderHook(({ tg }) => useShaderWarmup(tg), {
      initialProps: { tg: null as WarmupTarget | null },
    });
    expect(r.compile).not.toHaveBeenCalled();
    rerender({ tg: r.target });
    expect(r.compile).toHaveBeenCalledWith(r.target.scene, r.target.camera);
    expect(result.current).toBe(false);

    r.linked.set(r.materials[0]!, true);
    act(() => vi.advanceTimersByTime(20));
    expect(result.current).toBe(false);
    r.linked.set(r.materials[1]!, true);
    act(() => vi.advanceTimersByTime(20));
    expect(result.current).toBe(true);
    rerender({ tg: r.target });
    expect(r.compile).toHaveBeenCalledOnce();
  });

  it('a material disposed while compiling counts as done, with no isReady error', () => {
    const r = fakeRenderer();
    const { result } = renderHook(() => useShaderWarmup(r.target));
    // Disposed: three drops its properties, so there is no program any more.
    r.props.delete(r.materials[0]!);
    r.linked.set(r.materials[1]!, true);
    expect(() => act(() => vi.advanceTimersByTime(20))).not.toThrow();
    expect(result.current).toBe(true);
  });

  it('stops checking once unmounted', () => {
    const r = fakeRenderer(1);
    const isReady = vi.fn(() => false);
    r.props.set(r.materials[0]!, { currentProgram: { isReady } });
    const { unmount } = renderHook(() => useShaderWarmup(r.target));
    act(() => vi.advanceTimersByTime(30));
    const calls = isReady.mock.calls.length;
    unmount();
    vi.advanceTimersByTime(WARMUP_TIMEOUT_MS * 2);
    expect(isReady.mock.calls.length).toBe(calls);
  });

  it('shows the canvas anyway after the timeout', () => {
    const r = fakeRenderer();
    const { result } = renderHook(() => useShaderWarmup(r.target));
    act(() => vi.advanceTimersByTime(WARMUP_TIMEOUT_MS - 1));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('a failed compile still shows the canvas', () => {
    const r = fakeRenderer();
    r.compile.mockImplementation(() => {
      throw new Error('lost');
    });
    const { result } = renderHook(() => useShaderWarmup(r.target));
    expect(result.current).toBe(true);
  });

  it('no compile (old renderer): ready at once', () => {
    const r = fakeRenderer();
    const { result } = renderHook(() => useShaderWarmup({ ...r.target, gl: {} }));
    expect(result.current).toBe(true);
  });
});
