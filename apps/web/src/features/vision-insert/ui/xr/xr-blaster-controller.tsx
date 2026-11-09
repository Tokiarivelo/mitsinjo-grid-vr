'use client';

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  createControllerGripModel,
  createHandMesh,
  updateHandMesh,
} from '@/features/microgrid-3d/utils/xr-hands';
import type { SpatialTarget } from './spatial-projection';
import { pickTargetAtUv, screenHitFromRay } from './webcam-screen';
import { AIR_BUTTON_POSITION, AIR_BUTTON_RADIUS, AIR_BUTTON_TOUCH_RADIUS } from './xr-layout';
import { playLaserShootSound, playScanRadarSound, playTargetHitSound } from './xr-audio-fx';

export const AIR_BUTTON_ID = 'spatial-air-button';

export interface XRBlasterControllerProps {
  targets: SpatialTarget[];
  onHoverTarget: (id: string | null) => void;
  /** A detection was hit (its box contains the image point under the laser). */
  onShootTarget: (id: string) => void;
  onTriggerScan?: () => void;
  /** The webcam video was hit outside every detection box, at image coords (u, v). */
  onShootScreen?: (u: number, v: number) => void;
}

type AimKind = 'button' | 'target' | 'screen' | 'none';
interface Aim {
  kind: AimKind;
  id: string | null;
  u: number;
  v: number;
}

// Module-level scratch objects: no allocation in the frame loop.
const _raycaster = new THREE.Raycaster();
const _tempMatrix = new THREE.Matrix4();
const _vOrigin = new THREE.Vector3();
const _vDirection = new THREE.Vector3();
const _vEnd = new THREE.Vector3();
const _vTip = new THREE.Vector3();
const _vCurPos = new THREE.Vector3();
const _mouse = new THREE.Vector2();
const _FORWARD = new THREE.Vector3(0, 0, -1);
const BUTTON_POS = new THREE.Vector3(...AIR_BUTTON_POSITION);
const BEAM_LENGTH = 3;
const TOUCH_COOLDOWN_MS = 750;

const BEAM_IDLE = '#38bdf8';
const BEAM_BUTTON = '#c084fc';
const BEAM_TARGET = '#f59e0b';
const BEAM_SCREEN = '#7dd3fc';

function createDot(radius: number, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 12),
    new THREE.MeshBasicMaterial({ color })
  );
  mesh.visible = false;
  return mesh;
}

function createImpactRing(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.05, 0.28, 24),
    new THREE.MeshBasicMaterial({
      color: BEAM_TARGET,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    })
  );
  mesh.visible = false;
  return mesh;
}

function createPointerLine(): THREE.Line {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: BEAM_IDLE, transparent: true, opacity: 0.65 });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  line.frustumCulled = false;
  return line;
}

/** Ray origin + direction of an XR target-ray space (controller or hand pointer). */
function rayFrom(space: THREE.Object3D, origin: THREE.Vector3, direction: THREE.Vector3) {
  space.updateMatrixWorld(true);
  _tempMatrix.identity().extractRotation(space.matrixWorld);
  origin.setFromMatrixPosition(space.matrixWorld);
  direction.copy(_FORWARD).applyMatrix4(_tempMatrix).normalize();
}

/**
 * What a ray points at, nearest first: the scan button, then the webcam video
 * (resolved to the detection whose box holds that image point). Writes the beam end to `end`.
 */
function aimAt(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  targets: readonly SpatialTarget[],
  end: THREE.Vector3
): Aim {
  _raycaster.ray.origin.copy(origin);
  _raycaster.ray.direction.copy(direction);

  const toButton = _vCurPos.subVectors(BUTTON_POS, origin).dot(direction);
  if (toButton > 0 && _raycaster.ray.distanceToPoint(BUTTON_POS) <= AIR_BUTTON_RADIUS) {
    end.copy(BUTTON_POS);
    return { kind: 'button', id: AIR_BUTTON_ID, u: 0, v: 0 };
  }

  const hit = screenHitFromRay(origin, direction);
  if (hit) {
    const target = pickTargetAtUv(targets, hit.u, hit.v);
    if (target) {
      end.set(...target.position);
      return { kind: 'target', id: target.id, u: hit.u, v: hit.v };
    }
    end.set(...hit.point);
    return { kind: 'screen', id: null, u: hit.u, v: hit.v };
  }

  end.copy(origin).addScaledVector(direction, BEAM_LENGTH);
  return { kind: 'none', id: null, u: 0, v: 0 };
}

function beamColor(kind: AimKind): string {
  if (kind === 'button') return BEAM_BUTTON;
  if (kind === 'target') return BEAM_TARGET;
  if (kind === 'screen') return BEAM_SCREEN;
  return BEAM_IDLE;
}

/**
 * Single input source of the /village VR studio (VS-T4).
 * - Controllers and hands share the system pointer ray (`getController(i)`): one shot per
 *   `selectstart` (trigger press or native pinch), never `select` too.
 * - Fingertip touch presses the scan button directly.
 * - Mouse: desktop preview and the IWER emulator.
 * Shots at the webcam video hit the object under the laser; elsewhere fall back to
 * scene objects carrying `userData.onSelect` (HUD toggle).
 */
export const XRBlasterController = memo(function XRBlasterController({
  targets,
  onHoverTarget,
  onShootTarget,
  onTriggerScan,
  onShootScreen,
}: XRBlasterControllerProps) {
  const { gl, camera, scene } = useThree();
  const hoveredRef = useRef<string | null>(null);
  const mouseNdcRef = useRef<{ x: number; y: number } | null>(null);
  const handsRef = useRef<
    Array<{ group: Parameters<typeof updateHandMesh>[0]; mesh: THREE.InstancedMesh }>
  >([]);
  const gripsRef = useRef<THREE.Object3D[]>([]);
  const lastTouchRef = useRef(0);
  const blastRef = useRef<{ origin: THREE.Vector3; to: THREE.Vector3; progress: number } | null>(
    null
  );

  // Imperative Three objects, mutated in the frame loop without React renders.
  const fx = useMemo(
    () => ({
      pointers: [createPointerLine(), createPointerLine()] as const,
      pips: [createDot(0.022, BEAM_IDLE), createDot(0.022, BEAM_IDLE)] as const,
      projectile: createDot(0.035, BEAM_IDLE),
      impact: createImpactRing(),
    }),
    []
  );
  const { pointers, pips, projectile, impact } = fx;

  useEffect(
    () => () => {
      for (const o of [...fx.pointers, ...fx.pips, fx.projectile, fx.impact]) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    },
    [fx]
  );

  const startBlast = (origin: THREE.Vector3, to: THREE.Vector3) => {
    blastRef.current = { origin: origin.clone(), to: to.clone(), progress: 0 };
  };

  const pressButton = useCallback(() => {
    playLaserShootSound();
    playScanRadarSound();
    onTriggerScan?.();
  }, [onTriggerScan]);

  /** Resolves one shot. `haptics` is the gamepad of the input that fired, if any. */
  const triggerShot = useCallback(
    (origin: THREE.Vector3, direction: THREE.Vector3, haptics?: Gamepad | null) => {
      const aim = aimAt(origin, direction, targets, _vEnd);

      if (aim.kind === 'button') {
        startBlast(origin, _vEnd);
        pressButton();
        return;
      }

      // Panels in front of the video (HUD) take the shot first.
      if (scene) {
        _raycaster.ray.origin.copy(origin);
        _raycaster.ray.direction.copy(direction);
        if (camera) _raycaster.camera = camera;
        let hits: THREE.Intersection[] = [];
        try {
          hits = _raycaster.intersectObjects(scene.children, true);
        } catch {
          hits = [];
        }
        for (const hit of hits) {
          for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
            const handler = o.userData?.onSelect;
            if (typeof handler === 'function') {
              playLaserShootSound();
              handler();
              return;
            }
          }
        }
      }

      if (aim.kind === 'none') return;
      startBlast(origin, _vEnd);
      playLaserShootSound();
      if (aim.kind === 'target' && aim.id) {
        playTargetHitSound();
        try {
          haptics?.hapticActuators?.[0]?.pulse(0.8, 120);
        } catch {
          // No haptics on the desktop emulator.
        }
        onShootTarget(aim.id);
        return;
      }
      onShootScreen?.(aim.u, aim.v);
    },
    [camera, scene, targets, pressButton, onShootTarget, onShootScreen]
  );

  // XR pointers (controllers and hands), grips and articulated hands.
  useEffect(() => {
    if (!gl?.xr?.getController) return;
    const added: Array<{ parent: THREE.Object3D; child: THREE.Object3D }> = [];
    const listeners: Array<{ space: THREE.XRTargetRaySpace; fn: (e: THREE.Event) => void }> = [];

    for (let i = 0; i < 2; i++) {
      const space = gl.xr.getController(i);
      scene?.add(space);
      const fn = (e: THREE.Event) => {
        rayFrom(space, _vOrigin, _vDirection);
        const source = (e as { data?: XRInputSource }).data;
        triggerShot(_vOrigin, _vDirection, source?.gamepad ?? null);
      };
      space.addEventListener('selectstart', fn as never);
      listeners.push({ space, fn });

      if (gl.xr.getHand && scene) {
        const hand = gl.xr.getHand(i) as Parameters<typeof updateHandMesh>[0];
        const mesh = createHandMesh();
        hand.add(mesh);
        scene.add(hand);
        handsRef.current.push({ group: hand, mesh });
        added.push({ parent: hand, child: mesh });
      }

      const getGrip = (gl.xr as unknown as { getControllerGrip?: (idx: number) => THREE.Group })
        .getControllerGrip;
      if (typeof getGrip === 'function' && scene) {
        const grip = getGrip.call(gl.xr, i);
        const model = createControllerGripModel();
        model.visible = false;
        grip.add(model);
        scene.add(grip);
        gripsRef.current.push(model);
        added.push({ parent: grip, child: model });
      }
    }

    return () => {
      for (const { space, fn } of listeners) {
        space.removeEventListener('selectstart', fn as never);
        scene?.remove(space);
      }
      for (const { parent, child } of added) {
        parent.remove(child);
        scene?.remove(parent);
      }
      handsRef.current = [];
      gripsRef.current = [];
    };
  }, [gl, scene, triggerShot]);

  // Mouse: aim on move, shoot on left click (desktop preview and IWER emulator).
  useEffect(() => {
    const dom = gl.domElement;
    if (!dom) return;
    const toNdc = (e: MouseEvent) => {
      const rect = dom.getBoundingClientRect();
      const w = rect.width || window.innerWidth || 800;
      const h = rect.height || window.innerHeight || 600;
      const cx = typeof e.clientX === 'number' ? e.clientX : w / 2;
      const cy = typeof e.clientY === 'number' ? e.clientY : h / 2;
      return {
        x: ((cx - (rect.left || 0)) / w) * 2 - 1,
        y: -((cy - (rect.top || 0)) / h) * 2 + 1,
      };
    };
    const onMove = (e: MouseEvent) => {
      mouseNdcRef.current = toNdc(e);
    };
    const onDown = (e: MouseEvent) => {
      if ((typeof e.button === 'number' && e.button !== 0) || !camera) return;
      const ndc = toNdc(e);
      _mouse.set(ndc.x, ndc.y);
      _raycaster.setFromCamera(_mouse, camera);
      _vOrigin.copy(_raycaster.ray.origin);
      _vDirection.copy(_raycaster.ray.direction);
      triggerShot(_vOrigin, _vDirection);
    };
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerdown', onDown);
    return () => {
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerdown', onDown);
    };
  }, [gl, camera, triggerShot]);

  const drawBeam = (
    index: 0 | 1,
    origin: THREE.Vector3,
    direction: THREE.Vector3
  ): string | null => {
    const aim = aimAt(origin, direction, targets, _vEnd);
    const pointer = pointers[index];
    const pip = pips[index];
    const color = beamColor(aim.kind);
    const attr = pointer.geometry.attributes.position as THREE.BufferAttribute;
    attr.setXYZ(0, origin.x, origin.y, origin.z);
    attr.setXYZ(1, _vEnd.x, _vEnd.y, _vEnd.z);
    attr.needsUpdate = true;
    (pointer.material as THREE.LineBasicMaterial).color.set(color);
    pointer.visible = true;
    pip.visible = true;
    pip.position.copy(_vEnd);
    (pip.material as THREE.MeshBasicMaterial).color.set(color);
    return aim.id;
  };

  const hideBeam = (index: 0 | 1) => {
    pointers[index].visible = false;
    pips[index].visible = false;
  };

  useFrame((_, delta) => {
    const presenting = !!gl.xr?.isPresenting;
    const now = performance.now();
    let hovered: string | null = null;

    // 1. Hands: joints mesh + fingertip press on the scan button.
    let anyHand = false;
    for (const h of handsRef.current) {
      const tracked = updateHandMesh(h.group, h.mesh) > 0 && presenting;
      h.mesh.visible = tracked;
      if (!tracked) continue;
      anyHand = true;
      const tip = h.group.joints?.['index-finger-tip'];
      if (!tip) continue;
      tip.getWorldPosition(_vTip);
      const d = _vTip.distanceTo(BUTTON_POS);
      if (d <= AIR_BUTTON_RADIUS) hovered = AIR_BUTTON_ID;
      if (d <= AIR_BUTTON_TOUCH_RADIUS && now - lastTouchRef.current > TOUCH_COOLDOWN_MS) {
        lastTouchRef.current = now;
        pressButton();
      }
    }
    for (const grip of gripsRef.current) grip.visible = presenting && !anyHand;

    // 2. Projectile and impact ring.
    const blast = blastRef.current;
    if (blast) {
      blast.progress += delta * 3.5;
      if (blast.progress >= 1) {
        blastRef.current = null;
        projectile.visible = false;
        impact.visible = false;
      } else {
        _vCurPos.lerpVectors(blast.origin, blast.to, blast.progress);
        projectile.visible = blast.progress < 0.8;
        projectile.position.copy(_vCurPos);
        impact.visible = blast.progress >= 0.7;
        if (impact.visible) {
          impact.position.copy(blast.to);
          const s = Math.max(0.01, (blast.progress - 0.7) * 4);
          impact.scale.set(s, s, s);
          (impact.material as THREE.MeshBasicMaterial).opacity = 1 - (blast.progress - 0.7) / 0.3;
        }
      }
    }

    // 3. Beams: both XR pointers in the headset, the mouse/camera ray otherwise.
    if (presenting) {
      for (const i of [0, 1] as const) {
        const space = gl.xr.getController(i);
        if (!space || !space.visible || space.matrixWorld.elements[15] === 0) {
          hideBeam(i);
          continue;
        }
        rayFrom(space, _vOrigin, _vDirection);
        hovered = drawBeam(i, _vOrigin, _vDirection) ?? hovered;
      }
    } else if (camera) {
      hideBeam(1);
      if (mouseNdcRef.current) {
        _mouse.set(mouseNdcRef.current.x, mouseNdcRef.current.y);
        _raycaster.setFromCamera(_mouse, camera);
        _vOrigin.copy(_raycaster.ray.origin);
        _vDirection.copy(_raycaster.ray.direction);
      } else {
        _vOrigin.copy(camera.position);
        camera.getWorldDirection(_vDirection);
      }
      hovered = drawBeam(0, _vOrigin, _vDirection) ?? hovered;
    }

    if (hovered !== hoveredRef.current) {
      hoveredRef.current = hovered;
      onHoverTarget(hovered);
    }
  });

  return (
    <group name="xr-blaster-controller-root">
      <primitive object={pointers[0]} />
      <primitive object={pointers[1]} />
      <primitive object={pips[0]} />
      <primitive object={pips[1]} />
      <primitive object={projectile} />
      <primitive object={impact} />
    </group>
  );
});
