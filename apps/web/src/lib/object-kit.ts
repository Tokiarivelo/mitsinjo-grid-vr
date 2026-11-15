import type { ApplianceCategory } from '@mitsinjo/engine';
import { z } from 'zod';
import {
  boundForRoof,
  MAX_ROOF_OVERHANG,
  RecipeMaterialSchema,
  type ObjectRecipe,
  type RecipePart,
} from './object-shape';
import type { SceneryType } from './vision';

/**
 * 3D « kit » of one object (PV-T9b): what Muse Spark returns instead of free 3D coordinates.
 * Spark only classifies (archetype), reads proportions, 3 colours and a few counts; `kitToRecipe`
 * builds the parts from fixed templates. Reason: a 12-part coordinate recipe made Spark think for
 * more than 60 s on a building (user report 2026-11-01); a kit is ~80 output tokens.
 */

export const KIT_ARCHETYPES = [
  'cabinet', // fridge, freezer, washing machine, cupboard, generic box appliance
  'screen', // TV, monitor, laptop, sign board
  'fan', // fan, round appliance on a stand
  'machine', // pump, mill, welder, generator: body + pipe / motor
  'lamp_post', // street lamp, light on a pole
  'pole', // utility pole, antenna, mast
  'tank', // water tank, barrel, round container
  'panel', // solar panel, board on legs
  'house', // house, cottage, hut (pitched roof)
  'building', // flat-roof building, shop, school, block
  'tree',
  'bush', // bush, plant, hedge, flower bed
  'vehicle', // car, truck, motorbike, cart
  'person',
  'animal',
  'water', // river, pond, pool (flat)
  'other', // plain box
] as const;
export type KitArchetype = (typeof KIT_ARCHETYPES)[number];

/**
 * Roof measured on the SAM outline (PF-T3, never from the LLM), box fractions (x 0 = left, y 0 = top):
 * `eave` = where the walls end; each gable spans [x0, x1] with its ridge at x `peak`, height `top`.
 */
export const KitRoofSchema = z.object({
  eave: z.number().min(0).max(1),
  gables: z
    .array(
      z.object({
        x0: z.number().min(0).max(1),
        x1: z.number().min(0).max(1),
        peak: z.number().min(0).max(1),
        top: z.number().min(0).max(1),
      })
    )
    .min(1)
    .max(6),
});
export type KitRoof = z.infer<typeof KitRoofSchema>;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const count = (max: number) => z.number().int().min(0).max(max);

/** Building parts whose material Spark reads on the 2D drawing (PG-T5). */
export const PART_MATERIAL_KEYS = ['roof', 'walls', 'frame', 'plinth', 'chimney', 'door'] as const;
export type PartMaterialKey = (typeof PART_MATERIAL_KEYS)[number];

/** Views the model may report facing (PQ-T12). Anything else is dropped. */
export const EVIDENCE_VIEWS = ['front', 'side', 'back', 'three_quarter', 'top'] as const;

/** Most parts the model may list as visible (PQ-T12). */
export const MAX_VISIBLE_PARTS = 12;

/**
 * What the model saw before it answered (PQ-T12, methodology §6.3). Written first in the answer, so the
 * fields after it follow from it. `visibleParts` are plain SAM words (« wheel », « door handle »).
 */
export const KitEvidenceSchema = z.object({
  view: z.enum(EVIDENCE_VIEWS).optional(),
  outline: z.string().max(160).optional(),
  hiddenBy: z.array(z.string().max(40)).max(6).optional(),
  volumes: z.array(z.string().max(60)).max(3).optional(),
  visibleParts: z.array(z.string().max(40)).max(MAX_VISIBLE_PARTS).optional(),
  /** Counts of what repeats on the photo (windows per floor, wheels on this side…). */
  repeats: z.record(z.string().max(32), z.number().int().min(0).max(50)).optional(),
  /** Fields the model guessed instead of saw (« proportions.d », « colors »). Fusion leads them by measurement. */
  unsure: z.array(z.string().max(40)).max(12).optional(),
});
export type KitEvidence = z.infer<typeof KitEvidenceSchema>;

/** How sure the model is of each group of fields, 0 to 1; under 0.5 « mostly a guess » (PQ-T12). */
export const KitConfidenceSchema = z.object({
  archetype: z.number().min(0).max(1).optional(),
  proportions: z.number().min(0).max(1).optional(),
  colors: z.number().min(0).max(1).optional(),
  counts: z.number().min(0).max(1).optional(),
});
export type KitConfidence = z.infer<typeof KitConfidenceSchema>;

/** State of one closed-list part (PQ-T46, universal pipeline §5): seen, existing but unseen, or none. */
export const ANATOMY_STATES = ['present', 'hidden', 'absent'] as const;
export type AnatomyState = (typeof ANATOMY_STATES)[number];

/** Most closed-list parts the model may answer (PQ-T46: the longest list holds 13). */
export const MAX_ANATOMY_PARTS = 16;

export const KitAnatomyPartSchema = z.object({
  part: z.string().max(32),
  state: z.enum(ANATOMY_STATES),
  /** Where the part is in plain words (« lower left », « rear »); like `visibleParts`. */
  where: z.string().max(80).optional(),
});
export type KitAnatomyPart = z.infer<typeof KitAnatomyPartSchema>;
export const KitAnatomySchema = z.array(KitAnatomyPartSchema).max(MAX_ANATOMY_PARTS);
export type KitAnatomy = z.infer<typeof KitAnatomySchema>;

/**
 * Closed part inventory of each family (PQ-T46, universal pipeline §5): the parts the archetype always
 * has, which the model answers one by one (`present` | `hidden` | `absent`). The archetype skill cards
 * carry the same lists (`docs/vision-to-3d-muse-skills.md` §5, checked by `skills.test.ts`); the kit
 * prompt names them so the inventory is closed on every prompt version. `water` and `other` have none.
 * Tree droop and foliage density (§5 table) stay prose in the card: traits do not fit `present | absent`.
 */
export const ANATOMY: Record<KitArchetype, readonly string[]> = {
  vehicle: [
    'windshield',
    'rear window',
    'side windows',
    'wheels',
    'wheel arches',
    'headlights',
    'tail lights',
    'side mirrors',
    'bumpers',
    'grille',
    'door lines',
    'roof',
    'plate',
  ],
  house: [
    'walls',
    'roof',
    'roof overhang',
    'ridge',
    'door',
    'windows',
    'chimney',
    'plinth',
    'gutter',
    'steps',
  ],
  building: ['walls', 'roof edge', 'entrance', 'windows', 'stairs', 'sign'],
  cabinet: ['door', 'handle', 'vents', 'feet', 'display', 'cable'],
  screen: ['display', 'frame', 'stand'],
  fan: ['blades', 'guard', 'pole', 'base'],
  machine: ['body', 'motor', 'pipe', 'frame', 'controls'],
  lamp_post: ['shaft', 'lamp head', 'arm', 'solar panel', 'base'],
  pole: ['shaft', 'crossarm', 'base'],
  tank: ['body', 'lid', 'stand', 'pipe'],
  panel: ['board', 'cells', 'frame', 'legs'],
  tree: ['trunk', 'root flare', 'branches', 'low branches', 'crown', 'palm fan'],
  bush: ['stems', 'foliage mass'],
  person: ['head', 'torso', 'arms', 'legs'],
  animal: ['head', 'body', 'legs', 'tail'],
  water: [],
  other: [],
};

export const ObjectKitSchema = z.object({
  /** Written before the answer (PQ-T12); absent on answers of the first prompt. */
  evidence: KitEvidenceSchema.optional(),
  confidence: KitConfidenceSchema.optional(),
  /** Closed inventory (PQ-T46): one state per part of `ANATOMY`, answered before the decision. */
  anatomy: KitAnatomySchema.optional(),
  archetype: z.enum(KIT_ARCHETYPES),
  /** Optional subtype (vehicle: sedan, hatchback, vintage, van, truck; house: cottage, gable; tree: round, conifer). */
  subtype: z.string().max(32).optional(),
  /** Real proportions, largest side = 1. */
  proportions: z.object({
    w: z.number().min(0.01).max(1),
    h: z.number().min(0.01).max(1),
    d: z.number().min(0.01).max(1),
  }),
  /** main = biggest surface (walls, body), secondary = roof / stand / trunk, accent = glass, handle, lamp. */
  colors: z.object({ main: hex, secondary: hex, accent: hex }),
  /** What each colour role is made of, named by Spark (stone walls, slate roof, glass windows). */
  materials: z
    .object({
      main: RecipeMaterialSchema.optional(),
      secondary: RecipeMaterialSchema.optional(),
      accent: RecipeMaterialSchema.optional(),
    })
    .optional(),
  /**
   * Material per building part read on the validated 2D drawing (PG-T5: labels, hatching — « REED
   * THATCH » → thatch). Wins over the colour-role materials for that part; absent without a drawing.
   */
  partMaterials: z
    .object(
      Object.fromEntries(
        PART_MATERIAL_KEYS.map((k) => [k, RecipeMaterialSchema.optional()])
      ) as Record<PartMaterialKey, z.ZodOptional<typeof RecipeMaterialSchema>>
    )
    .optional(),
  /** Front windows (houses: per floor), doors, wheels, legs, floors. Absent = template default. */
  details: z
    .object({
      subtype: z.string().max(32).optional(),
      windows: count(8).optional(),
      doors: count(3).optional(),
      wheels: count(6).optional(),
      legs: count(4).optional(),
      floors: count(4).optional(),
      chimney: z.boolean().optional(),
      /** Buildings (PV-G, read on the drawing): stone base band, exposed timber frame, panes per window. */
      plinth: z.boolean().optional(),
      timberFrame: z.boolean().optional(),
      panes: z.tuple([count(6).min(1), count(6).min(1)]).optional(),
      /** Houses side by side in a row (PF-T4): measured on the photo, Spark's count only as a fallback. */
      units: count(8).optional(),
      /**
       * Roof overhang draft, object units each side (PQ-T43, §7.1): a starting point only — the
       * measured roofline or the §8bis code choice wins, clamped to the roofing bound.
       */
      eaves: z.number().min(0).max(MAX_ROOF_OVERHANG).optional(),
    })
    .optional(),
  /** Measured roofline (houses): replaces the stepped roof with one prism per gable. */
  roof: KitRoofSchema.optional(),
});
export type ObjectKit = z.infer<typeof ObjectKitSchema>;

/** Real size range of one axis, millimetres [min, max]. */
type MmRange = readonly [number, number];

/**
 * Real-world sizes per archetype (PT-8), mm: width (as seen on the photo) × height × depth. Used only to
 * clamp the depth Spark **estimates** (`clampEstimatedDepth`); widths and heights come from the photo box,
 * and a measured depth (drawn side view) is never clamped. Archetypes seen from any side (vehicle, animal,
 * person) or without a typical size (water, other) have no range.
 */
export const ARCHETYPE_SIZE_MM: Partial<
  Record<KitArchetype, { w: MmRange; h: MmRange; d: MmRange }>
> = {
  cabinet: { w: [500, 900], h: [800, 2000], d: [500, 750] },
  screen: { w: [300, 2000], h: [200, 1200], d: [20, 300] },
  fan: { w: [300, 600], h: [400, 1500], d: [300, 600] },
  machine: { w: [300, 2000], h: [300, 1500], d: [300, 1200] },
  lamp_post: { w: [200, 1500], h: [3000, 10000], d: [200, 1500] },
  pole: { w: [150, 1500], h: [4000, 15000], d: [150, 1500] },
  tank: { w: [600, 2500], h: [600, 3000], d: [600, 2500] },
  panel: { w: [1000, 2300], h: [1000, 2500], d: [40, 1500] },
  house: { w: [4000, 20000], h: [3000, 9000], d: [4000, 15000] },
  building: { w: [5000, 40000], h: [3000, 20000], d: [5000, 30000] },
  tree: { w: [1000, 15000], h: [2000, 30000], d: [1000, 15000] },
  bush: { w: [300, 4000], h: [300, 3000], d: [300, 4000] },
};

/**
 * Spark-estimated proportions → depth clamped to the archetype's real range (PT-8), largest side = 1
 * again. The depth must fit both its ratio to the height and to the width; when the two ranges do not
 * overlap (odd width / height from Spark), only the height ratio is used. No range → unchanged.
 */
export function clampEstimatedDepth(
  archetype: KitArchetype,
  p: ObjectKit['proportions']
): ObjectKit['proportions'] {
  const size = ARCHETYPE_SIZE_MM[archetype];
  if (!size) return p;
  const byH = [(size.d[0] / size.h[1]) * p.h, (size.d[1] / size.h[0]) * p.h] as const;
  const byW = [(size.d[0] / size.w[1]) * p.w, (size.d[1] / size.w[0]) * p.w] as const;
  let [lo, hi] = [Math.max(byH[0], byW[0]), Math.min(byH[1], byW[1])];
  if (lo > hi) [lo, hi] = byH;
  const d = Math.min(hi, Math.max(lo, p.d));
  if (d === p.d) return p;
  const max = Math.max(p.w, p.h, d);
  const unit = (v: number) => Math.min(1, Math.max(0.01, v / max));
  return { w: unit(p.w), h: unit(p.h), d: unit(d) };
}

/** Water sheet thickness, share of its depth on the ground. */
export const WATER_SHEET = 0.04;

/**
 * Water lies flat (user 2026-11-05: a river came out as a standing block): the photo box's height
 * is mostly the water's depth on the ground seen in perspective, so it becomes the depth and the
 * model a thin sheet of the water colour. Pure.
 */
export function flatWaterRecipe(recipe: ObjectRecipe): ObjectRecipe {
  const { w, h, d } = recipe.proportions;
  const depth = Math.max(d, h);
  const thick = WATER_SHEET * depth;
  const max = Math.max(w, depth, thick);
  const main = recipe.parts[0];
  return {
    ...recipe,
    proportions: { w: w / max, h: Math.max(0.01, thick / max), d: depth / max },
    parts: [
      {
        shape: 'box',
        at: [0, 0, 0],
        size: [1, 1, 1],
        color: main?.color ?? '#3d6b7a',
        material: 'water',
        front: true,
        ...(main?.status ? { status: main.status } : {}),
      },
    ],
  };
}

/** The family asked of the model: the operator's pick when valid (PQ-T41), else the detection's. */
export function archetypeOf(target: {
  category: ApplianceCategory;
  scenery?: SceneryType | undefined;
  label?: string | undefined;
  archetype?: string | undefined;
}): KitArchetype {
  const picked = (KIT_ARCHETYPES as readonly string[]).includes(target.archetype ?? '')
    ? (target.archetype as KitArchetype)
    : null;
  return picked ?? defaultArchetype(target.category, target.scenery, target.label);
}

/** Archetype the detection already implies (mock mode, and the hint sent to Spark). */
export function defaultArchetype(
  category: ApplianceCategory,
  scenery?: SceneryType,
  label?: string
): KitArchetype {
  if (scenery && scenery !== 'other') {
    const byScenery: Record<SceneryType, KitArchetype> = {
      building: 'house',
      vehicle: 'vehicle',
      tree: 'tree',
      plant: 'bush',
      person: 'person',
      animal: 'animal',
      water: 'water',
      other: 'other',
    };
    return byScenery[scenery];
  }
  // Check label if scenery is missing or 'other', or category is 'other'
  if (label) {
    const norm = label.trim().toLowerCase();
    if (
      /\b(car|cars|vehicle|vehicles|automobile|automobiles|auto|autos|mini|cooper|sedan|sedans|hatchback|hatchbacks|suv|suvs|truck|trucks|pickup|pickups|van|vans|bus|buses|cart|carts|coupe|convertible|motorcar|jeep|taxi|wagon|buggy|motorbike|motorcycle|bike|bicycle|scooter|voiture|camion|fiara|tomobila|topiary_car)\b/i.test(
        norm
      )
    ) {
      return 'vehicle';
    }
    if (
      /\b(house|cottage|building|roof|wall|barn|shed|cabin|hut|shop|maison|trano|batiment)\b/i.test(
        norm
      )
    ) {
      return 'house';
    }
    if (/\b(tree|trees|palm|pine|conifer|willow|hazo|arbre)\b/i.test(norm)) {
      return 'tree';
    }
    if (/\b(bush|plant|hedge|shrub|flower|flowers|grass|topiary)\b/i.test(norm)) {
      return 'bush';
    }
    if (/\b(lamp|light|lantern|street_light|lamppost|lamp_post|jiro)\b/i.test(norm)) {
      return 'lamp_post';
    }
  }
  const byCategory: Record<ApplianceCategory, KitArchetype> = {
    fridge: 'cabinet',
    freezer: 'cabinet',
    fridge_vaccine: 'cabinet',
    tv: 'screen',
    computer: 'screen',
    laptop: 'screen',
    lamp: 'lamp_post',
    fan: 'fan',
    radio: 'cabinet',
    phone_charger: 'cabinet',
    water_pump: 'machine',
    rice_mill: 'machine',
    sewing_machine: 'machine',
    welder: 'machine',
    other: 'other',
  };
  return byCategory[category];
}

type Vec = [number, number, number];
const part = (
  shape: RecipePart['shape'],
  at: Vec,
  size: Vec,
  color: string,
  extra: Partial<
    Pick<
      RecipePart,
      | 'axis'
      | 'front'
      | 'apex'
      | 'profile'
      | 'material'
      | 'status'
      | 'kind'
      | 'overhang'
      | 'generator'
    >
  > = {}
): RecipePart => ({ shape, at, size, color, ...extra });

/** `n` centres spread evenly over [-span/2, span/2]. */
const spread = (n: number, span: number) =>
  Array.from({ length: n }, (_, i) => (n === 1 ? 0 : -span / 2 + (span * i) / (n - 1)));

/** Width of `n` decals over `span`: at most `max`, and ≤ 70 % of their pitch so they never overlap. */
export const decalWidth = (n: number, span: number, max: number) =>
  n <= 1 ? max : Math.min(max, (0.7 * span) / (n - 1));

type Template = (k: ObjectKit) => RecipePart[];
const MAX_PARTS = 12;

/** Houses side by side (1–8, `details.units`). */
const unitsOf = (d: ObjectKit['details']) => Math.max(1, Math.min(8, d?.units ?? 1));

/**
 * Openings over the wall band [`bottom`, `top`] (y): front windows and doors standing on the ground,
 * then the rear mirror (same bays, windows before doors, status inferred) and two side windows per
 * face. One house: the kit counts spread over the front. A row of `units` (PF-T4): each house gets
 * its own door and windows, fewer when the 12-part budget (`room`) is short (windows first dropped,
 * then doors). The rear/side mirror ships whole or not at all: a truncated rear is lopsided
 * and would starve the deduced end windows downstream, so when it does not fit the template stays
 * front-only and hidden-sides owns the other faces (rows always wait — their fronts fill the room).
 */
function facade(
  c: ObjectKit['colors'],
  d: ObjectKit['details'],
  bottom: number,
  top: number,
  room = 12
) {
  const wall = top - bottom;
  const doorH = Math.min(0.28, 0.47 * wall);
  const winY = bottom + (0.44 / 0.6) * wall;
  const winH = Math.min(0.14, 0.24 * wall);
  const units = unitsOf(d);
  const window = (x: number, w: number) =>
    part('box', [x, winY, 0.505], [w, winH, 0.02], c.accent, { kind: 'window' });
  const door = (x: number, w: number) =>
    part('box', [x, bottom + doorH / 2, 0.505], [w, doorH, 0.02], c.secondary, { kind: 'door' });
  let front: RecipePart[];
  if (units === 1) {
    const windows = Math.min(8, d?.windows ?? 3);
    const doors = Math.min(3, d?.doors ?? 1);
    front = [
      ...spread(windows, 0.76).map((x) => window(x, decalWidth(windows, 0.76, 0.11))),
      ...spread(doors, 0.5).map((x) => door(x, decalWidth(doors, 0.5, 0.1))),
    ];
  } else {
    const per = Math.floor(Math.max(0, room) / units);
    const doors = per >= 2 || (per === 1 && !d?.windows) ? 1 : 0;
    const wanted = Math.max(1, Math.ceil((d?.windows ?? 2 * units) / units));
    const windows = Math.max(0, Math.min(wanted, per - doors));
    const pitch = 1 / units;
    // With a door: door on the left quarter of the house, windows over the right half.
    const span = (doors ? 0.44 : 0.76) * pitch;
    const winW = decalWidth(windows, span, Math.min(0.11, 0.16 * pitch));
    front = spread(units, 1 - pitch).flatMap((cx) => [
      ...spread(windows, span).map((x) => window(cx + x + (doors ? 0.15 * pitch : 0), winW)),
      ...(doors ? [door(cx - 0.3 * pitch, Math.min(0.1, 0.16 * pitch))] : []),
    ]);
  }
  // Rear by mirror of the front (PQ-T43, §7.4 remedy 2): same bays, windows before doors so a
  // short budget drops rear doors first. Sides: two windows per face on the front windows' line,
  // spread over the depth, interleaved so truncation keeps symmetric pairs.
  const mirror = (p: RecipePart): RecipePart => ({
    ...p,
    at: [p.at[0], p.at[1], -p.at[2]],
    status: 'inferred',
  });
  const rear = [
    ...front.filter((p) => p.color === c.accent).map(mirror),
    ...front.filter((p) => p.color !== c.accent).map(mirror),
  ];
  const sideW = front.find((p) => p.color === c.accent)?.size[0] ?? 0.11;
  const sides = spread(2, 0.5).flatMap((z) =>
    ([1, -1] as const).map((s) =>
      part('box', [s * 0.51, winY, z], [0.02, winH, sideW], c.accent, {
        status: 'inferred',
        kind: 'window',
      })
    )
  );
  if (front.length + rear.length + sides.length > room) return front;
  return [...front, ...rear, ...sides];
}

/** Row of `units` houses without a measured roof (PF-T4): one even gable per house, walls 60 % high. */
export function uniformRoof(units: number): KitRoof | null {
  if (units < 2) return null;
  const n = Math.min(6, units);
  return {
    eave: 0.4,
    gables: Array.from({ length: n }, (_, i) => ({
      x0: i / n,
      x1: (i + 1) / n,
      peak: (i + 0.5) / n,
      top: 0,
    })),
  };
}

/** House without a measured roof: walls + three slabs that read as a pitched roof. */
const steppedHouse: Template = ({ colors: c, details: d }) => {
  const structure = [
    part('box', [0, -0.2, 0], [1, 0.6, 1], c.main, { front: true, kind: 'wall' }),
    part('box', [0, 0.16, 0], [1, 0.12, 1], c.secondary, { kind: 'roof' }),
    part('box', [0, 0.28, 0], [0.72, 0.12, 0.74], c.secondary, { kind: 'roof' }),
    part('box', [0, 0.4, 0], [0.42, 0.12, 0.48], c.secondary, { kind: 'roof' }),
    ...(d?.chimney
      ? [part('box', [0.3, 0.38, 0], [0.08, 0.24, 0.1], c.main, { kind: 'chimney' })]
      : []),
  ];
  return [...structure, ...facade(c, d, -0.5, 0.1, MAX_PARTS - structure.length)];
};

/** House with the measured roofline (PF-T3): walls up to the eave, one prism per gable on top. */
function measuredHouse(
  { colors: c, details: d, materials }: ObjectKit,
  roof: KitRoof
): RecipePart[] {
  const eave = 0.5 - roof.eave;
  const ridges = roof.gables.map((g) => 0.5 - g.top);
  const highest = Math.max(...ridges);
  // Draft overhang (PQ-T43): the `eaves` value clamped to the roofing bound. No photo measure
  // here — KitRoof carries no wall extent, so outline-vs-wall (removed facade route) belongs to the
  // fit stage and the §8bis code (PQ-T45).
  const bound = boundForRoof(materials?.secondary);
  const overhang = Math.min(d?.eaves ?? bound, bound);
  // Single gable on a single house: the middle prism shrinks so the gable ends stand at the wall
  // plane with a 0.005 gap (no coplanar faces); rows and multi-gable roofs keep full-depth prisms.
  const singleGable = unitsOf(d) === 1 && roof.gables.length === 1;
  const gables = roof.gables.map((g, i) => {
    const w = Math.max(0.01, g.x1 - g.x0);
    const h = Math.max(0.01, ridges[i]! - eave);
    const depth = singleGable ? Math.max(0.5, 0.94 - 2 * overhang) : 1;
    return part('prism', [(g.x0 + g.x1) / 2 - 0.5, eave + h / 2, 0], [w, h, depth], c.secondary, {
      apex: Math.min(1, Math.max(0, (g.peak - g.x0) / w)),
      kind: 'roof',
      overhang,
    });
  });
  // Gable triangles in wall material (PQ-T43, §7.4): thin prisms flush with the walls. Rows and
  // multi-gable roofs keep roof-colored gables: no room under the 12-cap.
  const mid = singleGable ? gables[0]! : null;
  const ends = mid
    ? [0.4875, -0.4875].map((z) =>
        part('prism', [mid.at[0], mid.at[1], z], [mid.size[0], mid.size[1], 0.025], c.main, {
          apex: mid.apex ?? 0.5,
          kind: 'roof',
          overhang: 0,
        })
      )
    : [];
  const chimneyTop = eave + 0.85 * (highest - eave) + 0.06;
  const structure = [
    part('box', [0, (eave - 0.5) / 2, 0], [1, eave + 0.5, 1], c.main, {
      front: true,
      kind: 'wall',
    }),
    ...gables,
    ...ends,
    ...(d?.chimney
      ? [
          part('box', [0.3, (eave + chimneyTop) / 2, 0], [0.08, chimneyTop - eave, 0.1], c.main, {
            kind: 'chimney',
          }),
        ]
      : []),
  ];
  return [...structure, ...facade(c, d, -0.5, eave, MAX_PARTS - structure.length)];
}

export const TEMPLATES: Record<KitArchetype, Template> = {
  cabinet: ({ colors: c, details: d }) => [
    part('box', [0, 0, 0], [1, 1, 1], c.main, { front: true }),
    part('box', [0.38, 0.1, 0.51], [0.05, 0.3, 0.04], c.accent),
    ...((d?.doors ?? 2) >= 2
      ? [part('box', [0, 0.18, 0.5], [0.98, 0.015, 0.02], c.secondary)]
      : []),
  ],
  screen: ({ colors: c }) => [
    part('box', [0, 0.08, 0], [1, 0.84, 0.35], c.main, { front: true }),
    part('box', [0, -0.37, 0], [0.12, 0.08, 0.3], c.secondary),
    part('box', [0, -0.45, 0], [0.4, 0.06, 1], c.secondary),
  ],
  fan: ({ colors: c }) => [
    part('cylinder', [0, 0.28, 0], [1, 0.45, 0.3], c.main, { axis: 'z', front: true }),
    part('cylinder', [0, -0.15, 0], [0.08, 0.45, 0.1], c.secondary),
    part('cylinder', [0, -0.47, 0], [0.7, 0.06, 0.9], c.secondary),
  ],
  machine: ({ colors: c }) => [
    part('box', [0, -0.12, 0], [1, 0.76, 1], c.main, { front: true }),
    part('cylinder', [0.25, 0.38, 0], [0.35, 0.24, 0.5], c.secondary, { axis: 'x' }),
    part('cylinder', [-0.3, 0.33, 0], [0.12, 0.3, 0.2], c.accent),
  ],
  lamp_post: ({ colors: c }) => [
    part('cylinder', [0, -0.06, 0], [0.16, 0.86, 0.16], c.main),
    part('lathe', [0, 0.4, 0], [0.9, 0.18, 0.9], c.accent, {
      front: true,
      profile: [
        [0, -0.5],
        [0.46, -0.5],
        [0.5, -0.42],
        [0.5, 0.5],
        [0, 0.5],
      ],
    }),
    part('cone', [0, 0.47, 0], [1, 0.06, 1], c.secondary),
    part('cylinder', [0, -0.47, 0], [0.4, 0.06, 0.4], c.secondary),
  ],
  pole: ({ colors: c }) => [
    part('cylinder', [0, 0, 0], [0.22, 1, 0.22], c.main, { front: true }),
    part('box', [0, 0.4, 0], [1, 0.05, 0.15], c.secondary),
  ],
  tank: ({ colors: c }) => [
    part('lathe', [0, -0.03, 0], [1, 0.94, 1], c.main, {
      front: true,
      profile: [
        [0, -0.5],
        [0.5, -0.5],
        [0.5, 0.34],
        [0.4, 0.5],
        [0, 0.5],
      ],
    }),
    part('cylinder', [0, 0.47, 0], [0.96, 0.06, 0.96], c.secondary),
  ],
  panel: ({ colors: c, details: d }) => [
    part('box', [0, 0.15, 0], [1, 0.7, 0.12], c.main, { front: true }),
    ...spread(Math.max(1, Math.min(4, d?.legs ?? 2)), 0.8).map((x) =>
      part('box', [x, -0.35, 0], [0.06, 0.3, 0.12], c.secondary)
    ),
  ],
  house: (k) => {
    const roof = k.roof ?? uniformRoof(unitsOf(k.details));
    return roof ? measuredHouse(k, roof) : steppedHouse(k);
  },
  building: ({ colors: c, details: d }) => {
    const floors = Math.max(1, Math.min(4, d?.floors ?? 2));
    const windows = Math.max(1, Math.min(8, d?.windows ?? 4));
    const bodyH = 0.92;
    const winW = decalWidth(windows, 0.8, 0.08);
    const floorY = (f: number) => -0.5 + ((f + 0.6) * bodyH) / floors;
    const front = Array.from({ length: floors }, (_, f) =>
      spread(windows, 0.8).map((x) =>
        part('box', [x, floorY(f), 0.505], [winW, 0.1, 0.02], c.accent)
      )
    ).flat();
    // Rear mirror + one side window per floor per side (PQ-T43, §7.4 remedy 2), whole or not
    // at all: a truncated mirror is lopsided, so when it does not fit the front ships alone.
    const rear = front.map((p): RecipePart => ({
      ...p,
      at: [p.at[0], p.at[1], -p.at[2]],
      status: 'inferred',
    }));
    const sides = Array.from({ length: floors }, (_, f) => floorY(f)).flatMap((y) =>
      ([1, -1] as const).map((s) =>
        part('box', [s * 0.51, y, 0], [0.02, 0.1, winW], c.accent, { status: 'inferred' })
      )
    );
    const mirror = front.length + rear.length + sides.length <= 10 ? [...rear, ...sides] : [];
    return [
      part('box', [0, -0.04, 0], [1, bodyH, 1], c.main, { front: true }),
      part('box', [0, 0.46, 0], [1.0, 0.08, 1.0], c.secondary),
      ...front,
      ...mirror,
    ].slice(0, 12);
  },
  tree: ({ colors: c }) => [
    // PQ-T50: the canopy stays smooth spheres (the golden cartoon is saturated at 99; leaf shells
    // await outline-driven volumes with live proof). The trunk is a grown sweep (taper + flare).
    part('sphere', [0, 0.16, 0], [0.96, 0.64, 0.96], c.main, { front: true }),
    part('box', [0, -0.28, 0], [0.16, 0.44, 0.16], c.secondary, {
      generator: {
        op: 'sweep',
        seed: 7,
        points: [
          [0, -0.5, 0],
          [0, -0.28, 0],
          [0, -0.06, 0],
        ],
        r0: 0.06,
        r1: 0.05,
        flare: 0.15,
      },
    }),
    part('sphere', [-0.18, 0.18, 0.12], [0.52, 0.42, 0.52], c.main),
    part('sphere', [0.18, 0.22, -0.1], [0.48, 0.38, 0.48], c.main),
    part('sphere', [0.04, 0.32, 0.08], [0.44, 0.3, 0.44], c.main),
  ],
  bush: ({ colors: c }) => [
    part('sphere', [0, 0.05, 0], [1, 0.9, 1], c.main, { front: true }),
    part('sphere', [0.25, 0.25, 0.1], [0.4, 0.4, 0.4], c.accent),
  ],
  vehicle: ({ colors: c, details: d, subtype: rawSubtype }) => {
    const sub = (rawSubtype ?? d?.subtype ?? '').toLowerCase();
    const wheels = Math.max(2, Math.min(6, d?.wheels ?? 4));

    // Two-wheel vehicle (motorbike, scooter, bicycle):
    if (wheels === 2 || sub === 'motorbike' || sub === 'bike' || sub === 'scooter') {
      return [
        part('box', [0, -0.06, 0], [0.55, 0.28, 0.22], c.main, { front: true }),
        part('cylinder', [0.34, -0.32, 0], [0.32, 0.32, 0.08], WHEEL_COLOR, {
          axis: 'z',
          material: 'rubber',
          kind: 'wheel',
        }),
        part('cylinder', [-0.34, -0.32, 0], [0.32, 0.32, 0.08], WHEEL_COLOR, {
          axis: 'z',
          material: 'rubber',
          kind: 'wheel',
        }),
        part('cylinder', [0.22, 0.16, 0], [0.08, 0.52, 0.08], c.secondary),
        part('sphere', [0.06, 0.14, 0], [0.28, 0.2, 0.22], c.main),
        part('box', [-0.14, 0.12, 0], [0.24, 0.08, 0.18], c.secondary),
        part('cylinder', [0.32, 0.26, 0], [0.08, 0.08, 0.08], c.accent, {
          axis: 'x',
          kind: 'light',
        }),
        // Flyscreen above the headlamp (PQ-T43): the bike has room, unlike the 12-part cars.
        // Kindless on purpose (PQ-T46): tagging it `window` would invite precision judgments.
        part('box', [0.37, 0.35, 0], [0.02, 0.16, 0.2], c.accent),
      ];
    }

    // Van / bus / minivan:
    if (sub === 'van' || sub === 'bus' || sub === 'minivan') {
      const perSide = Math.ceil(wheels / 2);
      return [
        part('box', [0, -0.08, 0], [1.0, 0.44, 0.9], c.main, { front: true, kind: 'body' }),
        part('box', [-0.04, 0.28, 0], [0.84, 0.36, 0.84], c.secondary, { kind: 'body' }),
        part('prism', [0.44, 0.28, 0], [0.12, 0.36, 0.84], c.accent, { apex: 0, kind: 'window' }),
        // Rear bumper only: the front one funded the red lenses (PR-2.11). Trim colour, not glass.
        part('box', [-0.5, -0.18, 0], [0.04, 0.14, 0.88], c.secondary, { kind: 'bumper' }),
        part('cylinder', [0.49, 0.02, 0.3], [0.03, 0.09, 0.09], c.accent, {
          axis: 'x',
          kind: 'light',
        }),
        part('cylinder', [0.49, 0.02, -0.3], [0.03, 0.09, 0.09], c.accent, {
          axis: 'x',
          kind: 'light',
        }),
        ...spread(perSide, 0.6).flatMap((x) => [
          part('cylinder', [x, -0.38, 0.44], [0.22, 0.22, 0.14], WHEEL_COLOR, {
            axis: 'z',
            material: 'rubber',
            kind: 'wheel',
          }),
          part('cylinder', [x, -0.38, -0.44], [0.22, 0.22, 0.14], WHEEL_COLOR, {
            axis: 'z',
            material: 'rubber',
            kind: 'wheel',
          }),
        ]),
        // Red rear lenses last: the 12-part slice drops them before a wheel (PR-2.11).
        part('cylinder', [-0.49, 0.02, 0.3], [0.03, 0.09, 0.09], TAIL_LIGHT_COLOR, {
          axis: 'x',
          kind: 'light',
        }),
        part('cylinder', [-0.49, 0.02, -0.3], [0.03, 0.09, 0.09], TAIL_LIGHT_COLOR, {
          axis: 'x',
          kind: 'light',
        }),
      ].slice(0, 12);
    }

    // Pickup / truck: open bed at the back, red lenses at its rear corners (PR-2.11).
    if (sub === 'pickup' || sub === 'truck') {
      return [
        part('box', [0, -0.1, 0], [1.0, 0.4, 0.9], c.main, { front: true, kind: 'body' }),
        part('box', [0.14, 0.28, 0], [0.44, 0.36, 0.84], c.secondary, { kind: 'body' }),
        part('prism', [0.42, 0.28, 0], [0.14, 0.36, 0.84], c.accent, { apex: 0, kind: 'window' }),
        part('box', [-0.25, 0.14, 0], [0.46, 0.08, 0.86], c.secondary, { kind: 'body' }),
        part('cylinder', [0.32, -0.38, 0.44], [0.24, 0.24, 0.14], WHEEL_COLOR, {
          axis: 'z',
          material: 'rubber',
          kind: 'wheel',
        }),
        part('cylinder', [0.32, -0.38, -0.44], [0.24, 0.24, 0.14], WHEEL_COLOR, {
          axis: 'z',
          material: 'rubber',
          kind: 'wheel',
        }),
        part('cylinder', [-0.3, -0.38, 0.44], [0.24, 0.24, 0.14], WHEEL_COLOR, {
          axis: 'z',
          material: 'rubber',
          kind: 'wheel',
        }),
        part('cylinder', [-0.3, -0.38, -0.44], [0.24, 0.24, 0.14], WHEEL_COLOR, {
          axis: 'z',
          material: 'rubber',
          kind: 'wheel',
        }),
        part('cylinder', [0.49, 0.02, 0.3], [0.03, 0.09, 0.09], c.accent, {
          axis: 'x',
          kind: 'light',
        }),
        part('cylinder', [0.49, 0.02, -0.3], [0.03, 0.09, 0.09], c.accent, {
          axis: 'x',
          kind: 'light',
        }),
        part('cylinder', [-0.49, 0.02, 0.3], [0.03, 0.09, 0.09], TAIL_LIGHT_COLOR, {
          axis: 'x',
          kind: 'light',
        }),
        part('cylinder', [-0.49, 0.02, -0.3], [0.03, 0.09, 0.09], TAIL_LIGHT_COLOR, {
          axis: 'x',
          kind: 'light',
        }),
      ];
    }

    // Classic car / vintage / hatchback / sedan (Mini Cooper, etc.):
    // Sleek, recognizable vehicle: glass cabin band, sloped windscreen and rear window (accent =
    // glass, PQ-T43; the slopes double as the glass — proud parts would cost the lights under the
    // 12-cap), 4 dark wheels, headlights and red taillights. The bumpers sat coplanar with the body
    // in its own colour (invisible): the rear reads through the trunk slope and the red lenses
    // instead (PR-2.11).
    return [
      // PQ-T51: the body is a 4-station loft (tapered nose and tail), not a slab.
      part('box', [0, -0.06, 0], [1.0, 0.48, 0.9], c.main, {
        front: true,
        kind: 'body',
        generator: {
          op: 'loft',
          seed: 3,
          axis: 'x',
          stations: [
            { width: 0.84, height: 0.42, radius: 0 },
            { width: 0.9, height: 0.48, radius: 0 },
            { width: 0.9, height: 0.48, radius: 0 },
            { width: 0.76, height: 0.34, radius: 0 },
          ],
        },
      }),
      // Kindless on purpose (PQ-T46): a `window` box would expand into a framed opening
      // (`layoutOpenings`), but the glasshouse band is glazing, not a punched window.
      part('box', [-0.03, 0.32, 0], [0.52, 0.36, 0.82], c.accent),
      part('prism', [0.26, 0.32, 0], [0.14, 0.36, 0.82], c.accent, { apex: 0, kind: 'window' }),
      part('prism', [-0.33, 0.32, 0], [0.14, 0.36, 0.82], c.accent, { apex: 1, kind: 'window' }),
      part('cylinder', [0.25, -0.38, 0.44], [0.24, 0.24, 0.14], WHEEL_COLOR, {
        axis: 'z',
        material: 'rubber',
        kind: 'wheel',
      }),
      part('cylinder', [0.25, -0.38, -0.44], [0.24, 0.24, 0.14], WHEEL_COLOR, {
        axis: 'z',
        material: 'rubber',
        kind: 'wheel',
      }),
      part('cylinder', [-0.25, -0.38, 0.44], [0.24, 0.24, 0.14], WHEEL_COLOR, {
        axis: 'z',
        material: 'rubber',
        kind: 'wheel',
      }),
      part('cylinder', [-0.25, -0.38, -0.44], [0.24, 0.24, 0.14], WHEEL_COLOR, {
        axis: 'z',
        material: 'rubber',
        kind: 'wheel',
      }),
      part('cylinder', [0.49, 0.04, 0.28], [0.02, 0.08, 0.08], c.secondary, {
        axis: 'x',
        kind: 'light',
      }),
      part('cylinder', [0.49, 0.04, -0.28], [0.02, 0.08, 0.08], c.secondary, {
        axis: 'x',
        kind: 'light',
      }),
      part('cylinder', [-0.49, 0.04, 0.28], [0.02, 0.08, 0.08], TAIL_LIGHT_COLOR, {
        axis: 'x',
        kind: 'light',
      }),
      part('cylinder', [-0.49, 0.04, -0.28], [0.02, 0.08, 0.08], TAIL_LIGHT_COLOR, {
        axis: 'x',
        kind: 'light',
      }),
    ];
  },
  person: ({ colors: c }) => [
    part('cylinder', [0, -0.12, 0], [0.8, 0.75, 0.8], c.main, { front: true }),
    part('sphere', [0, 0.38, 0], [0.55, 0.22, 0.75], c.secondary),
  ],
  animal: ({ colors: c, details: d }) => [
    part('box', [0, 0.05, 0], [0.75, 0.45, 1], c.main, { front: true }),
    part('box', [0.42, 0.28, 0], [0.22, 0.3, 0.6], c.secondary),
    ...spread(Math.max(2, Math.min(4, d?.legs ?? 4)) === 2 ? 1 : 2, 0.55).map((x) =>
      part('cylinder', [x, -0.32, 0], [0.1, 0.36, 0.2], c.secondary)
    ),
  ],
  water: ({ colors: c }) => [part('cylinder', [0, 0, 0], [1, 1, 1], c.main, { front: true })],
  other: ({ colors: c }) => [part('box', [0, 0, 0], [1, 1, 1], c.main, { front: true })],
};

type Role = keyof ObjectKit['colors'];

/**
 * Signal red both taillights share (PR-2.11): a light lens is red on every car, so unlike body
 * parts it is fixed rather than role-measured (same exception as the alloy `RIM_COLOR`).
 */
export const TAIL_LIGHT_COLOR = '#c0271c';

/**
 * Near-black every template wheel shares (PQ-T43): tyres read the same on every car, so like the
 * red lenses they are fixed rather than role-measured — which frees `accent` to mean « glass ».
 */
export const WHEEL_COLOR = '#1c1c1c';

/**
 * Stand-in colours handed to the templates so each part's role (main / secondary / accent) can be read
 * back afterwards; templates only pass colours through, so no real colour is ever one of these.
 */
const ROLE_TOKEN: Record<Role, string> = {
  main: '#000001',
  secondary: '#000002',
  accent: '#000003',
};
const ROLES = Object.keys(ROLE_TOKEN) as Role[];

/**
 * Kit → parts recipe (≤ 12 parts, inside the object box). Pure: same kit → same recipe. Each part takes
 * the colour and the material (AI, `kit.materials`) of its role; fixed signal colours (taillight
 * red) pass through untouched, with no material.
 */
/**
 * Generator growth colours through the role tokens (PQ-T50): a palette or override left as a
 * token would leaf near-black (#00000x). Exported for its test; templates resolve through it.
 */
export function resolveGeneratorColors(
  generator: NonNullable<RecipePart['generator']>,
  colors: ObjectKit['colors']
): NonNullable<RecipePart['generator']> {
  const resolveRole = (c: string): string => {
    const found = ROLES.find((r) => ROLE_TOKEN[r] === c);
    return found ? colors[found] : c;
  };
  if (generator.op === 'scatter')
    return { ...generator, colors: generator.colors.map(resolveRole) };
  if ('color' in generator && generator.color)
    return { ...generator, color: resolveRole(generator.color) };
  return generator;
}

export function kitToRecipe(kit: ObjectKit): ObjectRecipe {
  const parts = TEMPLATES[kit.archetype]({ ...kit, colors: ROLE_TOKEN })
    .slice(0, 12)
    .map((p) => {
      const role = ROLES.find((r) => ROLE_TOKEN[r] === p.color);
      const material = role ? kit.materials?.[role] : undefined;
      const generator = p.generator ? resolveGeneratorColors(p.generator, kit.colors) : undefined;
      return {
        ...p,
        ...(role ? { color: kit.colors[role] } : {}),
        ...(material ? { material } : {}),
        ...(generator ? { generator } : {}),
      };
    });
  return { proportions: kit.proportions, parts };
}
