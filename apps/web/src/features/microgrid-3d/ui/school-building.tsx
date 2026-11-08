'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { createSchoolGeometry } from '../utils/school-geometry';
import { corrugatedTexture } from './procedural-textures';
import { windowColor } from './village-house';

export interface SchoolBuildingProps {
  /** Power glow 0..1 (derived from microgrid sector status). */
  glow: number;
}

const UNLIT_GLASS = '#253545';

export function SchoolBuilding({ glow }: SchoolBuildingProps) {
  const geos = useMemo(() => createSchoolGeometry(), []);

  // Corrugated texture for cardboard / ribbed roofs
  const roofTexture = useMemo(() => {
    const tex = corrugatedTexture().clone();
    tex.repeat.set(4, 1);
    tex.needsUpdate = true;
    return tex;
  }, []);

  // Glass material dynamically reacting to microgrid power
  const glassColor = useMemo(() => {
    if (glow <= 0) return new THREE.Color(UNLIT_GLASS);
    return windowColor(glow);
  }, [glow]);

  return (
    <group name="school-mesh">
      {/* 1. Lower story sunny yellow walls & steps */}
      <mesh geometry={geos.yellowWalls} castShadow receiveShadow>
        <meshStandardMaterial color="#f6c944" roughness={0.55} metalness={0.05} />
      </mesh>

      {/* 2. Upper story sky blue walls & belfry */}
      <mesh geometry={geos.blueWalls} castShadow receiveShadow>
        <meshStandardMaterial color="#3b82f6" roughness={0.55} metalness={0.05} />
      </mesh>

      {/* 3. Red divider belts, doors, brick chimney & swing set */}
      <mesh geometry={geos.redTrim} castShadow receiveShadow>
        <meshStandardMaterial color="#dc2626" roughness={0.48} metalness={0.1} />
      </mesh>

      {/* 4. Warm timber / cardboard window frames, belfry posts & school benches */}
      <mesh geometry={geos.woodTrim} castShadow receiveShadow>
        <meshStandardMaterial color="#c89658" roughness={0.65} metalness={0.05} />
      </mesh>

      {/* 5. Ribbed corrugated gabled roofs & belfry canopy */}
      <mesh geometry={geos.roofs} castShadow receiveShadow>
        <meshStandardMaterial color="#b88a5d" map={roofTexture} roughness={0.68} metalness={0.15} />
      </mesh>

      {/* 6. Multi-pane classroom windows (illuminated when powered) */}
      <mesh geometry={geos.glass}>
        <meshStandardMaterial
          color={glassColor}
          emissive={glow > 0 ? glassColor : '#000000'}
          emissiveIntensity={glow > 0 ? 0.7 * glow : 0}
          transparent
          opacity={glow > 0 ? 0.9 : 0.75}
          roughness={glow > 0 ? 0.15 : 0.25}
          metalness={glow > 0 ? 0.3 : 0.8}
        />
      </mesh>

      {/* 7. Front schoolyard playground (slide chute, planter bed, pavers) */}
      <mesh geometry={geos.playground} castShadow receiveShadow>
        <meshStandardMaterial color="#0284c7" roughness={0.5} metalness={0.15} />
      </mesh>

      {/* 8. Brass school bell inside belfry */}
      <mesh geometry={geos.brassBell} castShadow>
        <meshStandardMaterial color="#facc15" roughness={0.22} metalness={0.88} />
      </mesh>
    </group>
  );
}
