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
};

/** VR entry viewpoint: a standing-scale overlook of the whole diorama. */
export const XR_VIEWPOINT: { position: Vec3; target: Vec3 } = {
  position: [0, 20, 30],
  target: [0, 1, -4],
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
}

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
}: CameraControllerProps) {
  const camera = useThree((s) => s.camera);
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
      // XR entry snaps too: the headset drives the camera from the viewpoint on.
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

  // XR session: snap to the diorama viewpoint on entry, restore the 2D target on exit.
  // Declared last so it wins over the preset/focus effects re-run by the `moveTo` change.
  const wasXrActive = useRef(false);
  useEffect(() => {
    if (xrActive) {
      wasXrActive.current = true;
      moveTo(XR_VIEWPOINT, false);
    } else if (wasXrActive.current) {
      wasXrActive.current = false;
      moveToFocusTarget(focusKey);
    }
  }, [xrActive, focusKey, moveTo, moveToFocusTarget]);

  useFrame((state, delta) => {
    if (reducedMotion || xrActive) return;

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
    <OrbitControls
      ref={controlsRef}
      enabled={!xrActive}
      enableDamping={damping}
      dampingFactor={0.05}
      maxPolarAngle={Math.PI / 2.15}
      minDistance={panMode ? 3 : 6}
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
  );
}
