'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { defaultArchetype, kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import { fitRecipe } from '@/lib/object-shape';
import { recipeMesh } from '../../utils/object-geometry';
import { surfaceMaterial, SURFACES, type Surface } from '../../utils/surface-look';
import type { SpatialTarget } from './spatial-projection';
import { PowerConnectionBeam } from './power-connection-beam';

export interface SpawnedObject3DProps {
  target: SpatialTarget;
  /** Spawn animation progress [0..1] */
  spawnProgress?: number;
  /** Whether the appliance is actively connected to the village microgrid */
  isConnected?: boolean;
}

/**
 * 3D Procedural Appliance Materialized in-situ in the WebXR room.
 * Extrudes from 0 to 1 scale with elastic bounce, renders real materials and contact shadows.
 */
export const SpawnedObject3D = memo(function SpawnedObject3D({
  target,
  isConnected = false,
}: SpawnedObject3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const scaleRef = useRef(0);
  const { detection, position, dimensions } = target;

  const activeRecipe = useMemo(() => {
    const archetype = defaultArchetype(detection.category, detection.scenery, detection.label);
    const fallbackKit: ObjectKit = {
      archetype,
      proportions: { w: dimensions[0], h: dimensions[1], d: dimensions[2] },
      colors: { main: '#78909c', secondary: '#37474f', accent: '#00bcd4' },
      materials: { main: 'metal', secondary: 'glass', accent: 'plastic' },
    };
    return fitRecipe(kitToRecipe(fallbackKit), 1.0);
  }, [detection, dimensions]);

  const geometry = useMemo(() => {
    return recipeMesh(activeRecipe, 'full');
  }, [activeRecipe]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const materials = useMemo(() => {
    return SURFACES.map((s: Surface) =>
      surfaceMaterial(s, {
        vertexColors: true,
        color: new THREE.Color('#ffffff'),
      })
    );
  }, []);

  useEffect(
    () => () => {
      for (const m of materials) m.dispose();
    },
    [materials]
  );

  // Spring animation on spawn
  useFrame((_, delta) => {
    if (scaleRef.current < 1) {
      // Smooth spring expansion towards 1.0
      scaleRef.current = Math.min(1, scaleRef.current + delta * 2.8);
      const s = THREE.MathUtils.lerp(0, 1, scaleRef.current);
      if (groupRef.current) {
        groupRef.current.scale.set(s, s, s);
      }
    }
  });

  return (
    <group ref={groupRef} position={position} name={`spawned-object-${target.id}`}>
      {/* 3D Multi-material Model */}
      <mesh geometry={geometry} material={materials} castShadow receiveShadow />

      {/* Ground Contact Shadow beneath the object */}
      <ContactShadows
        position={[0, -dimensions[1] / 2, 0]}
        opacity={0.65}
        scale={Math.max(dimensions[0], dimensions[2]) * 2.0}
        blur={1.8}
        far={1.2}
      />

      {/* Energy connection aura ring at base (Green when connected, Cyan when idle) */}
      <mesh position={[0, -dimensions[1] / 2 + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.1, Math.max(dimensions[0], dimensions[2]) * 0.7, 32]} />
        <meshBasicMaterial
          color={isConnected ? '#22c55e' : '#38bdf8'}
          transparent
          opacity={isConnected ? 0.7 : 0.3}
        />
      </mesh>

      {/* 3D Electrical Power Connection Conduit linking to village diorama */}
      {isConnected && (
        <PowerConnectionBeam
          from={[position[0], position[1] - dimensions[1] / 2, position[2]]}
          to={[0, 0, -1.5]}
        />
      )}
    </group>
  );
});
