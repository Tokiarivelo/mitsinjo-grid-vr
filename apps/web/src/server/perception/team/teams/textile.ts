import { backdrop, curtain, rods, rug, type PartSpec } from '../../furniture';
import {
  enumField,
  finishColor,
  footprint,
  furnitureTeam,
  intField,
  ownObject,
  ownSpec,
  type FurnitureReading,
} from './furniture';

/**
 * The textile team (PQ-T90): curtains, sheers, blinds, rugs, photo backdrops. No legs: the shared
 * profile and finishes, and its own drape specialist (how it hangs, its rods or rolls, whether it
 * runs onto the floor). `textileParts` builds the cloth on the object's outline (`silhouette`
 * parts, cut from the SAM contour by `furnitureModel`), a rug flat on the floor.
 */

export const TEXTILE_KINDS = ['curtain', 'sheer', 'blind', 'rug', 'backdrop'] as const;
export type TextileKind = (typeof TEXTILE_KINDS)[number];
export const TEXTILE_PARTS = ['rod', 'track', 'rolls', 'tieback', 'valance', 'fringe'] as const;
export const DRAPE_HANGS = ['rod', 'track', 'rings', 'stand', 'floor'] as const;
export const DRAPE_FOLDS = ['flat', 'soft', 'deep'] as const;

export interface Drape {
  hang: (typeof DRAPE_HANGS)[number];
  /** Rods or paper rolls side by side along the top (0 = none seen). */
  rods: number;
  folds: (typeof DRAPE_FOLDS)[number];
  /** It runs onto the floor at its foot (a backdrop sweep, a pooled curtain). */
  pool: boolean;
  tied: boolean;
}

const DRAPE_DEFAULT: Drape = { hang: 'rod', rods: 0, folds: 'soft', pool: false, tied: false };

const NOUN = 'textile';
const SUBJECT = 'ONE textile (a curtain, a sheer, a blind, a rug or a photo backdrop)';

export const DRAPE_SPEC = ownSpec({
  key: 'drape',
  role: 'drape specialist',
  subject: SUBJECT,
  reads: 'how the cloth hangs or lies',
  noun: NOUN,
  fields: `hang = ${DRAPE_HANGS.join(', ')} (stand = a backdrop stand, floor = it lies on the floor like a rug); rods = how many rods or paper rolls run side by side along its top (0 when none is seen); folds = ${DRAPE_FOLDS.join(', ')}; pool = true when its foot runs onto the floor toward the viewer; tied = true when a tieback gathers it.`,
  properties: {
    hang: { type: 'string', enum: [...DRAPE_HANGS] },
    rods: { type: 'integer', minimum: 0, maximum: 4 },
    folds: { type: 'string', enum: [...DRAPE_FOLDS] },
    pool: { type: 'boolean' },
    tied: { type: 'boolean' },
  },
  required: ['hang', 'rods', 'pool'],
  task: 'Say how it hangs, how many rods or rolls run along its top and whether it runs onto the floor.',
});

/** The drape of an answer, every field defaulted. */
export function parseDrape(content: string | null | undefined): Drape {
  const o = ownObject(content, 'drape');
  if (!o) return DRAPE_DEFAULT;
  return {
    hang: enumField(o.hang, DRAPE_HANGS, 'rod'),
    rods: intField(o.rods, 0, 4, 0),
    folds: enumField(o.folds, DRAPE_FOLDS, 'soft'),
    pool: o.pool === true,
    tied: o.tied === true,
  };
}

/** 1: first version. */
export const TEXTILE_PROMPT_VERSION = 1;

export const TEXTILE_TEAM = furnitureTeam({
  id: 'textile',
  promptVersion: TEXTILE_PROMPT_VERSION,
  noun: NOUN,
  subject: SUBJECT,
  kinds: TEXTILE_KINDS,
  parts: TEXTILE_PARTS,
  finishes: [
    ['fabric', 'the cloth itself'],
    ['roll', 'each rod or paper roll along the top, from the top one down'],
  ],
  materials: ['fabric', 'paper', 'plastic', 'wood'],
  own: { drape: DRAPE_SPEC },
  parseOwn: (a) => parseDrape(a.drape),
  ownSummary: (d) =>
    `hangs ${d.hang}${d.rods ? `, ${d.rods} rods` : ''}${d.pool ? ', runs onto the floor' : ''}`,
});

export type TextileReading = FurnitureReading<Drape>;

/** Usual drop of a hanging cloth and the rug builder's thickness (metres): only the proportions matter. */
const DROP = 2.6;
const RUG_T = 0.04;
/** Each rod or roll: this share of the drop. */
const ROD_SHARE = 0.035;

/** A textile reading on its measured proportions (largest side = 1) → the cloth's parts. */
export function textileParts(
  r: TextileReading,
  p: { w: number; h: number; d: number }
): PartSpec[] {
  const kind = enumField(r.kind, TEXTILE_KINDS, 'curtain');
  const color = finishColor(r, ['fabric'], '#d8d4cc');
  const d = r.own;
  if (kind === 'rug' || d.hang === 'floor') {
    // A rug's measured height is its thickness: the rug builder's, its sides in proportion.
    const k = RUG_T / Math.max(1e-3, p.h);
    return rug(p.w * k, p.d * k, color);
  }
  const { w, d: depth } = footprint(DROP, p);
  if (d.pool) return backdrop(w, DROP, depth, color);
  // The rods or rolls take the top of the drop, the cloth hangs below them on its outline band.
  const n = d.rods;
  const dia = ROD_SHARE * DROP;
  const rodTop = n * dia;
  const rolls = r.finishes.filter((f) => f.finish === 'roll').map((f) => f.color.toLowerCase());
  const colors = Array.from({ length: n }, (_, i) => rolls[i] ?? rolls.at(-1) ?? '#8a8580');
  return [
    ...curtain(w, DROP - rodTop, color, {
      d: Math.max(0.04, depth - (n ? dia : 0)),
      ...(n ? { band: [rodTop / DROP, 1] as [number, number] } : {}),
    }),
    ...rods(w, DROP, colors, dia),
  ];
}
