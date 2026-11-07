'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { buildHouseCluster, type HouseSpec } from '../utils/house-geometry';
import { corrugatedTexture } from './procedural-textures';

/** Window glass when the building is unlit. */
const DARK_GLASS = '#1c2129';
/** Warm interior light (sRGB). Multiplied above 1 so bloom catches it. */
const WARM_LIGHT = '#ffb25e';

const TRIM_MAT = new THREE.MeshStandardMaterial({
  color: '#2b343d',
  roughness: 0.58,
  metalness: 0.18,
});
const VERANDA_MAT = new THREE.MeshStandardMaterial({ color: '#c4ad8f', roughness: 0.72 });
/** Wall color comes from the per-house `color` vertex attribute. */
const WALL_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.74,
  metalness: 0.04,
});

export type RoofFinish = 'corrugated' | 'tile';

const roofMats = new Map<RoofFinish, THREE.MeshStandardMaterial>();
/** One shared roof material per finish; the roof color is per-house vertex color. */
function roofMaterial(finish: RoofFinish): THREE.MeshStandardMaterial {
  let mat = roofMats.get(finish);
  if (!mat) {
    const tex = finish === 'corrugated' ? corrugatedTexture().clone() : null;
    if (tex) {
      tex.needsUpdate = true;
      tex.repeat.set(0.9, 1);
    }
    mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: tex,
      bumpMap: tex,
      bumpScale: 0.45,
      roughness: finish === 'corrugated' ? 0.42 : 0.65,
      metalness: finish === 'corrugated' ? 0.42 : 0.08,
    });
    roofMats.set(finish, mat);
  }
  return mat;
}

/** Shared window color for a 0..1 glow (0 = dark glass). */
export function windowColor(glow: number): THREE.Color {
  const c = new THREE.Color(DARK_GLASS);
  if (glow <= 0) return c;
  return c
    .lerp(new THREE.Color(WARM_LIGHT), Math.min(1, glow * 1.5))
    .multiplyScalar(1 + glow * 2.4);
}

export interface HouseClusterProps {
  houses: readonly HouseSpec[];
  /** Interior light, 0..1 (data-driven by the parent: served / partial / unserved). */
  windowGlow?: number;
  /** Corrugated metal (default) or smooth tiles. */
  roofFinish?: RoofFinish;
  name?: string;
}

/**
 * Any number of houses in 4–5 draw calls (trim, walls, roofs, windows, verandas).
 * Pass a stable `houses` array (module constant or memoized): it is rebuilt on change.
 */
export function HouseCluster({
  houses,
  windowGlow = 0,
  roofFinish = 'corrugated',
  name,
}: HouseClusterProps) {
  const geo = useMemo(() => buildHouseCluster(houses), [houses]);
  useEffect(
    () => () => {
      geo.trim.dispose();
      geo.walls.dispose();
      geo.roofs.dispose();
      geo.windows.dispose();
      geo.verandas?.dispose();
    },
    [geo]
  );
  const glassColor = useMemo(() => windowColor(windowGlow), [windowGlow]);

  return (
    <group name={name}>
      <mesh geometry={geo.trim} material={TRIM_MAT} receiveShadow castShadow />
      <mesh geometry={geo.walls} material={WALL_MAT} castShadow receiveShadow />
      <mesh geometry={geo.roofs} material={roofMaterial(roofFinish)} castShadow receiveShadow />
      {/* Windows (reflective architectural glass + interior light glow) */}
      <mesh geometry={geo.windows}>
        <meshStandardMaterial
          color={glassColor}
          emissive={windowGlow > 0 ? glassColor : '#0c1a2e'}
          emissiveIntensity={windowGlow > 0 ? 1.5 : 0.25}
          roughness={0.12}
          metalness={0.28}
          envMapIntensity={2.0}
        />
      </mesh>
      {geo.verandas && (
        <mesh geometry={geo.verandas} material={VERANDA_MAT} castShadow receiveShadow />
      )}
    </group>
  );
}

export interface VillageHouseProps extends HouseSpec {
  windowGlow?: number;
  roofFinish?: RoofFinish;
}

/** A single house: a one-house cluster. */
export function VillageHouse({ windowGlow, roofFinish, ...spec }: VillageHouseProps) {
  const {
    width,
    depth,
    wallHeight,
    roofHeight,
    wallColor,
    roofColor,
    overhang,
    windowsPerSide,
    veranda,
    position,
    rotationY,
  } = spec;
  const px = position?.[0] ?? 0;
  const py = position?.[1] ?? 0;
  const pz = position?.[2] ?? 0;
  const houses = useMemo<HouseSpec[]>(
    () => [
      {
        width,
        depth,
        wallHeight,
        roofHeight,
        wallColor,
        roofColor,
        overhang,
        windowsPerSide,
        veranda,
        position: [px, py, pz],
        rotationY,
      },
    ],
    [
      width,
      depth,
      wallHeight,
      roofHeight,
      wallColor,
      roofColor,
      overhang,
      windowsPerSide,
      veranda,
      px,
      py,
      pz,
      rotationY,
    ]
  );
  return <HouseCluster houses={houses} windowGlow={windowGlow} roofFinish={roofFinish} />;
}
