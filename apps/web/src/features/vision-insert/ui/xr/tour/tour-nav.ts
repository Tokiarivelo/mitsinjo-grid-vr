import type { ApplianceDetection } from '@/lib/vision';
import {
  dirFromYawPitch,
  equirectYawPitch,
  projectPanoBox,
  type CaptureView,
  type Vec3,
} from './equirect';
import type { TourRoom, TourRoomId } from './tour-data';

/** Centre of the photo sphere = where the 360° camera stood: viewer's eye height. */
export const TOUR_EYE: Vec3 = [0, 1.6, 0];
/** Photo sphere radius (m): beyond every panel, label and target, so nothing is ever cut. */
export const TOUR_SPHERE_RADIUS = 9;
/** Scan photo: 80° wide, 16:9, like a phone camera. */
export const TOUR_CAPTURE_HFOV = (80 * Math.PI) / 180;
export const TOUR_CAPTURE_ASPECT = 16 / 9;
/** Plane the scan photo is laid on for targets (`surfaceFromView`), in front of the sphere. */
export const TOUR_SURFACE_DISTANCE = 3;
/** Floor arrows indoors: distance from the photo spot and pick radius (m). */
export const TOUR_ARROW_DISTANCE = 1.7;
export const TOUR_ARROW_RADIUS = 0.38;
/** Walking speed (m/s): a calm human pace. */
export const TOUR_WALK_SPEED = 1.4;
/** Walking within this distance of an arrow goes through it to the next place (m). */
export const TOUR_ARROW_REACH = 0.45;

/**
 * Size of the grounded photo (floor plane + walls around the photo spot) and of the walkable
 * disc. Indoors the walls are close; outdoors the photo is a wide open space.
 */
export interface TourScale {
  /** Radius of the wall the photo is projected on (m). */
  wall: number;
  /** How far from the photo spot the viewer may walk (m). */
  walk: number;
  /** Distance of the floor arrows from the photo spot (m). */
  arrow: number;
}

const INDOOR: TourScale = { wall: 4, walk: 2.1, arrow: TOUR_ARROW_DISTANCE };
const OUTDOOR: TourScale = { wall: 14, walk: 4, arrow: 3 };

export function tourScale(room: TourRoom): TourScale {
  return room.src.includes('/outdoor/') ? OUTDOOR : INDOOR;
}

export const tourLinkId = (to: TourRoomId) => `tour-link:${to}`;

export interface TourArrow {
  id: string;
  to: TourRoomId;
  yaw: number;
  /** World position on the floor. */
  position: Vec3;
}

/** Floor arrows of a room, given the image column seen straight ahead (`uFront`). */
export function tourArrows(room: TourRoom, uFront: number): TourArrow[] {
  const dist = tourScale(room).arrow;
  return room.links.map((link) => {
    const { yaw } = equirectYawPitch(link.u, 0.5, uFront);
    return {
      id: tourLinkId(link.to),
      to: link.to,
      yaw,
      position: [
        Number((TOUR_EYE[0] + Math.sin(yaw) * dist).toFixed(3)),
        0.03,
        Number((TOUR_EYE[2] - Math.cos(yaw) * dist).toFixed(3)),
      ],
    };
  });
}

/** Walk input: forward (+) / back (-) and right (+) / left (-), each in [-1, 1]. */
export interface WalkAxes {
  forward: number;
  strafe: number;
}

/** Ground offset [x, z] (m) from the photo spot. */
export type Ground = [number, number];

/**
 * One frame of walking: moves `ground` along the head heading (yaw 0 = -Z) at walking speed,
 * kept inside the walkable disc. Diagonals are not faster.
 */
export function stepWalk(
  ground: Ground,
  axes: WalkAxes,
  headYaw: number,
  dt: number,
  walkRadius: number
): Ground {
  let { forward: f, strafe: s } = axes;
  const len = Math.hypot(f, s);
  if (len < 1e-3) return ground;
  if (len > 1) {
    f /= len;
    s /= len;
  }
  const step = TOUR_WALK_SPEED * dt;
  const sin = Math.sin(headYaw);
  const cos = Math.cos(headYaw);
  let x = ground[0] + (sin * f + cos * s) * step;
  let z = ground[1] + (-cos * f + sin * s) * step;
  const r = Math.hypot(x, z);
  if (r > walkRadius) {
    x *= walkRadius / r;
    z *= walkRadius / r;
  }
  return [x, z];
}

/** Arrow the viewer stands on (within reach), if any. `ground` is relative to the photo spot. */
export function arrowAt(arrows: readonly TourArrow[], ground: Ground): TourArrow | null {
  for (const a of arrows) {
    const dx = a.position[0] - TOUR_EYE[0] - ground[0];
    const dz = a.position[2] - TOUR_EYE[2] - ground[1];
    if (Math.hypot(dx, dz) <= TOUR_ARROW_REACH) return a;
  }
  return null;
}

const KEY_AXES: Record<string, [keyof WalkAxes, number]> = {
  arrowup: ['forward', 1],
  w: ['forward', 1],
  z: ['forward', 1],
  arrowdown: ['forward', -1],
  s: ['forward', -1],
  arrowleft: ['strafe', -1],
  a: ['strafe', -1],
  q: ['strafe', -1],
  arrowright: ['strafe', 1],
  d: ['strafe', 1],
};

/** True for a key that walks (↑↓←→, WASD and ZQSD for AZERTY keyboards). */
export const isWalkKey = (key: string) => key.toLowerCase() in KEY_AXES;

/** Walk axes from the keys held down. */
export function keyWalkAxes(held: ReadonlySet<string>): WalkAxes {
  const axes: WalkAxes = { forward: 0, strafe: 0 };
  for (const key of held) {
    const hit = KEY_AXES[key.toLowerCase()];
    if (hit) axes[hit[0]] = Math.max(-1, Math.min(1, axes[hit[0]] + hit[1]));
  }
  return axes;
}

const STICK_DEADZONE = 0.15;

/** Walk axes from a gamepad: the thumbstick (xr-standard axes 2–3, else 0–1); up = forward. */
export function stickWalkAxes(axes: readonly number[] | undefined): WalkAxes {
  if (!axes || axes.length < 2) return { forward: 0, strafe: 0 };
  const [x, y] = axes.length >= 4 ? [axes[2]!, axes[3]!] : [axes[0]!, axes[1]!];
  const dead = (v: number) => (Math.abs(v) < STICK_DEADZONE ? 0 : v);
  return { forward: -dead(y), strafe: dead(x) };
}

/** Scan photo of the 360° view centred on a heading (head gaze, or a shot direction). */
export function captureViewAt(yaw: number, pitch: number): CaptureView {
  // Keep the photo level-ish: very steep looks would only see floor or ceiling.
  const p = Math.max(-0.6, Math.min(0.6, pitch));
  return { yaw, pitch: p, hfov: TOUR_CAPTURE_HFOV, aspect: TOUR_CAPTURE_ASPECT };
}

/** Labelled objects of the room visible in a scan photo, as detections (offline ground truth). */
export function tourExpectedDetections(
  room: TourRoom,
  uFront: number,
  view: CaptureView
): ApplianceDetection[] {
  const out: ApplianceDetection[] = [];
  for (const o of room.objects) {
    const box = projectPanoBox(o.box, uFront, view);
    if (!box) continue;
    out.push({
      id: o.id,
      label: o.label,
      labels: o.labels,
      category: o.category,
      ...(o.kind ? { kind: o.kind, scenery: o.scenery } : {}),
      confidence: 0.9,
      box,
    });
  }
  return out;
}

export { dirFromYawPitch };
