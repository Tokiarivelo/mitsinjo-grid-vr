import type { ApplianceCategory } from '@mitsinjo/engine';
import type { SceneryType } from '@/lib/vision';
import { z } from 'zod';
import {
  clampEstimatedDepth,
  KIT_ARCHETYPES,
  ObjectKitSchema,
  PART_MATERIAL_KEYS,
  type KitArchetype,
  type ObjectKit,
} from '@/lib/object-kit';
import { RECIPE_MATERIALS, type ObjectRecipe, type RecipePart } from '@/lib/object-shape';

/**
 * Prompts and parsing for the Spark 3D « kit » of one object (PV-T9b). Spark only classifies and reads
 * colours; `kitToRecipe` builds the parts. The old free 12-part recipe took Spark more than 60 s on a
 * building (2026-11-01).
 */

/**
 * Version of the kit prompt (PQ-T5): bump it with every change of `SHAPE_SYSTEM_PROMPT` and keep the old
 * text in `KIT_PROMPTS`, so `make eval-shape PROMPT=1,2` compares them on the same captures.
 */
export const KIT_PROMPT_VERSION = 1;

export const SHAPE_SYSTEM_PROMPT = [
  'You describe ONE object seen on a photo crop so a SIMULATED rural microgrid editor can build a 3D model with high fidelity.',
  'Answer fast and short: do not plan 3D coordinates, the editor has the templates.',
  'IMAGINE and INTERPOLATE the complete 3D object even if partially hidden, occluded (by hedges, wireframes, fences, shadows, people), cropped, or seen from only one angle.',
  'Reconstruct the unseen sides, symmetric features, depth, roof, and undercarriage with strong 3D imagination.',
  `archetype = the closest of: ${KIT_ARCHETYPES.join(', ')}.`,
  'For vehicles (cars, vintage cars, compacts, sedans, hatchbacks, trucks, vans, carts, vehicle topiary/sculptures): recognize as "vehicle" and imagine full vehicle anatomy (hood, windshield angle, cabin roof, trunk/rear, 4 wheels, bumpers, lights).',
  'subtype = optional specific subtype: for vehicle: hatchback, sedan, vintage, compact, suv, van, truck, bus, cart, motorbike; for house: cottage, gable, hip, flat; for tree: round, conifer, palm.',
  'proportions = real width, height, depth of the object, largest = 1 (guess the depth from what it is, e.g. car depth is typically 0.45-0.65 of its width).',
  'colors: main = the biggest surface (walls, body, canopy), secondary = roof, stand, trunk or frame,',
  'accent = glass, windows, handle, lamp or wheels; each #rrggbb as seen or inferred.',
  `materials: what main, secondary and accent are made of, each one of: ${RECIPE_MATERIALS.join(', ')} (e.g. stone walls, slate roof, glass windows, metal body, rubber wheels).`,
  'details (optional, small integers): windows on the front face, doors, wheels, legs, floors, chimney, units (houses side by side in a row).',
  'For buildings also: plinth (true when a stone or concrete base band runs along the foot of the walls), timberFrame (true when timber posts and rails show on the walls), panes ([across, down] glass panes of one front window, e.g. [4, 4] for two casements of 2 × 4).',
  `partMaterials (buildings, optional): what the roof, walls, frame (window and door frames), plinth, chimney and door are made of, each one of the materials above; read them on the drawing when there is one (labels, hatching: « REED THATCH » = thatch, brick courses = brick, stone base = stone).`,
  'Never give watts, kW or any energy value.',
].join(' ');

/** Every kit prompt still comparable by version (current = `KIT_PROMPT_VERSION`). */
export const KIT_PROMPTS: Readonly<Record<number, string>> = { 1: SHAPE_SYSTEM_PROMPT };

/** The kit system prompt of `version` (default: current); throws on a version that was not kept. */
export function kitPrompt(version: number = KIT_PROMPT_VERSION): string {
  const text = KIT_PROMPTS[version];
  if (!text)
    throw new Error(
      `unknown kit prompt version ${version} (kept: ${Object.keys(KIT_PROMPTS).join(', ')})`
    );
  return text;
}

/**
 * User turn; the label is the detection name (from a model or typed by the operator), quoted.
 * `aspect` = width / height on the photo; `hint` = archetype the detection implies (Spark may change it).
 */
/** Told to Spark when the validated 2D facade comes as the second image. */
export const FACADE_REFERENCE_LINE =
  'The second image is the validated front elevation of this same object, drawn unoccluded: use it for the windows, doors, floors, roof shape, materials and part layout; the photo crop (first image) still gives the size, pose and colours.';

/** Told to Spark when the tight crop of the object alone comes as the second image (PQ-T8). */
export const TIGHT_CROP_LINE =
  'The first image is the photo crop with context; the second image is the object alone, large, with the background painted grey: use it for the details and the parts.';
export const FACADE_AS_THIRD_LINE = FACADE_REFERENCE_LINE.replace(
  'The second image is',
  'The third image is'
);

export function shapeQuestion(
  label: string,
  aspect?: number,
  hint?: KitArchetype,
  withFacade = false,
  facts: readonly string[] = [],
  withTight = false
): string {
  const name = label.slice(0, 40).replace(/"/g, "'");
  const seen =
    aspect && aspect > 0 && Number.isFinite(aspect)
      ? ` On the photo it is ${aspect.toFixed(2)} times as wide as it is high.`
      : '';
  const guess = hint ? ` It is probably a "${hint}".` : '';
  const facade = withFacade ? ` ${withTight ? FACADE_AS_THIRD_LINE : FACADE_REFERENCE_LINE}` : '';
  const tight = withTight ? ` ${TIGHT_CROP_LINE}` : '';
  const measured = facts.length ? ` Measured: ${facts.join(' · ')}.` : '';
  return `Describe the full 3D "${name}" in the clear rectangle in the middle of this crop with strong 3D imagination and interpolation, even if partially occluded.${seen}${guess}${measured}${tight}${facade}`;
}

const color = { type: 'string' };
const int = { type: 'integer' };
const material = { type: 'string', enum: [...RECIPE_MATERIALS] };

export const SHAPE_JSON_SCHEMA = {
  name: 'ObjectKit',
  schema: {
    type: 'object',
    properties: {
      archetype: { type: 'string', enum: [...KIT_ARCHETYPES] },
      subtype: { type: 'string' },
      proportions: {
        type: 'object',
        properties: { w: { type: 'number' }, h: { type: 'number' }, d: { type: 'number' } },
        required: ['w', 'h', 'd'],
      },
      colors: {
        type: 'object',
        properties: { main: color, secondary: color, accent: color },
        required: ['main', 'secondary', 'accent'],
      },
      materials: {
        type: 'object',
        properties: { main: material, secondary: material, accent: material },
      },
      partMaterials: {
        type: 'object',
        properties: Object.fromEntries(PART_MATERIAL_KEYS.map((k) => [k, material])),
      },
      details: {
        type: 'object',
        properties: {
          subtype: { type: 'string' },
          windows: int,
          doors: int,
          wheels: int,
          legs: int,
          floors: int,
          chimney: { type: 'boolean' },
          units: int,
          plinth: { type: 'boolean' },
          timberFrame: { type: 'boolean' },
          panes: { type: 'array', items: int },
        },
      },
    },
    required: ['archetype', 'proportions', 'colors'],
  },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const NEUTRAL = '#9aa3ad';
const HEX = /^#[0-9a-f]{6}$/i;

const ReplySchema = z.object({
  archetype: z.string(),
  subtype: z.string().optional(),
  proportions: z.object({ w: z.number(), h: z.number(), d: z.number() }),
  colors: z.record(z.string(), z.unknown()).optional(),
  materials: z.record(z.string(), z.unknown()).optional(),
  partMaterials: z.record(z.string(), z.unknown()).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const LIMITS = { windows: 8, doors: 3, wheels: 6, legs: 4, floors: 4, units: 8 } as const;

/** Version of the critic prompt (PQ-T5), logged with every critic call. */
export const CRITIC_PROMPT_VERSION = 1;

export const CRITIC_SYSTEM_PROMPT = [
  'You are the visual critic of a 3D reconstruction loop. The image shows the PHOTO of one object (left) and OUR 3D MODEL seen from the same view (right).',
  'List what differs (shape, sub-type, counts, proportions, colours of each part), then answer ONLY a JSON patch of the kit: the fields to change, nothing else.',
  `Allowed fields: archetype (one of: ${KIT_ARCHETYPES.join(', ')}), subtype, proportions {w,h,d} (largest = 1), colors {main,secondary,accent} (#rrggbb each), materials, details {windows,doors,wheels,legs,floors,chimney,units}.`,
  'Counts, sub-type, proportions and part colour roles only: never metres, watts, or geometry numbers.',
  'Empty patch ({}) when the model already matches.',
].join(' ');

/** Partial kit: every field optional, nothing required (patches only change what they name). */
export const CRITIC_JSON_SCHEMA = {
  name: 'KitPatch',
  schema: {
    type: 'object',
    properties: {
      archetype: { type: 'string', enum: [...KIT_ARCHETYPES] },
      subtype: { type: 'string' },
      proportions: {
        type: 'object',
        properties: { w: { type: 'number' }, h: { type: 'number' }, d: { type: 'number' } },
        required: ['w', 'h', 'd'],
      },
      colors: {
        type: 'object',
        properties: { main: color, secondary: color, accent: color },
      },
      materials: {
        type: 'object',
        properties: { main: material, secondary: material, accent: material },
      },
      details: {
        type: 'object',
        properties: {
          subtype: { type: 'string' },
          windows: int,
          doors: int,
          wheels: int,
          legs: int,
          floors: int,
          chimney: { type: 'boolean' },
          units: int,
        },
      },
    },
  },
};

/** User turn: current kit JSON + the score numbers the patch must raise. */
export function criticQuestion(
  kit: ObjectKit,
  score: { score: number; iou: number; edgeF1: number; deltaE: number }
): string {
  return (
    `Left is the photo of the selected object, right is our 3D model seen from the same view. ` +
    `Current kit: ${JSON.stringify(kit)}. ` +
    `Scores: ${score.score}/100 (silhouette IoU ${score.iou}, edge F1 ${score.edgeF1}, colour ΔE ${score.deltaE}). ` +
    `What differs (shape, sub-type, counts, proportions, colours of each part)? Answer only the JSON patch of the kit.`
  );
}

/**
 * Critic reply → kit patch, or null when it is not JSON or names nothing usable. Lenient like
 * `parseKit` (counts rounded and clamped, unknown values dropped), but strict where a patch must
 * be: bad colours are dropped, never greyed (grey would overwrite measured paint); `roof` is
 * always dropped (measured on the outline, never from the LLM); proportions need the full triple.
 */
export function parseKitPatch(content: string): Partial<ObjectKit> | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const patch: Partial<ObjectKit> = {};
  if (
    typeof o.archetype === 'string' &&
    (KIT_ARCHETYPES as readonly string[]).includes(o.archetype)
  ) {
    patch.archetype = o.archetype as KitArchetype;
  }
  const rawSubtype =
    typeof o.subtype === 'string'
      ? o.subtype
      : (o.details as Record<string, unknown> | undefined)?.subtype;
  if (typeof rawSubtype === 'string' && rawSubtype.trim()) {
    patch.subtype = rawSubtype
      .trim()
      .toLowerCase()
      .slice(0, 32)
      .replace(/[\s-]+/g, '_');
  }
  const pr = o.proportions as Record<string, unknown> | undefined;
  if (
    pr &&
    typeof pr.w === 'number' &&
    typeof pr.h === 'number' &&
    typeof pr.d === 'number' &&
    pr.w > 0 &&
    pr.h > 0 &&
    pr.d > 0
  ) {
    const max = Math.max(pr.w, pr.h, pr.d);
    patch.proportions = {
      w: clamp(pr.w / max, 0.01, 1),
      h: clamp(pr.h / max, 0.01, 1),
      d: clamp(pr.d / max, 0.01, 1),
    };
  }
  const co = o.colors as Record<string, unknown> | undefined;
  if (co) {
    const colors: Partial<ObjectKit['colors']> = {};
    for (const k of ['main', 'secondary', 'accent'] as const) {
      if (typeof co[k] === 'string' && HEX.test(co[k] as string)) colors[k] = co[k] as string;
    }
    if (Object.keys(colors).length > 0) patch.colors = colors as ObjectKit['colors'];
  }
  const ma = o.materials as Record<string, unknown> | undefined;
  if (ma) {
    const materials: NonNullable<ObjectKit['materials']> = {};
    for (const k of ['main', 'secondary', 'accent'] as const) {
      const m = RECIPE_MATERIALS.find((x) => x === ma[k]);
      if (m) materials[k] = m;
    }
    if (Object.keys(materials).length > 0) patch.materials = materials;
  }
  const de = o.details as Record<string, unknown> | undefined;
  if (de) {
    const details: NonNullable<ObjectKit['details']> = {};
    for (const [k, lim] of Object.entries(LIMITS) as Array<[keyof typeof LIMITS, number]>) {
      const v = de[k];
      if (typeof v === 'number' && Number.isFinite(v)) details[k] = clamp(Math.round(v), 0, lim);
    }
    if (de.chimney === true) details.chimney = true;
    if (Object.keys(details).length > 0) patch.details = details;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Patch over kit (per-key merge for the nested objects). Validated: a merged kit that fails the
 * schema keeps the original (a patch never corrupts the kit).
 */
export function mergeKitPatch(kit: ObjectKit, patch: Partial<ObjectKit>): ObjectKit {
  const merged = {
    ...kit,
    ...patch,
    ...(patch.proportions
      ? {
          proportions: clampEstimatedDepth(patch.archetype ?? kit.archetype, {
            ...kit.proportions,
            ...patch.proportions,
          }),
        }
      : {}),
    ...(patch.colors ? { colors: { ...kit.colors, ...patch.colors } } : {}),
    ...(patch.materials ? { materials: { ...kit.materials, ...patch.materials } } : {}),
    ...(patch.details ? { details: { ...kit.details, ...patch.details } } : {}),
  };
  const ok = ObjectKitSchema.safeParse(merged);
  return ok.success ? ok.data : kit;
}

/**
 * Spark reply → kit, or null when it is not JSON or misses the archetype / proportions.
 * Lenient: unknown archetype → `fallback`, proportions rescaled (largest = 1), bad colour → grey,
 * counts rounded and clamped, unknown details and materials dropped.
 */
export function parseKit(content: string, fallback: KitArchetype = 'other'): ObjectKit | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const reply = ReplySchema.safeParse(json);
  if (!reply.success) return null;
  const { w, h, d } = reply.data.proportions;
  const max = Math.max(w, h, d);
  if (!(max > 0)) return null;
  const archetype = KIT_ARCHETYPES.find((a) => a === reply.data.archetype) ?? fallback;
  const rawSubtype =
    typeof reply.data.subtype === 'string'
      ? reply.data.subtype
      : typeof reply.data.details?.subtype === 'string'
        ? reply.data.details.subtype
        : undefined;
  const subtype = rawSubtype
    ? rawSubtype
        .trim()
        .toLowerCase()
        .slice(0, 32)
        .replace(/[\s-]+/g, '_')
    : undefined;
  const pick = (k: string) => {
    const v = reply.data.colors?.[k];
    return typeof v === 'string' && HEX.test(v) ? v : NEUTRAL;
  };
  const details: NonNullable<ObjectKit['details']> = {};
  for (const [k, lim] of Object.entries(LIMITS) as Array<[keyof typeof LIMITS, number]>) {
    const v = reply.data.details?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) details[k] = clamp(Math.round(v), 0, lim);
  }
  if (reply.data.details?.chimney === true) details.chimney = true;
  if (reply.data.details?.plinth === true) details.plinth = true;
  if (reply.data.details?.timberFrame === true) details.timberFrame = true;
  const panes = reply.data.details?.panes;
  if (
    Array.isArray(panes) &&
    panes.length === 2 &&
    panes.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
    details.panes = [clamp(Math.round(panes[0]), 1, 6), clamp(Math.round(panes[1]), 1, 6)];
  const materials: NonNullable<ObjectKit['materials']> = {};
  for (const k of ['main', 'secondary', 'accent'] as const) {
    const v = reply.data.materials?.[k];
    const m = RECIPE_MATERIALS.find((x) => x === v);
    if (m) materials[k] = m;
  }
  const partMaterials: NonNullable<ObjectKit['partMaterials']> = {};
  for (const k of PART_MATERIAL_KEYS) {
    const m = RECIPE_MATERIALS.find((x) => x === reply.data.partMaterials?.[k]);
    if (m) partMaterials[k] = m;
  }
  const kit = ObjectKitSchema.safeParse({
    archetype,
    ...(subtype ? { subtype } : {}),
    // Spark only estimates the depth: keep it within the archetype's real size range (PT-8).
    proportions: clampEstimatedDepth(archetype, {
      w: clamp(w / max, 0.01, 1),
      h: clamp(h / max, 0.01, 1),
      d: clamp(d / max, 0.01, 1),
    }),
    colors: { main: pick('main'), secondary: pick('secondary'), accent: pick('accent') },
    ...(Object.keys(materials).length ? { materials } : {}),
    ...(Object.keys(partMaterials).length ? { partMaterials } : {}),
    ...(Object.keys(details).length ? { details } : {}),
  });
  return kit.success ? kit.data : null;
}

const body = (color: string): RecipePart => ({
  shape: 'box',
  at: [0, 0, 0],
  size: [1, 1, 1],
  color,
  front: true,
});

/** Offline recipes (mock mode), so the demo always shows a shaped object. Unknown category → a plain box. */
const MOCK_RECIPES: Partial<Record<ApplianceCategory, ObjectRecipe>> = {
  fridge: {
    proportions: { w: 0.5, h: 1, d: 0.5 },
    parts: [
      body('#e6e9ec'),
      { shape: 'box', at: [0.38, 0.12, 0.51], size: [0.04, 0.35, 0.04], color: '#8a939c' },
      { shape: 'box', at: [0, 0.18, 0.5], size: [0.98, 0.01, 0.02], color: '#b9c0c7' },
    ],
  },
  tv: {
    proportions: { w: 1, h: 0.62, d: 0.12 },
    parts: [
      { ...body('#1d2329'), at: [0, 0.08, 0], size: [1, 0.84, 0.4] },
      { shape: 'box', at: [0, -0.46, 0], size: [0.3, 0.08, 1], color: '#2b3239' },
    ],
  },
  fan: {
    proportions: { w: 0.45, h: 1, d: 0.35 },
    parts: [
      { ...body('#d8dde2'), shape: 'cylinder', axis: 'z', at: [0, 0.28, 0], size: [1, 0.45, 0.3] },
      { shape: 'cylinder', at: [0, -0.15, 0], size: [0.08, 0.45, 0.1], color: '#a7afb7' },
      { shape: 'cylinder', at: [0, -0.47, 0], size: [0.7, 0.06, 0.9], color: '#a7afb7' },
    ],
  },
  lamp: {
    proportions: { w: 0.4, h: 1, d: 0.4 },
    parts: [
      { ...body('#f2d27a'), shape: 'cone', at: [0, 0.32, 0], size: [1, 0.35, 1] },
      { shape: 'cylinder', at: [0, -0.1, 0], size: [0.08, 0.6, 0.08], color: '#6f7780' },
      { shape: 'cylinder', at: [0, -0.46, 0], size: [0.6, 0.08, 0.6], color: '#6f7780' },
    ],
  },
};

const part = (
  shape: RecipePart['shape'],
  at: RecipePart['at'],
  size: RecipePart['size'],
  color: string,
  axis?: RecipePart['axis'],
  apex?: number
): RecipePart => ({
  shape,
  at,
  size,
  color,
  ...(axis ? { axis } : {}),
  ...(apex !== undefined ? { apex } : {}),
});

/** Offline recipes for scenery (no load), so houses, trees or cars also show in 3D. */
const MOCK_SCENERY: Partial<Record<SceneryType, ObjectRecipe>> = {
  building: {
    proportions: { w: 1, h: 0.75, d: 0.8 },
    parts: [
      { ...body('#c9b79c'), at: [0, -0.15, 0], size: [1, 0.7, 1] },
      part('box', [0, 0.32, 0], [1, 0.25, 1], '#8a5a44'),
      part('box', [-0.2, -0.3, 0.5], [0.16, 0.38, 0.02], '#5b3b2a'),
      part('box', [0.22, -0.12, 0.5], [0.18, 0.16, 0.02], '#9cc3d5'),
    ],
  },
  tree: {
    proportions: { w: 0.7, h: 1, d: 0.7 },
    parts: [
      { ...body('#4f8a4b'), shape: 'sphere', at: [0, 0.18, 0], size: [1, 0.64, 1] },
      part('cylinder', [0, -0.3, 0], [0.14, 0.4, 0.14], '#6b4a32'),
    ],
  },
  plant: {
    proportions: { w: 0.6, h: 1, d: 0.6 },
    parts: [
      { ...body('#5c9b55'), shape: 'sphere', at: [0, 0.15, 0], size: [1, 0.7, 1] },
      part('cylinder', [0, -0.35, 0], [0.6, 0.3, 0.6], '#a0603d'),
    ],
  },
  vehicle: {
    proportions: { w: 1, h: 0.45, d: 0.45 },
    parts: [
      { ...body('#3f6fa8'), at: [0, -0.08, 0], size: [1.0, 0.42, 0.9] },
      part('box', [-0.04, 0.29, 0], [0.52, 0.32, 0.82], '#2f5585'),
      part('prism', [0.29, 0.29, 0], [0.14, 0.32, 0.82], '#7ea8cf', undefined, 0),
      part('prism', [-0.36, 0.29, 0], [0.12, 0.32, 0.82], '#7ea8cf', undefined, 1),
      part('box', [0.5, -0.2, 0], [0.04, 0.12, 0.88], '#222831'),
      part('box', [-0.5, -0.2, 0], [0.04, 0.12, 0.88], '#222831'),
      part('cylinder', [0.3, -0.38, 0.44], [0.24, 0.24, 0.14], '#222831', 'z'),
      part('cylinder', [0.3, -0.38, -0.44], [0.24, 0.24, 0.14], '#222831', 'z'),
      part('cylinder', [-0.3, -0.38, 0.44], [0.24, 0.24, 0.14], '#222831', 'z'),
      part('cylinder', [-0.3, -0.38, -0.44], [0.24, 0.24, 0.14], '#222831', 'z'),
      part('cylinder', [0.49, 0.02, 0.28], [0.03, 0.09, 0.09], '#f0eed8', 'x'),
      part('cylinder', [0.49, 0.02, -0.28], [0.03, 0.09, 0.09], '#f0eed8', 'x'),
    ],
  },
  person: {
    proportions: { w: 0.35, h: 1, d: 0.25 },
    parts: [
      { ...body('#4f6d8f'), shape: 'cylinder', at: [0, -0.12, 0], size: [0.8, 0.75, 0.8] },
      part('sphere', [0, 0.38, 0], [0.55, 0.22, 0.75], '#c99a73'),
    ],
  },
  animal: {
    proportions: { w: 1, h: 0.6, d: 0.4 },
    parts: [
      { ...body('#8b6b4a'), at: [0, 0.05, 0], size: [0.75, 0.45, 1] },
      part('box', [0.42, 0.28, 0], [0.22, 0.3, 0.6], '#7a5c3f'),
      part('cylinder', [-0.28, -0.32, 0], [0.1, 0.36, 0.2], '#6b4f36'),
      part('cylinder', [0.25, -0.32, 0], [0.1, 0.36, 0.2], '#6b4f36'),
    ],
  },
  water: {
    proportions: { w: 1, h: 0.08, d: 0.7 },
    parts: [{ ...body('#4c8fb8'), shape: 'cylinder' }],
  },
};

export function mockRecipe(category: ApplianceCategory, scenery?: SceneryType): ObjectRecipe {
  return (
    (scenery ? MOCK_SCENERY[scenery] : MOCK_RECIPES[category]) ?? {
      proportions: { w: 1, h: 1, d: 0.6 },
      parts: [body(NEUTRAL)],
    }
  );
}
