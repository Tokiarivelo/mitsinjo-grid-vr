import type { SectorId } from '@mitsinjo/engine';
import type { StatusColor } from '../types';
import { BUS_POSITION, SECTOR_POSITIONS } from './site-positions';

/**
 * /simulation VR map (VS-T37). Pure: village points → map plane coordinates (u right, v up, m).
 *
 * - Mini map (GTA-like): a small disc in the lower right of the view, heading-up and centred on the
 *   walker; blips past its range sit on its rim.
 * - Big map: a hologram table opened in front, north (−Z) up, centred on the village core; the
 *   walker is an arrow, buildings and the dispatcher are pins that open their controls.
 */

/** Mini map: disc radius (m, as felt) and village range it shows (scene units, centre to rim). */
export const MINI_MAP_RADIUS = 0.11;
export const MINI_MAP_RANGE = 24;
/** Mini map in the follow frame (0.9 m ahead, below the eyes): right and low, clear of panels. */
export const MINI_MAP_OFFSET: [number, number, number] = [0.5, -0.2, 0];
/** Tilt of the map discs toward the viewer (rad, about their X axis). */
export const MAP_TILT = -0.9;

/** Big map: disc radius (m, as felt) and range (scene units, centre to rim). */
export const BIG_MAP_RADIUS = 0.42;
export const BIG_MAP_RANGE = 22;
/** Big map centre: the village core (between the sectors). */
export const BIG_MAP_CENTER: [number, number] = [2.5, -0.5];
/** Pin radius on the big map (m): over Meta's 22 mm minimum hit target. */
export const MAP_PIN_RADIUS = 0.035;

export type MapPinId = SectorId | 'dispatcher';

export interface MapPin {
  id: MapPinId;
  x: number;
  z: number;
}

/** What the map shows: the six sectors and the dispatcher (its mixing desk). */
export const MAP_PINS: readonly MapPin[] = [
  ...(Object.keys(SECTOR_POSITIONS) as SectorId[]).map((id) => ({
    id,
    x: SECTOR_POSITIONS[id][0],
    z: SECTOR_POSITIONS[id][2],
  })),
  { id: 'dispatcher', x: BUS_POSITION[0], z: BUS_POSITION[2] },
];

/** Puts (u, v) back inside the disc of `radius` (on its rim when past it). Mutates `out`. */
function clampToDisc(out: [number, number], radius: number): [number, number] {
  const r = Math.hypot(out[0], out[1]);
  if (r > radius) {
    out[0] *= radius / r;
    out[1] *= radius / r;
  }
  return out;
}

/**
 * Mini map point (heading-up, walker at the centre): (x, z) seen from the walker at (px, pz)
 * looking along the horizontal unit (fx, fz). Into `out` (no allocation in the frame loop).
 */
export function miniMapPoint(
  px: number,
  pz: number,
  fx: number,
  fz: number,
  x: number,
  z: number,
  out: [number, number],
  radius = MINI_MAP_RADIUS,
  range = MINI_MAP_RANGE
): [number, number] {
  const dx = x - px;
  const dz = z - pz;
  const k = radius / range;
  // Right of the heading (Y up): (−fz, fx).
  out[0] = (dx * -fz + dz * fx) * k;
  out[1] = (dx * fx + dz * fz) * k;
  return clampToDisc(out, radius);
}

/** Big map point (north = −Z up, east = +X right), on the rim when out of range. Into `out`. */
export function bigMapPoint(
  x: number,
  z: number,
  out: [number, number],
  radius = BIG_MAP_RADIUS,
  range = BIG_MAP_RANGE,
  center: [number, number] = BIG_MAP_CENTER
): [number, number] {
  const k = radius / range;
  out[0] = (x - center[0]) * k;
  out[1] = -(z - center[1]) * k;
  return clampToDisc(out, radius);
}

/** Walker arrow angle on the north-up map (rad, about the plane normal, + = counter-clockwise). */
export function headingAngle(fx: number, fz: number): number {
  return Math.atan2(-fx, -fz);
}

/** Unit horizontal heading of a direction (falls back to −Z when looking straight down/up). */
export function horizontalHeading(dx: number, dz: number, out: [number, number]): [number, number] {
  const l = Math.hypot(dx, dz);
  if (l < 1e-6) {
    out[0] = 0;
    out[1] = -1;
  } else {
    out[0] = dx / l;
    out[1] = dz / l;
  }
  return out;
}

/** Pin tone key from a building's engine status (the dispatcher has its own). */
export function pinTone(
  status: StatusColor | 'dispatcher'
): 'green' | 'amber' | 'red' | 'cyan' | 'violet' {
  if (status === 'dispatcher') return 'violet';
  if (status === 'battery-green') return 'green';
  if (status === 'warning-amber') return 'amber';
  if (status === 'critical-red') return 'red';
  return 'cyan';
}
