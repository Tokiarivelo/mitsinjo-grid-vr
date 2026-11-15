import type { Vec3 } from './equirect';

/**
 * The grounded 360° photo as the panorama shader draws it (`panorama-tour.tsx`): a sphere of
 * radius `wall` around the photo spot, cut by the floor `floor` m below it. `offset` is the live
 * walk offset [x, bob, z] the shader adds to the head (the photo spot sits at `eye - offset` in
 * the world), written every frame by `PanoramaTour`.
 */
export interface PhotoGround {
  eye: Vec3;
  wall: number;
  floor: number;
  /** Mutated in place every frame (no allocation); [0, 0, 0] at the photo spot. */
  offset: Vec3;
  /**
   * Steps asked for (m, > 0 forward along the gaze, < 0 back): the tour glides them off (snap
   * step, VS-T23) and brings this back to 0.
   */
  step: number;
}

/** Distance along `d` (unit) from `o` (photo-local) to the photo: wall sphere, else the floor. */
export function groundedDistance(o: Vec3, d: Vec3, wall: number, floor: number): number {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - wall * wall;
  let t = -b + Math.sqrt(Math.max(b * b - c, 0));
  if (d[1] < -1e-4) t = Math.min(t, (-floor - o[1]) / d[1]);
  return Math.max(0, t);
}

/** Point of the photo seen from its spot in direction `d` (unit), photo-local. */
export function groundedPoint(d: Vec3, wall: number, floor: number): Vec3 {
  const t = groundedDistance([0, 0, 0], d, wall, floor);
  return [d[0] * t, d[1] * t, d[2] * t];
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * A world ray (head or controller, after walking) as the photo sees it: the photo point it hits,
 * in world coordinates, and the direction of that point from the photo spot. Shooting or hovering
 * an object then resolves on the scan image exactly where it is drawn, wherever the viewer stands.
 */
export function photoRay(
  origin: Vec3,
  direction: Vec3,
  g: PhotoGround
): { dir: Vec3; point: Vec3 } {
  const o: Vec3 = [
    origin[0] - g.eye[0] + g.offset[0],
    origin[1] - g.eye[1] + g.offset[1],
    origin[2] - g.eye[2] + g.offset[2],
  ];
  const d = norm(direction);
  const t = groundedDistance(o, d, g.wall, g.floor);
  const local: Vec3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  return {
    dir: norm(local),
    point: [
      g.eye[0] + local[0] - g.offset[0],
      g.eye[1] + local[1] - g.offset[1],
      g.eye[2] + local[2] - g.offset[2],
    ],
  };
}
