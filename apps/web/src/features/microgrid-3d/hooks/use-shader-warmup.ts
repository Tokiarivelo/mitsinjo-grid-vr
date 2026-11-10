import { useEffect, useState } from 'react';
import type * as THREE from 'three';

/** Longest wait for the shaders before the canvas shows anyway. */
export const WARMUP_TIMEOUT_MS = 1000;
/** How often the compiling programs are checked (same as three's `compileAsync`). */
const POLL_MS = 10;

/** What `<Canvas onCreated>` hands over: the renderer, its scene and camera. */
export interface WarmupTarget {
  gl: Partial<Pick<THREE.WebGLRenderer, 'compile' | 'properties'>>;
  scene: THREE.Object3D;
  camera: THREE.Camera;
}

interface ProgramProps {
  currentProgram?: { isReady?: () => boolean };
}

/**
 * Shader warm-up (PT-7): once a canvas exists, compile every material of its scene (`gl.compile`, parallel
 * where the driver has `KHR_parallel_shader_compile`), so the first visible frame does not stall on shader
 * linking. `ready` turns true when every program is linked, on failure, or after `timeoutMs`, whichever
 * comes first: fade the canvas in on it.
 *
 * Not `gl.compileAsync`: its poll reads `currentProgram.isReady()` without a guard, so a material disposed
 * while compiling (canvas unmounted, Fast Refresh, entering VR) throws
 * "Cannot read properties of undefined (reading 'isReady')" from a timer. This poll skips disposed materials
 * and stops on unmount.
 */
export function useShaderWarmup(
  target: WarmupTarget | null,
  timeoutMs = WARMUP_TIMEOUT_MS
): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!target) return;
    let done = false;
    let poll: number | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(poll);
      setReady(true);
    };
    const timeout = window.setTimeout(finish, timeoutMs);

    const { compile, properties } = target.gl;
    let pending: Set<THREE.Material> | undefined;
    try {
      const out: unknown = compile?.call(target.gl, target.scene, target.camera);
      if (out instanceof Set) pending = out as Set<THREE.Material>;
    } catch {
      pending = undefined;
    }
    if (!pending || !properties) {
      finish();
    } else {
      const check = () => {
        if (done) return;
        try {
          for (const material of pending) {
            const program = (properties.get(material) as ProgramProps).currentProgram;
            // No program any more = material disposed meanwhile: nothing left to wait for.
            if (!program?.isReady || program.isReady()) pending.delete(material);
          }
        } catch {
          pending.clear();
        }
        if (pending.size === 0) finish();
        else poll = window.setTimeout(check, POLL_MS);
      };
      check();
    }

    return () => {
      done = true;
      window.clearTimeout(timeout);
      window.clearTimeout(poll);
    };
  }, [target, timeoutMs]);
  return ready;
}
