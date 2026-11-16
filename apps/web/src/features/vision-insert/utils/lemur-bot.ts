/**
 * Head of the chat's maki bot (VS-T27): where it looks and when it blinks. Pure, no three.js, no
 * randomness (same motion every run, testable): the blinks follow a fixed irregular rhythm.
 */

/** Furthest the head turns toward the cursor (rad): sideways, then up / down. */
export const GAZE_MAX_YAW = 0.65;
export const GAZE_MAX_PITCH = 0.4;

const clamp = (n: number, a: number) => Math.max(-a, Math.min(a, n));

/**
 * Head yaw (right = positive) and pitch (up = positive) toward a point given in the head's own
 * space (+Z out of its face), clamped so the head never turns its back. A point behind the head
 * keeps the head facing forward on that side.
 */
export function gazeAngles(x: number, y: number, z: number): { yaw: number; pitch: number } {
  const flat = Math.hypot(x, z);
  if (flat < 1e-6 && Math.abs(y) < 1e-6) return { yaw: 0, pitch: 0 };
  return {
    yaw: clamp(Math.atan2(x, Math.max(z, 1e-3)), GAZE_MAX_YAW),
    pitch: clamp(Math.atan2(y, flat), GAZE_MAX_PITCH),
  };
}

/** Seconds between blinks, repeated (a double blink every few: two close gaps). */
const BLINK_GAPS = [3.2, 4.6, 0.35, 2.4, 5.1, 3.7];
const BLINK_PERIOD = BLINK_GAPS.reduce((a, b) => a + b, 0);
/** A blink closes and opens the lids in this long (s). */
export const BLINK_DURATION = 0.18;

/** How closed the eyelids are at time `t` (s): 0 open, 1 shut. */
export function blinkAmount(t: number): number {
  let local = ((t % BLINK_PERIOD) + BLINK_PERIOD) % BLINK_PERIOD;
  for (const gap of BLINK_GAPS) {
    if (local < gap) {
      const into = gap - local; // time left before the blink at the end of this gap
      if (into > BLINK_DURATION) return 0;
      const k = 1 - into / BLINK_DURATION; // 0 → 1 across the blink
      return Math.sin(k * Math.PI);
    }
    local -= gap;
  }
  return 0;
}
