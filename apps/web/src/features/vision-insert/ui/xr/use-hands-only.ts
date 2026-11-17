'use client';

import { useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { handsOnly } from './xr-nav-pad';

/**
 * True while the XR session is driven by hands only (no controller): read from the live input
 * sources each frame, React state written only when it changes. False off the headset.
 */
export function useHandsOnly(): boolean {
  const gl = useThree((s) => s.gl);
  const [only, setOnly] = useState(false);
  useFrame(() => {
    const session = gl.xr?.isPresenting ? gl.xr.getSession?.() : null;
    const next = session ? handsOnly(session.inputSources) : false;
    if (next !== only) setOnly(next);
  });
  return only;
}
