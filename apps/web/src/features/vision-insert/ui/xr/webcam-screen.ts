/**
 * Flat image surfaces of the /village VR studio: where a photo / video frame sits in the world.
 * Single source of truth shared by the backdrop mesh, the target projection and the blaster
 * raycast, so a shot at an object seen in the image lands on that object.
 *
 * - `WEBCAM_SCREEN`: the live webcam wall, flat (no cylinder), bottom edge on the floor.
 * - `surfaceFromView`: the invisible plane of a 360° tour scan photo (`tour/equirect.ts`).
 * Image coords: u → right, v → down, in [0, 1].
 */
import {
  dirFromYawPitch,
  stripUv,
  stripYawPitch,
  viewBasis,
  yawPitchOf,
  type CaptureView,
} from './tour/equirect';

type Vec3 = [number, number, number];

/** A panorama strip photo laid on a sphere of `distance` m around `eye` (tour scans). */
export interface SurfaceStrip {
  eye: Vec3;
  view: CaptureView;
  distance: number;
}

export interface ImageSurface {
  /** World centre of the image. */
  center: Vec3;
  /** Unit vectors along the image's +u (right) and its up (−v). */
  right: Vec3;
  up: Vec3;
  /** Size of the image on the surface (m); a strip: its arc lengths. */
  width: number;
  height: number;
  /**
   * Set for a panorama strip (`surfaceFromStrip`): image coords map to headings around `eye`, not
   * to the flat plane above (which then only gives the strip's centre and orientation).
   */
  strip?: SurfaceStrip;
}

const WEBCAM_HEIGHT = 4.2;

/** Live webcam wall: 16:9, 2.6 m ahead, bottom edge on the floor. */
export const WEBCAM_SCREEN: ImageSurface = {
  center: [0, WEBCAM_HEIGHT / 2, -2.6],
  right: [1, 0, 0],
  up: [0, 1, 0],
  width: (WEBCAM_HEIGHT * 16) / 9,
  height: WEBCAM_HEIGHT,
};

/** Plane `distance` m ahead of `eye`, facing it, covering the view's field of view. */
export function surfaceFromView(
  eye: Vec3,
  basis: { forward: Vec3; right: Vec3; up: Vec3; tx: number; ty: number },
  distance: number
): ImageSurface {
  return {
    center: [
      eye[0] + basis.forward[0] * distance,
      eye[1] + basis.forward[1] * distance,
      eye[2] + basis.forward[2] * distance,
    ],
    right: basis.right,
    up: basis.up,
    width: 2 * distance * basis.tx,
    height: 2 * distance * basis.ty,
  };
}

/**
 * A panorama strip photo (`view.projection` `equirect`) around `eye`, at `distance` m: centre
 * straight ahead of the strip, arc-length size.
 */
export function surfaceFromStrip(eye: Vec3, view: CaptureView, distance: number): ImageSurface {
  const b = viewBasis(view);
  return {
    center: [
      eye[0] + b.forward[0] * distance,
      eye[1] + b.forward[1] * distance,
      eye[2] + b.forward[2] * distance,
    ],
    right: b.right,
    up: b.up,
    width: distance * view.hfov,
    height: (distance * view.hfov) / view.aspect,
    strip: { eye, view, distance },
  };
}

/** World point [x, y, z] of image coords (u, v) on the surface. */
export function screenPoint(u: number, v: number, s: ImageSurface = WEBCAM_SCREEN): Vec3 {
  if (s.strip) {
    const { eye, view, distance } = s.strip;
    const h = stripYawPitch(u, v, view);
    const d = dirFromYawPitch(h.yaw, h.pitch);
    return [eye[0] + d[0] * distance, eye[1] + d[1] * distance, eye[2] + d[2] * distance];
  }
  const a = (u - 0.5) * s.width;
  const b = (0.5 - v) * s.height;
  return [
    s.center[0] + s.right[0] * a + s.up[0] * b,
    s.center[1] + s.right[1] * a + s.up[1] * b,
    s.center[2] + s.right[2] * a + s.up[2] * b,
  ];
}

export interface ScreenHit {
  u: number;
  v: number;
  point: Vec3;
  /** Distance along the ray (m). */
  distance: number;
}

type XYZ = { x: number; y: number; z: number };

/** Where a ray meets the surface, in image coords; null when it misses or points away. */
export function screenHitFromRay(
  origin: XYZ,
  direction: XYZ,
  s: ImageSurface = WEBCAM_SCREEN
): ScreenHit | null {
  if (s.strip) return stripHitFromRay(origin, direction, s.strip);
  const [rx, ry, rz] = s.right;
  const [ux, uy, uz] = s.up;
  // Normal = right × up (towards the viewer).
  const nx = ry * uz - rz * uy;
  const ny = rz * ux - rx * uz;
  const nz = rx * uy - ry * ux;
  const denom = direction.x * nx + direction.y * ny + direction.z * nz;
  if (Math.abs(denom) < 1e-9) return null;
  const t =
    ((s.center[0] - origin.x) * nx +
      (s.center[1] - origin.y) * ny +
      (s.center[2] - origin.z) * nz) /
    denom;
  if (t <= 0) return null;
  const px = origin.x + direction.x * t;
  const py = origin.y + direction.y * t;
  const pz = origin.z + direction.z * t;
  const dx = px - s.center[0];
  const dy = py - s.center[1];
  const dz = pz - s.center[2];
  const u = 0.5 + (dx * rx + dy * ry + dz * rz) / s.width;
  const v = 0.5 - (dx * ux + dy * uy + dz * uz) / s.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v, point: [px, py, pz], distance: t };
}

interface BoxLike {
  id: string;
  detection: { box: { x: number; y: number; w: number; h: number } };
}

/**
 * The detection whose image box contains (u, v): smallest box wins, so a socket
 * on a table is picked over the table. `pad` widens boxes (image fraction) to forgive aim.
 */
export function pickTargetAtUv<T extends BoxLike>(
  targets: readonly T[],
  u: number,
  v: number,
  pad = 0.015
): T | null {
  let best: T | null = null;
  let bestArea = Infinity;
  for (const t of targets) {
    const { x, y, w, h } = t.detection.box;
    if (u < x - pad || u > x + w + pad || v < y - pad || v > y + h + pad) continue;
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      best = t;
    }
  }
  return best;
}

/** Where a ray meets a strip's sphere (from inside), in strip image coords. */
function stripHitFromRay(origin: XYZ, direction: XYZ, st: SurfaceStrip): ScreenHit | null {
  const len = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const dx = direction.x / len;
  const dy = direction.y / len;
  const dz = direction.z / len;
  const ox = origin.x - st.eye[0];
  const oy = origin.y - st.eye[1];
  const oz = origin.z - st.eye[2];
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - st.distance * st.distance;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b + Math.sqrt(disc);
  if (t <= 0) return null;
  const p: Vec3 = [ox + dx * t, oy + dy * t, oz + dz * t];
  const { yaw, pitch } = yawPitchOf(p);
  const { u, v } = stripUv(yaw, pitch, st.view);
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return {
    u,
    v,
    point: [st.eye[0] + p[0], st.eye[1] + p[1], st.eye[2] + p[2]],
    distance: t,
  };
}
