'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { createWindTurbineGeometry } from '../utils/wind-turbine-geometry';
import { terrainHeight } from '../utils/landscape';

interface TurbineSpec {
  x: number;
  z: number;
  rotationY: number;
  speed: number;
  height: number;
  bladeRadius: number;
}

const TURBINE_SPECS: TurbineSpec[] = [
  { x: -38, z: -46, rotationY: 0.3, speed: 0.85, height: 14, bladeRadius: 4.8 },
  { x: -14, z: -64, rotationY: -0.15, speed: 0.92, height: 16, bladeRadius: 5.2 },
  { x: 22, z: -58, rotationY: 0.45, speed: 0.78, height: 15, bladeRadius: 5.0 },
  { x: 48, z: -42, rotationY: -0.2, speed: 0.88, height: 14, bladeRadius: 4.6 },
];

const TOWER_MAT = new THREE.MeshStandardMaterial({
  color: '#eef2f5',
  roughness: 0.38,
  metalness: 0.15,
});

const ROTOR_MAT = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.28,
  metalness: 0.08,
});

export interface WindTurbinesProps {
  /** Time-of-day lamp glow from the celestial sky palette (dusk/night > 0.45). */
  lampGlow?: number;
}

function SingleTurbine({
  spec,
  isNight,
  nightFactor,
}: {
  spec: TurbineSpec;
  isNight: boolean;
  nightFactor: number;
}) {
  const rotorRef = useRef<THREE.Mesh>(null);
  const beaconRef = useRef<THREE.MeshBasicMaterial>(null);
  const y = terrainHeight(spec.x, spec.z);

  const { tower, nacelle, rotor } = useMemo(
    () => createWindTurbineGeometry(spec.height, spec.bladeRadius),
    [spec.height, spec.bladeRadius]
  );

  useFrame(({ clock }, delta) => {
    if (rotorRef.current) {
      rotorRef.current.rotation.z += delta * spec.speed;
    }
    // Rhythmic aviation beacon flash at ~1.2 Hz
    if (beaconRef.current && isNight) {
      const flash = Math.sin(clock.getElapsedTime() * 3.5 + spec.x * 0.1) > 0.15 ? 1.0 : 0.15;
      beaconRef.current.opacity = flash;
    }
  });

  return (
    <group position={[spec.x, y, spec.z]} rotation={[0, spec.rotationY, 0]}>
      {/* Tower standing from ground to top */}
      <mesh geometry={tower} material={TOWER_MAT} castShadow receiveShadow />

      {/* Generator nacelle atop the mast */}
      <group position={[0, spec.height, 0]}>
        <mesh geometry={nacelle} material={TOWER_MAT} castShadow receiveShadow />

        {/* Spinning 3-blade rotor assembly */}
        <mesh ref={rotorRef} geometry={rotor} material={ROTOR_MAT} castShadow receiveShadow />

        {/* Aviation red obstruction beacon atop rear nacelle */}
        <mesh position={[0, 0.32, -0.55]}>
          <sphereGeometry args={[0.09, 12, 10]} />
          <meshBasicMaterial
            ref={beaconRef}
            color={isNight ? '#ef4444' : '#551515'}
            transparent
            opacity={isNight ? 1 : 0.4}
            toneMapped={false}
          />
        </mesh>

        {/* Clean energy hub status indicator (luminous green-cyan) */}
        <mesh position={[0, 0, 0.46]}>
          <sphereGeometry args={[0.06, 10, 8]} />
          <meshBasicMaterial color={isNight ? '#38bdf8' : '#1e3a5f'} toneMapped={false} />
        </mesh>

        {/* Beacon light bloom glow at night */}
        {isNight && (
          <pointLight
            position={[0, 0.5, -0.55]}
            color="#ff2222"
            intensity={1.8 * nightFactor}
            distance={8}
            decay={2}
          />
        )}
      </group>

      {/* Hilltop base safety floodlight illuminating the tower base */}
      {isNight && (
        <pointLight
          position={[0, 1.2, 0]}
          color="#38bdf8"
          intensity={1.4 * nightFactor}
          distance={10}
          decay={2}
        />
      )}
    </group>
  );
}

/**
 * Hilltop wind turbines for the eco-village microgrid (reference design).
 * Adds clean renewable energy motion to the horizon with night aviation beacons
 * and base floodlights illuminating the hilltop ridge.
 */
export function WindTurbines({ lampGlow = 1 }: WindTurbinesProps) {
  const duskThreshold = 0.45;
  const isNight = lampGlow > duskThreshold;
  const nightFactor = isNight ? Math.max(0, Math.min(1, (lampGlow - duskThreshold) / 0.4)) : 0;

  return (
    <group name="wind-turbines">
      {TURBINE_SPECS.map((spec, i) => (
        <SingleTurbine key={i} spec={spec} isNight={isNight} nightFactor={nightFactor} />
      ))}
    </group>
  );
}
