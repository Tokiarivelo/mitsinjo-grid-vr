'use client';

import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

export interface PowerConnectionBeamProps {
  /** Origin point of the power cable (at base of the 3D appliance) */
  from: [number, number, number];
  /** Destination grid hub on the floor (defaults to studio diorama center [0, 0, -1.5]) */
  to?: [number, number, number];
  /** Color of the electrical energy conduit (defaults to #22c55e) */
  color?: string;
}

/**
 * 3D Electrical Power Connection Beam / Conduit.
 * Renders an energetic Catmull-Rom tube linking the materialized appliance
 * to the village microgrid diorama bus in WebXR.
 */
export const PowerConnectionBeam = memo(function PowerConnectionBeam({
  from,
  to = [0, 0, -1.5],
  color = '#22c55e',
}: PowerConnectionBeamProps) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    // Subtle natural arc curving down towards ground
    const mid = new THREE.Vector3(
      (start.x + end.x) / 2,
      Math.max(start.y, end.y) * 0.4 + 0.08,
      (start.z + end.z) / 2
    );

    const curve = new THREE.CatmullRomCurve3([start, mid, end]);
    return new THREE.TubeGeometry(curve, 28, 0.008, 8, false);
  }, [from, to]);

  // Electrical pulsation
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (materialRef.current) {
      materialRef.current.emissiveIntensity = 0.8 + Math.sin(t * 6) * 0.4;
    }
    if (ringRef.current) {
      const s = 1.0 + Math.sin(t * 4) * 0.12;
      ringRef.current.scale.set(s, s, s);
    }
  });

  return (
    <group name="power-connection-beam">
      {/* 1. Curved Conduit Tube */}
      <mesh geometry={geometry}>
        <meshStandardMaterial
          ref={materialRef}
          color={color}
          emissive={color}
          emissiveIntensity={1.0}
          roughness={0.2}
          metalness={0.8}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* 2. Base Terminal Junction Ring on Ground */}
      <mesh ref={ringRef} position={to} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.14, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* 3. Small Terminal Cylinder Beacon */}
      <mesh position={[to[0], to[1] + 0.03, to[2]]}>
        <cylinderGeometry args={[0.04, 0.05, 0.06, 16]} />
        <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.9} />
      </mesh>
    </group>
  );
});
