'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { HOLO } from './holo-style';
import { useXrWorld, worldShellBand } from './xr-world-switch';

/** Shell radius around the head (felt metres): beyond arm's reach, inside every panel's distance. */
const SHELL_RADIUS = 0.6;
/** Share of the height the noisy edge spans (as the lab's card). */
const SHELL_EDGE = 0.12;

const VERTEX = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/**
 * Masked, not blended (Meta WebXR guidance: alpha test keeps depth and costs no overdraw), like
 * the lab's 2D → 3D card: blocky noise crumbles the edge cell by cell, a glowing rim rides on it,
 * faint grid lines on the dome colour.
 */
const FRAGMENT = /* glsl */ `
uniform float uLow;
uniform float uHigh;
uniform float uEdge;
uniform float uRadius;
uniform vec3 uDome;
uniform vec3 uGrid;
uniform vec3 uRim;
varying vec3 vLocal;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float h = clamp(vLocal.y / uRadius * 0.5 + 0.5, 0.0, 1.0);
  float a = atan(vLocal.z, vLocal.x);
  float n = hash(floor(vec2(a * 24.0, h * 48.0)));
  float top = uHigh * (1.0 + uEdge) - n * uEdge;
  float bottom = uLow * (1.0 + uEdge) - n * uEdge;
  if (h > top || h < bottom) discard;
  float lines = step(0.94, fract(h * 24.0)) + step(0.96, fract(a * 6.0));
  vec3 col = mix(uDome, uGrid, clamp(lines, 0.0, 1.0));
  float rim = max(
    1.0 - smoothstep(0.0, uEdge * 0.5, top - h),
    (uLow > 0.001 ? 1.0 : 0.0) * (1.0 - smoothstep(0.0, uEdge * 0.5, h - bottom))
  );
  rim *= step(0.001, uHigh - uLow) * (uHigh < 0.999 || uLow > 0.001 ? 1.0 : 0.0);
  gl_FragColor = vec4(mix(col, uRim * 1.6, rim), 1.0);
}
`;

const _head = new THREE.Vector3();
const _scale = new THREE.Vector3();

/**
 * The lab ↔ village hand-over shell (VS-T49): a holographic dome around the viewer's head that
 * builds up from the floor over the old world, holds while the world swaps, then crumbles from
 * the floor onto the new one. Drawn over everything (no depth test), never moves the viewer.
 */
export const XrWorldTransition = memo(function XrWorldTransition() {
  const camera = useThree((s) => s.camera);
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.BackSide,
        // Sorted with the transparent panels (they draw after every opaque mesh), alpha stays 1:
        // render order 1000 puts the shell over the old world's panels too.
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uLow: { value: 0 },
          uHigh: { value: 0 },
          uEdge: { value: SHELL_EDGE },
          uRadius: { value: SHELL_RADIUS },
          uDome: { value: new THREE.Color(HOLO.dome) },
          uGrid: { value: new THREE.Color(HOLO.gridDim) },
          uRim: { value: new THREE.Color(HOLO.cyan) },
        },
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  // Dev only: lets `make vr-world-probe` ask for a world and read the shell (VS-T49).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as Window & { __VR_WORLD__?: unknown };
    w.__VR_WORLD__ = {
      state: () => {
        const { world, phase, target } = useXrWorld.getState();
        return { world, phase, target };
      },
      go: (target: 'lab' | 'village') => useXrWorld.getState().go(target),
      shell: () => Boolean(mesh.current?.visible),
    };
    return () => {
      delete w.__VR_WORLD__;
    };
  }, []);

  useFrame(() => {
    const store = useXrWorld.getState();
    store.step();
    const m = mesh.current;
    if (!m) return;
    const s = useXrWorld.getState();
    const band = worldShellBand(s, performance.now());
    m.visible = band.high > band.low;
    if (!m.visible) return;
    material.uniforms.uLow!.value = band.low;
    material.uniforms.uHigh!.value = band.high;
    // Centred on the head, felt size: the village rig shrinks the viewer (half-scale village).
    camera.getWorldPosition(_head);
    camera.getWorldScale(_scale);
    m.position.copy(_head);
    m.scale.setScalar(_scale.x);
  });

  return (
    <mesh ref={mesh} name="xr-world-shell" visible={false} renderOrder={1000} frustumCulled={false}>
      <sphereGeometry args={[SHELL_RADIUS, 48, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
});
