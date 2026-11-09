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

const _vTipPos = new THREE.Vector3();
const _vThumbPos = new THREE.Vector3();
const _vWristPos = new THREE.Vector3();
const _vHandRayDir = new THREE.Vector3();
const _vCtrlPos = new THREE.Vector3();

const AIR_BUTTON_ID = 'spatial-air-button';
const AIR_BUTTON_POS = new THREE.Vector3(0, 1.45, -1.2);
const AIR_BUTTON_RADIUS = 0.55;
const DIRECT_TOUCH_RADIUS = 0.22;

function createPointerLine(): THREE.Line {
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
}

/**
 * MultiPointer XR Blaster & Pointer Interaction Controller (VS-T4).
 * Aligned with Meta IWSDK MultiPointer specifications:
 * - Dual Controller Tracking (Controller 0 and 1) with dual independent aiming lasers.
 * - Articulated Hand Tracking with Direct Touch (index fingertip touch) and Far Interaction (Pinch).
 * - Interactive scene fallback with userData.onSelect / userData.onClick.
 * - Desktop mirror / mouse pointer forwarding fallback.
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

  const lastTouchTimeRef = useRef(0);
  const pinchActiveRef = useRef<[boolean, boolean]>([false, false]);

  // Imperative active blast tracking (zero React state updates in useFrame)
  const activeBlastRef = useRef<{
    origin: THREE.Vector3;
    targetPos: THREE.Vector3;
    progress: number;
  } | null>(null);

  const projectileMeshRef = useRef<THREE.Mesh>(null);
  const impactMeshRef = useRef<THREE.Mesh>(null);
  const pointerPip0Ref = useRef<THREE.Mesh>(null);
  const pointerPip1Ref = useRef<THREE.Mesh>(null);

  const pointer0 = useMemo(() => createPointerLine(), []);
  const pointer1 = useMemo(() => createPointerLine(), []);

  useEffect(() => {
    return () => {
      pointer0.geometry.dispose();
      (pointer0.material as THREE.Material).dispose();
      pointer1.geometry.dispose();
      (pointer1.material as THREE.Material).dispose();
    };
  }, [pointer0, pointer1]);

  // Shared shoot resolution function (invoked by controllers, pinch gestures, or mouse)
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

  // Setup WebXR Controllers & Articulated Hands
  useEffect(() => {
    if (!gl?.xr?.getController) return;

    const c0 = gl.xr.getController(0);
    const c1 = gl.xr.getController(1);

    if (scene) {
      scene.add(c0);
      scene.add(c1);
    }

    const onSelect0 = () => {
      c0.updateMatrixWorld(true);
      _tempMatrix.identity().extractRotation(c0.matrixWorld);
      _vOrigin.setFromMatrixPosition(c0.matrixWorld);
      _vDirection.copy(_FORWARD).applyMatrix4(_tempMatrix).normalize();
      triggerShot(_vOrigin, _vDirection);
    };

    const onSelect1 = () => {
      c1.updateMatrixWorld(true);
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

      if (scene) {
        scene.remove(c0);
        scene.remove(c1);
      }

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

  // Desktop Mouse Cursor Aiming and Direct Clicking (Fallback when on PC)
  useEffect(() => {
    const dom = gl.domElement;
    if (!dom) return;

    const onPointerMove = (e: MouseEvent) => {
      if (!camera) return;
      const rect = dom.getBoundingClientRect();
      const w = rect.width > 0 ? rect.width : window.innerWidth || 800;
      const h = rect.height > 0 ? rect.height : window.innerHeight || 600;
      const clientX = typeof e.clientX === 'number' ? e.clientX : w / 2;
      const clientY = typeof e.clientY === 'number' ? e.clientY : h / 2;
      const left = rect.left || 0;
      const top = rect.top || 0;
      mouseNdcRef.current = {
        x: ((clientX - left) / w) * 2 - 1,
        y: -((clientY - top) / h) * 2 + 1,
      };
    };

    const onPointerDown = (e: MouseEvent) => {
      if ((typeof e.button === 'number' && e.button !== 0) || !camera) return;
      const rect = dom.getBoundingClientRect();
      const w = rect.width > 0 ? rect.width : window.innerWidth || 800;
      const h = rect.height > 0 ? rect.height : window.innerHeight || 600;
      const clientX = typeof e.clientX === 'number' ? e.clientX : w / 2;
      const clientY = typeof e.clientY === 'number' ? e.clientY : h / 2;
      const left = rect.left || 0;
      const top = rect.top || 0;
      const mouseX = ((clientX - left) / w) * 2 - 1;
      const mouseY = -((clientY - top) / h) * 2 + 1;
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

  // Frame update for controllers, articulated hands, direct touch, & blaster projectiles
  useFrame((_, delta) => {
    const isPresenting = !!gl.xr?.isPresenting;
    const now = performance.now();
    const canTouch = now - lastTouchTimeRef.current > 750;

    let anyHandActive = false;
    let hoveredFromInteraction: string | null = null;

    // -------------------------------------------------------------
    // 0. Update Hand Tracking Joints & Direct Touch / Pinch Detection
    // -------------------------------------------------------------
    if (handsRef.current.length > 0) {
      const scaleTmp = new THREE.Vector3();
      const defaultRadius = 0.009;

      for (let hIdx = 0; hIdx < handsRef.current.length; hIdx++) {
        const h = handsRef.current[hIdx];
        if (!h) continue;
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
        const isThisHandActive = activeCount > 0 && isPresenting;
        h.mesh.visible = isThisHandActive;

        if (isThisHandActive) {
          anyHandActive = true;

          // Detect Direct Touch (Near Interaction with Index Fingertip or Wrist)
          const indexJoint = joints['index-finger-tip'] || joints['wrist'];
          const thumbJoint = joints['thumb-tip'];
          const wristJoint = joints['wrist'];

          if (indexJoint) {
            indexJoint.getWorldPosition(_vTipPos);

            // A. Check Direct Touch on Air Button
            const distAir = _vTipPos.distanceTo(AIR_BUTTON_POS);
            if (distAir <= AIR_BUTTON_RADIUS) {
              hoveredFromInteraction = AIR_BUTTON_ID;
              if (distAir <= DIRECT_TOUCH_RADIUS && canTouch && onTriggerScan) {
                lastTouchTimeRef.current = now;
                playLaserShootSound();
                playScanRadarSound();
                onTriggerScan();
              }
            }

            // B. Check Direct Touch on Targets
            for (const t of targets) {
              _vTargetPos.set(t.position[0], t.position[1], t.position[2]);
              const distT = _vTipPos.distanceTo(_vTargetPos);
              const hitR = Math.max(0.35, t.hitRadius * 1.4);
              if (distT <= hitR) {
                hoveredFromInteraction = t.id;
                if (distT <= Math.max(DIRECT_TOUCH_RADIUS, t.hitRadius) && canTouch) {
                  lastTouchTimeRef.current = now;
                  playLaserShootSound();
                  playTargetHitSound();
                  onShootTarget(t.id);
                }
              }
            }
          }

          // C. Detect Pinch Gesture (Far Interaction)
          if (indexJoint && thumbJoint && wristJoint) {
            thumbJoint.getWorldPosition(_vThumbPos);
            const pinchDist = _vTipPos.distanceTo(_vThumbPos);
            const isPinching = pinchDist < 0.032;
            const wasPinching = pinchActiveRef.current[hIdx] ?? false;

            if (isPinching && !wasPinching && canTouch) {
              lastTouchTimeRef.current = now;
              wristJoint.getWorldPosition(_vWristPos);
              _vHandRayDir.subVectors(_vTipPos, _vWristPos).normalize();
              if (_vHandRayDir.lengthSq() < 0.001) _vHandRayDir.set(0, 0, -1);
              triggerShot(_vWristPos, _vHandRayDir);
            }
            pinchActiveRef.current[hIdx] = isPinching;
          }
        }
      }
    }

    // Mutually exclude controller grip models when Hand Tracking is active
    for (const gripModel of gripsRef.current) {
      gripModel.visible = isPresenting && !anyHandActive;
    }

    // -------------------------------------------------------------
    // 1. Imperative animation of active projectile and impact shockwave
    // -------------------------------------------------------------
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
          projectileMeshRef.current.position?.copy?.(_vCurPos);
        }
        if (impactMeshRef.current) {
          impactMeshRef.current.visible = b.progress >= 0.7;
          if (b.progress >= 0.7) {
            impactMeshRef.current.position?.copy?.(b.targetPos);
            const scale = Math.max(0.01, (b.progress - 0.7) * 4.0);
            impactMeshRef.current.scale?.set?.(scale, scale, scale);
            const mat = impactMeshRef.current.material as THREE.MeshBasicMaterial | undefined;
            if (mat) mat.opacity = Math.max(0, 1 - (b.progress - 0.7) / 0.3);
          }
        }
      }
    }

    // -------------------------------------------------------------
    // 2. Controller & Hand Ray Aiming Beams (MultiPointer Support)
    // -------------------------------------------------------------
    if (isPresenting && !anyHandActive) {
      // Controllers Mode: Update Controller 0 and Controller 1 rays
      const c0 = gl.xr?.getController(0);
      const c1 = gl.xr?.getController(1);

      const updateCtrlBeam = (
        ctrl: THREE.Group | undefined,
        pointer: THREE.Line,
        pip: THREE.Mesh | null
      ) => {
        if (!ctrl || ctrl.matrixWorld.elements[15] === 0) {
          pointer.visible = false;
          if (pip) pip.visible = false;
          return;
        }

        ctrl.updateMatrixWorld(true);
        _tempMatrix.identity().extractRotation(ctrl.matrixWorld);
        _vOrigin.setFromMatrixPosition(ctrl.matrixWorld);
        _vDirection.copy(_FORWARD).applyMatrix4(_tempMatrix).normalize();

        // Check direct touch proximity from controller
        _vCtrlPos.setFromMatrixPosition(ctrl.matrixWorld);
        const distAir = _vCtrlPos.distanceTo(AIR_BUTTON_POS);
        if (distAir <= AIR_BUTTON_RADIUS) {
          hoveredFromInteraction = AIR_BUTTON_ID;
          if (distAir <= DIRECT_TOUCH_RADIUS && canTouch && onTriggerScan) {
            lastTouchTimeRef.current = now;
            playLaserShootSound();
            playScanRadarSound();
            onTriggerScan();
          }
        }

        _raycaster.ray.origin.copy(_vOrigin);
        _raycaster.ray.direction.copy(_vDirection);
        if (camera) _raycaster.camera = camera;

        let ctrlHover: string | null = null;
        let minDist = Infinity;
        _vHitEndpoint.copy(_vOrigin).addScaledVector(_vDirection, 2.5);

        // Raycast Air Button
        const distAirButton = _raycaster.ray.distanceToPoint(AIR_BUTTON_POS);
        if (distAirButton <= AIR_BUTTON_RADIUS) {
          ctrlHover = AIR_BUTTON_ID;
          minDist = distAirButton;
          _vHitEndpoint.copy(AIR_BUTTON_POS);
        }

        // Raycast Targets
        for (const t of targets) {
          _vTargetPos.set(t.position[0], t.position[1], t.position[2]);
          const dist = _raycaster.ray.distanceToPoint(_vTargetPos);
          const radius = t.hitRadius * 1.35;
          if (dist <= radius && dist < minDist) {
            minDist = dist;
            ctrlHover = t.id;
            _vHitEndpoint.copy(_vTargetPos);
          }
        }

        if (ctrlHover) hoveredFromInteraction = ctrlHover;

        pointer.visible = true;
        const attr = pointer.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (attr) {
          attr.setXYZ(0, _vOrigin.x, _vOrigin.y, _vOrigin.z);
          attr.setXYZ(1, _vHitEndpoint.x, _vHitEndpoint.y, _vHitEndpoint.z);
          attr.needsUpdate = true;
        }
        const beamColor =
          ctrlHover === AIR_BUTTON_ID ? '#c084fc' : ctrlHover ? '#f59e0b' : '#38bdf8';
        (pointer.material as THREE.LineBasicMaterial).color.set(beamColor);

        if (pip) {
          pip.visible = true;
          pip.position?.copy?.(_vHitEndpoint);
          (pip.material as THREE.MeshBasicMaterial | undefined)?.color?.set?.(beamColor);
        }
      };

      updateCtrlBeam(c0, pointer0, pointerPip0Ref.current);
      updateCtrlBeam(c1, pointer1, pointerPip1Ref.current);
    } else if (isPresenting && anyHandActive) {
      // Hand Tracking Mode: Hand Ray from wrist to index finger tip
      pointer1.visible = false;
      if (pointerPip1Ref.current) pointerPip1Ref.current.visible = false;

      const activeHand = handsRef.current.find((h) => h.mesh.visible);
      const joints = activeHand?.group.joints;
      const indexTip = joints?.['index-finger-tip'];
      const wrist = joints?.['wrist'];

      if (indexTip && wrist) {
        wrist.getWorldPosition(_vOrigin);
        indexTip.getWorldPosition(_vTipPos);
        _vDirection.subVectors(_vTipPos, _vOrigin).normalize();

        _raycaster.ray.origin.copy(_vOrigin);
        _raycaster.ray.direction.copy(_vDirection);
        if (camera) _raycaster.camera = camera;

        let handHover: string | null = null;
        let minDist = Infinity;
        _vHitEndpoint.copy(_vOrigin).addScaledVector(_vDirection, 2.5);

        const distAirButton = _raycaster.ray.distanceToPoint(AIR_BUTTON_POS);
        if (distAirButton <= AIR_BUTTON_RADIUS) {
          handHover = AIR_BUTTON_ID;
          minDist = distAirButton;
          _vHitEndpoint.copy(AIR_BUTTON_POS);
        }

        for (const t of targets) {
          _vTargetPos.set(t.position[0], t.position[1], t.position[2]);
          const dist = _raycaster.ray.distanceToPoint(_vTargetPos);
          if (dist <= t.hitRadius * 1.35 && dist < minDist) {
            minDist = dist;
            handHover = t.id;
            _vHitEndpoint.copy(_vTargetPos);
          }
        }

        if (handHover) hoveredFromInteraction = handHover;

        pointer0.visible = true;
        const attr = pointer0.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (attr) {
          attr.setXYZ(0, _vOrigin.x, _vOrigin.y, _vOrigin.z);
          attr.setXYZ(1, _vHitEndpoint.x, _vHitEndpoint.y, _vHitEndpoint.z);
          attr.needsUpdate = true;
        }
        const beamColor =
          handHover === AIR_BUTTON_ID ? '#c084fc' : handHover ? '#f59e0b' : '#38bdf8';
        (pointer0.material as THREE.LineBasicMaterial).color.set(beamColor);

        if (pointerPip0Ref.current) {
          pointerPip0Ref.current.visible = true;
          pointerPip0Ref.current.position?.copy?.(_vHitEndpoint);
          (pointerPip0Ref.current.material as THREE.MeshBasicMaterial | undefined)?.color?.set?.(
            beamColor
          );
        }
      } else {
        pointer0.visible = false;
        if (pointerPip0Ref.current) pointerPip0Ref.current.visible = false;
      }
    } else {
      // Desktop Preview Mode: Camera Mouse Ray
      pointer1.visible = false;
      if (pointerPip1Ref.current) pointerPip1Ref.current.visible = false;

      let hasAim = false;
      if (mouseNdcRef.current && camera) {
        _mouseVec.set(mouseNdcRef.current.x, mouseNdcRef.current.y);
        _raycaster.setFromCamera(_mouseVec, camera);
        _vOrigin.copy(_raycaster.ray.origin);
        _vDirection.copy(_raycaster.ray.direction);
        hasAim = true;
      } else if (camera) {
        _vOrigin.copy(camera.position);
        camera.getWorldDirection(_vDirection);
        hasAim = true;
      }

      if (hasAim) {
        _raycaster.ray.origin.copy(_vOrigin);
        _raycaster.ray.direction.copy(_vDirection);
        if (camera) _raycaster.camera = camera;

        let mouseHover: string | null = null;
        let minDist = Infinity;
        _vHitEndpoint.copy(_vOrigin).addScaledVector(_vDirection, 2.5);

        const distAirButton = _raycaster.ray.distanceToPoint(AIR_BUTTON_POS);
        if (distAirButton <= AIR_BUTTON_RADIUS) {
          mouseHover = AIR_BUTTON_ID;
          minDist = distAirButton;
          _vHitEndpoint.copy(AIR_BUTTON_POS);
        }

        for (const t of targets) {
          _vTargetPos.set(t.position[0], t.position[1], t.position[2]);
          const dist = _raycaster.ray.distanceToPoint(_vTargetPos);
          if (dist <= t.hitRadius * 1.35 && dist < minDist) {
            minDist = dist;
            mouseHover = t.id;
            _vHitEndpoint.copy(_vTargetPos);
          }
        }

        if (mouseHover) hoveredFromInteraction = mouseHover;

        pointer0.visible = true;
        const attr = pointer0.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (attr) {
          attr.setXYZ(0, _vOrigin.x, _vOrigin.y, _vOrigin.z);
          attr.setXYZ(1, _vHitEndpoint.x, _vHitEndpoint.y, _vHitEndpoint.z);
          attr.needsUpdate = true;
        }
        const beamColor =
          mouseHover === AIR_BUTTON_ID ? '#c084fc' : mouseHover ? '#f59e0b' : '#38bdf8';
        (pointer0.material as THREE.LineBasicMaterial).color.set(beamColor);

        if (pointerPip0Ref.current) {
          pointerPip0Ref.current.visible = true;
          pointerPip0Ref.current.position?.copy?.(_vHitEndpoint);
          (pointerPip0Ref.current.material as THREE.MeshBasicMaterial | undefined)?.color?.set?.(
            beamColor
          );
        }
      } else {
        pointer0.visible = false;
        if (pointerPip0Ref.current) pointerPip0Ref.current.visible = false;
      }
    }

    // Dispatch hover change if state altered
    if (hoveredFromInteraction !== hoveredRef.current) {
      hoveredRef.current = hoveredFromInteraction;
      onHoverTarget(hoveredFromInteraction);
    }
  });

  return (
    <group name="xr-blaster-controller-root">
      {/* Aiming Laser Line 0 (Controller 0 / Hand / Desktop Mouse) */}
      <primitive object={pointer0} />

      {/* Target Aiming Reticle Dot 0 */}
      <mesh ref={pointerPip0Ref} visible={false}>
        <sphereGeometry args={[0.022, 16, 16]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>

      {/* Aiming Laser Line 1 (Controller 1) */}
      <primitive object={pointer1} />

      {/* Target Aiming Reticle Dot 1 */}
      <mesh ref={pointerPip1Ref} visible={false}>
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
