import type { SectorId } from '@mitsinjo/engine';
import type { StatusColor } from '../types';
import { BUS_POSITION, SECTOR_POSITIONS } from './site-positions';
import {
  LAKE_CENTER,
  LAKE_RADIUS,
  PADDY_CENTER,
  PADDY_SIZE,
  PATH_HALF_WIDTH,
  POND_CENTER,
  POND_RADIUS,
  VILLAGE_PATHS,
} from './landscape';

/**
 * /simulation VR map (VS-T37). Pure: village points → map plane coordinates (u right, v up, m).
 *
 * - Mini map (GTA-like): a small disc in the lower right of the view, heading-up and centred on the
 *   walker; blips past its range sit on its rim.
 * - Big map: a hologram opened in front that walks with you (VS-T38), north (−Z) up and centred on
 *   the walker, whose arrow turns with the head; buildings and the dispatcher are pins that open
 *   their controls.
 * Both are drawn on a canvas (roads, paths, lake, pond, paddy, buildings, names): `mapTransform`
 * gives the world (x, z) → canvas px transform for `CanvasRenderingContext2D.setTransform`.
 */

/** Mini map: disc radius (m, as felt) and village range it shows (scene units, centre to rim). */
export const MINI_MAP_RADIUS = 0.11;
export const MINI_MAP_RANGE = 24;
/** Mini map in the follow frame (0.9 m ahead, below the eyes): right and low, clear of panels. */
/** Far right of the view (~38°), low: out of the way of the scene and the panels (VS-T38). */
export const MINI_MAP_OFFSET: [number, number, number] = [0.72, -0.2, 0];
/** Tilt of the mini map toward the viewer (rad, about its X axis). */
export const MAP_TILT = -0.55;

/** Big map: disc radius (m, as felt) and range (scene units, centre to rim). */
export const BIG_MAP_RADIUS = 0.55;
export const BIG_MAP_RANGE = 18;
/** Big map in the follow frame: centred, a bit higher and farther than the menus (~1.15 m). */
export const BIG_MAP_OFFSET: [number, number, number] = [0, 0.12, -0.25];
/** Nearly upright (≈ 20°): its names stay readable, not foreshortened like a table (VS-T38). */
export const BIG_MAP_TILT = -0.35;
/** Pin hit radius on the big map (m): over Meta's 22 mm minimum hit target. */
export const MAP_PIN_RADIUS = 0.04;
/** Canvas sizes (px): mini, big. */
export const MINI_MAP_PX = 256;
export const BIG_MAP_PX = 1024;

/** Land features drawn on the map (scene units). */
export const MAP_FEATURES = {
  paths: VILLAGE_PATHS,
  pathWidth: PATH_HALF_WIDTH * 2,
  water: [
    { x: LAKE_CENTER[0], z: LAKE_CENTER[1], r: LAKE_RADIUS },
    { x: POND_CENTER[0], z: POND_CENTER[1], r: POND_RADIUS },
  ],
  paddy: { x: PADDY_CENTER[0], z: PADDY_CENTER[1], w: PADDY_SIZE[0], d: PADDY_SIZE[1] },
} as const;

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

/** Big map point (north = −Z up, east = +X right) around the walker at (px, pz). Into `out`. */
export function bigMapPoint(
  px: number,
  pz: number,
  x: number,
  z: number,
  out: [number, number],
  radius = BIG_MAP_RADIUS,
  range = BIG_MAP_RANGE
): [number, number] {
  const k = radius / range;
  out[0] = (x - px) * k;
  out[1] = -(z - pz) * k;
  return clampToDisc(out, radius);
}

/**
 * World (x, z) → canvas px transform `[a, b, c, d, e, f]` for `ctx.setTransform` (X = a·x + c·z + e,
 * Y = b·x + d·z + f): the walker at (px, pz) in the centre of a `size` px canvas showing `range`
 * units to the rim; heading (fx, fz) up, or north up when (fx, fz) = (0, −1). Into `out`.
 */
export function mapTransform(
  px: number,
  pz: number,
  fx: number,
  fz: number,
  size: number,
  range: number,
  out: number[]
): number[] {
  const c = size / 2;
  const s = c / range;
  const a = -s * fz;
  const cz = s * fx;
  const b = -s * fx;
  const d = -s * fz;
  out[0] = a;
  out[1] = b;
  out[2] = cz;
  out[3] = d;
  out[4] = c - (a * px + cz * pz);
  out[5] = c - (b * px + d * pz);
  return out;
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
