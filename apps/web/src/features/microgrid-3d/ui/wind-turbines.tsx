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

function SingleTurbine({ spec }: { spec: TurbineSpec }) {
  const rotorRef = useRef<THREE.Mesh>(null);
  const y = terrainHeight(spec.x, spec.z);

  const { tower, nacelle, rotor } = useMemo(
    () => createWindTurbineGeometry(spec.height, spec.bladeRadius),
    [spec.height, spec.bladeRadius]
  );

  useFrame((_, delta) => {
    if (rotorRef.current) {
      rotorRef.current.rotation.z += delta * spec.speed;
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
      </group>
    </group>
  );
}

/**
 * Hilltop wind turbines for the eco-village microgrid (reference design).
 * Adds clean renewable energy motion to the horizon with minimal draw calls.
 */
export function WindTurbines() {
  return (
    <group name="wind-turbines">
      {TURBINE_SPECS.map((spec, i) => (
        <SingleTurbine key={i} spec={spec} />
      ))}
    </group>
  );
}
