import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { leaveImmersionFor, useImmersionQuery } from '../use-immersion-query';

const go = (url: string) => window.history.replaceState(null, '', url);

describe('useImmersionQuery', () => {
  afterEach(() => go('/'));

  it('writes ?immersion=vr while immersed and removes it on exit, keeping other params', () => {
    go('/simulation?perf=1');
    const { rerender } = renderHook(({ on }) => useImmersionQuery({ immersion: on }), {
      initialProps: { on: true },
    });
    expect(window.location.search).toBe('?perf=1&immersion=vr');
    rerender({ on: false });
    expect(window.location.search).toBe('?perf=1');
  });

  it('follows the /village studio desk', () => {
    go('/village');
    const { rerender } = renderHook(
      ({ lab }: { lab: '2d' | '3d' | null }) => useImmersionQuery({ immersion: true, lab }),
      { initialProps: { lab: null as '2d' | '3d' | null } }
    );
    expect(window.location.search).toBe('?immersion=vr');
    rerender({ lab: '2d' });
    expect(window.location.search).toBe('?immersion=vr&lab=2d');
    rerender({ lab: '3d' });
    expect(window.location.search).toBe('?immersion=vr&lab=3d');
  });

  it('arriving on an immersion URL asks the page to open it instead of stripping it', () => {
    go('/village?immersion=vr&lab=2d');
    const onArrive = vi.fn();
    renderHook(() => useImmersionQuery({ immersion: false }, onArrive));
    expect(onArrive).toHaveBeenCalledWith({ immersion: true, lab: '2d' });
    expect(window.location.search).toBe('?immersion=vr&lab=2d');
  });

  it('the page left for another immersion keeps its hands off the URL (VS-T36 regression)', () => {
    // Before: « Go to the simulation » ended the /village session, its hook wrote `/village`
    // back with replaceState and Next.js dropped the pending push to /simulation.
    go('/village?immersion=vr&lab=3d');
    const village = renderHook(({ on }) => useImmersionQuery({ immersion: on, lab: '3d' }), {
      initialProps: { on: true },
    });
    leaveImmersionFor('/simulation?immersion=vr');
    village.rerender({ on: false });
    expect(window.location.search).toBe('?immersion=vr&lab=3d');
    village.unmount();
    // The next page arrives: it owns the URL again.
    go('/simulation?immersion=vr');
    const sim = renderHook(({ on }) => useImmersionQuery({ immersion: on }), {
      initialProps: { on: true },
    });
    expect(window.location.search).toBe('?immersion=vr');
    sim.rerender({ on: false });
    expect(window.location.search).toBe('');
  });
});
