/**
 * Frame-rate independent easing of a visual level toward its engine target (lights, electron glow):
 * an exponential approach with time constant `tauS`, so a cap change dims the scene over about a
 * second instead of jumping. Pure: the caller keeps the current value (ref or state).
 */

/** Time constant of light changes (s): ≈ 95 % of the way after 3 τ ≈ 1.3 s. */
export const LIGHT_EASE_TAU_S = 0.45;
/** Below this gap the value snaps to the target (no endless tail of frames). */
export const EASE_EPS = 0.004;

export function easeToward(
  current: number,
  target: number,
  dtS: number,
  tauS = LIGHT_EASE_TAU_S
): number {
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(dtS) || dtS <= 0 || tauS <= 0) return dtS > 0 ? target : current;
  const next = current + (target - current) * (1 - Math.exp(-dtS / tauS));
  return Math.abs(target - next) < EASE_EPS ? target : next;
}

/** True when every value has reached its target. */
export function settled(current: Record<string, number>, target: Record<string, number>): boolean {
  return Object.keys(target).every((k) => current[k] === target[k]);
}
