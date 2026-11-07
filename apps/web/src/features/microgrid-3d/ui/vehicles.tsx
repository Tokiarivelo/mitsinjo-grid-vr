'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { SECTOR_POSITIONS } from '../utils/to-scene-model';
import { mergeObjectMeshes } from '../utils/float-geometry';

const VEHICLES = {
  ambulance: '/3d/ambulance.glb',
  truck: '/3d/truck.glb',
  van: '/3d/van.glb',
} as const;

type VehicleId = keyof typeof VEHICLES;

/** Kenney car kit models are ~3.3 units long; village scale wants ~1.8. */
const VEHICLE_SCALE = 0.55;

const PLACEMENTS: { id: VehicleId; position: [number, number, number]; rotationY: number }[] = [
  {
    id: 'ambulance',
    position: [SECTOR_POSITIONS.health[0] - 2.6, 0, SECTOR_POSITIONS.health[2] + 3.2],
    rotationY: 2.3,
  },
  {
    id: 'truck',
    position: [SECTOR_POSITIONS.market[0] + 3.1, 0, SECTOR_POSITIONS.market[2] + 2.2],
    rotationY: -0.6,
  },
  {
    id: 'van',
    position: [SECTOR_POSITIONS.market[0] - 3.2, 0, SECTOR_POSITIONS.market[2] + 2.6],
    rotationY: 0.4,
  },
];

function Vehicle({ id, position, rotationY }: (typeof PLACEMENTS)[number]) {
  const { scene } = useGLTF(VEHICLES[id]);
  // Body, wheels and doors share one texture atlas → bake into one mesh (1 draw call).
  const merged = useMemo(() => {
    const res = mergeObjectMeshes(scene);
    if (res.material && 'roughness' in res.material) {
      (res.material as THREE.MeshStandardMaterial).roughness = 0.38;
      (res.material as THREE.MeshStandardMaterial).metalness = 0.28;
      (res.material as THREE.MeshStandardMaterial).envMapIntensity = 1.4;
    }
    return res;
  }, [scene]);
  if (!merged.material) return null;
  return (
    <mesh
      geometry={merged.geometry}
      material={merged.material}
      position={position}
      rotation={[0, rotationY, 0]}
      scale={VEHICLE_SCALE}
      castShadow
      receiveShadow
    />
  );
}

export function Vehicles() {
  return (
    <group name="vehicles">
      {PLACEMENTS.map((p) => (
        <Vehicle key={p.id} {...p} />
      ))}
    </group>
  );
}

Object.values(VEHICLES).forEach((url) => useGLTF.preload(url));
