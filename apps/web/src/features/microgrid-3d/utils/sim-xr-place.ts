import type { SectorId } from '@mitsinjo/engine';
import { BUS_POSITION, SECTOR_POSITIONS } from './site-positions';
import { SECTOR_KEEP_OUT_R } from './landscape';

/**
 * Where the /simulation VR walker goes (VSIM-T3/T4): a building's door, inside its room, back out.
 * Pure: positions are feet on the ground [x, y, z]; `yaw` is the view heading (three.js rotation.y,
 * 0 = looking toward −Z).
 */
export interface XrSpot {
  position: [number, number, number];
  yaw: number;
}

/** Heading that looks from (fx, fz) toward (tx, tz). */
export function yawToward(fx: number, fz: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - fx), -(tz - fz));
}

/**
 * In front of the building, on the side facing the village square, facing the building. Walks out
 * from the wall until `blocked` (the walk grid) says the spot is clear.
 */
export function doorSpot(sector: SectorId, blocked?: (x: number, z: number) => boolean): XrSpot {
  const [bx, , bz] = SECTOR_POSITIONS[sector];
  let dx = BUS_POSITION[0] - bx;
  let dz = BUS_POSITION[2] - bz;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const r0 = SECTOR_KEEP_OUT_R[sector] * 0.7;
  let r = r0;
  while (blocked && blocked(bx + dx * r, bz + dz * r) && r < r0 + 8) r += 0.4;
  const x = bx + dx * r;
  const z = bz + dz * r;
  return { position: [x, 0, z], yaw: yawToward(x, z, bx, bz) };
}

/** The room you enter, built off the map under the ground (closed: nothing outside shows). */
export const INTERIOR_ORIGIN: [number, number, number] = [0, -60, 0];
export const INTERIOR_SIZE = { width: 6, depth: 5, height: 2.7 } as const;
/** Room surfaces (three.js materials can't read Tailwind tokens; scene colours, like house-geometry). */
export const INTERIOR_COLORS = {
  floor: '#6b4a2f',
  wall: '#d9cdb8',
  ceiling: '#efe9df',
  door: '#5a3a22',
  lampOff: '#3a3a3a',
  unlit: '#000000',
} as const;
/** Kept between the walker and the room walls (m). */
const INTERIOR_MARGIN = 0.35;

/** Just inside the door (+Z wall), facing into the room (−Z), where the power panel hangs. */
export function interiorSpawn(): XrSpot {
  const [ox, oy, oz] = INTERIOR_ORIGIN;
  return { position: [ox, oy, oz + INTERIOR_SIZE.depth / 2 - 0.9], yaw: 0 };
}

/** Keeps a head position inside the room. */
export function clampToInterior(x: number, z: number): [number, number] {
  const [ox, , oz] = INTERIOR_ORIGIN;
  const hw = INTERIOR_SIZE.width / 2 - INTERIOR_MARGIN;
  const hd = INTERIOR_SIZE.depth / 2 - INTERIOR_MARGIN;
  return [Math.max(ox - hw, Math.min(ox + hw, x)), Math.max(oz - hd, Math.min(oz + hd, z))];
}

/**
 * Snap turn of a camera rig group about the head (VS-T23 map, here for a rig group instead of a
 * reference space): the head stays where it is, the rig turns by `angle` (+ = left, three.js yaw).
 */
export function turnRigAboutHead(
  rigX: number,
  rigZ: number,
  rigYaw: number,
  headX: number,
  headZ: number,
  angle: number
): { x: number; z: number; yaw: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ox = rigX - headX;
  const oz = rigZ - headZ;
  // Rotation about +Y by `angle` (three.js convention): x' = x c + z s, z' = −x s + z c.
  return { x: headX + ox * c + oz * s, z: headZ - ox * s + oz * c, yaw: rigYaw + angle };
}

/** One piece of furniture or appliance in a sector's room (room-local, metres, box). */
export interface InteriorItem {
  id: string;
  size: [number, number, number];
  /** Centre, room-local (origin = floor centre). */
  position: [number, number, number];
  color: string;
  /** Lit by the power: screen, lamp, fridge light, machine LED. */
  powered?: boolean;
}

const WOOD = '#8a5a34';
const DARK = '#2b2f36';
const WHITE = '#e8e6e1';
const FABRIC = '#4f6d8f';
const METAL = '#9aa3ad';

/** What each sector's room holds: a home, a classroom, a clinic room, a pump room, a stall, a workshop. */
export function interiorItems(sector: SectorId): InteriorItem[] {
  const back = -INTERIOR_SIZE.depth / 2 + 0.45;
  switch (sector) {
    case 'households':
      return [
        { id: 'bed', size: [1.4, 0.5, 2], position: [-2, 0.25, -1.2], color: FABRIC },
        { id: 'table', size: [1.2, 0.75, 0.8], position: [0.6, 0.375, 0], color: WOOD },
        {
          id: 'fridge',
          size: [0.7, 1.7, 0.65],
          position: [2.4, 0.85, back],
          color: WHITE,
          powered: true,
        },
        {
          id: 'tv',
          size: [1.1, 0.65, 0.08],
          position: [0.3, 1.4, back - 0.3],
          color: DARK,
          powered: true,
        },
      ];
    case 'school':
      return [
        {
          id: 'board',
          size: [2.6, 1.1, 0.06],
          position: [0, 1.5, back - 0.35],
          color: DARK,
          powered: true,
        },
        ...[-1.6, 0, 1.6].flatMap((x, i) => [
          {
            id: `desk-${i}-a`,
            size: [1, 0.72, 0.55] as [number, number, number],
            position: [x, 0.36, -0.3] as [number, number, number],
            color: WOOD,
          },
          {
            id: `desk-${i}-b`,
            size: [1, 0.72, 0.55] as [number, number, number],
            position: [x, 0.36, 0.8] as [number, number, number],
            color: WOOD,
          },
        ]),
      ];
    case 'health':
      return [
        { id: 'bed', size: [0.9, 0.7, 2], position: [-2, 0.35, -1], color: WHITE },
        {
          id: 'vaccine-fridge',
          size: [0.6, 1.3, 0.6],
          position: [2.3, 0.65, back],
          color: WHITE,
          powered: true,
        },
        {
          id: 'monitor',
          size: [0.5, 0.4, 0.08],
          position: [-1.2, 1.3, back - 0.3],
          color: DARK,
          powered: true,
        },
        { id: 'cabinet', size: [1, 1.8, 0.45], position: [0.6, 0.9, back], color: METAL },
      ];
    case 'water':
      return [
        {
          id: 'pump',
          size: [1.2, 1, 0.9],
          position: [-0.8, 0.5, -0.9],
          color: METAL,
          powered: true,
        },
        { id: 'tank', size: [1.3, 2, 1.3], position: [1.8, 1, -1.2], color: FABRIC },
        {
          id: 'control-box',
          size: [0.6, 0.8, 0.2],
          position: [-2.4, 1.3, back - 0.2],
          color: DARK,
          powered: true,
        },
      ];
    case 'market':
      return [
        { id: 'stall', size: [2.4, 0.9, 0.8], position: [-0.8, 0.45, -0.8], color: WOOD },
        {
          id: 'freezer',
          size: [1.2, 0.9, 0.7],
          position: [1.9, 0.45, back + 0.1],
          color: WHITE,
          powered: true,
        },
        {
          id: 'radio',
          size: [0.4, 0.25, 0.2],
          position: [-0.8, 1.02, -0.8],
          color: DARK,
          powered: true,
        },
      ];
    case 'industry':
      return [
        { id: 'bench', size: [2.4, 0.9, 0.9], position: [-0.8, 0.45, -1.1], color: WOOD },
        {
          id: 'saw',
          size: [0.9, 1.1, 0.9],
          position: [1.8, 0.55, -1],
          color: METAL,
          powered: true,
        },
        {
          id: 'grinder',
          size: [0.4, 0.35, 0.3],
          position: [-1.4, 1.07, -1.1],
          color: DARK,
          powered: true,
        },
      ];
  }
}

/** Ceiling lamp brightness from the engine's coverage (0–100 %, null = no result): 0 = dark. */
export function lampLevel(coveragePct: number | null, servedKw: number): number {
  if (servedKw <= 0.01) return 0;
  if (coveragePct === null) return 0.6;
  return Math.max(0.15, Math.min(1, coveragePct / 100));
}

/** Button legend lines of /simulation (i18n keys of `features.simulation.vrControls`, title first). */
export function simLegendKeys(kind: 'controller' | 'hand', handedness: XRHandedness): string[] {
  if (kind === 'hand')
    return ['legendTitleHand', 'legendPinch', 'legendThumbTurn', 'legendThumbTap'];
  return handedness === 'left'
    ? [
        'legendTitleLeft',
        'legendTrigger',
        'legendStickWalk',
        'legendX',
        'legendY',
        'legendStickPress',
      ]
    : [
        'legendTitleRight',
        'legendTrigger',
        'legendStickTurn',
        'legendA',
        'legendB',
        'legendStickPress',
      ];
}

/** Power panel on the room's wall, in front of where you come in (facing the door). */
export function interiorPanelPose(): { position: [number, number, number]; yaw: number } {
  const spawn = interiorSpawn().position;
  return { position: [spawn[0], spawn[1] + 1.45, spawn[2] - 1.3], yaw: 0 };
}
