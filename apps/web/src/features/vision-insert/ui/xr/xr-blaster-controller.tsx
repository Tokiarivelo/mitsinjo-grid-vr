'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
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

// Module-level reusable scratch objects to avoid any heap allocation in useFrame
const _raycaster = new THREE.Raycaster();
const _tempMatrix = new THREE.Matrix4();
const _vOrigin = new THREE.Vector3();
const _vDirection = new THREE.Vector3();
const _vTargetPos = new THREE.Vector3();
const _vHitEndpoint = new THREE.Vector3();
const _vCurPos = new THREE.Vector3();
const _FORWARD = new THREE.Vector3(0, 0, -1);

/**
 * WebXR Laser Blaster Controller.
 * Handles continuous raycasting from the Quest controller or emulator pointer with 0 heap allocation,
 * renders directional aiming laser pointer, and animates imperatively to avoid React re-render lag.
 */
export const XRBlasterController = memo(function XRBlasterController({
  targets,
  materializedIds,
  onHoverTarget,
  onShootTarget,
}: XRBlasterControllerProps) {
  const { gl, camera } = useThree();
  const hoveredRef = useRef<string | null>(null);

  // Imperative active blast tracking (zero React state updates in useFrame)
  const activeBlastRef = useRef<{
    origin: THREE.Vector3;
    targetPos: THREE.Vector3;
    progress: number;
  } | null>(null);

  const projectileMeshRef = useRef<THREE.Mesh>(null);
  const impactMeshRef = useRef<THREE.Mesh>(null);
  const pointerPipRef = useRef<THREE.Mesh>(null);

  // Setup WebXR Controller Target Ray & Trigger Listener
  useEffect(() => {
    if (!gl?.xr?.getController) return;

    const controller = gl.xr.getController(0);

    const onSelect = () => {
      if (targets.length === 0) return;

      _tempMatrix.identity().extractRotation(controller.matrixWorld);
      _vOrigin.setFromMatrixPosition(controller.matrixWorld);
      _vDirection.copy(_FORWARD).applyMatrix4(_tempMatrix).normalize();

      _raycaster.ray.origin.copy(_vOrigin);
      _raycaster.ray.direction.copy(_vDirection);
      if (camera) _raycaster.camera = camera;

      let closestTarget: SpatialTarget | null = null;
      let closestDist = Infinity;

      for (const t of targets) {
        _vTargetPos.set(t.position[0], t.position[1], t.position[2]);
        const dist = _raycaster.ray.distanceToPoint(_vTargetPos);
        const radius = t.hitRadius * 1.35;
        if (dist <= radius && dist < closestDist) {
          closestDist = dist;
          closestTarget = t;
        }
      }

      if (closestTarget) {
        const hitTargetPos = new THREE.Vector3(...closestTarget.position);

        activeBlastRef.current = {
          origin: _vOrigin.clone(),
          targetPos: hitTargetPos,
          progress: 0,
        };

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

  useEffect(() => {
    return () => {
      pointerObject.geometry.dispose();
      (pointerObject.material as THREE.Material).dispose();
    };
  }, [pointerObject]);

  // Frame update for blaster projectile animations & continuous hover tracking
  useFrame((_, delta) => {
    // 1. Imperative animation of active projectile and impact shockwave (0 re-renders)
    if (activeBlastRef.current) {
      const b = activeBlastRef.current;
      b.progress += delta * 3.5;
      if (b.progress >= 1.0) {
        activeBlastRef.current = null;
        if (projectileMeshRef.current) projectileMeshRef.current.visible = false;
        if (impactMeshRef.current) impactMeshRef.current.visible = false;
      } else {
        _vCurPos.lerpVectors(b.origin, b.targetPos, Math.min(1, b.progress));
        if (projectileMeshRef.current) {
          projectileMeshRef.current.visible = b.progress < 0.8;
          projectileMeshRef.current.position.copy(_vCurPos);
        }
        if (impactMeshRef.current) {
          impactMeshRef.current.visible = b.progress >= 0.7;
          if (b.progress >= 0.7) {
            impactMeshRef.current.position.copy(b.targetPos);
            const scale = Math.max(0.01, (b.progress - 0.7) * 4.0);
            impactMeshRef.current.scale.set(scale, scale, scale);
            const mat = impactMeshRef.current.material as THREE.MeshBasicMaterial;
            mat.opacity = Math.max(0, 1 - (b.progress - 0.7) / 0.3);
          }
        }
      }
    }

    // 2. Track hover target and update aiming beam in WebXR with 0 heap allocation
    if (gl?.xr?.isPresenting) {
      const controller = gl.xr.getController(0);

      _tempMatrix.identity().extractRotation(controller.matrixWorld);
      _vOrigin.setFromMatrixPosition(controller.matrixWorld);
      _vDirection.copy(_FORWARD).applyMatrix4(_tempMatrix).normalize();

      _raycaster.ray.origin.copy(_vOrigin);
      _raycaster.ray.direction.copy(_vDirection);
      if (camera) _raycaster.camera = camera;

      let currentHover: string | null = null;
      let minDist = Infinity;
      _vHitEndpoint.copy(_vOrigin).addScaledVector(_vDirection, 2.5);

      for (const t of targets) {
        _vTargetPos.set(t.position[0], t.position[1], t.position[2]);
        const dist = _raycaster.ray.distanceToPoint(_vTargetPos);
        const radius = t.hitRadius * 1.35;
        if (dist <= radius && dist < minDist) {
          minDist = dist;
          currentHover = t.id;
          _vHitEndpoint.copy(_vTargetPos);
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
        attr.setXYZ(0, _vOrigin.x, _vOrigin.y, _vOrigin.z);
        attr.setXYZ(1, _vHitEndpoint.x, _vHitEndpoint.y, _vHitEndpoint.z);
        attr.needsUpdate = true;
      }
      const beamColor = currentHover ? '#f59e0b' : '#38bdf8';
      (pointerObject.material as THREE.LineBasicMaterial).color.set(beamColor);

      if (pointerPipRef.current) {
        pointerPipRef.current.visible = true;
        pointerPipRef.current.position.copy(_vHitEndpoint);
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

      {/* Imperatively Animated Blaster Projectile & Impact Burst (Zero React Re-renders) */}
      <mesh ref={projectileMeshRef} visible={false}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>

      <mesh ref={impactMeshRef} visible={false}>
        <ringGeometry args={[0.05, 0.28, 24]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={1} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
});
