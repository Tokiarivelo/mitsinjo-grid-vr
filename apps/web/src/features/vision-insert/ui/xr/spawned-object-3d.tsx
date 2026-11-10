'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { defaultArchetype, kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import { fitRecipe } from '@/lib/object-shape';
import { recipeMesh } from '../../utils/object-geometry';
import { surfaceMaterial, SURFACES, type Surface } from '../../utils/surface-look';
import type { SpatialTarget } from './spatial-projection';
import { PowerConnectionBeam } from './power-connection-beam';
import { spinTurntable, type Turntable } from './turntable';
import { MINIATURE_SIZE } from './xr-layout';

type Vec3 = [number, number, number];

export interface SpawnedObject3DProps {
  target: SpatialTarget;
  /** Pedestal position of the miniature, within the viewer's reach. */
  slot: Vec3;
  /** Rotation state, shared with the input controller that rotates it. */
  turntable: Turntable;
  hovered?: boolean;
  /** Whether the appliance is actively connected to the village microgrid */
  isConnected?: boolean;
}

const FLY_IN_SECONDS = 0.7;
const PEDESTAL_RADIUS = MINIATURE_SIZE * 0.62;

/**
 * 3D miniature of a shot object: flies out of the webcam video onto a pedestal in front of
 * the viewer, spins on its own, and turns with the viewer's hold (see `turntable.ts`).
 * No ContactShadows: its per-frame render target would break fixed foveation and MSAA in the
 * headset (Meta WebXR perf guidance).
 */
export const SpawnedObject3D = memo(function SpawnedObject3D({
  target,
  slot,
  turntable,
  hovered = false,
  isConnected = false,
}: SpawnedObject3DProps) {
  const rootRef = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const flyRef = useRef(0);
  const { detection, spawnPosition, spawnDimensions } = target;
  const from = useMemo(() => new THREE.Vector3(...spawnPosition), [spawnPosition]);
  const to = useMemo(() => new THREE.Vector3(...slot), [slot]);

  const geometry = useMemo(() => {
    const archetype = defaultArchetype(detection.category, detection.scenery, detection.label);
    const kit: ObjectKit = {
      archetype,
      proportions: { w: spawnDimensions[0], h: spawnDimensions[1], d: spawnDimensions[2] },
      colors: { main: '#78909c', secondary: '#37474f', accent: '#00bcd4' },
      materials: { main: 'metal', secondary: 'glass', accent: 'plastic' },
    };
    const aspect = spawnDimensions[0] / Math.max(spawnDimensions[1], 1e-6);
    // Largest side normalized to 1, centred so it spins around its middle.
    return recipeMesh(fitRecipe(kitToRecipe(kit), aspect), 'full').center();
  }, [detection, spawnDimensions]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const materials = useMemo(
    () =>
      SURFACES.map((s: Surface) =>
        surfaceMaterial(s, { vertexColors: true, color: new THREE.Color('#ffffff') })
      ),
    []
  );

  useEffect(
    () => () => {
      for (const m of materials) m.dispose();
    },
    [materials]
  );

  useFrame((_, delta) => {
    const root = rootRef.current;
    const model = modelRef.current;
    if (!root || !model) return;
    const dt = Math.min(delta, 0.1);

    // Fly in from the object in the video, growing from a point.
    if (flyRef.current < 1) {
      flyRef.current = Math.min(1, flyRef.current + dt / FLY_IN_SECONDS);
      const k = 1 - Math.pow(1 - flyRef.current, 3);
      root.position.lerpVectors(from, to, k);
      root.scale.setScalar(Math.max(0.001, k));
    } else {
      root.position.copy(to);
    }

    spinTurntable(turntable, dt, performance.now());
    model.rotation.set(turntable.pitch, turntable.yaw, 0, 'YXZ');
    const grow = hovered || turntable.heldBy !== null ? 1.12 : 1;
    const s = THREE.MathUtils.lerp(model.scale.x, MINIATURE_SIZE * grow, Math.min(1, dt * 12));
    model.scale.setScalar(s);
  });

  const base: Vec3 = [slot[0], slot[1] - MINIATURE_SIZE * 0.62, slot[2]];

  return (
    <>
      <group ref={rootRef} position={spawnPosition} name={`spawned-object-${target.id}`}>
        <group ref={modelRef} scale={MINIATURE_SIZE}>
          <mesh geometry={geometry} material={materials} castShadow />
        </group>

        {/* Pedestal ring: green when connected, cyan when idle, brighter when held/hovered. */}
        <mesh position={[0, -MINIATURE_SIZE * 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[PEDESTAL_RADIUS * 0.7, PEDESTAL_RADIUS, 40]} />
          <meshBasicMaterial
            color={isConnected ? '#22c55e' : '#38bdf8'}
            transparent
            opacity={hovered ? 0.95 : isConnected ? 0.75 : 0.45}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Power conduit from the pedestal to the village diorama. */}
      {isConnected && <PowerConnectionBeam from={base} to={[0, 0, -1.5]} />}
    </>
  );
});
