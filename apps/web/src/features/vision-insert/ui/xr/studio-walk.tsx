'use client';

import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { labSuspended } from './xr-world-switch';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { yawPitchOf } from './tour/equirect';
import { glideStep, stepWalk, stickWalkAxes, type Ground } from './tour/tour-nav';
import { isWalkStick, STEP_DISTANCE } from './xr-controls';
import { ARC_COLOR, StudioLocomotion, toWalkSpace } from './studio-locomotion';
import { playSnapSound } from './xr-audio-fx';

/** How far from where it opened the viewer may walk in the 3D studio (m); its dome is 7 m. */
export const STUDIO_WALK_RADIUS = 2.4;

/**
 * Where the viewer stands in the 3D studio, from where it opened: `offset` [x, z] (m), the snap
 * steps still to glide (`step`, m, > 0 forward), and the teleport being aimed (`aiming`) or just
 * let go (`land`, IW-T2). Mutated in place; reset when the studio closes.
 */
export interface StudioWalkState {
  offset: Ground;
  step: number;
  aiming: boolean;
  land: boolean;
}

export const newStudioWalk = (): StudioWalkState => ({
  offset: [0, 0],
  step: 0,
  aiming: false,
  land: false,
});

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
const _origin = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** The right controller's ray (XR space) this frame, or false. */
function rightRay(gl: THREE.WebGLRenderer, origin: THREE.Vector3, dir: THREE.Vector3): boolean {
  const frame = gl.xr.getFrame?.();
  const ref = gl.xr.getReferenceSpace?.();
  const session = gl.xr.getSession?.();
  if (!frame || !ref || !session) return false;
  for (const source of session.inputSources) {
    if (source.handedness !== 'right' || source.hand) continue;
    const pose = frame.getPose(source.targetRaySpace, ref);
    if (!pose) return false;
    const { position: p, orientation: o } = pose.transform;
    origin.set(p.x, p.y, p.z);
    dir.set(0, 0, -1).applyQuaternion(_q.set(o.x, o.y, o.z, o.w));
    return true;
  }
  return false;
}

/** Teleport arc and landing ring, shown while a teleport is aimed. */
interface TeleportVisuals {
  arc: THREE.Line;
  ring: THREE.Mesh;
}

/**
 * One frame of studio walking: stick slide, teleport aim / landing, snap-step glide. Mutates
 * `walk` and the visuals; returns where the viewer stands (walk space).
 */
function studioWalkFrame(
  gl: THREE.WebGLRenderer,
  camera: THREE.Camera,
  walk: StudioWalkState,
  loco: StudioLocomotion,
  visuals: TeleportVisuals,
  rawDelta: number
): Ground {
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
  const ready = loco.isReady();
  let ground = ready
    ? loco.walk(axes, yaw, delta)
    : stepWalk(walk.offset, axes, yaw, delta, STUDIO_WALK_RADIUS);

  // Teleport (IW-T2): aim while the stick is held, land where the arc ends on release.
  const aimNow = () =>
    ready && rightRay(gl, _origin, _aim)
      ? loco.aim(toWalkSpace(_origin, ground, _origin), _aim)
      : null;
  const target = walk.aiming ? aimNow() : null;
  if (target) visuals.arc.geometry.setFromPoints(loco.arc);
  if (walk.land) {
    walk.land = false;
    const to = aimNow();
    if (to) {
      loco.place(to);
      ground = loco.ground();
      playSnapSound();
    } else walk.step += STEP_DISTANCE; // nothing aimed (offline, no controller): one step
  }
  visuals.arc.visible = !!target;
  visuals.ring.visible = !!target;
  if (target) visuals.ring.position.set(target[0], 0.01, target[1]);

  if (walk.step !== 0) {
    const glided = glideStep(ground, walk.step, yaw, delta, STUDIO_WALK_RADIUS);
    ground = glided.ground;
    walk.step = glided.pending;
    if (ready) loco.place(ground);
  }
  walk.offset = ground;
  return ground;
}

/**
 * Lets the viewer walk up to the studio's screens and model (VS-T25, IW-T2 on IWSDK's locomotor):
 * left stick slides (head relative), right stick held forward aims a teleport arc and lands on
 * release, a snap step (right stick ↓, thumb swipe, mouse wheel) glides 80 cm, real walking works
 * as is. Like the 360° tour, the studio moves against the walk (its dome, carousel, column and
 * lab together), so the XR reference space, the tour and the webcam wall stay untouched. Until the
 * locomotor is up (or offline), the same walk runs on our own math.
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
  const loco = useMemo(() => new StudioLocomotion(STUDIO_WALK_RADIUS), []);
  useEffect(() => () => loco.dispose(), [loco]);
  const arc = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints(loco.arc);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: ARC_COLOR }));
    line.name = 'xr-teleport-arc';
    line.frustumCulled = false;
    line.visible = false;
    return line;
  }, [loco]);
  const ring = useMemo(() => {
    const geo = new THREE.RingGeometry(0.18, 0.24, 32).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: ARC_COLOR, side: THREE.DoubleSide })
    );
    mesh.name = 'xr-teleport-target';
    mesh.visible = false;
    return mesh;
  }, []);
  useEffect(
    () => () => {
      arc.geometry.dispose();
      (arc.material as THREE.Material).dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    },
    [arc, ring]
  );
  useFrame((_, rawDelta) => {
    if (labSuspended()) return;
    const ground = studioWalkFrame(gl, camera, walkRef.current, loco, { arc, ring }, rawDelta);
    ref.current?.position.set(-ground[0], 0, -ground[1]);
  });
  return (
    <group ref={ref} name="xr-studio-walk">
      <primitive object={arc} />
      <primitive object={ring} />
      {children}
    </group>
  );
}
