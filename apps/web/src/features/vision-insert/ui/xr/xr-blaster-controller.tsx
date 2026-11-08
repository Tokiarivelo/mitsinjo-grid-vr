'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { SpatialTarget } from './spatial-projection';
import { playLaserShootSound, playTargetHitSound } from './xr-audio-fx';

export interface XRBlasterControllerProps {
  targets: SpatialTarget[];
  materializedIds: Set<string>;
  connectedIds?: Set<string>;
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
      // Find candidate targets in scene (both unmaterialized targets and materialized appliances)
      if (targets.length === 0) return;

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

      for (const t of targets) {
        const targetPos = new THREE.Vector3(...t.position);
        const dist = raycaster.ray.distanceToPoint(targetPos);
        const radius = t.hitRadius * 1.35;
        if (dist <= radius && dist < closestDist) {
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

        // Play laser blast and impact sounds
        playLaserShootSound();
        playTargetHitSound();

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

  // Real-time Aiming Laser Pointer Beam in WebXR
  const pointerObject = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([0, 0, 0, 0, 0, -2.5]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.65,
    });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    return line;
  }, []);

  const pointerPipRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    return () => {
      pointerObject.geometry.dispose();
      (pointerObject.material as THREE.Material).dispose();
    };
  }, [pointerObject]);

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

    // 2. Track hover target and update aiming beam in WebXR
    if (gl?.xr?.isPresenting) {
      const controller = gl.xr.getController(0);
      const raycaster = new THREE.Raycaster();
      const tempMatrix = new THREE.Matrix4();
      tempMatrix.identity().extractRotation(controller.matrixWorld);
      const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
      const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(tempMatrix).normalize();

      raycaster.ray.origin.copy(origin);
      raycaster.ray.direction.copy(direction);
      if (camera) raycaster.camera = camera;

      let currentHover: string | null = null;
      let minDist = Infinity;
      const hitEndpoint = origin.clone().addScaledVector(direction, 2.5);

      for (const t of targets) {
        const targetPos = new THREE.Vector3(...t.position);
        const dist = raycaster.ray.distanceToPoint(targetPos);
        const radius = t.hitRadius * 1.35;
        if (dist <= radius && dist < minDist) {
          minDist = dist;
          currentHover = t.id;
          hitEndpoint.copy(targetPos);
        }
      }

      if (currentHover !== hoveredRef.current) {
        hoveredRef.current = currentHover;
        onHoverTarget(currentHover);
      }

      // Update pointing laser line and targeting reticle pip
      pointerObject.visible = true;
      const attr = pointerObject.geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (attr) {
        attr.setXYZ(0, origin.x, origin.y, origin.z);
        attr.setXYZ(1, hitEndpoint.x, hitEndpoint.y, hitEndpoint.z);
        attr.needsUpdate = true;
      }
      const beamColor = currentHover ? '#f59e0b' : '#38bdf8';
      (pointerObject.material as THREE.LineBasicMaterial).color.set(beamColor);

      if (pointerPipRef.current) {
        pointerPipRef.current.visible = true;
        pointerPipRef.current.position.copy(hitEndpoint);
        (pointerPipRef.current.material as THREE.MeshBasicMaterial).color.set(beamColor);
      }
    } else {
      pointerObject.visible = false;
      if (pointerPipRef.current) {
        pointerPipRef.current.visible = false;
      }
    }
  });

  return (
    <group name="xr-blaster-effects">
      {/* Real-time Aiming Laser Beam & Reticle Dot */}
      <primitive object={pointerObject} />
      <mesh ref={pointerPipRef} visible={false}>
        <sphereGeometry args={[0.015, 12, 12]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>

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
