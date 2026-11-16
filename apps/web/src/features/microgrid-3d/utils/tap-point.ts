import type { SectorId } from '@mitsinjo/engine';
import type { BuildingSceneModel, LineFlowSceneModel, SectorPole } from '../types';
import type { ApplianceMarkerSceneModel } from './appliance-markers';
import { routeCable } from './cable-route';
import { BUS_POSITION, SECTOR_POSITIONS, feederExitPosition } from './site-positions';
import { terrainHeight, type KeepOutZone } from './landscape';
import { siteZones } from './site-zones';
import { STATUS_HEX, TOKEN_HEX } from './scene-palette';

export type TapMode = 'branch' | 'ems';

export interface TapPointResult {
  /** The 3D tap position on the network [x, y, z]. */
  point: [number, number, number];
  x: number;
  y: number;
  z: number;
  /** Network element tapped: 'pole' | 'building' | 'ems'. */
  kind: 'pole' | 'building' | 'ems';
  /** Sector ID powering this branch / appliance. */
  sector: SectorId;
  /** Tap mode used: 'branch' (default) or 'ems'. */
  mode: TapMode;
  /** Optional corner pole waypoint [x, y, z] if contouring an obstacle. */
  waypoint?: [number, number, number];
  /** Total route distance from tap point (through waypoint if any) to appliance. */
  distance: number;
  /** False if object is right next to the tap point (distance <= 4.5, no intermediate poles). */
  needsPoles: boolean;
  /** Intermediate utility poles along the derivation (excluding tap anchor and target anchor). */
  poles: [number, number][];
  /** Full 3D polyline cable points from tap point to appliance. */
  routePoints: [number, number, number][];
}

export interface TapPointOptions {
  /** Dynamic and static zones to avoid crossing (defaults to siteZones()). */
  zones?: readonly KeepOutZone[];
  /** Placed object ID to exclude from obstacle intersection checks. */
  excludeId?: string;
  /** Cable route span spacing (defaults to 4.5 scene units). */
  spacing?: number;
}

/** Parses [x, y, z], [x, z], or { x, z } into 2D (x, z) coordinates and optional y. */
export function parsePositionCoords(
  pos: [number, number] | [number, number, number] | { x: number; z: number }
): { x: number; z: number; y?: number } {
  if (Array.isArray(pos)) {
    if (pos.length === 3) {
      return { x: pos[0], y: pos[1], z: pos[2] };
    }
    return { x: pos[0], z: pos[1] };
  }
  return { x: pos.x, z: pos.z };
}

/**
 * Approximate physical radius of an obstacle circle for suspended aerial cable clearance.
 * Smaller than the vegetation keep-out radius so cables can enter village yards, but
 * large enough to prevent cables clipping through roofs, pond water, or equipment.
 */
export function physicalObstacleRadius(zone: KeepOutZone): number {
  if (zone.id?.startsWith('sector:')) {
    // Village building footprint is ~2.4 m radius
    return 2.4;
  }
  if (zone.id === 'pond') {
    // Pond water body radius is 2.6 m
    return 2.6;
  }
  if (zone.id === 'solar') {
    return 5.5;
  }
  if (zone.id === 'battery') {
    return 2.2;
  }
  if (zone.id === 'bus') {
    return 1.8;
  }
  // Placed objects: keep clearance around their emprise
  return Math.max(0.4, zone.r * 0.7);
}

/**
 * Checks whether the straight 2D segment from A(x1, z1) to B(x2, z2) cuts through obstacle O.
 * Ignores obstacles that contain the start or end point (the anchors themselves).
 */
export function segmentIntersectsObstacle(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  zone: KeepOutZone,
  excludeId?: string
): boolean {
  if (excludeId && zone.id === excludeId) return false;

  const rPhys = physicalObstacleRadius(zone);

  // If anchor A or anchor B is inside/on the obstacle, that obstacle is the anchor itself
  const distA = Math.hypot(ax - zone.x, az - zone.z);
  const distB = Math.hypot(bx - zone.x, bz - zone.z);
  if (distA <= rPhys + 0.2 || distB <= rPhys + 0.2) {
    return false;
  }

  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-4) {
    return distA < rPhys;
  }

  const t = ((zone.x - ax) * dx + (zone.z - az) * dz) / len2;
  // Intersection only matters if the closest point lies strictly along the segment
  if (t <= 0.05 || t >= 0.95) {
    return false;
  }

  const projX = ax + t * dx;
  const projZ = az + t * dz;
  const dist = Math.hypot(zone.x - projX, zone.z - projZ);
  return dist < rPhys;
}

/**
 * Finds the first obstacle that the segment from A to B cuts through.
 */
export function findBlockingObstacle(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  zones: readonly KeepOutZone[],
  excludeId?: string
): KeepOutZone | null {
  for (const z of zones) {
    if (segmentIntersectsObstacle(ax, az, bx, bz, z, excludeId)) {
      return z;
    }
  }
  return null;
}

/**
 * Generates an intermediate corner pole waypoint [x, y, z] to contour around a blocking obstacle.
 * Returns null if no clean detour can be found.
 */
export function contourWaypoint(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  obstacle: KeepOutZone,
  zones: readonly KeepOutZone[],
  excludeId?: string
): [number, number, number] | null {
  const rPhys = physicalObstacleRadius(obstacle);
  const margin = 0.9;
  const detourR = rPhys + margin;

  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return null;

  // Normal unit vectors to segment AB
  const nx = -dz / len;
  const nz = dx / len;

  const cand1: [number, number] = [obstacle.x + nx * detourR, obstacle.z + nz * detourR];
  const cand2: [number, number] = [obstacle.x - nx * detourR, obstacle.z - nz * detourR];

  const evalDetour = (w: [number, number]): number | null => {
    // Check if segment A -> W is clear
    if (findBlockingObstacle(ax, az, w[0], w[1], zones, excludeId)) return null;
    // Check if segment W -> B is clear
    if (findBlockingObstacle(w[0], w[1], bx, bz, zones, excludeId)) return null;
    return Math.hypot(w[0] - ax, w[1] - az) + Math.hypot(bx - w[0], bz - w[1]);
  };

  const dist1 = evalDetour(cand1);
  const dist2 = evalDetour(cand2);

  let chosen: [number, number] | null = null;
  if (dist1 !== null && (dist2 === null || dist1 <= dist2)) chosen = cand1;
  else if (dist2 !== null) chosen = cand2;
  if (!chosen) return null;
  return [chosen[0], terrainHeight(chosen[0], chosen[1]), chosen[1]];
}

interface CandidateEval {
  point: [number, number, number];
  kind: 'pole' | 'building' | 'ems';
  sector: SectorId;
  waypoint?: [number, number, number];
  distance: number;
  cost: number;
}

/**
 * Evaluates candidate tap points along a sector branch or EMS, checking obstacle intersections
 * and contouring if required (PI-T6).
 */
export function tapPoint(
  position: [number, number] | [number, number, number] | { x: number; z: number },
  sector: SectorId,
  mode: TapMode = 'branch',
  options: TapPointOptions = {}
): TapPointResult {
  const { x: targetX, z: targetZ } = parsePositionCoords(position);
  const targetY = terrainHeight(targetX, targetZ);
  const targetPos: [number, number, number] = [targetX, targetY, targetZ];

  const zones = options.zones ?? siteZones();
  const excludeId = options.excludeId;
  const spacing = options.spacing ?? 4.5;

  // 1. Gather candidate connection origins
  const candidates: { point: [number, number, number]; kind: 'pole' | 'building' | 'ems' }[] = [];

  if (mode === 'ems') {
    const busY = terrainHeight(BUS_POSITION[0], BUS_POSITION[2]);
    candidates.push({
      point: [BUS_POSITION[0], busY, BUS_POSITION[2]],
      kind: 'ems',
    });
  } else {
    // Mode 'branch': candidates are the sector building and every pole along its feeder line
    const bPos = SECTOR_POSITIONS[sector];
    const bY = terrainHeight(bPos[0], bPos[2]);
    candidates.push({
      point: [bPos[0], bY, bPos[2]],
      kind: 'building',
    });

    const feederExit = feederExitPosition(sector);
    const lineRoute = routeCable(feederExit, bPos, { spacing });
    for (const [px, pz] of lineRoute.poles) {
      candidates.push({
        point: [px, terrainHeight(px, pz), pz],
        kind: 'pole',
      });
    }
  }

  // 2. Evaluate each candidate for clear path or detour
  const evals: CandidateEval[] = [];

  for (const cand of candidates) {
    const directDist = Math.hypot(targetX - cand.point[0], targetZ - cand.point[2]);
    const blocker = findBlockingObstacle(
      cand.point[0],
      cand.point[2],
      targetX,
      targetZ,
      zones,
      excludeId
    );

    if (!blocker) {
      // Direct path is clear
      evals.push({
        point: cand.point,
        kind: cand.kind,
        sector,
        distance: directDist,
        cost: directDist,
      });
    } else {
      // Try contouring around the blocking obstacle
      const wp = contourWaypoint(
        cand.point[0],
        cand.point[2],
        targetX,
        targetZ,
        blocker,
        zones,
        excludeId
      );
      if (wp) {
        const detourDist =
          Math.hypot(wp[0] - cand.point[0], wp[2] - cand.point[2]) +
          Math.hypot(targetX - wp[0], targetZ - wp[2]);
        // Slight penalty (+1.0) for a detour so a direct route of similar length is preferred
        evals.push({
          point: cand.point,
          kind: cand.kind,
          sector,
          waypoint: wp,
          distance: detourDist,
          cost: detourDist + 1.0,
        });
      }
    }
  }

  // Fallback: if all candidates are completely blocked, pick the candidate with minimum direct distance
  let chosen: CandidateEval;
  if (evals.length > 0) {
    evals.sort((a, b) => a.cost - b.cost);
    chosen = evals[0]!;
  } else {
    let best = candidates[0]!;
    let bestD = Infinity;
    for (const c of candidates) {
      const d = Math.hypot(targetX - c.point[0], targetZ - c.point[2]);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    const dist = Math.hypot(targetX - best.point[0], targetZ - best.point[2]);
    chosen = {
      point: best.point,
      kind: best.kind,
      sector,
      distance: dist,
      cost: dist,
    };
  }

  // 3. Route utility cable and intermediate poles
  let poles: [number, number][];
  let routePoints: [number, number, number][];

  // Service drop from building: up to 6.5 scene units without an intermediate pole (PI-T6/PI-T7)
  const effectiveSpacing =
    chosen.kind === 'building' && chosen.distance <= 6.5 && !chosen.waypoint
      ? Math.max(spacing, chosen.distance + 0.1)
      : spacing;

  if (!chosen.waypoint) {
    const route = routeCable(chosen.point, targetPos, { spacing: effectiveSpacing });
    poles = route.poles;
    routePoints = route.points;
  } else {
    const wp = chosen.waypoint;
    const r1 = routeCable(chosen.point, wp, { spacing });
    const r2 = routeCable(wp, targetPos, { spacing });
    // The waypoint itself acts as a corner utility pole
    poles = [...r1.poles, [wp[0], wp[2]], ...r2.poles];
    routePoints = [...r1.points, ...r2.points.slice(1)];
  }

  const needsPoles = poles.length > 0;

  return {
    point: chosen.point,
    x: chosen.point[0],
    y: chosen.point[1],
    z: chosen.point[2],
    kind: chosen.kind,
    sector,
    mode,
    waypoint: chosen.waypoint,
    distance: chosen.distance,
    needsPoles,
    poles,
    routePoints,
  };
}

/** Electron speed on an appliance derivation, from its current draw (visual only). */
export const derivationSpeed = (kwNow: number): number => Math.min(2.5, Math.max(0.5, kwNow / 2));

export interface ApplianceDerivationsResult {
  lines: LineFlowSceneModel[];
  poles: SectorPole[];
}

/**
 * Builds physical derivation cables and utility poles for all inserted appliances (PI-T7).
 * Reuses routeCable for catenary sag and pole placement.
 * Derivation poles inherit the appliance's sectorId so street lamps reflect feeder status.
 * Derivation lines are active when the appliance draws power, allowing ElectronFlow to follow.
 */
export function buildApplianceDerivations(
  appliances: readonly ApplianceMarkerSceneModel[] | undefined,
  buildings?: Partial<Record<SectorId, Pick<BuildingSceneModel, 'statusColor' | 'onFire'>>>,
  options: {
    placedModels?: Readonly<Record<string, { connectionMode?: TapMode }>>;
    zones?: readonly KeepOutZone[];
    spacing?: number;
  } = {}
): ApplianceDerivationsResult {
  if (!appliances || appliances.length === 0) {
    return { lines: [], poles: [] };
  }

  const lines: LineFlowSceneModel[] = [];
  const poles: SectorPole[] = [];

  for (const m of appliances) {
    // A non-electric object (VS-T40) gets no pole, tap or cable.
    if (m.nonElectric) continue;
    const mode = options.placedModels?.[m.id]?.connectionMode ?? 'branch';
    const tap = tapPoint(m.position, m.sector, mode, {
      zones: options.zones,
      excludeId: m.id,
      spacing: options.spacing,
    });

    // 1. Add intermediate utility poles
    for (const [px, pz] of tap.poles) {
      poles.push({ x: px, z: pz, sectorId: m.sector });
    }

    // 2. Add cable lines (for TransmissionCable and ElectronFlow)
    const b = buildings?.[m.sector];
    const statusColor = b?.statusColor ?? (m.running ? 'battery-green' : 'idle');
    const color = STATUS_HEX[statusColor] ?? TOKEN_HEX.energyCyan;
    const cut = Boolean(b?.onFire);
    const speed = derivationSpeed(m.kwNow);

    // One cable per segment: tap → (corner pole →) appliance.
    const stops = tap.waypoint ? [tap.point, tap.waypoint, m.position] : [tap.point, m.position];
    for (let i = 1; i < stops.length; i++) {
      lines.push({
        from: stops[i - 1]!,
        to: stops[i]!,
        active: m.running,
        flowKw: m.kwNow,
        direction: m.running ? 'forward' : 'idle',
        speed,
        color,
        cut,
      });
    }
  }

  return { lines, poles };
}
