'use client';

import { useLayoutEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { fbm2d, mulberry32 } from '../utils/noise';
import { useAmbientFrame } from '../hooks/use-ambient-frame';
import { setUniformValue } from '../utils/uniforms';
import type { SkyPalette } from '../utils/sky-palette';

export const SKY_RADIUS = 420;
const STAR_COUNT = 720;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.55, h), 0.7));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  // Wide warm halo + tight bright core around the celestial body.
  col += uGlow * (pow(s, 4.0) * 0.7 + pow(s, 40.0) * 1.1) * smoothstep(-0.1, 0.25, h + 0.1);
  // Soft glow band hugging the horizon.
  col = mix(col, uGlow, (1.0 - smoothstep(0.0, 0.12, abs(h))) * 0.25 * pow(s, 1.5));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STAR_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
varying vec3 vColor;
varying float vTwinkle;

void main() {
  vColor = aColor;
  vTwinkle = 0.65 + 0.35 * sin(uTime * 1.8 + aPhase);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (1.0 + 0.2 * sin(uTime * 2.5 + aPhase));
  gl_Position = projectionMatrix * mvPosition;
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying float vTwinkle;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  float alpha = smoothstep(0.5, 0.06, dist) * uOpacity * vTwinkle;
  gl_FragColor = vec4(vColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SkyBackdropProps {
  palette: SkyPalette;
  /** Unit vector towards the sun (daytime 0° to 180° arc). */
  sunDirection: [number, number, number];
  /** Unit vector towards the moon (nighttime 0° to 180° arc). */
  moonDirection?: [number, number, number];
  /** True during day hours (06:00 to 18:00). */
  isDaytime?: boolean;
  /** Night progress / factor [0..1] driving stars and lunar glow. */
  nightProgress?: number;
  /** Fewer ridge segments on the low tier. */
  detail?: 'high' | 'low';
  /** Animate star twinkling. */
  animate?: boolean;
  /** Optional external ref to animate sun group position smoothly in useFrame. */
  sunGroupRef?: React.RefObject<THREE.Group | null>;
  /** Optional external ref to animate moon group position smoothly in useFrame. */
  moonGroupRef?: React.RefObject<THREE.Group | null>;
  /** Optional external ref to update sky uniforms in useFrame. */
  skyUniformsRef?: React.MutableRefObject<{
    uZenith: THREE.IUniform<THREE.Color>;
    uHorizon: THREE.IUniform<THREE.Color>;
    uGlow: THREE.IUniform<THREE.Color>;
    uSunDir: THREE.IUniform<THREE.Vector3>;
  } | null>;
}

interface RidgeSpec {
  radius: number;
  base: number;
  amp: number;
  freq: number;
  seed: number;
  /** 0 = nearest (darkest green), 1 = farthest (almost fog). */
  depth: number;
}

const RIDGES: RidgeSpec[] = [
  { radius: 320, base: 16, amp: 52, freq: 3.1, seed: 31, depth: 1 },
  { radius: 230, base: 8, amp: 30, freq: 4.3, seed: 23, depth: 0.62 },
  { radius: 150, base: 3, amp: 16, freq: 6.2, seed: 17, depth: 0.3 },
];

/** Ring angles (x = cos a, z = sin a) for sunrise valley (East) and sunset valley (West). */
const SUNRISE_RING_ANGLE = Math.atan2(-Math.cos(0.75), Math.sin(0.75));
const SUNSET_RING_ANGLE = Math.atan2(-Math.cos(-0.75), Math.sin(-0.75));

function ridgeGeometry(spec: RidgeSpec, segments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    // Sample noise on a circle so the ridge loops seamlessly.
    const n = fbm2d(x * spec.freq + 50, z * spec.freq + 50, spec.seed, 5);
    // Open natural valleys where the sun rises (East) and sets (West) so celestial discs stay visible.
    const toSunrise = Math.abs(
      Math.atan2(Math.sin(a - SUNRISE_RING_ANGLE), Math.cos(a - SUNRISE_RING_ANGLE))
    );
    const toSunset = Math.abs(
      Math.atan2(Math.sin(a - SUNSET_RING_ANGLE), Math.cos(a - SUNSET_RING_ANGLE))
    );
    const dipEast = 0.55 * Math.exp(-(toSunrise * toSunrise) / (2 * 0.28 * 0.28));
    const dipWest = 0.65 * Math.exp(-(toSunset * toSunset) / (2 * 0.28 * 0.28));
    const valley = 1 - Math.max(dipEast, dipWest);
    const peak = (Math.pow(n, 1.6) * spec.amp + spec.base) * valley;
    positions.push(x * spec.radius, -30, z * spec.radius);
    positions.push(x * spec.radius, peak, z * spec.radius);
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}

function createStarGeometry(count: number = STAR_COUNT): THREE.BufferGeometry {
  const rng = mulberry32(101);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  const starColors = [
    new THREE.Color('#ffffff'), // pure white
    new THREE.Color('#e0ecff'), // soft blue-white
    new THREE.Color('#fff0d0'), // warm golden
    new THREE.Color('#cce2ff'), // pale cyan
  ];

  const radius = SKY_RADIUS * 0.96;

  for (let i = 0; i < count; i++) {
    // Upper dome: azimuth 0..2pi, altitude from 4° up to 88°
    const phi = 0.07 + rng() * (Math.PI * 0.5 - 0.1);
    const theta = rng() * Math.PI * 2;

    const x = radius * Math.cos(phi) * Math.sin(theta);
    const y = radius * Math.sin(phi);
    const z = -radius * Math.cos(phi) * Math.cos(theta);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const col = starColors[Math.floor(rng() * starColors.length)]!;
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;

    sizes[i] = 1.4 + rng() * 1.8;
    phases[i] = rng() * Math.PI * 2;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  return geom;
}

function StarField({ opacity, animate = true }: { opacity: number; animate?: boolean }) {
  const geom = useMemo(() => createStarGeometry(STAR_COUNT), []);
  const requestFrame = useAmbientFrame();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpacity: { value: 0 },
    }),
    []
  );

  useLayoutEffect(() => setUniformValue(uniforms.uOpacity, opacity), [uniforms, opacity]);

  useFrame((state) => {
    if (!animate || opacity <= 0.01) return;
    setUniformValue(uniforms.uTime, state.clock.elapsedTime);
    requestFrame();
  });

  if (opacity <= 0.01) return null;

  return (
    <points geometry={geom} renderOrder={-8}>
      <shaderMaterial
        transparent
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={STAR_VERTEX}
        fragmentShader={STAR_FRAGMENT}
      />
    </points>
  );
}

export function SkyBackdrop({
  palette,
  sunDirection,
  moonDirection,
  isDaytime = true,
  nightProgress,
  detail = 'high',
  animate = true,
  sunGroupRef,
  moonGroupRef,
  skyUniformsRef,
}: SkyBackdropProps) {
  const uniforms = useMemo(
    () => ({
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() },
    }),
    []
  );

  useLayoutEffect(() => {
    if (skyUniformsRef) skyUniformsRef.current = uniforms;
  }, [skyUniformsRef, uniforms]);

  const activeCelestialDir = isDaytime ? sunDirection : (moonDirection ?? sunDirection);
  uniforms.uZenith.value.set(palette.zenith);
  uniforms.uHorizon.value.set(palette.horizon);
  uniforms.uGlow.value.set(palette.sunGlow);
  uniforms.uSunDir.value.set(...activeCelestialDir);

  const segments = detail === 'high' ? 360 : 140;
  const ridges = useMemo(() => RIDGES.map((r) => ridgeGeometry(r, segments)), [segments]);

  // RIDGES is farthest-first; palette.ridges is nearest-first.
  const ridgeColors = [palette.ridges[2], palette.ridges[1], palette.ridges[0]];

  // 3D position of Sun disc
  const sunPos = useMemo(
    () => new THREE.Vector3(...sunDirection).normalize().multiplyScalar(SKY_RADIUS * 0.9),
    [sunDirection]
  );
  const sunCore = useMemo(
    () => new THREE.Color(palette.sunGlow).multiplyScalar(2.2),
    [palette.sunGlow]
  );
  const sunHalo = useMemo(
    () => new THREE.Color(palette.horizon).multiplyScalar(1.4),
    [palette.horizon]
  );

  // 3D position of Moon disc
  const effectiveMoonDir = moonDirection ?? sunDirection;
  const moonPos = useMemo(
    () => new THREE.Vector3(...effectiveMoonDir).normalize().multiplyScalar(SKY_RADIUS * 0.88),
    [effectiveMoonDir]
  );

  // Night factor (0 = full day, 1 = deep night)
  const effectiveNightFactor = nightProgress ?? (!isDaytime ? 1 : 0);
  const starOpacity = effectiveNightFactor * Math.max(0, palette.fogScale - 0.1);
  const moonOpacity = !isDaytime ? Math.min(1, palette.sunDisc * effectiveNightFactor * 1.2) : 0;

  useLayoutEffect(() => {
    if (sunGroupRef?.current && sunGroupRef.current.position.lengthSq() < 1) {
      sunGroupRef.current.position.copy(sunPos);
    }
    if (moonGroupRef?.current && moonGroupRef.current.position.lengthSq() < 1) {
      moonGroupRef.current.position.copy(moonPos);
    }
  }, [sunGroupRef, moonGroupRef, sunPos, moonPos]);

  return (
    <group name="sky-backdrop">
      <mesh renderOrder={-10}>
        <sphereGeometry args={[SKY_RADIUS, 48, 24]} />
        <shaderMaterial
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          uniforms={uniforms}
          vertexShader={SKY_VERTEX}
          fragmentShader={SKY_FRAGMENT}
        />
      </mesh>

      {/* Night stars (1 draw call, twinkling in the night sky) */}
      <StarField opacity={starOpacity} animate={animate} />

      {/* Sun disc + halo (daytime, arcing 0° to 180°) */}
      {isDaytime && sunDirection[1] > -0.02 && palette.sunDisc > 0.02 && (
        <group ref={sunGroupRef} position={sunGroupRef ? undefined : sunPos}>
          <mesh>
            <sphereGeometry args={[9, 24, 12]} />
            <meshBasicMaterial
              color={sunCore}
              transparent={palette.sunDisc < 1}
              opacity={palette.sunDisc}
              toneMapped={false}
              fog={false}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[22, 24, 12]} />
            <meshBasicMaterial
              color={sunHalo}
              transparent
              opacity={0.3 * palette.sunDisc}
              toneMapped={false}
              fog={false}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {/* Moon disc + halo (nighttime, arcing 0° to 180°) */}
      {!isDaytime && effectiveMoonDir[1] > -0.02 && moonOpacity > 0.02 && (
        <group ref={moonGroupRef} position={moonGroupRef ? undefined : moonPos}>
          {/* Silvery-pearl luminous moon body */}
          <mesh>
            <sphereGeometry args={[7.5, 24, 16]} />
            <meshBasicMaterial
              color="#eaf0fa"
              transparent={moonOpacity < 1}
              opacity={moonOpacity}
              toneMapped={false}
              fog={false}
            />
          </mesh>
          {/* Soft lunar halo glow */}
          <mesh>
            <sphereGeometry args={[20, 24, 16]} />
            <meshBasicMaterial
              color="#7899d9"
              transparent
              opacity={0.28 * moonOpacity}
              toneMapped={false}
              fog={false}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {ridges.map((g, i) => (
        <mesh key={i} geometry={g} renderOrder={-5 + i}>
          <meshBasicMaterial color={ridgeColors[i]} fog={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
