'use client';

import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useHoloImage } from './holo-ui';
import { HOLO } from './holo-style';
import {
  cardLevel,
  dissolveLevel,
  dissolveProgress,
  dissolveSeeds,
  DISSOLVE_EDGE,
  DISSOLVE_GRAINS,
  DISSOLVE_MS,
  DISSOLVE_WAIT_MS,
  GRAIN_LIFE,
  labMotionProbe,
} from './lab-dissolve';

/**
 * Card fragment: masked, not blended (Meta WebXR guidance: alpha test keeps depth and costs no
 * overdraw). Blocky noise makes the edge crumble cell by cell; a glowing rim rides on it.
 */
const CARD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const CARD_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uLevel;
uniform float uEdge;
uniform vec3 uRim;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float n = hash(floor(vUv * 48.0));
  float cut = uLevel + (n - 0.5) * uEdge;
  if (vUv.y < cut) discard;
  vec4 tex = texture2D(uMap, vUv);
  float glow = 1.0 - smoothstep(0.0, uEdge * 0.6, vUv.y - cut);
  float frame = 1.0 - smoothstep(0.0, 0.03, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
  vec3 col = mix(tex.rgb, uRim, frame * 0.65);
  col = mix(col, uRim * 1.6, glow * step(0.001, uLevel));
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Grains: born where the line passes their height, they fall into the plate and fade. */
const GRAIN_VERTEX = /* glsl */ `
attribute vec3 aSeed;
uniform float uLevel;
uniform float uLife;
uniform float uWidth;
uniform float uBottom;
uniform float uHeight;
uniform float uSize;
varying float vAge;
void main() {
  float age = (uLevel - aSeed.y) / uLife;
  vAge = age;
  float y0 = uBottom + aSeed.y * uHeight;
  vec3 p = vec3(
    aSeed.x * uWidth + sin(aSeed.z * 40.0 + age * 6.0) * 0.02,
    mix(y0, 0.0, clamp(age, 0.0, 1.0) * clamp(age, 0.0, 1.0)),
    (aSeed.z - 0.5) * 0.04 + age * 0.03
  );
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  bool live = age > 0.0 && age < 1.0;
  gl_PointSize = live ? uSize * (1.0 - age) / max(-mv.z, 0.05) : 0.0;
  gl_Position = projectionMatrix * mv;
}
`;
const GRAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTail;
varying float vAge;
void main() {
  if (vAge <= 0.0 || vAge >= 1.0) discard;
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(mix(uColor, uTail, vAge), (1.0 - vAge) * (1.0 - d * 2.0));
}
`;

export interface LabDissolveProps {
  /** The validated main drawing (never the photo). Without it only the model rises. */
  cardUrl?: string;
  /** Card side (m) and its centre height above the plate: where the build hologram stood. */
  cardSize: number;
  cardY: number;
  /** The model's root (its meshes get the rising clip plane while the hand-over runs). */
  model: RefObject<THREE.Object3D | null>;
}

/**
 * 2D → 3D hand-over on the lab pedestal (rendered in the pedestal's group, y 0 = plate top): the
 * drawn card crumbles bottom-up into the plate, its grains falling in, while the model appears
 * below the same line behind a glowing ring. One plane, one point cloud, one ring; the model keeps
 * its materials (a clip plane is added, then taken off). Gone for good once done.
 */
export const LabDissolve = memo(function LabDissolve({
  cardUrl,
  cardSize,
  cardY,
  model,
}: LabDissolveProps) {
  const get = useThree((s) => s.get);
  const { texture, state } = useHoloImage(cardUrl);
  const self = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const run = useRef({ mounted: -1, start: -1, done: false });
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  const clipped = useRef(new Map<THREE.Material, THREE.Plane[] | null>());
  const scratch = useMemo(
    () => ({ box: new THREE.Box3(), v: new THREE.Vector3(), size: new THREE.Vector3() }),
    []
  );

  // Uniforms held apart, typed: the frame loop writes them, the materials read them.
  const live = useMemo(
    () => ({
      map: { value: null as THREE.Texture | null },
      card: { value: 0 },
      grain: { value: 0 },
    }),
    []
  );
  const card = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CARD_VERTEX,
        fragmentShader: CARD_FRAGMENT,
        uniforms: {
          uMap: live.map,
          uLevel: live.card,
          uEdge: { value: DISSOLVE_EDGE },
          uRim: { value: new THREE.Color(HOLO.cyan) },
        },
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [live]
  );
  const grains = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    // Positions are computed in the shader; the attribute only sizes the draw.
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(DISSOLVE_GRAINS * 3), 3)
    );
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(dissolveSeeds(), 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: GRAIN_VERTEX,
      fragmentShader: GRAIN_FRAGMENT,
      uniforms: {
        uLevel: live.grain,
        uLife: { value: GRAIN_LIFE },
        uWidth: { value: cardSize * 0.9 },
        uBottom: { value: cardY - (cardSize * 0.9) / 2 },
        uHeight: { value: cardSize * 0.9 },
        uSize: { value: 9 },
        uColor: { value: new THREE.Color(HOLO.cyan) },
        uTail: { value: new THREE.Color(HOLO.violet) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    return { geometry, material };
  }, [cardSize, cardY, live]);

  useEffect(() => {
    live.map.value = texture;
  }, [live, texture]);

  // Takes the plane off every material it was put on (end, or the lab closed mid-way).
  const release = useMemo(
    () => () => {
      for (const [m, before] of clipped.current) m.clippingPlanes = before;
      clipped.current.clear();
    },
    []
  );
  useEffect(
    () => () => {
      release();
      card.dispose();
      grains.geometry.dispose();
      grains.material.dispose();
    },
    [release, card, grains]
  );

  useFrame(() => {
    const r = run.current;
    const root = model.current;
    const group = self.current;
    if (r.done || !group) return;
    const now = performance.now();
    const probe = labMotionProbe();
    if (r.mounted < 0) {
      r.mounted = now;
      if (probe) {
        probe.dissolve = 0;
        probe.frames = 0;
      }
      get().gl.localClippingEnabled = true;
    }
    // The model's meshes (they arrive after loading, and pieces may swap materials): clipped.
    let meshes = 0;
    root?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes++;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m || clipped.current.has(m) || m.clipIntersection) continue;
        clipped.current.set(m, m.clippingPlanes);
        m.clippingPlanes = [...(m.clippingPlanes ?? []), plane];
      }
    });
    if (r.start < 0 && (meshes > 0 || now - r.mounted > DISSOLVE_WAIT_MS)) r.start = now;

    // Top of the model above the plate (its world box brought into the pedestal's frame).
    let top = cardY + (cardSize * 0.9) / 2;
    let radius = cardSize * 0.5;
    if (root && meshes > 0) {
      scratch.box.setFromObject(root);
      if (!scratch.box.isEmpty()) {
        scratch.v.set(0, scratch.box.max.y, 0);
        top = Math.max(top, group.worldToLocal(scratch.v).y);
        scratch.box.getSize(scratch.size);
        radius = Math.max(scratch.size.x, scratch.size.z) * 0.62;
      }
    }
    const progress = r.start < 0 ? 0 : dissolveProgress(now - r.start, DISSOLVE_MS);
    const level = dissolveLevel(progress, top);
    if (probe) {
      probe.dissolve = progress;
      if (progress > 0 && progress < 1) probe.frames++;
    }

    // The clip plane lives in world space: the line, lifted from the pedestal's frame.
    scratch.v.set(0, level, 0);
    plane.constant = group.localToWorld(scratch.v).y;

    const v = cardLevel(level, cardY - (cardSize * 0.9) / 2, cardSize * 0.9);
    live.card.value = v;
    live.grain.value = v;
    if (ring.current) {
      ring.current.position.y = level;
      ring.current.scale.setScalar(Math.max(radius, 0.05));
      ring.current.visible = r.start >= 0;
    }
    if (progress >= 1) {
      r.done = true;
      release();
      group.visible = false;
    }
  });

  return (
    <group ref={self} name="xr-lab-dissolve">
      {state === 'ready' && texture && (
        <mesh material={card} position={[0, cardY, 0]}>
          <planeGeometry args={[cardSize * 0.9, cardSize * 0.9]} />
        </mesh>
      )}
      <points geometry={grains.geometry} material={grains.material} frustumCulled={false} />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={4}>
        <ringGeometry args={[0.92, 1, 48]} />
        <meshBasicMaterial
          color={HOLO.cyan}
          transparent
          opacity={0.8}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
});
