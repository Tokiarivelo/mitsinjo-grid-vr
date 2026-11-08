'use client';

import { useMemo } from 'react';
import { createSchoolGeometry } from '../utils/school-geometry';
import { corrugatedTexture } from './procedural-textures';

export interface SchoolBuildingProps {
  /** Power glow 0..1 (derived from microgrid sector status). */
  glow?: number;
}

export function SchoolBuilding({ glow: _glow }: SchoolBuildingProps) {
  const geos = useMemo(() => createSchoolGeometry(), []);

  // Corrugated texture for cardboard / ribbed roofs
  const roofTexture = useMemo(() => {
    const tex = corrugatedTexture().clone();
    tex.repeat.set(4, 1);
    tex.needsUpdate = true;
    return tex;
  }, []);

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

      {/* 6. Multi-pane classroom windows (reflective architectural glass) */}
      <mesh geometry={geos.glass}>
        <meshStandardMaterial
          color="#1c2836"
          roughness={0.08}
          metalness={0.92}
          envMapIntensity={2.5}
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
