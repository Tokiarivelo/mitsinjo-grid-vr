'use client';

import { useRef, type MutableRefObject, type ReactNode } from 'react';
import { labSuspended } from './xr-world-switch';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { yawPitchOf } from './tour/equirect';
import { glideStep, stepWalk, stickWalkAxes, type Ground } from './tour/tour-nav';
import { isWalkStick, STEP_DISTANCE } from './xr-controls';

/** How far from where it opened the viewer may walk in the 3D studio (m); its dome is 7 m. */
export const STUDIO_WALK_RADIUS = 2.4;

/**
 * Where the viewer stands in the 3D studio, from where it opened: `offset` [x, z] (m), and the
 * snap steps still to glide (`step`, m, > 0 forward). Mutated in place; reset when the studio closes.
 */
export interface StudioWalkState {
  offset: Ground;
  step: number;
}

export const newStudioWalk = (): StudioWalkState => ({ offset: [0, 0], step: 0 });

/** One mouse-wheel notch walks this far in the studio (emulator / desktop), m. */
export const WHEEL_STEP = 0.25;

/**
 * Steps left to glide after a wheel turn (`deltaY` < 0 = wheel up = forward), at most one snap
 * step queued either way so a fast spin never runs off.
 */
export function wheelStep(pending: number, deltaY: number): number {
  if (deltaY === 0) return pending;
  const next = pending - Math.sign(deltaY) * WHEEL_STEP;
  return Math.max(-STEP_DISTANCE, Math.min(STEP_DISTANCE, next));
}

const _dir = new THREE.Vector3();

/**
 * Lets the viewer walk up to the studio's screens and model (VS-T25): left stick slides (head
 * relative), a snap step (right stick ↑/↓, thumb swipe, mouse wheel) glides 80 cm, real walking
 * works as is. Like the 360° tour, the studio moves against the walk (its dome, carousel, column
 * and lab together), so the XR reference space, the tour and the webcam wall stay untouched.
 */
export function StudioWalk({
  walk: walkRef,
  children,
}: {
  walk: MutableRefObject<StudioWalkState>;
  children: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const { gl, camera } = useThree();
  useFrame((_, rawDelta) => {
    if (labSuspended()) return;
    const walk = walkRef.current;
    const delta = Math.min(rawDelta, 0.1);
    camera.getWorldDirection(_dir);
    const yaw = yawPitchOf([_dir.x, _dir.y, _dir.z]).yaw;
    const axes = { forward: 0, strafe: 0 };
    for (const source of gl.xr?.getSession?.()?.inputSources ?? []) {
      if (!isWalkStick(source)) continue;
      const stick = stickWalkAxes(source.gamepad?.axes);
      axes.forward += stick.forward;
      axes.strafe += stick.strafe;
    }
    let ground = stepWalk(walk.offset, axes, yaw, delta, STUDIO_WALK_RADIUS);
    const glided = glideStep(ground, walk.step, yaw, delta, STUDIO_WALK_RADIUS);
    ground = glided.ground;
    walk.step = glided.pending;
    walk.offset = ground;
    ref.current?.position.set(-ground[0], 0, -ground[1]);
  });
  return (
    <group ref={ref} name="xr-studio-walk">
      {children}
    </group>
  );
}
