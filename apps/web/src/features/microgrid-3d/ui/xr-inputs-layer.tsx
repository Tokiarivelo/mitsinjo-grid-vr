'use client';

import { useEffect } from 'react';
import type * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { applyInputLayer, useXrInputsShown, xrNear } from '../utils/xr-inputs-shown';

/**
 * Mount once in each canvas that can enter VR (VS-T30): keeps the camera's input-model layer in
 * step with the « hands & controllers » choice (shown by default), and pulls the near clip plane
 * in while presenting so hands and controllers ~0.4 m from the eyes are not clipped away (the
 * /simulation camera's 0.5 m near plane hid them). Restored when the session ends.
 */
export function XrInputsLayer() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const shown = useXrInputsShown((s) => s.shown);

  useEffect(() => {
    applyInputLayer(camera, shown);
    invalidate();
  }, [camera, shown, invalidate]);

  useEffect(() => {
    // Read from the store (not the hook value) to set the near plane in place.
    const cam = get().camera as THREE.Camera & {
      near?: number;
      updateProjectionMatrix?: () => void;
    };
    if (typeof cam.near !== 'number') return;
    let before: number | null = null;
    const onStart = () => {
      before = cam.near!;
      cam.near = xrNear(before);
      cam.updateProjectionMatrix?.();
    };
    const onEnd = () => {
      if (before === null) return;
      cam.near = before;
      before = null;
      cam.updateProjectionMatrix?.();
    };
    if (gl.xr.isPresenting) onStart();
    gl.xr.addEventListener('sessionstart', onStart);
    gl.xr.addEventListener('sessionend', onEnd);
    return () => {
      gl.xr.removeEventListener('sessionstart', onStart);
      gl.xr.removeEventListener('sessionend', onEnd);
      onEnd();
    };
  }, [camera, gl, get]);
  return null;
}
