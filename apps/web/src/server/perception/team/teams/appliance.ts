import { airUnit, applianceBody, hood, type FrontDetail, type PartSpec } from '../../furniture';
import { objectFrame } from '../shared/common';
import {
  openingsAnswered,
  openingsSpec,
  parseOpenings,
  type ReadOpening,
} from '../shared/openings';
import {
  FURNITURE_VIEWS,
  enumField,
  finishColor,
  footprint,
  furnitureTeam,
  legHeight,
  lineHeight,
  profileOn,
  type FurnitureReading,
} from './furniture';

/**
 * The appliance team (PQ-T90): fridges, air conditioners, cooker hoods, radiator covers,
 * fireplaces, screens, fans, machines, tanks (the `cabinet`, `screen`, `fan`, `machine`, `tank`
 * archetypes). Shared profile, legs and finishes, and the shared openings specialist as its
 * controls specialist (grilles, slot rows, screens, buttons, handles, seams, a firebox…).
 * `applianceParts` builds a wall air unit, a hood, or an appliance body with its front details.
 */

export const APPLIANCE_KINDS = [
  'fridge',
  'air_conditioner',
  'hood',
  'radiator',
  'fireplace',
  'screen',
  'fan',
  'machine',
  'tank',
] as const;
export type ApplianceKind = (typeof APPLIANCE_KINDS)[number];
export const APPLIANCE_PARTS = [
  'door',
  'grille',
  'slots',
  'screen',
  'buttons',
  'handle',
  'plinth',
  'feet',
  'top_board',
  'firebox',
  'mantel',
  'flue',
] as const;
export const CONTROL_KINDS = [
  'grille',
  'slots',
  'screen',
  'button',
  'handle',
  'seam',
  'vent',
  'firebox',
  'mantel',
  'jamb',
  'hearth',
  'logs',
] as const;

const NOUN = 'appliance';
const SUBJECT =
  'ONE appliance (a fridge, an air conditioner, a cooker hood, a radiator cover, a fireplace, a screen, a fan, a machine or a tank)';

export const CONTROLS_CFG = {
  subject: SUBJECT,
  frame: objectFrame(NOUN),
  what: 'every detail on its front: grilles, rows of slots, screens, buttons, handles, door seams, vents, and a fireplace’s firebox, mantel, jambs, hearth and logs',
  key: 'controls',
  kinds: CONTROL_KINDS,
  views: FURNITURE_VIEWS,
  shape: 'box' as const,
  panes: true,
  notes: [
    'slots = one block of louvre slots: panes = [slots per row, rows]; seam = the line between two doors or a door and the body; firebox = the opening of a fireplace.',
  ],
  schemaName: 'ApplianceControls',
  task: 'List the details on its front: grilles, slot rows, screens, buttons, handles, seams, vents, firebox, mantel.',
};

/** 1: first version. */
export const APPLIANCE_PROMPT_VERSION = 1;

export const APPLIANCE_TEAM = furnitureTeam({
  id: 'appliance',
  promptVersion: APPLIANCE_PROMPT_VERSION,
  noun: NOUN,
  subject: SUBJECT,
  kinds: APPLIANCE_KINDS,
  parts: APPLIANCE_PARTS,
  lines: [['canopy', 'top of a cooker hood’s canopy, where its flue starts']],
  finishes: [
    ['body', 'the casing'],
    ['grille', 'grilles and slots'],
    ['screen', 'a screen or a display'],
    ['handle', 'handles and buttons'],
    ['top', 'a top board of another finish'],
    ['firebox', 'the inside of a firebox'],
    ['base', 'a plinth, feet or a hearth'],
  ],
  materials: ['metal', 'plastic', 'glass', 'wood', 'stone'],
  own: {
    controls: {
      spec: openingsSpec(CONTROLS_CFG),
      answered: (c: string | null | undefined) => openingsAnswered(c, CONTROLS_CFG),
    },
  },
  parseOwn: (a): ReadOpening[] => parseOpenings(a.controls, CONTROLS_CFG),
  ownSummary: (c) => `${c.length} front details`,
});

export type ApplianceReading = FurnitureReading<ReadOpening[]>;

/** Usual height of each kind (metres): only the proportions matter, the builders want metres. */
const APPLIANCE_HEIGHT: Record<ApplianceKind, number> = {
  fridge: 1.45,
  air_conditioner: 0.42,
  hood: 0.84,
  radiator: 0.8,
  fireplace: 1.1,
  screen: 0.6,
  fan: 1.2,
  machine: 1.0,
  tank: 1.5,
};

/** Share of a fireplace's depth its body takes (the hearth runs to the full depth). */
const FIRE_BODY = 0.72;

/** Concept and finish of each front detail. */
const DETAIL: Record<
  (typeof CONTROL_KINDS)[number],
  { concept: string; finish: string; depth: number }
> = {
  grille: { concept: 'grille', finish: 'grille', depth: 0.008 },
  slots: { concept: 'grille', finish: 'grille', depth: 0.006 },
  vent: { concept: 'grille', finish: 'grille', depth: 0.006 },
  screen: { concept: 'screen', finish: 'screen', depth: 0.01 },
  button: { concept: 'control_panel', finish: 'handle', depth: 0.02 },
  handle: { concept: 'handle', finish: 'handle', depth: 0.04 },
  seam: { concept: 'frame', finish: 'grille', depth: 0.006 },
  firebox: { concept: 'stone_foundation', finish: 'firebox', depth: 0.02 },
  mantel: { concept: 'table', finish: 'body', depth: 0.06 },
  jamb: { concept: 'leg', finish: 'body', depth: 0.04 },
  hearth: { concept: 'base', finish: 'base', depth: 0.06 },
  logs: { concept: 'stone_foundation', finish: 'firebox', depth: 0.03 },
};

/** An appliance reading on its measured proportions (largest side = 1) → its builder's parts. */
export function applianceParts(
  r: ApplianceReading,
  p: { w: number; h: number; d: number }
): PartSpec[] {
  const kind = enumField(r.kind, APPLIANCE_KINDS, 'machine');
  const h = APPLIANCE_HEIGHT[kind];
  const { w, d } = footprint(h, p);
  const color = finishColor(r, ['body'], '#e7e7e3');
  const front = r.own.filter((c) => c.view === 'front' && c.box);
  if (kind === 'hood') {
    const canopy = lineHeight(r, 'canopy', 1);
    return hood(w, h, color, canopy ?? 0.5);
  }
  const slots = front.find((c) => c.kind === 'slots');
  if (kind === 'air_conditioner' && slots) {
    const [perRow, rows] = slots.panes ?? [12, 4];
    return airUnit(w, h, rows, perRow, color, finishColor(r, ['grille'], '#2a2a2a'));
  }
  const support = r.legs.find((l) => l.kind === 'plinth' || l.kind === 'leg');
  const foot = support ? { h: legHeight(r, h), color: finishColor(r, ['base'], color) } : null;
  const details: FrontDetail[] = front.map((c) => {
    const k = enumField(c.kind, CONTROL_KINDS, 'grille');
    const t = DETAIL[k];
    return {
      concept: t.concept,
      box: c.box!,
      color: finishColor(r, [t.finish], '#2a2a2a'),
      depth: t.depth,
    };
  });
  // A fireplace's body stands back: its hearth and mantel come out of it to the measured depth.
  const fire = kind === 'fireplace';
  const bodyD = fire ? d * FIRE_BODY : d;
  if (fire)
    for (const t of details)
      if (t.concept === 'base') t.depth = d - bodyD;
      else if (t.concept === 'table') t.depth = (d - bodyD) / 2;
  return applianceBody(w, h, d, color, {
    bodyD,
    rounded: profileOn(r).top === 'rounded',
    material: kind === 'fireplace' ? 'stone' : kind === 'radiator' ? 'wood' : 'metal',
    concept: kind === 'fridge' ? 'door' : kind === 'radiator' ? 'grille' : 'frame',
    ...(foot && support?.kind === 'plinth' ? { plinth: foot } : {}),
    ...(foot && support?.kind === 'leg' ? { feet: foot } : {}),
    ...(r.parts.includes('top_board') ? { top: finishColor(r, ['top'], color) } : {}),
    details,
  });
}
