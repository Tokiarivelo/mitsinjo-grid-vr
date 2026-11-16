import {
  applianceProfileKw,
  SECTOR_IDS,
  type Appliance,
  type Priority,
  type SectorId,
  type SimulationResult,
} from '@mitsinjo/engine';
import type { BuildingSceneModel, StatusColor } from '../types';
import { terrainHeight } from './landscape';
import { isNonElectric } from './non-electric';
import { clampToTerrain, defaultPosition, snapAwayFromBuildings } from './placement';

/** One inserted appliance in the 3D village (PV-T13). kW values come from the engine profile. */
export interface ApplianceMarkerSceneModel {
  id: string;
  name: string;
  category: Appliance['category'];
  sector: SectorId;
  quantity: number;
  watts: number;
  /** Engine profile of this line at the shown hour (kW). */
  kwNow: number;
  /** Line draws power now and its sector is served: the marker glows. */
  running: boolean;
  /** Marker base on the ground (y = terrain height). */
  position: [number, number, number];
  /** Feeder anchor: where the cable link meets the sector building (PP-T3). */
  feeder: [number, number, number];
  /** Grid connection mode (PI-T8/PI-T9): 'branch' (default) or 'ems'. */
  connectionMode?: 'branch' | 'ems';
  /** Draws no power (VS-T40, zero duty): no pole, tap, cable or diagram branch. */
  nonElectric?: true;
  /** Badge state from its sector (PT-11b), set by `toSceneModel`; absent = plain badge. */
  tag?: ApplianceTagState;
}

/** What an inserted object's badge shows, all from its sector's engine input and result (PT-11b). */
export interface ApplianceTagState {
  /** The sector's priority: an appliance has none of its own. */
  priority: Priority;
  statusColor: StatusColor;
  /** Its sector burns or has a critical incident. */
  inAlert: boolean;
}

/**
 * Badge state of one appliance: idle when its sector is off or it draws nothing this hour,
 * else its sector's served status (green full, amber partly served, red unserved). Pure.
 */
export function applianceTagState(
  m: Pick<ApplianceMarkerSceneModel, 'kwNow'>,
  sector: Pick<BuildingSceneModel, 'priority' | 'statusColor' | 'connected' | 'inAlert' | 'onFire'>
): ApplianceTagState {
  const drawing = sector.connected && m.kwNow > RUNNING_KW;
  return {
    priority: sector.priority,
    statusColor: drawing ? sector.statusColor : 'idle',
    inAlert: Boolean(sector.inAlert || sector.onFire),
  };
}

// Ring constants live in placement.ts (PP-T2); re-exported so existing importers keep working.
export { MARKER_GAP, MARKER_RING, MARKER_ROW, MARKERS_PER_ROW } from './placement';

/** Height of the feeder anchor above the ground at the sector building (mid-wall). */
export const MARKER_FEEDER_H = 1.2;
const RUNNING_KW = 1e-4;

/**
 * Markers sit on the outer side of their building (away from the controller in the middle, where the
 * cables come in), rows of 5 facing the centre — unless the appliance has a free-placement
 * `position` (PP-T3), clamped onto the terrain and snapped out of building footprints. `k` counts
 * every same-sector appliance in input order, placed or not, so placing one never moves the ring.
 * Pure: same input → same positions.
 */
export function applianceMarkers(
  appliances: readonly Appliance[] | undefined,
  positions: Record<SectorId, [number, number, number]>,
  timeIndex: number,
  result?: SimulationResult | null
): ApplianceMarkerSceneModel[] {
  if (!appliances?.length) return [];
  const t = Math.max(0, Math.min(23, Math.floor(timeIndex)));
  const step = result?.steps[t];
  const count: Partial<Record<SectorId, number>> = {};
  return appliances.map((a) => {
    const k = (count[a.sector] = (count[a.sector] ?? 0) + 1) - 1;
    const [bx, , bz] = positions[a.sector];
    let spot: { x: number; z: number };
    if (a.position) {
      spot = snapAwayFromBuildings(clampToTerrain(a.position));
    } else {
      const [x, , z] = defaultPosition(a.sector, k);
      spot = { x, z };
    }
    const kwNow = applianceProfileKw(a)[t] ?? 0;
    const served = (step?.sectors[a.sector]?.servedKw ?? 0) > 0.05;
    return {
      id: a.id,
      name: a.name,
      category: a.category,
      sector: a.sector,
      quantity: a.quantity,
      watts: a.watts,
      kwNow,
      running: served && kwNow > RUNNING_KW,
      position: [spot.x, terrainHeight(spot.x, spot.z), spot.z],
      feeder: [bx, terrainHeight(bx, bz) + MARKER_FEEDER_H, bz],
      ...(isNonElectric(a) ? { nonElectric: true as const } : {}),
    };
  });
}

/** Inserted lines per sector (2D diagram chip, lists). */
export function appliancesPerSector(
  appliances: readonly Pick<Appliance, 'sector'>[] | undefined
): Record<SectorId, number> {
  const out = Object.fromEntries(SECTOR_IDS.map((id) => [id, 0])) as Record<SectorId, number>;
  for (const a of appliances ?? []) out[a.sector] += 1;
  return out;
}
