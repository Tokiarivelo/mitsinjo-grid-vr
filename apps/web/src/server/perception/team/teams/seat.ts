import { chair, cyl, sofa, stool, WOOD, type PartSpec } from '../../furniture';
import {
  FURNITURE_FRAME,
  enumField,
  finishColor,
  footprint,
  furnitureTeam,
  intField,
  legHeight,
  lineHeight,
  ownObject,
  profileOn,
  type FurnitureReading,
} from './furniture';

/**
 * The seat team (PQ-T89): sofas, armchairs, chairs, stools, benches and poufs. Shared profile
 * (seat, arm and back lines), legs and finishes, and its own upholstery specialist (cushions, arms,
 * back). `seatParts` turns a reading into the seat builders' dimensions (`furniture/seating.ts`).
 */

export const SEAT_KINDS = ['sofa', 'armchair', 'chair', 'stool', 'bench', 'pouf'] as const;
export type SeatKind = (typeof SEAT_KINDS)[number];
export const SEAT_PARTS = [
  'back',
  'arms',
  'seat_cushions',
  'back_cushions',
  'legs',
  'frame',
] as const;
export const SEAT_ARMS = ['none', 'left', 'right', 'both'] as const;
export const SEAT_BACKS = ['none', 'straight', 'arched', 'tufted', 'shell', 'canvas'] as const;

export interface SeatUpholstery {
  seatCushions: number;
  backCushions: number;
  arms: (typeof SEAT_ARMS)[number];
  back: (typeof SEAT_BACKS)[number];
  /** Share of the width the back covers when it rises on one end only (chaise longue); 1 = all. */
  chaise: number;
}

const UPHOLSTERY_DEFAULT: SeatUpholstery = {
  seatCushions: 0,
  backCushions: 0,
  arms: 'none',
  back: 'straight',
  chaise: 1,
};

export const UPHOLSTERY_SPEC = {
  key: 'upholstery',
  task: 'Count its cushions and read its arms and back.',
  system: [
    'You are the upholstery specialist of a 3D modelling team. On the orthographic drawings of ONE seat, you read what it is made of above its legs.',
    FURNITURE_FRAME,
    `upholstery: seatCushions = loose seat cushions side by side (0 = one solid seat); backCushions = back cushions; arms = ${SEAT_ARMS.join(', ')}; back = ${SEAT_BACKS.join(', ')} (shell = one moulded seat and back, canvas = a cloth stretched between two posts, tufted = buttoned); chaise = share 0–1 of the width the back covers when it rises over one end only (a chaise longue), 1 when it runs along the whole width.`,
  ].join('\n'),
  schema: {
    name: 'SeatUpholstery',
    schema: {
      type: 'object',
      properties: {
        upholstery: {
          type: 'object',
          properties: {
            seatCushions: { type: 'integer', minimum: 0, maximum: 6 },
            backCushions: { type: 'integer', minimum: 0, maximum: 6 },
            arms: { type: 'string', enum: [...SEAT_ARMS] },
            back: { type: 'string', enum: [...SEAT_BACKS] },
            chaise: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['seatCushions', 'arms', 'back'],
        },
      },
      required: ['upholstery'],
    },
  },
};

/** The upholstery of an answer, every field defaulted. */
export function parseUpholstery(content: string | null | undefined): SeatUpholstery {
  const o = ownObject(content, 'upholstery');
  if (!o) return UPHOLSTERY_DEFAULT;
  const chaise = typeof o.chaise === 'number' ? Math.min(1, Math.max(0.2, o.chaise)) : 1;
  return {
    seatCushions: intField(o.seatCushions, 0, 6, 0),
    backCushions: intField(o.backCushions, 0, 6, 0),
    arms: enumField(o.arms, SEAT_ARMS, 'none'),
    back: enumField(o.back, SEAT_BACKS, 'straight'),
    chaise,
  };
}

/** 1: first version. */
export const SEAT_PROMPT_VERSION = 1;

export const SEAT_TEAM = furnitureTeam({
  id: 'seat',
  promptVersion: SEAT_PROMPT_VERSION,
  subject: 'ONE seat (a sofa, an armchair, a chair, a stool, a bench or a pouf)',
  kinds: SEAT_KINDS,
  parts: SEAT_PARTS,
  lines: [
    ['seat', 'top of the seat where one sits'],
    ['arm', 'top of the arms'],
  ],
  finishes: [
    ['upholstery', 'the fabric, leather or plastic one sits on'],
    ['frame', 'the legs and the visible frame'],
    ['cushion', 'loose cushions of another colour'],
  ],
  materials: ['fabric', 'wood', 'metal', 'plastic'],
  own: {
    upholstery: {
      spec: UPHOLSTERY_SPEC,
      answered: (c: string | null | undefined) => ownObject(c, 'upholstery') !== null,
    },
  },
  parseOwn: (a) => parseUpholstery(a.upholstery),
  ownSummary: (u) =>
    `${u.seatCushions}+${u.backCushions} cushions, arms ${u.arms}, back ${u.back}${u.chaise < 1 ? `, chaise ${u.chaise}` : ''}`,
});

export type SeatReading = FurnitureReading<SeatUpholstery>;

/** Usual full height of each kind (metres): only the proportions matter, the builders want metres. */
const SEAT_HEIGHT: Record<SeatKind, number> = {
  sofa: 0.85,
  armchair: 0.9,
  chair: 0.9,
  stool: 0.7,
  bench: 0.5,
  pouf: 0.42,
};

/** A seat reading on its measured proportions (largest side = 1) → the seat builders' parts. */
export function seatParts(r: SeatReading, p: { w: number; h: number; d: number }): PartSpec[] {
  const kind = enumField(r.kind, SEAT_KINDS, 'chair');
  const h = SEAT_HEIGHT[kind];
  const { w, d } = footprint(h, p);
  const u = r.own;
  const color = finishColor(r, ['upholstery', 'cushion'], '#8a8580');
  const legColor = finishColor(r, ['frame'], WOOD);
  const leg = legHeight(r, h);
  // The front profile's body top is the back's top; the seat line, else a share by kind.
  const back = (1 - profileOn(r).body[1]) * h;
  const seat = Math.min(
    back - 0.05,
    lineHeight(r, 'seat', h) ?? h * (kind === 'chair' ? 0.5 : 0.52)
  );
  if (kind === 'pouf')
    return [
      cyl([0, h / 2, 0], [w, h, d], color, { material: 'fabric', kind: 'body', concept: 'seat' }),
    ];
  if (kind === 'stool')
    // The stool's legs splay to 1.25 × its top: the top is the measured width over that.
    return stool(h, Math.min(w, d) / 1.25, color, legColor, profileOn(r).top === 'rounded');
  if (kind === 'chair')
    return chair({
      w,
      d,
      seat,
      back: Math.max(seat + 0.1, back),
      color,
      legColor,
      style:
        u.back === 'shell'
          ? 'shell'
          : u.back === 'canvas'
            ? 'director'
            : r.finishes.some((f) => f.finish === 'upholstery' && f.material === 'fabric')
              ? 'upholstered'
              : 'wire',
      arms: u.arms !== 'none',
    });
  // Sofa, armchair, bench: the sofa builder.
  const arm = u.arms === 'none' ? 0 : (lineHeight(r, 'arm', h) ?? seat + (back - seat) * 0.45);
  const parts = sofa({
    w,
    d,
    seat: Math.max(leg + 0.08, seat),
    back: u.back === 'none' ? seat + 0.02 : Math.max(seat + 0.1, back),
    arm: Math.max(0, Math.min(arm, back)),
    leg: Math.max(0.02, leg),
    color,
    legColor,
    cushions: Math.max(u.seatCushions, u.backCushions),
    arched: u.back === 'arched' || u.back === 'tufted',
    ...(u.chaise < 0.95 ? { chaise: u.chaise } : {}),
  });
  return u.back === 'none' ? parts.filter((x) => x.concept !== 'backrest') : parts;
}
