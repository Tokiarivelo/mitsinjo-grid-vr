import {
  FENCE_BOARD,
  fence,
  gate,
  ironRailing,
  latticeTower,
  METAL,
  type PartSpec,
} from '../../furniture';
import {
  enumField,
  finishColor,
  furnitureTeam,
  intField,
  ownObject,
  ownSpec,
  type FurnitureReading,
} from './furniture';

/**
 * The structure team (PQ-T90): railings, fences, gates, lattice pylons. No legs: the shared
 * profile and finishes, and its own lattice specialist (pattern, bars, posts, pillars, base wall,
 * the pylon's panels and cross arms). `structureParts` builds the railing, fence, gate or lattice
 * tower builder (`furniture/structure.ts`). Open structures: their colours are fixed by the
 * reading (the photo between the bars is the background, pitfall § 8).
 */

export const STRUCTURE_KINDS = ['railing', 'fence', 'gate', 'pylon'] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];
export const STRUCTURE_PARTS = [
  'posts',
  'rails',
  'bars',
  'boards',
  'pillars',
  'base',
  'arms',
] as const;
export const LATTICE_PATTERNS = ['bars', 'scroll', 'boards', 'mesh', 'lattice'] as const;

export interface Lattice {
  pattern: (typeof LATTICE_PATTERNS)[number];
  /** Balusters, boards or bars along the whole width. */
  bars: number;
  /** Posts as shares of the width (0 = left end). */
  posts: number[];
  /** Stone or brick pillars between the fence runs (a gate: its two pillars). */
  pillars: number;
  /** A low wall under it. */
  base: boolean;
  /** Pylon: braced panels up its height, top width over base width, cross arms (height share, span share). */
  levels: number;
  top: number;
  /** Pylon: its foot's width over the drawing width (the arms may be wider). */
  foot: number;
  arms: Array<[number, number]>;
}

const LATTICE_DEFAULT: Lattice = {
  pattern: 'bars',
  bars: 12,
  posts: [0, 1],
  pillars: 0,
  base: false,
  levels: 6,
  top: 0.25,
  foot: 1,
  arms: [],
};

const NOUN = 'structure';
const SUBJECT = 'ONE open structure (a railing, a fence, a gate or a lattice pylon)';

const share = { type: 'number', minimum: 0, maximum: 1 };

export const LATTICE_SPEC = ownSpec({
  key: 'lattice',
  role: 'lattice specialist',
  subject: SUBJECT,
  reads: 'its members: posts, rails, bars, boards and bracing',
  noun: NOUN,
  fields: `pattern = ${LATTICE_PATTERNS.join(', ')} (scroll = curled iron bars, lattice = X-braced steel); bars = how many balusters, boards or bars along the whole width; posts = the x share of each post (0 = left end, 1 = right end); pillars = stone or brick pillars (a gate: its two); base = true when it stands on a low wall; levels = braced panels up a pylon; top = a pylon's width at the top over its width at the foot; foot = a pylon's width at the foot over the drawing width; arms = each cross arm of a pylon as [y share from the top, its whole span over the drawing width].`,
  properties: {
    pattern: { type: 'string', enum: [...LATTICE_PATTERNS] },
    bars: { type: 'integer', minimum: 0, maximum: 80 },
    posts: { type: 'array', items: share, maxItems: 12 },
    pillars: { type: 'integer', minimum: 0, maximum: 12 },
    base: { type: 'boolean' },
    levels: { type: 'integer', minimum: 1, maximum: 20 },
    top: share,
    foot: share,
    arms: {
      type: 'array',
      items: { type: 'array', items: share, minItems: 2, maxItems: 2 },
      maxItems: 6,
    },
  },
  required: ['pattern', 'bars'],
  task: 'Name its pattern, count its bars or boards, place its posts, pillars and arms.',
});

const shares = (v: unknown, max: number): number[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
        .map((x) => Math.min(1, Math.max(0, x)))
        .slice(0, max)
    : [];

/** The lattice of an answer, every field defaulted. */
export function parseLattice(content: string | null | undefined): Lattice {
  const o = ownObject(content, 'lattice');
  if (!o) return LATTICE_DEFAULT;
  const posts = shares(o.posts, 12);
  const arms = (Array.isArray(o.arms) ? o.arms : [])
    .map((a) => shares(a, 2))
    .filter((a): a is [number, number] => a.length === 2)
    .slice(0, 6);
  return {
    pattern: enumField(o.pattern, LATTICE_PATTERNS, 'bars'),
    bars: intField(o.bars, 0, 80, 12),
    posts: posts.length ? posts : LATTICE_DEFAULT.posts,
    pillars: intField(o.pillars, 0, 12, 0),
    base: o.base === true,
    levels: intField(o.levels, 1, 20, 6),
    top: typeof o.top === 'number' && o.top > 0 ? Math.min(1, o.top) : LATTICE_DEFAULT.top,
    foot: typeof o.foot === 'number' && o.foot > 0 ? Math.min(1, o.foot) : 1,
    arms,
  };
}

/** 1: first version. */
export const STRUCTURE_PROMPT_VERSION = 1;

export const STRUCTURE_TEAM = furnitureTeam({
  id: 'structure',
  promptVersion: STRUCTURE_PROMPT_VERSION,
  noun: NOUN,
  subject: SUBJECT,
  kinds: STRUCTURE_KINDS,
  parts: STRUCTURE_PARTS,
  finishes: [
    ['frame', 'the bars, boards, rails and posts'],
    ['pillar', 'the stone or brick pillars'],
    ['base', 'the low wall under it'],
  ],
  materials: ['metal', 'wood', 'stone', 'concrete'],
  own: { lattice: LATTICE_SPEC },
  parseOwn: (a) => parseLattice(a.lattice),
  ownSummary: (l) =>
    `${l.pattern}, ${l.bars} bars, ${l.posts.length} posts${l.pillars ? `, ${l.pillars} pillars` : ''}${l.arms.length ? `, ${l.arms.length} arms` : ''}`,
});

export type StructureReading = FurnitureReading<Lattice>;

/** Usual height (metres): a balcony railing, a pylon. Fences and gates are scaled by their boards. */
const RAILING_H = 1.0;
const PYLON_H = 30;
/** Low wall under a fence (`fence` builder). */
const BASE_H = 0.35;

/** The parts with every colour kept as read (open structures: no photo colour between the bars). */
const fixed = (parts: PartSpec[], color: string) =>
  parts.map((p) => ({ ...p, color, fixed: true }));

/** A structure reading on its measured proportions (largest side = 1) → its builder's parts. */
export function structureParts(
  r: StructureReading,
  p: { w: number; h: number; d: number }
): PartSpec[] {
  const kind = enumField(r.kind, STRUCTURE_KINDS, 'fence');
  const l = r.own;
  const color = finishColor(
    r,
    ['frame'],
    kind === 'railing' || kind === 'pylon' ? METAL : '#6a5545'
  );
  const aspect = p.w / Math.max(1e-6, p.h);
  if (kind === 'railing') {
    const w = RAILING_H * aspect;
    return fixed(ironRailing(w, RAILING_H, Math.max(1, l.bars), l.posts), color);
  }
  if (kind === 'pylon') {
    // The drawing's width is the widest of the foot and the arms.
    const W = PYLON_H * aspect;
    const base = W * l.foot;
    return latticeTower(
      PYLON_H,
      base,
      base * l.top,
      l.levels,
      l.arms.map(([y, s]) => [1 - y, (s * W) / 2] as [number, number]),
      color
    );
  }
  // Boards are FENCE_BOARD wide: their count gives the width, the drawing the height.
  const boards = Math.max(1, l.bars);
  if (kind === 'gate') {
    const pillar = finishColor(r, ['pillar'], '#9c8670');
    const leaf = boards * FENCE_BOARD;
    const pw = Math.min(0.4, (leaf + 0.7) * 0.18);
    const w = leaf + 2 * pw - 0.1;
    return gate(w, Math.max(0.5, w / aspect - 0.1), color, pillar);
  }
  const w = boards * FENCE_BOARD;
  const h = Math.max(0.4, w / aspect - (l.base ? BASE_H : 0));
  return fence(w, h, color, l.pillars, l.base ? finishColor(r, ['base'], '#9a8b78') : undefined);
}
