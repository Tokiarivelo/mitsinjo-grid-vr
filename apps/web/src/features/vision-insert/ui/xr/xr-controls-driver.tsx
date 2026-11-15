'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  createControlMemory,
  readControls,
  snapshotSources,
  type XrControlAction,
} from './xr-controls';

/**
 * Reads the buttons, sticks and thumb microgestures of every XR input each frame and hands the
 * discrete actions to `onAction` (VS-T23). No React state in the loop; nothing off the headset.
 */
export const XrControlsDriver = memo(function XrControlsDriver({
  onAction,
}: {
  onAction: (action: XrControlAction) => void;
}) {
  const { gl } = useThree();
  const memory = useMemo(() => createControlMemory(), []);
  const handler = useRef(onAction);
  useEffect(() => {
    handler.current = onAction;
  }, [onAction]);

  useFrame((state) => {
    const session = gl.xr?.isPresenting ? gl.xr.getSession?.() : null;
    if (!session) {
      memory.clear();
      return;
    }
    const actions = readControls(
      snapshotSources(session.inputSources),
      memory,
      state.clock.elapsedTime
    );
    for (const a of actions) handler.current(a);
  });
  return null;
});
