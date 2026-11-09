/**
 * Geometry of the curved webcam screen in the /village VR studio.
 * Single source of truth shared by the backdrop mesh, the target projection and the
 * blaster raycast, so a shot at an object seen in the video lands on that object.
 *
 * The screen is the inside of an open cylinder (axis vertical, centred at z = centerZ),
 * mirrored on X so the video reads left-to-right. Image coords: u → right, v → down, in [0, 1].
 */
export interface WebcamScreenGeometry {
  /** Cylinder radius (m). Large radius = nearly flat central focus. */
  radius: number;
  /** Screen height (m). */
  height: number;
  /** Distance from the origin to the screen centre along -Z (m). */
  distance: number;
  /** Height of the screen centre (m). height / 2 keeps the bottom edge on the floor. */
  centerY: number;
  /** Video aspect ratio (width / height). */
  aspect: number;
}

export const WEBCAM_SCREEN: WebcamScreenGeometry = {
  radius: 8.5,
  height: 4.2,
  distance: 2.6,
  centerY: 2.1,
  aspect: 16 / 9,
};

export interface ScreenArc {
  thetaStart: number;
  thetaLength: number;
  /** Z of the cylinder axis. */
  centerZ: number;
}

export function screenArc(g: WebcamScreenGeometry = WEBCAM_SCREEN): ScreenArc {
  const thetaLength = (g.height * g.aspect) / g.radius;
  return {
    thetaLength,
    thetaStart: Math.PI - thetaLength / 2,
    centerZ: g.radius - g.distance,
  };
}

/** World point [x, y, z] of image coords (u, v) on the screen surface. */
export function screenPoint(
  u: number,
  v: number,
  g: WebcamScreenGeometry = WEBCAM_SCREEN
): [number, number, number] {
  const { thetaStart, thetaLength, centerZ } = screenArc(g);
  const theta = thetaStart + u * thetaLength;
  return [
    -g.radius * Math.sin(theta),
    g.centerY + g.height / 2 - v * g.height,
    centerZ + g.radius * Math.cos(theta),
  ];
}

export interface ScreenHit {
  u: number;
  v: number;
  point: [number, number, number];
  /** Distance along the ray (m). */
  distance: number;
}

type Vec3 = { x: number; y: number; z: number };

/**
 * Where a ray (from inside the cylinder) meets the screen, in image coords.
 * Null when the ray leaves through the uncovered part of the cylinder or points away.
 */
export function screenHitFromRay(
  origin: Vec3,
  direction: Vec3,
  g: WebcamScreenGeometry = WEBCAM_SCREEN
): ScreenHit | null {
  const { thetaStart, thetaLength, centerZ } = screenArc(g);
  const ox = origin.x;
  const oz = origin.z - centerZ;
  const a = direction.x * direction.x + direction.z * direction.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * direction.x + oz * direction.z);
  const c = ox * ox + oz * oz - g.radius * g.radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;

  const px = origin.x + direction.x * t;
  const py = origin.y + direction.y * t;
  const pz = origin.z + direction.z * t;
  // Undo the X mirror, then read the cylinder angle (x = R sin θ, z = R cos θ).
  let theta = Math.atan2(-px, pz - centerZ);
  if (theta < 0) theta += Math.PI * 2;
  const u = (theta - thetaStart) / thetaLength;
  const v = (g.centerY + g.height / 2 - py) / g.height;
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
