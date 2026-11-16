import * as THREE from 'three';
import { darkness, RAY_CONTRAST, rayColors } from './xr-ray-contrast';

/**
 * The pointer ray as Meta draws it (VS-T26, Meta « Ray casting » specs): the hit ray stays long and
 * invisible; what shows is a short, thin beam that starts a little in front of the hand or the
 * controller and fades out along its length, plus a cursor ring where the ray hits, of constant
 * angular size, white on hover, dark blue and smaller (83 %) while select is held. The beam fades
 * away when the ray points at nothing that can be used.
 *
 * VS-T30: the colours adapt to the surroundings (`xr-ray-contrast`): light beam and ring on dark
 * surroundings, dark ones on bright sky or walls, each with a thin halo of the opposite tone.
 */
export const RAY_VISUAL = {
  /** Visible beam length (m): hands, controllers. */
  handLength: 0.25,
  controllerLength: 0.35,
  /** Gap between the hand / controller and the beam's start (m). */
  gap: 0.1,
  /** Beam radius at its start (m): about 1 mm wide, tapering to nothing. */
  radius: 0.0009,
  hover: '#ffffff',
  select: '#001e78',
  /** Cursor ring radius per metre of distance (≈ 0.7° whatever the distance). */
  cursorPerMetre: 0.012,
  /** Inner radius of the ring, share of its outer radius. */
  cursorInner: 0.62,
  /** Cursor size while select is held, share of its hover size. */
  selectScale: 0.83,
  /** Transition durations (s): fade in (hover), fade out, press, release. */
  fadeIn: 0.3,
  fadeOut: 0.25,
  press: 0.08,
  release: 0.1,
  /** Beam opacity when the ray points at nothing usable. */
  idleOpacity: 0,
} as const;

export type RayInput = 'hand' | 'controller' | 'mouse';

/** Moves `current` toward `target` at a pace that covers 0 → 1 in `duration` seconds. */
export function approach(current: number, target: number, dt: number, duration: number): number {
  if (duration <= 0) return target;
  const step = dt / duration;
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

/**
 * Where the visible beam starts and how long it is (m), for a hit `distance` away: the spec length
 * after the gap, never past the hit. Zero length for the mouse (its ray starts at the eye).
 */
export function beamSpan(distance: number, input: RayInput): { start: number; length: number } {
  if (input === 'mouse') return { start: 0, length: 0 };
  const full = input === 'hand' ? RAY_VISUAL.handLength : RAY_VISUAL.controllerLength;
  const start = RAY_VISUAL.gap;
  return { start, length: Math.max(0, Math.min(full, distance - start)) };
}

/** Cursor outer radius at `distance` (m), shrunk to `selectScale` as `press` goes 0 → 1. */
export function cursorRadius(distance: number, press: number): number {
  const s = 1 - (1 - RAY_VISUAL.selectScale) * Math.min(1, Math.max(0, press));
  return Math.max(0.002, distance * RAY_VISUAL.cursorPerMetre) * s;
}

export interface RayVisualFrame {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  /** Where the hit ray ends (the hit point, or far ahead when nothing is hit). */
  end: THREE.Vector3;
  /** The ray points at something usable: beam and cursor shown. */
  usable: boolean;
  input: RayInput;
  /** Select (trigger / pinch / mouse button) held. */
  pressed: boolean;
  /** Colour of the cursor's centre dot (what kind of thing is aimed at). */
  tint: THREE.ColorRepresentation;
  /** Linear luminance (0–1) of what surrounds the ray (`surroundingLuminance`); default: dark. */
  surrounding?: number;
  dt: number;
}

export interface RayVisual {
  group: THREE.Group;
  update(frame: RayVisualFrame): void;
  hide(): void;
  dispose(): void;
}

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
/** Ring and dot face +z; turned to face back along the ray. */
const _backward = new THREE.Vector3(0, 0, 1);
const _neg = new THREE.Vector3();
const _colors = { core: new THREE.Color(), halo: new THREE.Color(), select: new THREE.Color() };
/** Halo: beam radius and ring width, as shares of the core's. */
const BEAM_HALO = 3;
const RING_HALO = 1.22;

/** Unit beam along +y (0 → 1), opaque at its base, transparent at its tip (vertex alpha). */
function beamGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0, 1, 1, 8, 4, true);
  geo.translate(0, 0.5, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    colors.set([1, 1, 1, Math.pow(1 - y, 1.6)], i * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geo;
}

/** One pointer's beam and cursor; `update` every frame, no allocation. */
export function createRayVisual(): RayVisual {
  const group = new THREE.Group();
  group.name = 'xr-ray-visual';
  const beamMat = new THREE.MeshBasicMaterial({
    color: RAY_VISUAL.hover,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const beamGeo = beamGeometry();
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.frustumCulled = false;
  beam.renderOrder = 10;
  const beamHaloMat = beamMat.clone();
  const beamHalo = new THREE.Mesh(beamGeo, beamHaloMat);
  beamHalo.frustumCulled = false;
  beamHalo.renderOrder = 9;
  const ringMat = new THREE.MeshBasicMaterial({
    color: RAY_VISUAL.hover,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(RAY_VISUAL.cursorInner, 1, 40), ringMat);
  const ringHaloMat = ringMat.clone();
  const ringHalo = new THREE.Mesh(
    new THREE.RingGeometry(RAY_VISUAL.cursorInner / RING_HALO, RING_HALO, 40),
    ringHaloMat
  );
  ringHalo.renderOrder = 10;
  const dotMat = ringMat.clone();
  const dot = new THREE.Mesh(new THREE.CircleGeometry(RAY_VISUAL.cursorInner * 0.45, 20), dotMat);
  const cursor = new THREE.Group();
  // Halos last: existing child indexes stay (render order puts them behind).
  cursor.add(ring, dot, ringHalo);
  cursor.renderOrder = 11;
  ring.renderOrder = 11;
  dot.renderOrder = 11;
  group.add(beam, cursor, beamHalo);
  group.visible = false;
  // The surroundings probe skips the lasers themselves.
  group.userData.noRayProbe = true;
  let shown = 0;
  let press = 0;
  let dark = 0;

  return {
    group,
    update({ origin, direction, end, usable, input, pressed, tint, surrounding, dt }) {
      shown = approach(
        shown,
        usable ? 1 : RAY_VISUAL.idleOpacity,
        dt,
        usable ? RAY_VISUAL.fadeIn : RAY_VISUAL.fadeOut
      );
      press = approach(press, pressed ? 1 : 0, dt, pressed ? RAY_VISUAL.press : RAY_VISUAL.release);
      group.visible = shown > 0.001;
      if (!group.visible) return;
      dark = approach(dark, darkness(surrounding ?? 0), dt, RAY_CONTRAST.settle);
      rayColors(dark, _colors);
      const distance = origin.distanceTo(end);
      const span = beamSpan(distance, input);
      beam.visible = span.length > 0.005;
      if (beam.visible) {
        const r = RAY_VISUAL.radius;
        _q.setFromUnitVectors(_up, direction);
        beam.quaternion.copy(_q);
        beam.position.copy(origin).addScaledVector(direction, span.start);
        beam.scale.set(r, span.length, r);
        beamMat.color.copy(_colors.core).lerp(_colors.select, press);
        beamMat.opacity = shown * 0.9;
        beamHalo.quaternion.copy(_q);
        beamHalo.position.copy(beam.position);
        beamHalo.scale.set(r * BEAM_HALO, span.length, r * BEAM_HALO);
        beamHaloMat.color.copy(_colors.halo);
        beamHaloMat.opacity = shown * 0.35;
      }
      beamHalo.visible = beam.visible;
      cursor.visible = usable || shown > 0.05;
      const radius = cursorRadius(distance, press);
      // A hair in front of the surface, facing the ray.
      cursor.position.copy(end).addScaledVector(direction, -0.004);
      cursor.quaternion.setFromUnitVectors(_backward, _neg.copy(direction).negate());
      cursor.scale.setScalar(radius);
      ringMat.color.copy(_colors.core).lerp(_colors.select, press);
      ringMat.opacity = shown;
      ringHaloMat.color.copy(_colors.halo);
      ringHaloMat.opacity = shown * 0.55;
      dotMat.color.set(tint);
      dotMat.opacity = shown * 0.9;
    },
    hide() {
      shown = 0;
      press = 0;
      group.visible = false;
    },
    dispose() {
      beamGeo.dispose();
      beamMat.dispose();
      beamHaloMat.dispose();
      ringHalo.geometry.dispose();
      ringHaloMat.dispose();
      ring.geometry.dispose();
      ringMat.dispose();
      dot.geometry.dispose();
      dotMat.dispose();
    },
  };
}
