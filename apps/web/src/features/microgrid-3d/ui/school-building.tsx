'use client';

import { useMemo } from 'react';
import { createSchoolGeometry } from '../utils/school-geometry';
import { corrugatedTexture } from './procedural-textures';

export interface SchoolBuildingProps {
  /** Power glow 0..1 (derived from microgrid sector status). */
  glow?: number;
}

export function SchoolBuilding({ glow = 0 }: SchoolBuildingProps) {
  const geos = useMemo(() => createSchoolGeometry(), []);
  const isLit = glow > 0;
  const glassColor = isLit ? '#ffe6a3' : '#1c2836';

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

      {/* 6. Multi-pane classroom windows (warm interior incandescent light at night when powered, dark reflective when unpowered/daytime) */}
      <mesh geometry={geos.glass}>
        <meshStandardMaterial
          color={glassColor}
          emissive={isLit ? '#ff9933' : '#000000'}
          emissiveIntensity={isLit ? 1.8 * glow : 0}
          toneMapped={!isLit}
          roughness={isLit ? 0.2 : 0.08}
          metalness={isLit ? 0.05 : 0.92}
          envMapIntensity={isLit ? 0.6 : 2.5}
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

      {/* Nighttime / dusk architectural illumination */}
      {isLit && (
        <>
          {/* Main entrance portico lantern globe */}
          <mesh position={[0, 1.42, 1.95]}>
            <sphereGeometry args={[0.07, 12, 10]} />
            <meshBasicMaterial color="#ffe082" toneMapped={false} />
          </mesh>
          {/* Main entrance portico lantern lighting the front steps and path */}
          <pointLight
            position={[0, 1.45, 2.0]}
            color="#ffb74d"
            intensity={2.2 * glow}
            distance={9}
            decay={2}
          />
          {/* Belfry bell lantern */}
          <mesh position={[0, 3.8, 0]}>
            <sphereGeometry args={[0.08, 12, 10]} />
            <meshBasicMaterial color="#ffe6a8" toneMapped={false} />
          </mesh>
          <pointLight
            position={[0, 3.85, 0]}
            color="#ffe082"
            intensity={1.6 * glow}
            distance={7}
            decay={2}
          />
          {/* Warm classroom light spilling out from left and right wings */}
          <pointLight
            position={[-2.4, 1.6, 0.4]}
            color="#ffd57e"
            intensity={1.8 * glow}
            distance={7}
            decay={2}
          />
          <pointLight
            position={[2.4, 1.6, 0.4]}
            color="#ffd57e"
            intensity={1.8 * glow}
            distance={7}
            decay={2}
          />
        </>
      )}
    </group>
  );
}
