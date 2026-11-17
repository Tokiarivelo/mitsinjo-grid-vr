import {
  box,
  ceilingDisc,
  ceilingPanel,
  chandelier,
  lantern,
  sconce,
  streetLamp,
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
 * The light team (PQ-T90): street lamps, wall lanterns and sconces, ceiling discs and panels,
 * chandeliers (the `lamp_post` archetype, indoor and outdoor). Shared profile and finishes, and
 * its own lamp specialist (mount, shade, bulbs, arm side). `lightParts` builds the matching light
 * builder (`furniture/lights.ts`); a flush fitting's size comes from its fixed thickness.
 */

export const LIGHT_KINDS = [
  'street_lamp',
  'wall_lantern',
  'sconce',
  'ceiling',
  'chandelier',
  'studio',
  'sign',
] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];
export const LIGHT_PARTS = ['pole', 'arm', 'shade', 'bulbs', 'lid', 'wall_plate', 'stem'] as const;
export const LAMP_SHADES = ['disc', 'panel', 'cone', 'lantern', 'bowl', 'box', 'none'] as const;
export const LAMP_ARMS = ['none', 'left', 'right', 'both'] as const;

export interface Lamp {
  shade: (typeof LAMP_SHADES)[number];
  bulbs: number;
  arm: (typeof LAMP_ARMS)[number];
  /** A lantern's glass: its bottom width over its top width. */
  taper: number;
}

const LAMP_DEFAULT: Lamp = { shade: 'disc', bulbs: 1, arm: 'none', taper: 0.7 };

const NOUN = 'light fitting';
const SUBJECT =
  'ONE light fitting (a street lamp, a wall lantern or sconce, a ceiling light, a chandelier, a studio light or a lit sign)';

export const LAMP_SPEC = ownSpec({
  key: 'lamp',
  role: 'lamp specialist',
  subject: SUBJECT,
  reads: 'its shade, its bulbs and its arm',
  noun: NOUN,
  fields: `shade = ${LAMP_SHADES.join(', ')} (disc = a round flush ceiling light, panel = a square one, bowl = a chandelier's glass bowl, box = a street lamp's head or a studio softbox); bulbs = how many bulbs or candle lights you see (0 when the light is inside the shade); arm = ${LAMP_ARMS.join(', ')}: which side the arm reaches from its pole or wall plate; taper = a lantern glass's width at the bottom over its width at the top.`,
  properties: {
    shade: { type: 'string', enum: [...LAMP_SHADES] },
    bulbs: { type: 'integer', minimum: 0, maximum: 24 },
    arm: { type: 'string', enum: [...LAMP_ARMS] },
    taper: { type: 'number', minimum: 0.2, maximum: 1 },
  },
  required: ['shade', 'bulbs', 'arm'],
  task: 'Name its shade, count its bulbs and say which side its arm reaches.',
});

/** The lamp of an answer, every field defaulted. */
export function parseLamp(content: string | null | undefined): Lamp {
  const o = ownObject(content, 'lamp');
  if (!o) return LAMP_DEFAULT;
  return {
    shade: enumField(o.shade, LAMP_SHADES, 'disc'),
    bulbs: intField(o.bulbs, 0, 24, 1),
    arm: enumField(o.arm, LAMP_ARMS, 'none'),
    taper:
      typeof o.taper === 'number' && Number.isFinite(o.taper)
        ? Math.min(1, Math.max(0.2, o.taper))
        : LAMP_DEFAULT.taper,
  };
}

/** 1: first version. */
export const LIGHT_PROMPT_VERSION = 1;

export const LIGHT_TEAM = furnitureTeam({
  id: 'light',
  promptVersion: LIGHT_PROMPT_VERSION,
  noun: NOUN,
  subject: SUBJECT,
  kinds: LIGHT_KINDS,
  parts: LIGHT_PARTS,
  finishes: [
    ['frame', 'the pole, arm, rim or frame'],
    ['shade', 'the shade, the glass or the diffuser as it looks'],
    ['bulb', 'the bulbs or candle lights'],
  ],
  materials: ['metal', 'glass', 'plastic', 'fabric'],
  own: { lamp: LAMP_SPEC },
  parseOwn: (a) => parseLamp(a.lamp),
  ownSummary: (l) => `${l.shade} shade, ${l.bulbs} bulbs, arm ${l.arm}`,
});

export type LightReading = FurnitureReading<Lamp>;

/** Builders' fixed sizes (metres): a flush disc's and panel's thickness, a wall light's height. */
const DISC_T = 0.075;
const PANEL_T = 0.065;
const LANTERN_H = 0.7;
const CHANDELIER_H = 1.69;
const STREET_H = 8;
const STUDIO_H = 1.6;

/** A light reading on its measured proportions (largest side = 1) → its builder's parts. */
export function lightParts(r: LightReading, p: { w: number; h: number; d: number }): PartSpec[] {
  const kind = enumField(r.kind, LIGHT_KINDS, 'ceiling');
  const l = r.own;
  const aspect = p.w / Math.max(1e-6, p.h);
  const frame = finishColor(r, ['frame'], '#d9d9d6');
  const shade = finishColor(r, ['shade'], '#efefec');
  if (kind === 'street_lamp') {
    const side = l.arm === 'left' ? -1 : 1;
    return streetLamp(STREET_H, Math.max(0.3, STREET_H * aspect - 0.08), side, frame, shade);
  }
  if (kind === 'wall_lantern') return lantern(LANTERN_H * aspect, LANTERN_H, frame, shade, l.taper);
  if (kind === 'sconce') return sconce(1, frame, shade);
  if (kind === 'chandelier' || l.shade === 'bowl')
    return chandelier(
      CHANDELIER_H * aspect,
      CHANDELIER_H,
      l.bulbs,
      frame,
      shade,
      finishColor(r, ['bulb'], '#efe6d2')
    );
  if (kind === 'ceiling') {
    const t = l.shade === 'panel' ? PANEL_T : DISC_T;
    const size = (t * Math.max(p.w, p.d)) / Math.max(1e-6, p.h);
    return l.shade === 'panel' ? ceilingPanel(size, frame, shade) : ceilingDisc(size, frame, shade);
  }
  // A studio light or a lit sign: its panel on the measured box, lit.
  return [
    box([0, STUDIO_H / 2, 0], [STUDIO_H * aspect, STUDIO_H, (STUDIO_H * p.d) / p.h], shade, {
      material: 'fabric',
      kind: 'display',
      concept: 'screen',
    }),
  ];
}
