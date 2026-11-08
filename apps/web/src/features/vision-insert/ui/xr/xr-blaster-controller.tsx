'use client';

import { memo, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { SpatialTarget } from './spatial-projection';

export interface XRBlasterControllerProps {
  targets: SpatialTarget[];
  materializedIds: Set<string>;
  onHoverTarget: (id: string | null) => void;
  onShootTarget: (id: string) => void;
}

interface BlastEffect {
  id: number;
  origin: THREE.Vector3;
  targetPos: THREE.Vector3;
  progress: number;
}

/**
 * WebXR Laser Blaster Controller.
 * Handles continuous raycasting from the Quest controller or emulator pointer,
 * renders directional laser pointer, firing beam projectile, and impact explosion.
 */
export const XRBlasterController = memo(function XRBlasterController({
  targets,
  materializedIds,
  onHoverTarget,
  onShootTarget,
}: XRBlasterControllerProps) {
  const { gl, camera } = useThree();
  const [blasts, setBlasts] = useState<BlastEffect[]>([]);
  const blastSeq = useRef(0);
  const hoveredRef = useRef<string | null>(null);

  // Setup WebXR Controller Target Ray & Trigger Listener
  useEffect(() => {
    if (!gl?.xr?.getController) return;

    const controller = gl.xr.getController(0);
    const raycaster = new THREE.Raycaster();
    const tempMatrix = new THREE.Matrix4();

    const onSelect = () => {
      // Find candidate targets in scene that are not yet materialized
      const activeTargets = targets.filter((t) => !materializedIds.has(t.id));
      if (activeTargets.length === 0) return;

      // Extract ray origin and direction from controller
      tempMatrix.identity().extractRotation(controller.matrixWorld);
      const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
      const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(tempMatrix).normalize();

      raycaster.ray.origin.copy(origin);
      raycaster.ray.direction.copy(direction);
      if (camera) raycaster.camera = camera;

      // Check collision with all active targets
      let closestTarget: SpatialTarget | null = null;
      let closestDist = Infinity;

      for (const t of activeTargets) {
        const targetPos = new THREE.Vector3(...t.position);
        const dist = raycaster.ray.distanceToPoint(targetPos);
        if (dist <= t.hitRadius && dist < closestDist) {
          closestDist = dist;
          closestTarget = t;
        }
      }

      // If hit, spawn blaster beam effect and notify parent
      if (closestTarget) {
        const hitTargetPos = new THREE.Vector3(...closestTarget.position);
        blastSeq.current += 1;
        setBlasts((prev) => [
          ...prev,
          {
            id: blastSeq.current,
            origin: origin.clone(),
            targetPos: hitTargetPos,
            progress: 0,
          },
        ]);

        // Haptic feedback
        try {
          const session = gl.xr.getSession();
          const source = session?.inputSources?.[0];
          const actuator = source?.gamepad?.hapticActuators?.[0];
          actuator?.pulse(0.8, 120);
        } catch {
          // Non-critical if haptic actuator is unavailable (desktop emulator)
        }

        onShootTarget(closestTarget.id);
      }
    };

    controller.addEventListener('selectstart', onSelect);
    return () => {
      controller.removeEventListener('selectstart', onSelect);
    };
  }, [gl, camera, targets, materializedIds, onShootTarget]);

  // Frame update for blaster projectile animations & continuous hover tracking
  useFrame((_, delta) => {
    // 1. Advance and prune active blasts
    if (blasts.length > 0) {
      setBlasts((prev) =>
        prev
          .map((b) => ({ ...b, progress: b.progress + delta * 3.5 }))
          .filter((b) => b.progress < 1.0)
      );
    }

    // 2. Track hover target in WebXR
    if (gl?.xr?.isPresenting) {
      const controller = gl.xr.getController(0);
      const raycaster = new THREE.Raycaster();
      const tempMatrix = new THREE.Matrix4();
      tempMatrix.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix).normalize();

      const activeTargets = targets.filter((t) => !materializedIds.has(t.id));
      let currentHover: string | null = null;
      let minDist = Infinity;

      for (const t of activeTargets) {
        const targetPos = new THREE.Vector3(...t.position);
        const dist = raycaster.ray.distanceToPoint(targetPos);
        if (dist <= t.hitRadius && dist < minDist) {
          minDist = dist;
          currentHover = t.id;
        }
      }

      if (currentHover !== hoveredRef.current) {
        hoveredRef.current = currentHover;
        onHoverTarget(currentHover);
      }
    }
  });

  return (
    <group name="xr-blaster-effects">
      {/* Dynamic Laser Projectiles & Impact Bursts */}
      {blasts.map((b) => {
        const curPos = new THREE.Vector3().lerpVectors(
          b.origin,
          b.targetPos,
          Math.min(1, b.progress)
        );
        const impactScale = Math.max(0.01, (b.progress - 0.7) * 4.0);

        return (
          <group key={b.id}>
            {/* Blaster projectile sphere traveling forward */}
            {b.progress < 0.8 && (
              <mesh position={curPos}>
                <sphereGeometry args={[0.035, 12, 12]} />
                <meshBasicMaterial color="#38bdf8" />
              </mesh>
            )}

            {/* Impact Flash Shockwave at target position */}
            {b.progress >= 0.7 && (
              <group position={b.targetPos}>
                <mesh scale={[impactScale, impactScale, impactScale]}>
                  <ringGeometry args={[0.05, 0.28, 24]} />
                  <meshBasicMaterial
                    color="#f59e0b"
                    transparent
                    opacity={Math.max(0, 1 - (b.progress - 0.7) / 0.3)}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
});
