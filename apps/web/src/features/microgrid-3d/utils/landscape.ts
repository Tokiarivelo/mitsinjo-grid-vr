import { SECTOR_IDS, type SectorId } from '@mitsinjo/engine';
import { BATTERY_POSITION, BUS_POSITION, SECTOR_POSITIONS, SOLAR_POSITION } from './site-positions';
import { fbm2d, smoothstep } from './noise';

/**
 * Pure landscape layout: terrain relief, laterite paths and keep-out zones.
 * Visual only (no energy values). Shared by the terrain mesh, the vegetation
 * scatter and the cable router so everything sits on the same ground.
 */

/** Village plateau: flat inside this radius so buildings never float. */
export const FLAT_RADIUS = 25;
/** Hills reach full height at this radius. */
export const HILL_RADIUS = 52;
/** Terrain mesh radius (fog hides the edge). */
export const TERRAIN_RADIUS = 110;

export const POND_CENTER: [number, number] = [-11.5, 4.5];
export const POND_RADIUS = 2.6;

/** Rice paddy parcel west of the pond (visual only, M12-T1). */
export const PADDY_CENTER: [number, number] = [-19, 4.5];
export const PADDY_SIZE: [number, number] = [7, 5];

/**
 * Sun azimuth (radians, from -z towards +x): behind the village, slightly right,
 * over the lake valley, as in the reference render.
 */
export const SUN_AZIMUTH_RAD = 0.45;

/** Distant lake in the sunset valley (catches the sun like the reference). */
export const LAKE_CENTER: [number, number] = [34, -70];
export const LAKE_RADIUS = 24;
export const LAKE_LEVEL = -0.6;

const TERRAIN_SEED = 7;

/** Ground height at (x, z). 0 on the village plateau, rolling forested hills beyond. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const rise = smoothstep(FLAT_RADIUS, HILL_RADIUS, r);
  const relief = fbm2d(x * 0.035, z * 0.035, TERRAIN_SEED);
  // Lower on the camera side (south, +z) so the village and the horizon stay visible.
  const facing = 0.3 + 0.7 * smoothstep(25, -35, z);
  const hills = rise * rise * (2 + relief * 11) * facing;
  // Small bumps only near/after the plateau edge.
  const bumps =
    (fbm2d(x * 0.18, z * 0.18, TERRAIN_SEED + 3) - 0.5) *
    0.6 *
    smoothstep(FLAT_RADIUS - 4, FLAT_RADIUS + 6, r);
  // Basin for the distant lake.
  const dl = Math.hypot(x - LAKE_CENTER[0], z - LAKE_CENTER[1]);
  const basin = (1 - smoothstep(LAKE_RADIUS * 0.6, LAKE_RADIUS * 1.25, dl)) * (hills + 2.2);
  return hills + bumps - basin;
}

/** Laterite paths as polylines [x, z][] (bus hub → each site, plus the village road). */
export const VILLAGE_PATHS: [number, number][][] = [
  [
    [BUS_POSITION[0], BUS_POSITION[2]],
    [-3, -3],
    [SOLAR_POSITION[0] + 3, SOLAR_POSITION[2] + 3],
  ],
  [
    [BUS_POSITION[0], BUS_POSITION[2]],
    [BATTERY_POSITION[0], BATTERY_POSITION[2]],
  ],
  [
    [BUS_POSITION[0], BUS_POSITION[2]],
    [5.5, 0.5],
    [SECTOR_POSITIONS.health[0] - 1.2, SECTOR_POSITIONS.health[2] + 1.5],
  ],
  [
    [BUS_POSITION[0], BUS_POSITION[2]],
    [-5, 0.8],
    [SECTOR_POSITIONS.water[0] + 1.5, SECTOR_POSITIONS.water[2]],
  ],
  [
    [BATTERY_POSITION[0], BATTERY_POSITION[2]],
    [1.5, -7.5],
    [SECTOR_POSITIONS.school[0], SECTOR_POSITIONS.school[2] + 2],
  ],
  [
    [BUS_POSITION[0], BUS_POSITION[2]],
    [-4.5, 6.5],
    [SECTOR_POSITIONS.households[0] + 1.2, SECTOR_POSITIONS.households[2]],
  ],
  [
    [BUS_POSITION[0], BUS_POSITION[2]],
    [3.5, 5.5],
    [SECTOR_POSITIONS.market[0], SECTOR_POSITIONS.market[2] - 1],
  ],
  // Service track to the factory (north-east, behind the clinic).
  [
    [BUS_POSITION[0], BUS_POSITION[2]],
    [7.5, -4.5],
    [SECTOR_POSITIONS.industry[0] - 2.4, SECTOR_POSITIONS.industry[2]],
  ],
  // Main road leaving the village to the south-east.
  [
    [SECTOR_POSITIONS.market[0], SECTOR_POSITIONS.market[2]],
    [12, 15],
    [17, 23],
    [20, 36],
    [26, 54],
  ],
  // Ring road to the clinic and school.
  [
    [SECTOR_POSITIONS.health[0], SECTOR_POSITIONS.health[2]],
    [10, -9],
    [SECTOR_POSITIONS.school[0] + 3, SECTOR_POSITIONS.school[2]],
  ],
];

export const PATH_HALF_WIDTH = 0.8;

/** Closest point to (px, pz) on segment a→b. */
function projectOnSegment(
  px: number,
  pz: number,
  a: [number, number],
  b: [number, number]
): [number, number] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2));
  return [a[0] + t * dx, a[1] + t * dz];
}

export interface ClosestPathSegment {
  distance: number;
  closestPoint: [number, number];
  segment: [[number, number], [number, number]];
}

/** Finds the nearest point and segment among village paths. */
export function closestPathSegment(
  x: number,
  z: number,
  paths = VILLAGE_PATHS
): ClosestPathSegment | null {
  let best = Infinity;
  let bestPoint: [number, number] = [0, 0];
  let bestSeg: [[number, number], [number, number]] = [
    [0, 0],
    [0, 0],
  ];
  for (const line of paths) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      if (!a || !b) continue;
      const [cx, cz] = projectOnSegment(x, z, a, b);
      const d = Math.hypot(x - cx, z - cz);
      if (d < best) {
        best = d;
        bestPoint = [cx, cz];
        bestSeg = [a, b];
      }
    }
  }
  if (!Number.isFinite(best)) return null;
  return { distance: best, closestPoint: bestPoint, segment: bestSeg };
}

/** Distance from (x, z) to the nearest path centre line. */
export function pathDistance(x: number, z: number, paths = VILLAGE_PATHS): number {
  const hit = closestPathSegment(x, z, paths);
  return hit ? hit.distance : Infinity;
}

export interface KeepOutZone {
  x: number;
  z: number;
  r: number;
  id?: string;
}

/** Clearing radius around each sector building (no trees inside). */
export const SECTOR_KEEP_OUT_R: Record<SectorId, number> = {
  health: 4.6,
  water: 3.4,
  school: 5,
  households: 4.4,
  market: 4.2,
  industry: 4.2,
};

/** Areas where vegetation must not grow (buildings, pads, pond). */
export const KEEP_OUT_ZONES: KeepOutZone[] = [
  ...SECTOR_IDS.map((id) => ({
    x: SECTOR_POSITIONS[id][0],
    z: SECTOR_POSITIONS[id][2],
    r: SECTOR_KEEP_OUT_R[id],
    id: `sector:${id}`,
  })),
  { x: SOLAR_POSITION[0], z: SOLAR_POSITION[2], r: 6.6, id: 'solar' },
  { x: BATTERY_POSITION[0], z: BATTERY_POSITION[2], r: 3.4, id: 'battery' },
  { x: BUS_POSITION[0], z: BUS_POSITION[2], r: 3.2, id: 'bus' },
  { x: POND_CENTER[0], z: POND_CENTER[1], r: POND_RADIUS + 0.8, id: 'pond' },
];

/** True when nothing may be placed at (x, z): keep-out zone, path, lake or off-map. */
export function isBlocked(
  x: number,
  z: number,
  margin = 0,
  zones: readonly KeepOutZone[] = KEEP_OUT_ZONES,
  excludeId?: string
): boolean {
  if (Math.hypot(x, z) > TERRAIN_RADIUS - 4) return true;
  for (const k of zones) {
    if (excludeId && k.id === excludeId) continue;
    if (Math.hypot(x - k.x, z - k.z) < k.r + margin - 1e-9) return true;
  }
  if (pathDistance(x, z) < PATH_HALF_WIDTH + 0.5 + margin - 1e-9) return true;
  if (Math.hypot(x - LAKE_CENTER[0], z - LAKE_CENTER[1]) < LAKE_RADIUS * 0.95) return true;
  return false;
}
