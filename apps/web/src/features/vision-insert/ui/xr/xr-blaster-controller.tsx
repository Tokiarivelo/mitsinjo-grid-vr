'use client';

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  createControllerGripModel,
  createHandMesh,
  HAND_JOINTS,
} from '@/features/microgrid-3d/utils/xr-hands';
import type { SpatialTarget } from './spatial-projection';
import { playLaserShootSound, playScanRadarSound, playTargetHitSound } from './xr-audio-fx';

export interface XRBlasterControllerProps {
  targets: SpatialTarget[];
  materializedIds: Set<string>;
  connectedIds: Set<string>;
  onHoverTarget: (id: string | null) => void;
  onShootTarget: (id: string) => void;
  onTriggerScan?: () => void;
}

// Module-level reusable singletons to eliminate all heap allocations at 90 FPS
const _raycaster = new THREE.Raycaster();
const _tempMatrix = new THREE.Matrix4();
const _vOrigin = new THREE.Vector3();
const _vDirection = new THREE.Vector3();
const _vHitEndpoint = new THREE.Vector3();
const _vTargetPos = new THREE.Vector3();
const _vCurPos = new THREE.Vector3();
const _FORWARD = new THREE.Vector3(0, 0, -1);
const _mouseVec = new THREE.Vector2();

const AIR_BUTTON_ID = 'spatial-air-button';
const AIR_BUTTON_POS = new THREE.Vector3(0, 1.45, -1.2);
const AIR_BUTTON_RADIUS = 0.55;

/**
 * MultiPointer XR Blaster & Pointer Interaction Controller (VS-T4).
 * Aligned with Meta IWSDK MultiPointer specifications:
 * - Tracks primary & secondary WebXR controllers (controller 0 and 1).
 * - Desktop mirror / mouse pointer forwarding fallback.
 * - Dual targeting: Floating Air Button ("Scanner la pièce") and detected 3D targets.
 * - Procedural laser ray beam, lock-on pips, shockwave bursts, and haptic feedback.
 */
export const XRBlasterController = memo(function XRBlasterController({
  targets,
  materializedIds: _materializedIds,
  connectedIds: _connectedIds,
  onHoverTarget,
  onShootTarget,
  onTriggerScan,
}: XRBlasterControllerProps) {
  const { gl, camera, scene } = useThree();
  const hoveredRef = useRef<string | null>(null);
  const mouseNdcRef = useRef<{ x: number; y: number } | null>(null);

  const handsRef = useRef<
    Array<{
      group: THREE.Group & { joints?: Record<string, THREE.Group & { jointRadius?: number }> };
      mesh: THREE.InstancedMesh;
    }>
  >([]);
  const gripsRef = useRef<THREE.Object3D[]>([]);
  const modelRefs = useRef<Array<{ parent: THREE.Object3D; child: THREE.Object3D }>>([]);

  // Imperative active blast tracking (zero React state updates in useFrame)
  const activeBlastRef = useRef<{
    origin: THREE.Vector3;
    targetPos: THREE.Vector3;
    progress: number;
  } | null>(null);

  const projectileMeshRef = useRef<THREE.Mesh>(null);
  const impactMeshRef = useRef<THREE.Mesh>(null);
  const pointerPipRef = useRef<THREE.Mesh>(null);

  // Shared shoot resolution function
  const triggerShot = useCallback(
    (origin: THREE.Vector3, direction: THREE.Vector3) => {
      _raycaster.ray.origin.copy(origin);
      _raycaster.ray.direction.copy(direction);
      if (camera) _raycaster.camera = camera;

      // 1. Test Air Button hit
      const distToAirButton = _raycaster.ray.distanceToPoint(AIR_BUTTON_POS);
      if (distToAirButton <= AIR_BUTTON_RADIUS && onTriggerScan) {
        activeBlastRef.current = {
          origin: origin.clone(),
          targetPos: AIR_BUTTON_POS.clone(),
          progress: 0,
        };
        playLaserShootSound();
        playScanRadarSound();
        onTriggerScan();
        return;
      }

      // 2. Test detected appliance targets
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
          origin: origin.clone(),
          targetPos: hitTargetPos,
          progress: 0,
        };

        // Play laser blast and impact sounds
        playLaserShootSound();
        playTargetHitSound();

        // Haptic feedback
        try {
          const session = gl.xr?.getSession?.();
          const source = session?.inputSources?.[0];
          const actuator = source?.gamepad?.hapticActuators?.[0];
          actuator?.pulse(0.8, 120);
        } catch {
          // Non-critical if haptic actuator is unavailable (desktop emulator)
        }

        onShootTarget(closestTarget.id);
        return;
      }

      // 3. Fallback: Raycast scene children for interactive objects (HUD toggle, diegetic controls)
      if (scene) {
        let intersects: THREE.Intersection[] = [];
        try {
          intersects = _raycaster.intersectObjects(scene.children, true);
        } catch {
          intersects = [];
        }
        for (const hit of intersects) {
          let curr: THREE.Object3D | null = hit.object;
          while (curr) {
            const handler = curr.userData?.onSelect || curr.userData?.onClick;
            if (typeof handler === 'function') {
              playLaserShootSound();
              handler({ stopPropagation: () => {} });
              return;
            }
            curr = curr.parent;
          }
        }
      }
    },
    [camera, gl, targets, onShootTarget, onTriggerScan, scene]
  );

  // Setup WebXR Controllers & Articulated Hands (Touch controllers + Hand tracking)
  useEffect(() => {
    if (!gl?.xr?.getController) return;

    const c0 = gl.xr.getController(0);
    const c1 = gl.xr.getController(1);

    const onSelect0 = () => {
      _tempMatrix.identity().extractRotation(c0.matrixWorld);
      _vOrigin.setFromMatrixPosition(c0.matrixWorld);
      _vDirection.copy(_FORWARD).applyMatrix4(_tempMatrix).normalize();
      triggerShot(_vOrigin, _vDirection);
    };

    const onSelect1 = () => {
      _tempMatrix.identity().extractRotation(c1.matrixWorld);
      _vOrigin.setFromMatrixPosition(c1.matrixWorld);
      _vDirection.copy(_FORWARD).applyMatrix4(_tempMatrix).normalize();
      triggerShot(_vOrigin, _vDirection);
    };

    c0.addEventListener('selectstart', onSelect0);
    c0.addEventListener('select', onSelect0);
    c1.addEventListener('selectstart', onSelect1);
    c1.addEventListener('select', onSelect1);

    // Attach Hand Tracking meshes & Touch Controller Grip visuals
    if (gl.xr.getHand && scene) {
      for (let i = 0; i < 2; i++) {
        // Articulated Hand tracking joints (25 joints)
        const handGroup = gl.xr.getHand(i) as THREE.Group & {
          joints?: Record<string, THREE.Group & { jointRadius?: number }>;
        };
        const handMesh = createHandMesh();
        handGroup.add(handMesh);
        scene.add(handGroup);
        handsRef.current.push({ group: handGroup, mesh: handMesh });
        modelRefs.current.push({ parent: handGroup, child: handMesh });

        // Touch Controller 3D Model
        const getGrip = (gl.xr as unknown as { getControllerGrip?: (idx: number) => THREE.Group })
          .getControllerGrip;
        if (typeof getGrip === 'function') {
          const grip = getGrip.call(gl.xr, i);
          const gripModel = createControllerGripModel();
          gripModel.visible = false;
          grip.add(gripModel);
          scene.add(grip);
          gripsRef.current.push(gripModel);
          modelRefs.current.push({ parent: grip, child: gripModel });
        }
      }
    }

    return () => {
      c0.removeEventListener('selectstart', onSelect0);
      c0.removeEventListener('select', onSelect0);
      c1.removeEventListener('selectstart', onSelect1);
      c1.removeEventListener('select', onSelect1);

      for (const { parent, child } of modelRefs.current) {
        parent.remove(child);
      }
      for (const h of handsRef.current) {
        if (scene) scene.remove(h.group);
      }
      handsRef.current = [];
      gripsRef.current = [];
      modelRefs.current = [];
    };
  }, [gl, scene, triggerShot]);

  // Desktop Mouse Cursor Aiming and Direct Clicking (Unprojects mouse NDC to 3D Ray)
  useEffect(() => {
    const dom = gl.domElement;
    if (!dom) return;

    const onPointerMove = (e: MouseEvent) => {
      if (!camera) return;
      const rect = dom.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      mouseNdcRef.current = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      };
    };

    const onPointerDown = (e: MouseEvent) => {
      if (e.button !== 0 || !camera) return;
      const rect = dom.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      _mouseVec.set(mouseX, mouseY);
      _raycaster.setFromCamera(_mouseVec, camera);
      triggerShot(_raycaster.ray.origin, _raycaster.ray.direction);
    };

    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerdown', onPointerDown);
    return () => {
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerdown', onPointerDown);
    };
  }, [gl, camera, triggerShot]);

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

  // Frame update for articulated hands, blaster projectile animations & continuous hover tracking
  useFrame((_, delta) => {
    // 0. Update hand tracking joint matrices & mutually exclude controller grip models
    let anyHandActive = false;
    if (handsRef.current.length > 0) {
      const scaleTmp = new THREE.Vector3();
      const defaultRadius = 0.009;
      for (const h of handsRef.current) {
        const joints = h.group.joints;
        if (!joints || Object.keys(joints).length === 0) {
          h.mesh.visible = false;
          continue;
        }
        let activeCount = 0;
        for (let j = 0; j < HAND_JOINTS.length; j++) {
          const name = HAND_JOINTS[j];
          if (!name) continue;
          const joint = joints[name];
          if (joint && joint.visible) {
            scaleTmp.setScalar(joint.jointRadius || defaultRadius);
            _tempMatrix.compose(joint.position, joint.quaternion, scaleTmp);
            h.mesh.setMatrixAt(j, _tempMatrix);
            activeCount++;
          }
        }
        h.mesh.count = activeCount;
        h.mesh.instanceMatrix.needsUpdate = true;
        const isThisHandActive = activeCount > 0 && !!gl.xr?.isPresenting;
        h.mesh.visible = isThisHandActive;
        if (isThisHandActive) anyHandActive = true;
      }
    }

    // Hide controller grip models when Hand Tracking is active or when not presenting in VR
    const isPresenting = !!gl.xr?.isPresenting;
    for (const gripModel of gripsRef.current) {
      gripModel.visible = isPresenting && !anyHandActive;
    }

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

    // 2. Track hover target and update aiming beam (Desktop Mouse or WebXR Controller 0/1)
    let hasAim = false;
    if (mouseNdcRef.current && camera) {
      _mouseVec.set(mouseNdcRef.current.x, mouseNdcRef.current.y);
      _raycaster.setFromCamera(_mouseVec, camera);
      _vOrigin.copy(_raycaster.ray.origin);
      _vDirection.copy(_raycaster.ray.direction);
      hasAim = true;
    } else if (gl?.xr?.isPresenting) {
      const c0 = gl.xr.getController(0);
      const c1 = gl.xr.getController(1);
      const activeCtrl = c0 && c0.matrixWorld.elements[15] !== 0 ? c0 : c1;
      if (activeCtrl) {
        _tempMatrix.identity().extractRotation(activeCtrl.matrixWorld);
        _vOrigin.setFromMatrixPosition(activeCtrl.matrixWorld);
        _vDirection.copy(_FORWARD).applyMatrix4(_tempMatrix).normalize();
        hasAim = true;
      }
    } else if (camera) {
      _vOrigin.copy(camera.position);
      camera.getWorldDirection(_vDirection);
      hasAim = true;
    }

    if (hasAim) {
      _raycaster.ray.origin.copy(_vOrigin);
      _raycaster.ray.direction.copy(_vDirection);
      if (camera) _raycaster.camera = camera;

      let currentHover: string | null = null;
      let minDist = Infinity;
      _vHitEndpoint.copy(_vOrigin).addScaledVector(_vDirection, 2.5);

      // 2a. Check Air Button hover
      const distAirButton = _raycaster.ray.distanceToPoint(AIR_BUTTON_POS);
      if (distAirButton <= AIR_BUTTON_RADIUS) {
        currentHover = AIR_BUTTON_ID;
        minDist = distAirButton;
        _vHitEndpoint.copy(AIR_BUTTON_POS);
      }

      // 2b. Check targets hover
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
      const beamColor =
        currentHover === AIR_BUTTON_ID ? '#c084fc' : currentHover ? '#f59e0b' : '#38bdf8';
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
    <group name="xr-blaster-controller-root">
      {/* Real-time Aiming Laser Line */}
      <primitive object={pointerObject} />

      {/* Target Aiming Reticle Dot at Endpoint */}
      <mesh ref={pointerPipRef} visible={false}>
        <sphereGeometry args={[0.022, 16, 16]} />
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
