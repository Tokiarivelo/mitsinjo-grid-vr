'use client';

import { useCallback, type ComponentRef, useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { SectorId } from '@mitsinjo/engine';
import { cameraLerpFactor, cameraTweenExpired } from '../utils/camera-tween';
import {
  APPLIANCE_FOCUS_SCALE,
  focusCameraFor,
  focusOrbitAngle,
  type Vec3,
} from '../utils/camera-focus';
import { SECTOR_POSITIONS } from '../utils/to-scene-model';
import { terrainHeight } from '../utils/landscape';
import { setupXRHandsAndControllers, type XRHandsHandle } from '../utils/xr-hands';
import { buildWalkGrid, resolveWalk, type WalkGrid } from '../utils/walk-grid';
import { standNear, useXrHandoff } from '../utils/xr-handoff';
import { readXrKeys, xrWorldScale, XR_KEY_TURN_SPEED } from '../utils/xr-walk';
import {
  clampToInterior,
  INTERIOR_ORIGIN,
  turnRigAboutHead,
  type XrSpot,
} from '../utils/sim-xr-place';
import {
  isWalkStick,
  SNAP_TURN,
  STEP_DISTANCE,
  type XrControlAction,
} from '@/features/vision-insert/ui/xr/xr-controls';
import { XrControlsDriver } from '@/features/vision-insert/ui/xr/xr-controls-driver';
import { playSnapSound } from '@/features/vision-insert/ui/xr/xr-audio-fx';
import * as THREE from 'three';
import type { CameraPreset } from '../types';

export const CAMERA_PRESETS: Record<CameraPreset, { position: Vec3; target: Vec3 }> = {
  // Front three-quarter view: village in front, hills, lake and sunset behind.
  village: {
    position: [2, 10.5, 28],
    target: [0, 2.5, -8],
  },
  solar: {
    position: [-4, 10, 4],
    target: [-10, 0.5, -8],
  },
  battery: {
    position: [6, 7, 5],
    target: [0, 1, -2],
  },
  // From the gap between households and market: shelter, roof feeders and their kW tags.
  controller: {
    position: [-2, 8.5, 11.5],
    target: [0, 1.1, 1],
  },
  essential: {
    position: [14, 13, 16],
    target: [4, 1, -2],
  },
  // Standing at 1:1 human scale on the village entrance path (Immersion mode viewpoint).
  immersion: {
    position: [0, 1.8, 14],
    target: [0, 1.8, 0],
  },
};

/** Human eye level above ground (1.8m). */
export const EYE_HEIGHT = 1.8;

/** VR entry viewpoint: standing on the entrance path facing the village at 1:1 human scale. */
export const XR_VIEWPOINT: { position: Vec3; target: Vec3 } = {
  position: [0, EYE_HEIGHT, 14],
  target: [0, EYE_HEIGHT, 0],
};

const UP = new THREE.Vector3(0, 1, 0);

export interface CameraControllerProps {
  preset: CameraPreset;
  /** Changing this re-applies `preset` even when it is unchanged. */
  resetKey?: number;
  /** Selected building: the camera flies to it; clearing it returns to `preset`. */
  focusSector?: SectorId | null;
  /** Selected appliance (ground position): the camera flies to it, ahead of `focusSector`. */
  focusPoint?: Vec3 | null;
  /** Hand tool: one-finger / left-button drag pans the view instead of orbiting. */
  panMode?: boolean;
  /** Slowly orbit the focused building once the camera arrives (off without a GPU). */
  autoRotate?: boolean;
  reducedMotion?: boolean;
  /**
   * Inertia after a drag. Off on the `low` tier: damping keeps requesting frames until
   * it decays, which at very low fps (weak GPU, software GL) means minutes of rendering.
   */
  damping?: boolean;
  /** An XR session is presenting: orbit input off, camera on `XR_VIEWPOINT`. */
  xrActive?: boolean;
  /**
   * XR teleport (VSIM-T3/T4): bump `key` to put the head on `spot` facing its yaw; `interior` = the
   * walker is in a building's room (room floor, walls instead of the village walk grid).
   */
  xrPlace?: { spot: XrSpot; interior: boolean; key: number } | null;
  /** XR buttons other than turn / step (A/X, B/Y, stick click, thumb tap): VSIM-T1. */
  onXrAction?: (action: XrControlAction) => void;
  /** Filled with the walk grid while in XR (door spots, probe). */
  walkGridRef?: { current: WalkGrid | null };
}

/** Village walk limit (m from the centre), as before collisions. */
const WALK_LIMIT = 65;
/** Snap step glide speed (m/s), like /village. */
const STEP_SPEED = 3.2;
/** Late-loading meshes (trees, models): the grid is rebuilt once after entry. */
const GRID_REBUILD_MS = 3000;
const _head = new THREE.Vector3();
const _local = new THREE.Vector3();
const _euler = new THREE.Euler();

export function CameraController({
  preset,
  resetKey = 0,
  focusSector = null,
  focusPoint = null,
  panMode = false,
  autoRotate = true,
  reducedMotion = false,
  damping = true,
  xrActive = false,
  xrPlace = null,
  onXrAction,
  walkGridRef,
}: CameraControllerProps) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);

  const targetPos = useRef(new THREE.Vector3(...CAMERA_PRESETS.village.position));
  const targetLook = useRef(new THREE.Vector3(...CAMERA_PRESETS.village.target));
  const isTransitioning = useRef(false);
  /** Orbit around `targetLook` (after the tween, until the user drags or deselects). */
  const isOrbiting = useRef(false);
  const orbitAfterTween = useRef(false);
  const tweenStart = useRef(0);
  const hasMounted = useRef(false);
  const presetRef = useRef(preset);
  const prevFocus = useRef<string | null>(null);
  const orbitOffset = useRef(new THREE.Vector3());

  // XR locomotion vectors & keyboard input
  const xrMoveDir = useRef(new THREE.Vector3());
  const xrCamFwd = useRef(new THREE.Vector3());
  const xrCamRight = useRef(new THREE.Vector3());
  const xrKeysDown = useRef<Set<string>>(new Set());
  const walkGrid = useRef<WalkGrid | null>(null);
  const interior = useRef(false);
  /** Snap step left to glide (m) and its heading (unit XZ). */
  const stepLeft = useRef(0);
  const stepDir = useRef(new THREE.Vector3());

  useEffect(() => {
    if (!xrActive) {
      xrKeysDown.current.clear();
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      xrKeysDown.current.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      xrKeysDown.current.delete(e.code);
    };
    const onBlur = () => {
      xrKeysDown.current.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      xrKeysDown.current.clear();
    };
  }, [xrActive]);

  const startOrbit = useCallback(() => {
    isOrbiting.current = orbitAfterTween.current;
    orbitAfterTween.current = false;
  }, []);

  const snapToTarget = useCallback(() => {
    camera.position.copy(targetPos.current);
    if (controlsRef.current) {
      controlsRef.current.target.copy(targetLook.current);
      controlsRef.current.update();
    }
    isTransitioning.current = false;
    startOrbit();
  }, [camera, startOrbit]);

  const moveTo = useCallback(
    (config: { position: Vec3; target: Vec3 }, orbit: boolean) => {
      targetPos.current.set(...config.position);
      targetLook.current.set(...config.target);
      isOrbiting.current = false;
      orbitAfterTween.current = orbit && !reducedMotion;

      // First placement is instant (nothing to animate from); later moves tween.
      // Mid-XR calls also snap (the headset pose overwrites them on the next frame).
      if (reducedMotion || xrActive || !hasMounted.current) {
        snapToTarget();
      } else {
        isTransitioning.current = true;
        tweenStart.current = performance.now();
      }
      hasMounted.current = true;
      // frameloop="demand": render the jump, or start the tween loop.
      invalidate();
    },
    [reducedMotion, xrActive, invalidate, snapToTarget]
  );

  useEffect(() => {
    presetRef.current = preset;
    moveTo(CAMERA_PRESETS[preset] ?? CAMERA_PRESETS.village, false);
  }, [preset, resetKey, moveTo]);

  // One focus target: the selected appliance first, else the selected building.
  const focusKey = focusPoint
    ? `p:${focusPoint.map((v) => v.toFixed(2)).join(',')}`
    : focusSector
      ? `s:${focusSector}`
      : null;
  const moveToFocusTarget = useCallback(
    (key: string | null) => {
      if (key?.startsWith('p:')) {
        const p = key.slice(2).split(',').map(Number) as Vec3;
        moveTo(focusCameraFor(p, APPLIANCE_FOCUS_SCALE), autoRotate);
      } else if (key) {
        moveTo(focusCameraFor(SECTOR_POSITIONS[key.slice(2) as SectorId]), autoRotate);
      } else {
        moveTo(CAMERA_PRESETS[presetRef.current] ?? CAMERA_PRESETS.village, false);
      }
    },
    [autoRotate, moveTo]
  );
  useEffect(() => {
    const previous = prevFocus.current;
    prevFocus.current = focusKey;
    if (focusKey || previous) moveToFocusTarget(focusKey);
  }, [focusKey, moveToFocusTarget]);

  // XR session: the headset pose overwrites camera.position/quaternion every frame,
  // so a camera snap can't place the viewpoint — parent the camera to a rig group
  // at XR_VIEWPOINT on entry (the pose then applies relative to it), detach on exit.
  // Declared last so it wins over the preset/focus effects re-run by the `moveTo` change.
  const wasXrActive = useRef(false);
  const xrRig = useRef<THREE.Group | null>(null);
  const xrPrevParent = useRef<THREE.Object3D | null>(null);
  const xrHandsHandle = useRef<XRHandsHandle | null>(null);
  const hasFloorTracking = useRef(false);
  useEffect(() => {
    if (!xrActive) {
      if (wasXrActive.current) {
        wasXrActive.current = false;
        hasFloorTracking.current = false;
        xrHandsHandle.current?.dispose();
        xrHandsHandle.current = null;
        const rig = xrRig.current;
        xrRig.current = null;
        if (rig) {
          (xrPrevParent.current ?? scene).attach(camera);
          camera.scale.set(1, 1, 1); // `attach` kept the rig's scale (VS-T33)
          scene.remove(rig);
        }
        moveToFocusTarget(focusKey);
      }
      return;
    }
    wasXrActive.current = true;
    if (xrRig.current) return; // StrictMode double-invoke / focus change mid-session.
    const rig = new THREE.Group();
    // Arriving from the /village lab (VS-T29): stand next to the object just added.
    const handoff = useXrHandoff.getState();
    const at = handoff.pending?.at;
    const view = at ? standNear(at[0], at[1], EYE_HEIGHT) : XR_VIEWPOINT;
    if (handoff.pending) handoff.clear();
    rig.position.set(...view.position);
    // The village is half scale: the viewer shrinks with it (eyes, hands, steps, VS-T33).
    rig.scale.setScalar(xrWorldScale(false));
    // Align rig yaw only with target on the horizontal plane (XZ).
    // NEVER pitch or roll the XR rig: tilting the rig's Y-axis causes
    // headset yaw to induce artificial visual roll, triggering severe motion sickness.
    const dx = view.target[0] - view.position[0];
    const dz = view.target[2] - view.position[2];
    const yaw = Math.atan2(-dx, -dz);
    rig.quaternion.setFromAxisAngle(UP, yaw);
    scene.add(rig);
    xrPrevParent.current = camera.parent;
    rig.attach(camera); // keep the 2D world transform, then hand over to the headset
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    xrRig.current = rig;

    // Attach articulated hands and controller pointers inside the rig
    xrHandsHandle.current = setupXRHandsAndControllers(rig, gl, scene, camera);

    invalidate();
  }, [xrActive, focusKey, moveTo, moveToFocusTarget, camera, scene, gl, invalidate]);

  // Walk grid (VSIM-T2): built from the scene on entry, once more after late meshes load.
  useEffect(() => {
    if (!xrActive) {
      walkGrid.current = null;
      if (walkGridRef) walkGridRef.current = null;
      return;
    }
    const build = () => {
      const skip = new Set<THREE.Object3D>(xrRig.current ? [xrRig.current] : []);
      walkGrid.current = buildWalkGrid(scene, terrainHeight, WALK_LIMIT + 1, 0.25, skip);
      if (walkGridRef) walkGridRef.current = walkGrid.current;
    };
    const first = window.setTimeout(build, 0);
    const again = window.setTimeout(build, GRID_REBUILD_MS);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(again);
    };
  }, [xrActive, scene, walkGridRef]);

  // Teleport (door, room, back out): head on the spot, looking along its yaw.
  const placeKey = xrPlace?.key;
  useEffect(() => {
    const rig = xrRig.current;
    if (!xrActive || !rig || !xrPlace) return;
    interior.current = xrPlace.interior;
    stepLeft.current = 0;
    const scale = xrWorldScale(xrPlace.interior);
    rig.scale.setScalar(scale);
    const headYaw = _euler.setFromQuaternion(camera.quaternion, 'YXZ').y;
    rig.rotation.set(0, xrPlace.spot.yaw - headYaw, 0);
    _local
      .set(camera.position.x, 0, camera.position.z)
      .multiplyScalar(scale)
      .applyAxisAngle(UP, rig.rotation.y);
    rig.position.x = xrPlace.spot.position[0] - _local.x;
    rig.position.z = xrPlace.spot.position[2] - _local.z;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-place only when `key` changes
  }, [placeKey, xrActive]);

  const onAction = useCallback(
    (a: XrControlAction) => {
      const rig = xrRig.current;
      if (a.type === 'turn' && rig) {
        camera.getWorldPosition(_head);
        const t = turnRigAboutHead(
          rig.position.x,
          rig.position.z,
          rig.rotation.y,
          _head.x,
          _head.z,
          -a.direction * SNAP_TURN
        );
        rig.position.x = t.x;
        rig.position.z = t.z;
        rig.rotation.y = t.yaw;
        playSnapSound();
        return;
      }
      if (a.type === 'step' && rig) {
        camera.getWorldDirection(stepDir.current);
        stepDir.current.y = 0;
        if (stepDir.current.lengthSq() < 1e-6) return;
        stepDir.current.normalize().multiplyScalar(a.direction);
        stepLeft.current = STEP_DISTANCE * rig.scale.x;
        playSnapSound();
        return;
      }
      onXrAction?.(a);
    },
    [camera, onXrAction]
  );

  /**
   * Moves the rig so the head goes by (dx, dz), stopped by walls (walk grid) or the room, within the
   * village limit. Returns the distance actually walked.
   */
  const walkRig = (rig: THREE.Group, dx: number, dz: number): number => {
    camera.getWorldPosition(_head);
    let tx = _head.x + dx;
    let tz = _head.z + dz;
    if (interior.current) {
      [tx, tz] = clampToInterior(tx, tz);
    } else {
      const r = Math.hypot(tx, tz);
      if (r > WALK_LIMIT) {
        tx *= WALK_LIMIT / r;
        tz *= WALK_LIMIT / r;
      }
      if (walkGrid.current) [tx, tz] = resolveWalk(walkGrid.current, _head.x, _head.z, tx, tz);
    }
    rig.position.x += tx - _head.x;
    rig.position.z += tz - _head.z;
    return Math.hypot(tx - _head.x, tz - _head.z);
  };

  useFrame((state, delta) => {
    if (xrActive) {
      xrHandsHandle.current?.update();
      const rig = xrRig.current;
      if (!rig) return;

      const scale = rig.scale.x;
      // 1. Keyboard (WASD / ZQSD / ↑↓ walk, ← → turn the head: VS-T33)
      const keys = readXrKeys(xrKeysDown.current);
      let moveX = keys.moveX;
      let moveZ = keys.moveZ;
      const isRunning = keys.run;
      if (keys.turn !== 0) {
        state.invalidate();
        camera.getWorldPosition(_head);
        const t = turnRigAboutHead(
          rig.position.x,
          rig.position.z,
          rig.rotation.y,
          _head.x,
          _head.z,
          keys.turn * XR_KEY_TURN_SPEED * Math.min(delta, 0.1)
        );
        rig.position.x = t.x;
        rig.position.z = t.z;
        rig.rotation.y = t.yaw;
      }

      // 2. WebXR Gamepad / Thumbsticks (Oculus Touch & IWER DevUI)
      const session = state.gl.xr?.getSession?.();
      if (session) {
        for (const source of session.inputSources) {
          const gp = source.gamepad;
          if (!gp) continue;

          let stickX = 0;
          let stickY = 0;
          if (gp.axes.length >= 4) {
            const ax = gp.axes[2] ?? 0;
            const ay = gp.axes[3] ?? 0;
            stickX = Math.abs(ax) > 0.15 ? ax : 0;
            stickY = Math.abs(ay) > 0.15 ? ay : 0;
          } else if (gp.axes.length >= 2) {
            const ax = gp.axes[0] ?? 0;
            const ay = gp.axes[1] ?? 0;
            stickX = Math.abs(ax) > 0.15 ? ax : 0;
            stickY = Math.abs(ay) > 0.15 ? ay : 0;
          }

          // Left stick walks; the right stick snap-turns / steps (XrControlsDriver, VSIM-T1).
          if (isWalkStick(source)) {
            moveX += stickX;
            moveZ += stickY;
          }
        }
      }

      // 4. Locomotion along horizontal camera direction
      if (moveX !== 0 || moveZ !== 0) {
        state.invalidate();
        camera.getWorldDirection(xrCamFwd.current);
        xrCamFwd.current.y = 0;
        xrCamFwd.current.normalize();

        xrCamRight.current.crossVectors(xrCamFwd.current, UP).normalize();

        xrMoveDir.current.set(0, 0, 0);
        if (moveZ !== 0) xrMoveDir.current.addScaledVector(xrCamFwd.current, -moveZ);
        if (moveX !== 0) xrMoveDir.current.addScaledVector(xrCamRight.current, moveX);
        if (xrMoveDir.current.lengthSq() > 0) {
          xrMoveDir.current.normalize();
        }

        const baseSpeed = isRunning ? 6.0 : 3.0; // m/s as felt; the world is `scale` smaller
        const step = baseSpeed * scale * Math.min(delta, 0.1);
        walkRig(rig, xrMoveDir.current.x * step, xrMoveDir.current.z * step);
      }

      // Snap step glide (right stick ↑/↓, thumb swipe): stops at a wall.
      if (stepLeft.current > 0) {
        state.invalidate();
        const d = Math.min(stepLeft.current, STEP_SPEED * scale * Math.min(delta, 0.1));
        const moved = walkRig(rig, stepDir.current.x * d, stepDir.current.z * d);
        stepLeft.current = moved < d * 0.5 ? 0 : stepLeft.current - d;
      }

      // Always maintain standing eye height above terrain relief
      // Auto-detects if a real headset runtime provides physical floor height (camera.position.y > 0.5)
      if (camera.position.y > 0.5) {
        hasFloorTracking.current = true;
      }
      const groundY = interior.current
        ? INTERIOR_ORIGIN[1]
        : terrainHeight(rig.position.x, rig.position.z);
      // Headset pose is in rig space: heights scale with the rig (half-scale village).
      const eyeOffset = hasFloorTracking.current ? 0 : EYE_HEIGHT * scale;
      rig.position.y = groundY + eyeOffset;

      // Absolute safety floor clamp: eye height can NEVER sink beneath ground level + 0.35m (felt)
      const eyeWorldY = rig.position.y + camera.position.y * scale;
      if (eyeWorldY < groundY + 0.35 * scale) {
        rig.position.y = groundY + (0.35 - camera.position.y) * scale;
      }
      return;
    }

    if (reducedMotion) return;

    if (isTransitioning.current) {
      state.invalidate();
      if (cameraTweenExpired(tweenStart.current, performance.now())) {
        snapToTarget();
        return;
      }
      const lerpFactor = cameraLerpFactor(delta);
      camera.position.lerp(targetPos.current, lerpFactor);

      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetLook.current, lerpFactor);
        controlsRef.current.update();
      }

      if (
        camera.position.distanceTo(targetPos.current) < 0.1 &&
        (!controlsRef.current || controlsRef.current.target.distanceTo(targetLook.current) < 0.1)
      ) {
        isTransitioning.current = false;
        startOrbit();
      }
      return;
    }

    if (isOrbiting.current && controlsRef.current) {
      state.invalidate();
      // Rotate the camera around the look target on the vertical axis (no allocation).
      const look = controlsRef.current.target;
      orbitOffset.current
        .copy(camera.position)
        .sub(look)
        .applyAxisAngle(UP, focusOrbitAngle(delta));
      camera.position.copy(look).add(orbitOffset.current);
      controlsRef.current.update();
    }
  });

  return (
    <>
      {xrActive && <XrControlsDriver onAction={onAction} />}
      <OrbitControls
        ref={controlsRef}
        enabled={!xrActive}
        enableDamping={damping}
        dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={panMode ? 2.5 : 4}
        maxDistance={70}
        // Pan along the ground (not the screen) so the view never dives under the terrain.
        screenSpacePanning={false}
        mouseButtons={
          panMode
            ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
            : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
        }
        touches={
          panMode
            ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
            : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
        }
        onStart={() => {
          // The user takes over: stop any tween or orbit.
          isTransitioning.current = false;
          isOrbiting.current = false;
          orbitAfterTween.current = false;
        }}
      />
    </>
  );
}
