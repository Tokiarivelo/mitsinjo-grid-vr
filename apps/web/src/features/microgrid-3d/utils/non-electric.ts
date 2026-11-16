import { HORIZON_H } from '@mitsinjo/engine';

/**
 * Non-electric object (VS-T40): a placed thing that draws no power (tree, car, fence…). It stays an
 * engine line so the village keeps its spot, with a zero duty profile, so the engine computes 0 kW
 * for it, and the village draws no pole, tap or cable to it.
 */

/** Duty of a non-electric line: off every hour. */
export const NO_LOAD_DUTY: readonly number[] = Object.freeze(Array<number>(HORIZON_H).fill(0));

/** True when a line never draws power (its duty is zero every hour). */
export function isNonElectric(a: { hourlyDuty?: readonly number[] | undefined }): boolean {
  return !!a.hourlyDuty && a.hourlyDuty.length > 0 && a.hourlyDuty.every((d) => d === 0);
}
