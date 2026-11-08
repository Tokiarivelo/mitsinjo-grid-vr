/**
 * Pure camera framing for a selected building: where to look, where to stand,
 * and how fast to orbit around it once the camera arrives.
 */

export type Vec3 = [number, number, number];

/** Look slightly above the ground so the building body sits mid-frame. */
export const FOCUS_LOOK_HEIGHT = 1.3;
/** Camera offset from the building: front three-quarter, intimate cinematic close-up framing. */
export const FOCUS_OFFSET: Vec3 = [3.6, 4.2, 5.5];
/** Orbit speed around the focused building (rad/s): one full turn ≈ 42 s. */
export const FOCUS_ORBIT_RAD_PER_S = 0.15;

/** Appliances are small: the camera comes even closer than for a building. */
export const APPLIANCE_FOCUS_SCALE = 0.65;

/** `scale` shrinks the offset and look height (1 = building framing). */
export function focusCameraFor(position: Vec3, scale = 1): { position: Vec3; target: Vec3 } {
  const [x, y, z] = position;
  return {
    position: [
      x + FOCUS_OFFSET[0] * scale,
      y + FOCUS_OFFSET[1] * scale,
      z + FOCUS_OFFSET[2] * scale,
    ],
    target: [x, y + FOCUS_LOOK_HEIGHT * scale, z],
  };
}

/** Per-frame orbit angle (delta capped so the first demand frame after idle doesn't jump). */
export function focusOrbitAngle(deltaS: number): number {
  return Math.min(Math.max(deltaS, 0), 0.1) * FOCUS_ORBIT_RAD_PER_S;
}
