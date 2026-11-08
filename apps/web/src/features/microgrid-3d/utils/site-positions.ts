import type { SectorId } from '@mitsinjo/engine';

/**
 * Village site positions (scene units, y = 0, ground added by callers). Leaf module on purpose:
 * `landscape` and `placement` both need these, and living in `to-scene-model` created an import
 * cycle that crashed module evaluation (PP-T3).
 */
export const SECTOR_POSITIONS: Record<SectorId, [number, number, number]> = {
  health: [12.5, 0, -0.5],
  water: [-10.5, 0, 0.5],
  school: [2.5, 0, -13.0],
  households: [-9.0, 0, 11.0],
  market: [7.0, 0, 10.0],
  industry: [15.5, 0, -11.5],
};

export const SOLAR_POSITION: [number, number, number] = [-14.0, 0, -11.5];
export const BATTERY_POSITION: [number, number, number] = [0, 0, -2];
export const BUS_POSITION: [number, number, number] = [0, 0, 1];

/**
 * Feeder departures on the EMS controller's roof gantry (x offset from BUS_POSITION),
 * ordered by where each sector lies (west → east) so outgoing cables never cross.
 * The breaker LEDs on the cabinet use the same order.
 */
export const FEEDER_EXIT_X: Record<SectorId, number> = {
  water: -0.6,
  households: -0.36,
  school: -0.12,
  market: 0.12,
  health: 0.36,
  industry: 0.6,
};
/** Gantry depth (z offset from BUS_POSITION), above the cabinet. */
export const FEEDER_EXIT_Z = -0.2;

/** World point where a sector's cable leaves the controller. */
export function feederExitPosition(id: SectorId): [number, number, number] {
  return [BUS_POSITION[0] + FEEDER_EXIT_X[id], 0, BUS_POSITION[2] + FEEDER_EXIT_Z];
}
