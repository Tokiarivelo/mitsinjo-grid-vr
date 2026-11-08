'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { createLakeGrilleGeometry } from '../utils/lake-grille-geometry';

export interface LakeGrilleProps {
  /** Time-of-day lamp glow from the celestial sky palette (dusk/night > 0.45). */
  lampGlow?: number;
  /** True when the microgrid has electrical power to illuminate the promenade (dark during blackouts). */
  hasPower?: boolean;
}

const STEEL_GRILLE_MAT = new THREE.MeshStandardMaterial({
  color: '#334155',
  roughness: 0.52,
  metalness: 0.72,
});

/**
 * Illuminated protective security grille and promenade railing around the lake
 * facing the wind turbines, with safety edging at the water station pond.
 * Renders in only 2 draw calls for optimal 60 FPS performance.
 */
export function LakeGrille({ lampGlow = 1, hasPower = true }: LakeGrilleProps) {
  const geos = useMemo(() => createLakeGrilleGeometry(), []);

  // Nighttime illumination factor (triggers when dusk sets in: lampGlow > 0.45 AND grid has power)
  const duskThreshold = 0.45;
  const isNight = lampGlow > duskThreshold;
  const isLit = isNight && hasPower;
  const nightFactor = isLit ? Math.max(0, Math.min(1, (lampGlow - duskThreshold) / 0.4)) : 0;

  // Luminescent lantern color: radiant cyan-marine glow at night when powered, muted unlit cap otherwise
  const lanternColor = useMemo(
    () => (isLit ? new THREE.Color('#38bdf8') : new THREE.Color('#1e293b')),
    [isLit]
  );

  return (
    <group name="lake-illuminated-grille">
      {/* 1. Metal structural posts, rails and security grille bars */}
      <mesh geometry={geos.metalGrille} material={STEEL_GRILLE_MAT} castShadow receiveShadow />

      {/* 2. Luminous bollard lanterns atop the railing posts */}
      <mesh geometry={geos.lanterns}>
        <meshBasicMaterial color={lanternColor} toneMapped={false} />
      </mesh>

      {/* 3. Nighttime illumination casting reflections onto the lake and shoreline near the wind turbines */}
      {isLit && (
        <>
          {/* Promenade floodlight directly below Hilltop Turbine #3 (22, -58) */}
          <pointLight
            position={[18.5, 0.6, -53.5]}
            color="#38bdf8"
            intensity={2.2 * nightFactor}
            distance={16}
            decay={2}
          />
          {/* North-west lake water surface illumination */}
          <pointLight
            position={[26.0, 0.5, -47.5]}
            color="#0ea5e9"
            intensity={2.0 * nightFactor}
            distance={15}
            decay={2}
          />
          {/* Center northern lake promontory facing the village */}
          <pointLight
            position={[34.0, 0.5, -45.0]}
            color="#38bdf8"
            intensity={2.2 * nightFactor}
            distance={16}
            decay={2}
          />
          {/* North-east lake water surface near Turbine #4 (48, -42) */}
          <pointLight
            position={[43.5, 0.5, -49.0]}
            color="#0ea5e9"
            intensity={2.0 * nightFactor}
            distance={15}
            decay={2}
          />

          {/* Water station pond railing illumination */}
          <pointLight
            position={[-11.5, 0.6, 5.0]}
            color="#38bdf8"
            intensity={1.4 * nightFactor}
            distance={7}
            decay={2}
          />
        </>
      )}
    </group>
  );
}
