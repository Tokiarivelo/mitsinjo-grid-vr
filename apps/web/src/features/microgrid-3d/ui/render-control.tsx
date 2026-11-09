'use client';

import { memo, useEffect, useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';

/**
 * Bakes the sun shadow map instead of re-rendering it every frame. Every shadow caster
 * is static, so the map is re-rendered only when `bakeKey` changes identity (sun, data).
 * Mount it after the casters (inside their Suspense) so the bake includes them.
 */
export function ShadowBake({ bakeKey }: { bakeKey: unknown }) {
  const get = useThree((s) => s.get);

  useLayoutEffect(() => {
    const { shadowMap } = get().gl;
    shadowMap.autoUpdate = false;
    return () => {
      shadowMap.autoUpdate = true;
    };
  }, [get]);

  useEffect(() => {
    const state = get();
    state.gl.shadowMap.needsUpdate = true;
    state.invalidate();
  }, [get, bakeKey]);

  return null;
}

/**
 * Renders one frame when the paused canvas (`frameloop="never"`, off-screen) resumes,
 * so animations that request their own next frame start again.
 */
export function ResumeOnVisible() {
  const frameloop = useThree((s) => s.frameloop);
  const size = useThree((s) => s.size as { width: number; height: number } | undefined);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (frameloop !== 'never') invalidate();
  }, [frameloop, size?.width, size?.height, invalidate]);
  return null;
}

/**
 * Low-tier ground shadow, rendered once. drei's `ContactShadows` keeps its `frames` counter
 * in a local variable that resets on every React re-render, so `frames={1}` re-renders the
 * whole scene (depth pass + 4 blur passes) after each parent render: timeline step, selection,
 * `?perf=1` overlay. Memoized without props, it never re-renders, so it really bakes once.
 */
export const BakedContactShadows = memo(function BakedContactShadows() {
  return (
    <ContactShadows
      position={[0, 0.01, 0]}
      opacity={0.55}
      scale={44}
      blur={1.8}
      far={8}
      frames={1}
      color="#1a1408"
    />
  );
});
