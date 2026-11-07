'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WeatherId } from '@mitsinjo/engine';
import type { SkyPalette } from '../utils/sky-palette';
import {
  WEATHER_ATMOSPHERE,
  WEATHER_HEX,
  cloudPuffs,
  lightningFlash,
  rainDropCount,
} from '../utils/weather-atmosphere';
import { mulberry32 } from '../utils/noise';
import { useAmbientFrame } from '../hooks/use-ambient-frame';

export interface WeatherEffectsProps {
  weather: WeatherId;
  isDaytime: boolean;
  quality: 'high' | 'low';
  /** False under reduced motion or without a GPU: clouds and rain stay still, no lightning. */
  animate: boolean;
  palette?: SkyPalette;
  sunDirection?: [number, number, number];
  timeIndex?: number;
}

/** Clouds, rain and storm lightning for the day's weather. Visual only, never data. */
export function WeatherEffects({
  weather,
  isDaytime,
  quality,
  animate,
  palette,
  sunDirection,
  timeIndex,
}: WeatherEffectsProps) {
  const atmo = WEATHER_ATMOSPHERE[weather];
  return (
    <group name="weather-effects">
      <CloudLayer
        cover={atmo.cloudCover}
        darkness={atmo.cloudDarkness}
        animate={animate}
        palette={palette}
        sunDirection={sunDirection}
        quality={quality}
        isDaytime={isDaytime}
        hasLightning={atmo.lightning}
        timeIndex={timeIndex}
      />
      {atmo.rain > 0 && (
        <Rain
          count={rainDropCount(atmo.rain, quality)}
          isDaytime={isDaytime}
          intensity={atmo.rain}
          animate={animate}
        />
      )}
      {atmo.lightning && animate && <Lightning />}
    </group>
  );
}

/* ------------------------------------------------------------------ clouds */

const CLOUD_VERTEX = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vLocalPosition;

#include <common>
#include <fog_pars_vertex>

void main() {
  vLocalPosition = position;

  #ifdef USE_INSTANCING
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    mat3 m = mat3(instanceMatrix);
    // Correct for non-uniform instance scaling
    vec3 transformedNormal = normal / vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
    transformedNormal = m * transformedNormal;
    vWorldNormal = normalize((modelMatrix * vec4(transformedNormal, 0.0)).xyz);
  #else
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  #endif

  vWorldPosition = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uSunGlow;
uniform vec3 uCloudBase;
uniform vec3 uCloudShadow;
uniform float uDarkness;
uniform float uLightning;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vLocalPosition;

#include <common>
#include <fog_pars_fragment>

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPosition);
  vec3 L = normalize(uSunDir);

  // Soft wrapped diffuse: wraps sunlight around the curved cloud surface,
  // eliminating harsh black terminator lines
  float NdotL = dot(N, L);
  float wrap = 0.45;
  float diff = clamp((NdotL + wrap) / (1.0 + wrap), 0.0, 1.0);
  diff = smoothstep(0.02, 0.98, diff);

  // Atmospheric ambient bounce: sky from top, ground bounce from bottom
  float up = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 ambientLight = mix(uGroundColor, uSkyColor, up);

  // Vertical fluffiness gradient: tops are pure bright white, bottoms catch soft volume tint
  float heightT = clamp((vLocalPosition.y + 0.85) / 1.7, 0.0, 1.0);
  vec3 baseShade = mix(uCloudShadow, uCloudBase, heightT * 0.4 + 0.6);

  // Direct sun vs ambient shade
  vec3 litColor = uCloudBase * (uSunColor * 1.15 + vec3(0.12));
  vec3 shadeColor = mix(baseShade, ambientLight, 0.42);
  vec3 color = mix(shadeColor, litColor, diff);

  // Silver lining / rim lighting when backlit by the sun
  float sunFacing = max(0.0, dot(L, -V));
  float fresnel = pow(1.0 - max(0.0, dot(N, V)), 2.2);
  float rim = fresnel * (0.35 + 0.65 * pow(sunFacing, 2.0));
  color += uSunGlow * rim * (1.0 - uDarkness * 0.6);

  // Weather darkness (storm / rainy)
  if (uDarkness > 0.0) {
    vec3 stormTone = mix(vec3(0.25, 0.27, 0.33), vec3(0.45, 0.48, 0.55), diff);
    color = mix(color, stormTone, uDarkness * 0.85);
  }

  // Lightning flash illumination during storms
  if (uLightning > 0.0) {
    color = mix(color, vec3(1.3, 1.35, 1.5), uLightning * 0.8);
  }

  gl_FragColor = vec4(color, 1.0);

  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface CloudShaderUniforms {
  [key: string]: THREE.IUniform;
  fogColor: THREE.IUniform<THREE.Color>;
  fogNear: THREE.IUniform<number>;
  fogFar: THREE.IUniform<number>;
  fogDensity: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uSkyColor: THREE.IUniform<THREE.Color>;
  uGroundColor: THREE.IUniform<THREE.Color>;
  uSunGlow: THREE.IUniform<THREE.Color>;
  uCloudBase: THREE.IUniform<THREE.Color>;
  uCloudShadow: THREE.IUniform<THREE.Color>;
  uDarkness: THREE.IUniform<number>;
  uLightning: THREE.IUniform<number>;
}

function CloudLayer({
  cover,
  darkness,
  animate,
  palette,
  sunDirection,
  quality,
  isDaytime,
  hasLightning,
  timeIndex,
}: {
  cover: number;
  darkness: number;
  animate: boolean;
  palette?: SkyPalette;
  sunDirection?: [number, number, number];
  quality: 'high' | 'low';
  isDaytime: boolean;
  hasLightning: boolean;
  timeIndex?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const driftRef = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  const requestFrame = useAmbientFrame();
  const puffs = useMemo(() => cloudPuffs(cover), [cover]);

  const uniforms = useMemo<CloudShaderUniforms>(
    () => ({
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSkyColor: { value: new THREE.Color() },
      uGroundColor: { value: new THREE.Color() },
      uSunGlow: { value: new THREE.Color() },
      uCloudBase: { value: new THREE.Color(WEATHER_HEX.cloudLight) },
      uCloudShadow: { value: new THREE.Color(WEATHER_HEX.cloudShadow) },
      uDarkness: { value: 0 },
      uLightning: { value: 0 },
    }),
    []
  );

  useLayoutEffect(() => {
    if (sunDirection) {
      uniforms.uSunDir.value.set(...sunDirection).normalize();
    } else {
      uniforms.uSunDir.value.set(0.4, 0.8, -0.4).normalize();
    }
    if (palette) {
      uniforms.uSunColor.value.set(palette.sun);
      uniforms.uSkyColor.value.set(palette.hemiSky);
      uniforms.uGroundColor.value.set(palette.hemiGround);
      uniforms.uSunGlow.value.set(palette.sunGlow);
    } else {
      uniforms.uSunColor.value.set(isDaytime ? '#fff4e0' : '#9db4ff');
      uniforms.uSkyColor.value.set(isDaytime ? '#9fb2df' : '#3b4a8a');
      uniforms.uGroundColor.value.set(isDaytime ? '#6b533e' : '#0b1210');
      uniforms.uSunGlow.value.set(isDaytime ? '#ffd08a' : '#2a3260');
    }
    uniforms.uCloudBase.value.set(WEATHER_HEX.cloudLight);
    uniforms.uCloudShadow.value.set(WEATHER_HEX.cloudShadow);
    uniforms.uDarkness.value = darkness;
    invalidate();
  }, [uniforms, palette, sunDirection, isDaytime, darkness, invalidate]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const obj = new THREE.Object3D();
    puffs.forEach((p, i) => {
      obj.position.set(...p.position);
      obj.scale.set(...p.scale);
      obj.updateMatrix();
      mesh.setMatrixAt(i, obj.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [puffs, invalidate]);

  useEffect(() => {
    if (animate) invalidate();
  }, [animate, invalidate]);

  const baseRotation = (timeIndex ?? 12) * 0.05;

  useFrame((state, delta) => {
    if (!animate) return;
    driftRef.current += delta * 0.015;
    if (groupRef.current) {
      // Peaceful continuous drift across the sky, augmented by simulated time progression
      groupRef.current.rotation.y = baseRotation + driftRef.current;
      // Gentle subtle breeze floating
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.6;
      groupRef.current.position.x = Math.sin(state.clock.elapsedTime * 0.18) * 1.2;
    }
    if (hasLightning) {
      uniforms.uLightning.value = lightningFlash(state.clock.elapsedTime);
    }
    requestFrame();
  });

  if (puffs.length === 0) return null;

  return (
    <group ref={groupRef}>
      <instancedMesh
        key={`${puffs.length}-${quality}`}
        ref={meshRef}
        args={[undefined, undefined, puffs.length]}
        frustumCulled={false}
        name="weather-clouds"
      >
        <sphereGeometry
          key={quality}
          args={[1, quality === 'high' ? 16 : 12, quality === 'high' ? 12 : 8]}
        />
        <shaderMaterial
          fog
          depthWrite
          depthTest
          uniforms={uniforms}
          vertexShader={CLOUD_VERTEX}
          fragmentShader={CLOUD_FRAGMENT}
        />
      </instancedMesh>
    </group>
  );
}

/* -------------------------------------------------------------------- rain */

/** Rain volume around the village (world units). */
const RAIN_HALF_WIDTH = 42;
const RAIN_HEIGHT = 36;
const RAIN_STREAK = 0.9;
const RAIN_SPEED = 22;

const RAIN_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uHeight;
uniform float uLength;
attribute float aTip;
varying float vFade;
void main() {
  vec3 p = position;
  float y = mod(p.y - uTime * uSpeed, uHeight);
  p.y = y - aTip * uLength;
  p.x += aTip * uLength * 0.18; // light wind slant
  vFade = 1.0 - aTip * 0.75;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade);
  #include <colorspace_fragment>
}`;

function setUniform(material: THREE.ShaderMaterial, name: string, value: number) {
  const u = material.uniforms[name];
  if (u) u.value = value;
}

/** GPU-animated rain streaks: one draw call, only a time uniform changes per frame. */
function Rain({
  count,
  isDaytime,
  intensity,
  animate,
}: {
  count: number;
  isDaytime: boolean;
  intensity: number;
  animate: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const requestFrame = useAmbientFrame();

  const geometry = useMemo(() => {
    const rand = mulberry32(42);
    const positions = new Float32Array(count * 6);
    const tips = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (rand() * 2 - 1) * RAIN_HALF_WIDTH;
      const y = rand() * RAIN_HEIGHT;
      const z = (rand() * 2 - 1) * RAIN_HALF_WIDTH;
      positions.set([x, y, z, x, y, z], i * 6);
      tips[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aTip', new THREE.BufferAttribute(tips, 1));
    return g;
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const materialRef = useRef<THREE.ShaderMaterial>(null);
  // Initial values only; updates go through the material ref below.
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSpeed: { value: RAIN_SPEED },
      uHeight: { value: RAIN_HEIGHT },
      uLength: { value: RAIN_STREAK },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 0.5 },
    }),
    []
  );

  useLayoutEffect(() => {
    const u = materialRef.current?.uniforms;
    if (!u) return;
    u.uColor!.value.set(isDaytime ? WEATHER_HEX.rainDay : WEATHER_HEX.rainNight);
    u.uOpacity!.value = 0.3 + 0.3 * intensity;
    // Longer streaks in a downpour.
    u.uLength!.value = RAIN_STREAK * (0.8 + 0.6 * intensity);
    invalidate();
  }, [animate, isDaytime, intensity, invalidate]);

  useFrame((state) => {
    if (!animate || !materialRef.current) return;
    setUniform(materialRef.current, 'uTime', state.clock.elapsedTime);
    requestFrame();
  });

  return (
    <lineSegments geometry={geometry} frustumCulled={false} name="weather-rain">
      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={RAIN_VERTEX}
        fragmentShader={RAIN_FRAGMENT}
      />
    </lineSegments>
  );
}

/* --------------------------------------------------------------- lightning */

const LIGHTNING_PEAK = 7;

/** Storm flashes: one light whose intensity follows a fixed schedule. */
function Lightning() {
  const requestFrame = useAmbientFrame();
  const lightRef = useRef<THREE.DirectionalLight>(null);
  useFrame((state) => {
    const light = lightRef.current;
    if (!light) return;
    light.intensity = lightningFlash(state.clock.elapsedTime) * LIGHTNING_PEAK;
    requestFrame();
  });
  return (
    <directionalLight
      ref={lightRef}
      position={[20, 60, -30]}
      color={WEATHER_HEX.lightning}
      intensity={0}
    />
  );
}
