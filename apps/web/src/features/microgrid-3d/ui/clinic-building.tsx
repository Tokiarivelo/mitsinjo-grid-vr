'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { createClinicGeometry } from '../utils/clinic-geometry';
import { horizontalTimberSlatTexture, solarCellTexture } from './procedural-textures';
import { windowColor } from './village-house';

export interface ClinicBuildingProps {
  /** Power glow 0..1 (derived from microgrid sector status). */
  glow: number;
}

const CLINIC_RED_LIT = '#ef4444';
const CLINIC_RED_UNLIT = '#6b1d1d';
const UNLIT_GLASS = '#334e68';

export function ClinicBuilding({ glow }: ClinicBuildingProps) {
  const geos = useMemo(() => createClinicGeometry(), []);

  // Timber texture for horizontal slats
  const woodTexture = useMemo(() => {
    const tex = horizontalTimberSlatTexture().clone();
    tex.repeat.set(1, 2);
    tex.needsUpdate = true;
    return tex;
  }, []);

  // Solar texture for rooftop modules
  const pvTexture = useMemo(() => {
    const tex = solarCellTexture().clone();
    tex.repeat.set(2, 2);
    tex.needsUpdate = true;
    return tex;
  }, []);

  const isLit = glow > 0;

  // Glass material dynamically reacting to microgrid power at dusk / night
  const glassColor = useMemo(() => {
    if (!isLit) return new THREE.Color(UNLIT_GLASS);
    return windowColor(glow);
  }, [isLit, glow]);

  return (
    <group name="health-clinic-mesh">
      {/* 1. White composite fascias, floor slabs, columns & core walls */}
      <mesh geometry={geos.whiteFascia} castShadow receiveShadow>
        <meshStandardMaterial color="#f8fafc" roughness={0.35} metalness={0.15} />
      </mesh>

      {/* 2. Warm horizontal timber slats on terrace facade & planters */}
      <mesh geometry={geos.woodSlat} castShadow receiveShadow>
        <meshStandardMaterial color="#be8347" map={woodTexture} roughness={0.65} metalness={0.05} />
      </mesh>

      {/* 3. Curtain wall glass (translucent, warmly illuminated when powered at night) */}
      <mesh geometry={geos.curtainGlass}>
        <meshStandardMaterial
          color={glassColor}
          emissive={isLit ? glassColor : '#000000'}
          emissiveIntensity={isLit ? 1.6 * glow : 0}
          toneMapped={!isLit}
          transparent
          opacity={isLit ? 0.92 : 0.72}
          roughness={isLit ? 0.12 : 0.18}
          metalness={isLit ? 0.15 : 0.85}
        />
      </mesh>

      {/* 4. Charcoal aluminium mullions, window frames & handrails */}
      <mesh geometry={geos.charcoalTrim} castShadow receiveShadow>
        <meshStandardMaterial color="#1e293b" roughness={0.45} metalness={0.75} />
      </mesh>

      {/* 5. Flat roof gravel deck & BIPV solar array */}
      <mesh geometry={geos.roofTop} castShadow receiveShadow>
        <meshStandardMaterial color="#94a3b8" map={pvTexture} roughness={0.38} metalness={0.45} />
      </mesh>

      {/* 6. Manicured entrance landscaping (boxwood hedges & planters) */}
      <mesh geometry={geos.landscape} castShadow receiveShadow>
        <meshStandardMaterial color="#365314" roughness={0.85} metalness={0.05} />
      </mesh>

      {/* 7. Red illuminated medical crosses (facade & entrance totem) */}
      <mesh geometry={geos.redCross}>
        <meshBasicMaterial color={isLit ? CLINIC_RED_LIT : CLINIC_RED_UNLIT} toneMapped={false} />
      </mesh>

      {/* Nighttime / dusk architectural illumination */}
      {isLit && (
        <>
          {/* Clinic entrance ambulance bay & portico illumination */}
          <pointLight
            position={[-0.8, 1.8, 2.2]}
            color="#fff0c2"
            intensity={1.8 * glow}
            distance={8}
            decay={2}
          />
          {/* Clinic interior curtain wall gentle ambient glow */}
          <pointLight
            position={[0.8, 2.2, 0]}
            color="#e0f2fe"
            intensity={1.4 * glow}
            distance={7}
            decay={2}
          />
        </>
      )}
    </group>
  );
}
