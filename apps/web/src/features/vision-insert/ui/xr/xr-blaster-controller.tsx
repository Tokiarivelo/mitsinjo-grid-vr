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
import { photoRay, type PhotoGround } from './tour/grounded';
import {
  pickTargetAtUv,
  screenHitFromRay,
  WEBCAM_SCREEN,
  type ImageSurface,
} from './webcam-screen';
import { AIR_BUTTON_RADIUS, AIR_BUTTON_TOUCH_RADIUS, MINIATURE_GRAB_RADIUS } from './xr-layout';
import {
  WRIST_BUTTON_ID,
  WRIST_RAY_RADIUS,
  WRIST_TOUCH_RADIUS,
  type WristMenu,
} from './wrist-menu';
import { playLaserShootSound, playScanRadarSound, playTargetHitSound } from './xr-audio-fx';
import { grabTurntable, releaseTurntable, rotateTurntable, type Turntable } from './turntable';
import {
  dragTo,
  endDrag,
  panelOf,
  shown,
  type HoloPanelData,
  type PanelDrag,
  type PanelRegistry,
  HOLO_ID_PREFIX,
} from './holo-panel';
import { playHoverTick, playPanelSelectSound } from './xr-audio-fx';

export const AIR_BUTTON_ID = 'spatial-air-button';

/** A 3D miniature the viewer can hold and rotate. */
export interface MiniatureHandle {
  id: string;
  position: [number, number, number];
  turntable: Turntable;
}

export interface XRBlasterControllerProps {
  targets: SpatialTarget[];
  /** Wrist menu: its wrist button toggles it; the scan button is live only while it is open. */
  menu: WristMenu;
  /** Miniatures in reach: a held select rotates them, a quick tap calls `onTapMiniature`. */
  miniatures?: MiniatureHandle[];
  onTapMiniature?: (id: string) => void;
  onHoverTarget: (id: string | null) => void;
  /** A detection was hit (its box contains the image point under the laser). */
  onShootTarget: (id: string) => void;
  onTriggerScan?: () => void;
  /** The webcam video was hit outside every detection box, at image coords (u, v). */
  onShootScreen?: (u: number, v: number) => void;
  /** Where the scanned image sits (webcam wall, or a 360° tour scan photo); null = none yet. */
  surface?: ImageSurface | null;
  /** Floor arrows of the 360° tour: a shot on one calls `onHotspot(id)`. */
  hotspots?: readonly Hotspot[];
  onHotspot?: (id: string) => void;
  /** A shot that hit nothing (no surface, panel or arrow): 360° tour scans that direction. */
  onShootOutside?: (origin: THREE.Vector3, direction: THREE.Vector3) => void;
  /** Holographic panels (dialog, carousel, lab): hit first, tapped or dragged (VS-T19). */
  panels?: PanelRegistry;
  /**
   * 360° tour: the live grounded photo. The ray is resolved on the photo as drawn after walking
   * (photo point → scan image), so aiming at an object hits it wherever the viewer stands.
   */
  photo?: PhotoGround;
  /**
   * Written every frame: what each pointer aims at and where its beam ends, and whether it is a
   * hand (pinch) or a controller (trigger). Read by the aim hint (« Trigger · Extract … »).
   */
  aimOut?: AimReadout;
}

/** Live aim of the two XR pointers (and the mouse as pointer 0 off the headset). */
export interface AimReadout {
  pointers: [PointerAim, PointerAim];
}

export interface PointerAim {
  visible: boolean;
  kind: AimKind;
  id: string | null;
  /** Beam end (world). */
  end: THREE.Vector3;
  input: 'controller' | 'hand' | 'mouse';
}

export function createAimReadout(): AimReadout {
  const one = (): PointerAim => ({
    visible: false,
    kind: 'none',
    id: null,
    end: new THREE.Vector3(),
    input: 'controller',
  });
  return { pointers: [one(), one()] };
}

export interface Hotspot {
  id: string;
  position: [number, number, number];
}

/** Pick radius around a floor arrow (m). */
const HOTSPOT_RADIUS = 0.38;

type AimKind =
  'wrist' | 'panel' | 'miniature' | 'button' | 'hotspot' | 'target' | 'screen' | 'none';
interface Aim {
  kind: AimKind;
  id: string | null;
  u: number;
  v: number;
  miniature?: MiniatureHandle;
  panel?: HoloPanelData;
  hit?: THREE.Intersection;
}

/** Pointer 0 / 1 select, 2 / 3 their grip (squeeze), or the mouse. */
type InputKey = 0 | 1 | 2 | 3 | 'mouse';
/** One input holding a miniature: last pointer pose, to turn its motion into rotation. */
interface Grab {
  miniature: MiniatureHandle;
  yaw: number;
  pitch: number;
  x: number;
  y: number;
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
const BEAM_LENGTH = 3;
const TOUCH_COOLDOWN_MS = 750;
/** Mouse travel (px) under which a press + release is a click, not a drag. */
const CLICK_SLOP_PX = 6;
/** In the headset view, the mouse keeps hovering this long after its last move (ms). */
const MOUSE_HOVER_MS = 2500;

const BEAM_IDLE = '#38bdf8';
const BEAM_WRIST = '#e9d5ff';
const BEAM_HOTSPOT = '#a5f3fc';
const BEAM_BUTTON = '#c084fc';
const BEAM_TARGET = '#f59e0b';
const BEAM_SCREEN = '#7dd3fc';
const BEAM_MINIATURE = '#4ade80';
/** Rotation per radian of pointer turn, and per metre of hand move (direct pinch). */
const RAY_GAIN = 3;
const MOVE_GAIN = 9;
/** Rotation per pixel of mouse drag. */
const MOUSE_GAIN = 0.012;
/** Panel drag: pointer yaw per pixel of mouse drag (rad). */
const MOUSE_PANEL_GAIN = 0.004;
const BEAM_PANEL = '#67e8f9';

/** Head turn per pixel of locked mouse move in the IWER DevUI Play mode (its own gain, rad). */
export const LOCKED_TURN_GAIN = 0.002;

/**
 * Turn a locked mouse move (IWER DevUI Play mode) would give the headset — and the controllers
 * carried with it — as a ray yaw / pitch step (yaw > 0 = right, pitch > 0 = up). While a
 * controller holds a panel or a model, the studio applies it to the held thing instead of the view.
 */
export function lockedTurn(movementX: number, movementY: number): { yaw: number; pitch: number } {
  return { yaw: movementX * LOCKED_TURN_GAIN, pitch: -movementY * LOCKED_TURN_GAIN };
}

/** Horizontal / vertical angle of a ray direction. */
const yawOf = (d: THREE.Vector3) => Math.atan2(d.x, -d.z);
const pitchOf = (d: THREE.Vector3) => Math.asin(Math.max(-1, Math.min(1, d.y)));
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

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

/**
 * Whether a mouse event belongs to the scene: on our canvas, or, in the headset view, on a canvas
 * laid over it (the IWER DevUI overlay of the emulator). HTML panels and buttons never count.
 */
export function mouseTarget(
  target: EventTarget | null,
  dom: HTMLCanvasElement,
  presenting: boolean
): boolean {
  if (target === dom) return true;
  return presenting && (target as { tagName?: string } | null)?.tagName === 'CANVAS';
}

/**
 * The XR eye camera under the mouse, and the mouse x in that eye's view (NDC). One view (the
 * emulator's mono preview) fills the canvas; two views (stereo) share it left | right.
 */
export function xrEyeAt(
  xrCamera: { cameras?: THREE.Camera[] } | undefined,
  ndcX: number
): { camera: THREE.Camera; x: number } | null {
  const eyes = xrCamera?.cameras ?? [];
  if (eyes.length === 0) return null;
  if (eyes.length === 1) return { camera: eyes[0]!, x: ndcX };
  const right = ndcX >= 0;
  return { camera: eyes[right ? 1 : 0]!, x: right ? ndcX * 2 - 1 : ndcX * 2 + 1 };
}

/** Ray origin + direction of an XR target-ray space (controller or hand pointer). */
function rayFrom(space: THREE.Object3D, origin: THREE.Vector3, direction: THREE.Vector3) {
  space.updateMatrixWorld(true);
  _tempMatrix.identity().extractRotation(space.matrixWorld);
  origin.setFromMatrixPosition(space.matrixWorld);
  direction.copy(_FORWARD).applyMatrix4(_tempMatrix).normalize();
}

/** Nearest miniature along the ray (or around its origin, for a pinch right on it). */
function miniatureOnRay(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  miniatures: readonly MiniatureHandle[]
): MiniatureHandle | null {
  let best: MiniatureHandle | null = null;
  let bestAlong = Infinity;
  for (const m of miniatures) {
    _vCurPos.set(...m.position);
    const along = _vCurPos.sub(origin).dot(direction);
    if (along < -MINIATURE_GRAB_RADIUS || along >= bestAlong) continue;
    _vCurPos.set(...m.position);
    if (_raycaster.ray.distanceToPoint(_vCurPos) <= MINIATURE_GRAB_RADIUS) {
      best = m;
      bestAlong = along;
    }
  }
  return best;
}

/** True when the ray passes within `radius` of `point`, in front of its origin. */
function rayNear(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  point: THREE.Vector3,
  radius: number
) {
  return (
    _vCurPos.subVectors(point, origin).dot(direction) > 0 &&
    _raycaster.ray.distanceToPoint(point) <= radius
  );
}

/** Everything a ray can hit besides scene panels (`userData.onSelect`). */
interface AimScene {
  targets: readonly SpatialTarget[];
  menu: WristMenu;
  miniatures?: readonly MiniatureHandle[];
  surface: ImageSurface | null;
  hotspots: readonly Hotspot[];
  panels?: PanelRegistry;
  photo?: PhotoGround | undefined;
}

const _panelHits: THREE.Intersection[] = [];

/** Nearest shown panel the ray hits (the raycaster ray is already set). */
function panelOnRay(panels: PanelRegistry | undefined) {
  if (!panels || panels.objects.length === 0) return null;
  _panelHits.length = 0;
  _raycaster.intersectObjects(panels.objects, true, _panelHits);
  for (const hit of _panelHits) {
    if (!shown(hit.object)) continue;
    const panel = panelOf(hit.object);
    if (panel) return { panel, hit };
  }
  return null;
}

const _vHot = new THREE.Vector3();
const _vPhotoO = new THREE.Vector3();
const _vPhotoD = new THREE.Vector3();

/**
 * What a ray points at, nearest first: the wrist button, a miniature, the scan button (menu
 * open), a tour floor arrow, then the scanned image (resolved to the detection whose box holds
 * that image point). Writes the beam end to `end`.
 */
function aimAt(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  end: THREE.Vector3,
  { targets, menu, miniatures = [], surface, hotspots, panels, photo }: AimScene
): Aim {
  _raycaster.ray.origin.copy(origin);
  _raycaster.ray.direction.copy(direction);

  if (menu.buttonVisible && rayNear(origin, direction, menu.button, WRIST_RAY_RADIUS)) {
    end.copy(menu.button);
    return { kind: 'wrist', id: WRIST_BUTTON_ID, u: 0, v: 0 };
  }

  const onPanel = panelOnRay(panels);
  if (onPanel) {
    end.copy(onPanel.hit.point);
    return { kind: 'panel', id: onPanel.panel.id, u: 0, v: 0, ...onPanel };
  }

  const mini = miniatureOnRay(origin, direction, miniatures);
  if (mini) {
    end.set(...mini.position);
    return { kind: 'miniature', id: mini.id, u: 0, v: 0, miniature: mini };
  }

  if (menu.open && rayNear(origin, direction, menu.scan, AIR_BUTTON_RADIUS)) {
    end.copy(menu.scan);
    return { kind: 'button', id: AIR_BUTTON_ID, u: 0, v: 0 };
  }

  for (const h of hotspots) {
    _vHot.set(...h.position);
    if (rayNear(origin, direction, _vHot, HOTSPOT_RADIUS)) {
      end.copy(_vHot);
      return { kind: 'hotspot', id: h.id, u: 0, v: 0 };
    }
  }

  // Tour: the ray as the photo sees it (from its spot, toward the photo point under the laser).
  const seen =
    surface && photo
      ? photoRay([origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z], photo)
      : null;
  if (seen && photo) {
    _vPhotoO.set(...photo.eye);
    _vPhotoD.set(...seen.dir);
  }
  const hit = surface
    ? seen
      ? screenHitFromRay(_vPhotoO, _vPhotoD, surface)
      : screenHitFromRay(origin, direction, surface)
    : null;
  if (hit) {
    const target = pickTargetAtUv(targets, hit.u, hit.v);
    if (target) {
      end.set(...target.position);
      // Targets are laid on the photo, which moves with the walk.
      if (photo) end.set(end.x - photo.offset[0], end.y - photo.offset[1], end.z - photo.offset[2]);
      return { kind: 'target', id: target.id, u: hit.u, v: hit.v };
    }
    end.set(...(seen ? seen.point : hit.point));
    return { kind: 'screen', id: null, u: hit.u, v: hit.v };
  }

  end.copy(origin).addScaledVector(direction, BEAM_LENGTH);
  return { kind: 'none', id: null, u: 0, v: 0 };
}

function beamColor(kind: AimKind): string {
  if (kind === 'wrist') return BEAM_WRIST;
  if (kind === 'panel') return BEAM_PANEL;
  if (kind === 'hotspot') return BEAM_HOTSPOT;
  if (kind === 'miniature') return BEAM_MINIATURE;
  if (kind === 'button') return BEAM_BUTTON;
  if (kind === 'target') return BEAM_TARGET;
  if (kind === 'screen') return BEAM_SCREEN;
  return BEAM_IDLE;
}

/**
 * Single input source of the /village VR studio (VS-T4).
 * - Controllers and hands share the system pointer ray (`getController(i)`): one shot per
 *   `selectstart` (trigger press or native pinch), never `select` too.
 * - Fingertip touch presses the wrist button (other hand) and, menu open, the scan button.
 * - Mouse: desktop preview and the IWER emulator.
 * Shots at the webcam video hit the object under the laser; elsewhere fall back to
 * scene objects carrying `userData.onSelect` (HUD toggle).
 * Miniatures: select held on one grabs it in place; turning or moving the controller / hand
 * (or dragging the mouse) rotates it; a quick tap calls `onTapMiniature` (connect).
 */
export const XRBlasterController = memo(function XRBlasterController({
  targets,
  menu,
  miniatures = [],
  onTapMiniature,
  onHoverTarget,
  onShootTarget,
  onTriggerScan,
  onShootScreen,
  surface = WEBCAM_SCREEN,
  hotspots = [],
  onHotspot,
  onShootOutside,
  panels,
  photo,
  aimOut,
}: XRBlasterControllerProps) {
  const { gl, camera, scene } = useThree();
  const hoveredRef = useRef<string | null>(null);
  const mouseNdcRef = useRef<{ x: number; y: number } | null>(null);
  /** Last mouse move over the scene (ms): in the headset view the mouse hovers for a while. */
  const mouseAtRef = useRef(-Infinity);
  const handsRef = useRef<
    Array<{ group: Parameters<typeof updateHandMesh>[0]; mesh: THREE.InstancedMesh }>
  >([]);
  const gripsRef = useRef<THREE.Object3D[]>([]);
  const lastTouchRef = useRef(0);
  const inputKindsRef = useRef<['controller' | 'hand', 'controller' | 'hand']>([
    'controller',
    'controller',
  ]);
  const grabsRef = useRef(new Map<InputKey, Grab>());
  /** Selects held on a panel: a tap on release, or a sideways drag (carousel). */
  const dragsRef = useRef(new Map<InputKey, PanelDrag>());
  /** Locked mouse turn (Play mode) kept off the headset while a controller holds something. */
  const heldTurnRef = useRef({ yaw: 0, pitch: 0 });
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

  const toggleMenu = useCallback(() => {
    playTargetHitSound();
    menu.toggle();
  }, [menu]);

  const pressButton = useCallback(() => {
    playLaserShootSound();
    playScanRadarSound();
    onTriggerScan?.();
  }, [onTriggerScan]);

  /** Starts holding the miniature the input points at; false when it points at none. */
  const tryGrab = useCallback(
    (
      key: InputKey,
      origin: THREE.Vector3,
      direction: THREE.Vector3,
      haptics?: Gamepad | null,
      grip = false
    ) => {
      const aim = aimAt(origin, direction, _vEnd, {
        targets,
        menu,
        miniatures,
        surface,
        hotspots,
        panels,
        photo,
      });
      if (!grip && aim.kind === 'panel' && aim.panel && aim.hit) {
        dragsRef.current.set(key, {
          panel: aim.panel,
          hit: aim.hit,
          yaw: yawOf(direction),
          moved: 0,
        });
        try {
          haptics?.hapticActuators?.[0]?.pulse(0.3, 30);
        } catch {
          // No haptics on the desktop emulator.
        }
        return true;
      }
      if (aim.kind !== 'miniature' || !aim.miniature) return false;
      grabTurntable(aim.miniature.turntable, key, performance.now());
      grabsRef.current.set(key, {
        miniature: aim.miniature,
        yaw: yawOf(direction),
        pitch: pitchOf(direction),
        x: origin.x,
        y: origin.y,
      });
      try {
        haptics?.hapticActuators?.[0]?.pulse(0.4, 40);
      } catch {
        // No haptics on the desktop emulator.
      }
      return true;
    },
    [targets, miniatures, menu, surface, hotspots, panels, photo]
  );

  const release = useCallback(
    (key: InputKey) => {
      const drag = dragsRef.current.get(key);
      if (drag) {
        dragsRef.current.delete(key);
        if (endDrag(drag)) playPanelSelectSound();
        return;
      }
      const grab = grabsRef.current.get(key);
      if (!grab) return;
      grabsRef.current.delete(key);
      // A quick trigger / pinch on a miniature connects it; the grip only ever turns it.
      const isGrip = key === 2 || key === 3;
      if (releaseTurntable(grab.miniature.turntable, performance.now()) && !isGrip) {
        playTargetHitSound();
        onTapMiniature?.(grab.miniature.id);
      }
    },
    [onTapMiniature]
  );

  /** Resolves one shot. `haptics` is the gamepad of the input that fired, if any. */
  const triggerShot = useCallback(
    (origin: THREE.Vector3, direction: THREE.Vector3, haptics?: Gamepad | null) => {
      const aim = aimAt(origin, direction, _vEnd, { targets, menu, surface, hotspots, photo });

      if (aim.kind === 'wrist') {
        toggleMenu();
        return;
      }
      if (aim.kind === 'hotspot' && aim.id) {
        playTargetHitSound();
        onHotspot?.(aim.id);
        return;
      }
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

      if (aim.kind === 'none') {
        if (onShootOutside) {
          playLaserShootSound();
          onShootOutside(origin, direction);
        }
        return;
      }
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
    [
      camera,
      scene,
      targets,
      menu,
      surface,
      hotspots,
      photo,
      toggleMenu,
      pressButton,
      onHotspot,
      onShootTarget,
      onShootScreen,
      onShootOutside,
    ]
  );

  // XR pointers (controllers and hands), grips and articulated hands.
  useEffect(() => {
    if (!gl?.xr?.getController) return;
    const added: Array<{ parent: THREE.Object3D; child: THREE.Object3D }> = [];
    const listeners: Array<{
      space: THREE.XRTargetRaySpace;
      type: 'selectstart' | 'selectend' | 'squeezestart' | 'squeezeend' | 'connected';
      fn: (e: THREE.Event) => void;
    }> = [];

    for (const i of [0, 1] as const) {
      const space = gl.xr.getController(i);
      scene?.add(space);
      const onStart = (e: THREE.Event) => {
        rayFrom(space, _vOrigin, _vDirection);
        const gamepad = (e as { data?: XRInputSource }).data?.gamepad ?? null;
        if (tryGrab(i, _vOrigin, _vDirection, gamepad)) return;
        triggerShot(_vOrigin, _vDirection, gamepad);
      };
      const onEnd = () => release(i);
      // Grip (squeeze) held on a miniature turns it, like Meta's grab (VS-T23).
      const gripKey = (i + 2) as InputKey;
      const onSqueezeStart = (e: THREE.Event) => {
        rayFrom(space, _vOrigin, _vDirection);
        const gamepad = (e as { data?: XRInputSource }).data?.gamepad ?? null;
        tryGrab(gripKey, _vOrigin, _vDirection, gamepad, true);
      };
      const onSqueezeEnd = () => release(gripKey);
      // Which input drives this pointer: a hand pinches, a controller pulls its trigger.
      const onConnected = (e: THREE.Event) => {
        const source = (e as { data?: XRInputSource }).data;
        inputKindsRef.current[i] = source?.hand ? 'hand' : 'controller';
      };
      space.addEventListener('selectstart', onStart as never);
      space.addEventListener('selectend', onEnd as never);
      space.addEventListener('squeezestart', onSqueezeStart as never);
      space.addEventListener('squeezeend', onSqueezeEnd as never);
      space.addEventListener('connected', onConnected as never);
      listeners.push({ space, type: 'selectstart', fn: onStart });
      listeners.push({ space, type: 'selectend', fn: onEnd });
      listeners.push({ space, type: 'squeezestart', fn: onSqueezeStart });
      listeners.push({ space, type: 'squeezeend', fn: onSqueezeEnd });
      listeners.push({ space, type: 'connected', fn: onConnected });

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
      for (const { space, type, fn } of listeners) {
        space.removeEventListener(type, fn as never);
        scene?.remove(space);
      }
      for (const { parent, child } of added) {
        parent.remove(child);
        scene?.remove(parent);
      }
      handsRef.current = [];
      gripsRef.current = [];
    };
  }, [gl, scene, triggerShot, tryGrab, release]);

  // Mouse: aim on move, shoot on left click (desktop preview and IWER emulator).
  // Listened on the document: in the emulator the IWER DevUI draws its own full-screen canvas
  // over ours (controller gizmos), which would swallow every click (menu, dialog buttons).
  useEffect(() => {
    const dom = gl.domElement;
    if (!dom) return;
    const doc = dom.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
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
    const presenting = () => !!gl.xr?.isPresenting;
    const px = (e: MouseEvent) => (typeof e.clientX === 'number' ? e.clientX : 0);
    /** Last pointer x of a panel drag (px). */
    let lastX = 0;
    const py = (e: MouseEvent) => (typeof e.clientY === 'number' ? e.clientY : 0);
    /**
     * A press that grabbed a panel or a model owns the gesture until release: its events stop
     * here (capture phase), so the emulator overlay (DevUI turns the headset on a mouse drag) and
     * the desktop camera controls never turn the view while a carousel or a model is dragged.
     */
    let owned = false;
    const own = (e: Event) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    };
    const onMouse = (e: Event) => {
      if (owned) own(e);
    };
    const onMove = (e: MouseEvent) => {
      if (owned) own(e);
      else if (!mouseTarget(e.target, dom, presenting())) return;
      mouseNdcRef.current = toNdc(e);
      mouseAtRef.current = performance.now();
      const drag = dragsRef.current.get('mouse');
      if (drag) {
        dragTo(drag, drag.yaw + (px(e) - lastX) * MOUSE_PANEL_GAIN);
        lastX = px(e);
        return;
      }
      const grab = grabsRef.current.get('mouse');
      if (!grab) return;
      const dx = px(e) - grab.x;
      const dy = py(e) - grab.y;
      grab.x = px(e);
      grab.y = py(e);
      rotateTurntable(grab.miniature.turntable, dx * MOUSE_GAIN, dy * MOUSE_GAIN);
    };
    const rayAt = (e: MouseEvent) => {
      const ndc = toNdc(e);
      // In the headset view the scene is drawn by the XR eye cameras, not the R3F camera.
      const eye = presenting()
        ? xrEyeAt(
            (gl.xr as unknown as { getCamera?: () => THREE.ArrayCamera }).getCamera?.(),
            ndc.x
          )
        : null;
      _mouse.set(eye ? eye.x : ndc.x, ndc.y);
      _raycaster.setFromCamera(_mouse, eye?.camera ?? camera!);
      _vOrigin.copy(_raycaster.ray.origin);
      _vDirection.copy(_raycaster.ray.direction);
    };
    // A click (press + release without dragging) shoots; a drag elsewhere looks around (desktop
    // controls, or the emulator's headset / gizmos).
    let press: { x: number; y: number } | null = null;
    const onDown = (e: MouseEvent) => {
      if ((typeof e.button === 'number' && e.button !== 0) || !camera) return;
      if (!mouseTarget(e.target, dom, presenting())) return;
      rayAt(e);
      press = { x: px(e), y: py(e) };
      if (tryGrab('mouse', _vOrigin, _vDirection)) {
        owned = true;
        own(e);
        lastX = px(e);
        const grab = grabsRef.current.get('mouse');
        if (grab) {
          grab.x = px(e);
          grab.y = py(e);
        }
      }
    };
    const onUp = (e: MouseEvent) => {
      if (owned) own(e);
      owned = false;
      const p = press;
      press = null;
      const moved = !p || Math.hypot(px(e) - p.x, py(e) - p.y) > CLICK_SLOP_PX;
      const drag = dragsRef.current.get('mouse');
      const held = !!drag || grabsRef.current.has('mouse');
      // A button pressed then dragged off (an emulator gizmo drag) is not a tap.
      if (drag && moved && !drag.panel.onDrag) dragsRef.current.delete('mouse');
      release('mouse');
      if (held || moved || !camera) return;
      rayAt(e);
      triggerShot(_vOrigin, _vDirection);
    };
    const onLeave = () => {
      press = null;
      owned = false;
      release('mouse');
    };
    // Emulator Play mode (pointer locked): the DevUI turns the headset, controllers included, on
    // every mouse move. While a controller holds a panel or a model, the move turns that instead
    // (stopped before the DevUI's document listener), so the view stays still, as on a headset.
    const view = doc.defaultView;
    const onLockedMove = (e: MouseEvent) => {
      if (!doc.pointerLockElement || !presenting()) return;
      const holding = [...dragsRef.current.keys(), ...grabsRef.current.keys()].some(
        (k) => k !== 'mouse'
      );
      if (!holding) return;
      own(e);
      const step = lockedTurn(e.movementX || 0, e.movementY || 0);
      heldTurnRef.current.yaw += step.yaw;
      heldTurnRef.current.pitch += step.pitch;
    };
    view?.addEventListener('mousemove', onLockedMove, true);
    const MOUSE_EVENTS = ['mousedown', 'mousemove', 'mouseup'] as const;
    for (const type of MOUSE_EVENTS) doc.addEventListener(type, onMouse, true);
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', onLeave, true);
    dom.addEventListener('pointerleave', onLeave);
    return () => {
      view?.removeEventListener('mousemove', onLockedMove, true);
      for (const type of MOUSE_EVENTS) doc.removeEventListener(type, onMouse, true);
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', onLeave, true);
      dom.removeEventListener('pointerleave', onLeave);
    };
  }, [gl, camera, triggerShot, tryGrab, release]);

  const drawBeam = (
    index: 0 | 1,
    origin: THREE.Vector3,
    direction: THREE.Vector3
  ): string | null => {
    const aim = aimAt(origin, direction, _vEnd, {
      targets,
      menu,
      miniatures,
      surface,
      hotspots,
      panels,
      photo,
    });
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
    const out = aimOut?.pointers[index];
    if (out) {
      out.visible = true;
      out.kind = aim.kind;
      out.id = aim.id;
      out.end.copy(_vEnd);
      out.input = gl.xr?.isPresenting ? inputKindsRef.current[index] : 'mouse';
    }
    return aim.id;
  };

  const hideBeam = (index: 0 | 1) => {
    pointers[index].visible = false;
    pips[index].visible = false;
    const out = aimOut?.pointers[index];
    if (out) out.visible = false;
  };

  useFrame((_, delta) => {
    const presenting = !!gl.xr?.isPresenting;
    const now = performance.now();
    let hovered: string | null = null;

    // 1. Hands: joints mesh + fingertip press on the wrist button (other hand) and,
    //    menu open, on the scan button.
    let anyHand = false;
    handsRef.current.forEach((h, index) => {
      const tracked = updateHandMesh(h.group, h.mesh) > 0 && presenting;
      h.mesh.visible = tracked;
      if (!tracked) return;
      anyHand = true;
      const tip = h.group.joints?.['index-finger-tip'];
      if (!tip) return;
      tip.getWorldPosition(_vTip);
      const cooled = now - lastTouchRef.current > TOUCH_COOLDOWN_MS;
      if (menu.buttonVisible && menu.wearer !== index) {
        const dw = _vTip.distanceTo(menu.button);
        if (dw <= WRIST_RAY_RADIUS) hovered = WRIST_BUTTON_ID;
        if (dw <= WRIST_TOUCH_RADIUS && cooled) {
          lastTouchRef.current = now;
          toggleMenu();
          return;
        }
      }
      if (!menu.open) return;
      const d = _vTip.distanceTo(menu.scan);
      if (d <= AIR_BUTTON_RADIUS) hovered = AIR_BUTTON_ID;
      if (d <= AIR_BUTTON_TOUCH_RADIUS && cooled) {
        lastTouchRef.current = now;
        pressButton();
      }
    });
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
    //    A pointer holding a miniature turns its motion into rotation instead.
    if (presenting) {
      // The Play-mode mouse turn applies only while something is held; it restarts at 0.
      const held = heldTurnRef.current;
      if (![...dragsRef.current.keys(), ...grabsRef.current.keys()].some((k) => k !== 'mouse')) {
        held.yaw = 0;
        held.pitch = 0;
      }
      for (const i of [0, 1] as const) {
        const space = gl.xr.getController(i);
        if (!space || !space.visible || space.matrixWorld.elements[15] === 0) {
          hideBeam(i);
          release(i); // tracking lost while holding: let go
          release((i + 2) as InputKey);
          continue;
        }
        rayFrom(space, _vOrigin, _vDirection);
        const drag = dragsRef.current.get(i);
        if (drag) dragTo(drag, yawOf(_vDirection) + held.yaw);
        const grab = grabsRef.current.get(i) ?? grabsRef.current.get((i + 2) as InputKey);
        if (grab) {
          const yaw = yawOf(_vDirection) + held.yaw;
          const pitch = pitchOf(_vDirection) + held.pitch;
          rotateTurntable(
            grab.miniature.turntable,
            wrapPi(yaw - grab.yaw) * RAY_GAIN + (_vOrigin.x - grab.x) * MOVE_GAIN,
            -(pitch - grab.pitch) * RAY_GAIN - (_vOrigin.y - grab.y) * MOVE_GAIN
          );
          grab.yaw = yaw;
          grab.pitch = pitch;
          grab.x = _vOrigin.x;
          grab.y = _vOrigin.y;
        }
        hovered = drawBeam(i, _vOrigin, _vDirection) ?? hovered;
      }
      // Emulator mouse: hover what it points at (no beam), so buttons light up before a click.
      // The lasers keep priority: a mouse left still never hides what a controller aims at.
      const ndc = mouseNdcRef.current;
      if (!hovered && ndc && now - mouseAtRef.current < MOUSE_HOVER_MS) {
        const eye = xrEyeAt(
          (gl.xr as unknown as { getCamera?: () => THREE.ArrayCamera }).getCamera?.(),
          ndc.x
        );
        if (eye) {
          _mouse.set(eye.x, ndc.y);
          _raycaster.setFromCamera(_mouse, eye.camera);
          _vOrigin.copy(_raycaster.ray.origin);
          _vDirection.copy(_raycaster.ray.direction);
          const aim = aimAt(_vOrigin, _vDirection, _vEnd, {
            targets,
            menu,
            miniatures,
            surface,
            hotspots,
            panels,
            photo,
          });
          if (aim.kind !== 'none' && aim.kind !== 'screen') hovered = aim.id ?? hovered;
        }
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
      if (hovered?.startsWith(HOLO_ID_PREFIX)) playHoverTick();
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
