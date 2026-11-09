'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { buildHouseCluster, type HouseSpec } from '../utils/house-geometry';
import { bipvRoofTexture, corrugatedTexture, timberSlatTexture } from './procedural-textures';

/** Window glass when the building is unlit. */
const DARK_GLASS = '#1c2129';
/** Warm interior light (sRGB). Multiplied above 1 so bloom catches it. */
const WARM_LIGHT = '#ffb25e';

const TRIM_MAT = new THREE.MeshStandardMaterial({
  color: '#1e252e',
  roughness: 0.48,
  metalness: 0.22,
});
const VERANDA_MAT = new THREE.MeshStandardMaterial({
  color: '#b58855',
  roughness: 0.62,
  metalness: 0.06,
});

const wallTex = timberSlatTexture().clone();
wallTex.needsUpdate = true;
wallTex.repeat.set(3, 1);

/** Wall color comes from the per-house `color` vertex attribute, multiplied by timber slat grain. */
const WALL_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true,
  map: wallTex,
  roughness: 0.72,
  metalness: 0.04,
});

export type RoofFinish = 'corrugated' | 'tile' | 'bipv';

const roofMats = new Map<RoofFinish, THREE.MeshStandardMaterial>();
/** One shared roof material per finish; the roof color is per-house vertex color. */
function roofMaterial(finish: RoofFinish): THREE.MeshStandardMaterial {
  let mat = roofMats.get(finish);
  if (!mat) {
    const tex =
      finish === 'corrugated'
        ? corrugatedTexture().clone()
        : finish === 'bipv'
          ? bipvRoofTexture().clone()
          : null;
    if (tex) {
      tex.needsUpdate = true;
      tex.repeat.set(finish === 'bipv' ? 1.4 : 0.9, 1);
    }
    mat = new THREE.MeshStandardMaterial({
      vertexColors: finish !== 'bipv',
      color: finish === 'bipv' ? '#ffffff' : undefined,
      map: tex,
      bumpMap: tex,
      bumpScale: finish === 'bipv' ? 0.2 : 0.45,
      roughness: finish === 'bipv' ? 0.24 : finish === 'corrugated' ? 0.42 : 0.65,
      metalness: finish === 'bipv' ? 0.62 : finish === 'corrugated' ? 0.42 : 0.08,
      envMapIntensity: finish === 'bipv' ? 1.6 : 1.0,
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
  const isLit = windowGlow > 0;
  const glassColor = useMemo(
    () => (isLit ? new THREE.Color('#ffe8a3') : new THREE.Color(DARK_GLASS)),
    [isLit]
  );

  return (
    <group name={name}>
      <mesh geometry={geo.trim} material={TRIM_MAT} receiveShadow castShadow />
      <mesh geometry={geo.walls} material={WALL_MAT} castShadow receiveShadow />
      <mesh geometry={geo.roofs} material={roofMaterial(roofFinish)} castShadow receiveShadow />
      {/* Windows (warm interior incandescent light at night when powered, reflective dark glass when daytime/unpowered) */}
      <mesh geometry={geo.windows}>
        <meshStandardMaterial
          color={glassColor}
          emissive={isLit ? '#ff9933' : '#000000'}
          emissiveIntensity={isLit ? 1.8 * windowGlow : 0}
          toneMapped={!isLit}
          roughness={isLit ? 0.2 : 0.08}
          metalness={isLit ? 0.05 : 0.88}
          envMapIntensity={isLit ? 0.6 : 2.2}
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
    roofStyle,
    ridgeZOffset,
    deckFurniture,
    slatCladding,
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
        roofStyle,
        ridgeZOffset,
        deckFurniture,
        slatCladding,
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
      roofStyle,
      ridgeZOffset,
      deckFurniture,
      slatCladding,
    ]
  );
  return <HouseCluster houses={houses} windowGlow={windowGlow} roofFinish={roofFinish} />;
}
