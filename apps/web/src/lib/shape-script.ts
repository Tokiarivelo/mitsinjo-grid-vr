import { z } from 'zod';
import {
  MAX_COMPONENTS,
  MAX_DOOR_GLAZED,
  MAX_DOOR_PANELS,
  MAX_PANES,
  HIP_CLIP_MAX,
  MAX_ROOF_BULGE,
  ObjectRecipeSchema,
  RECIPE_BOUND,
  RecipeMaterialSchema,
  RecipePartSchema,
  DetailKindSchema,
  DETAIL_KINDS,
  BranchParamsSchema,
  DrapeParamsSchema,
  PartKindSchema,
  ScatterParamsSchema,
  SweepParamsSchema,
  type GeneratorParams,
  type ObjectRecipe,
  type PartKind,
  type RecipePart,
} from './object-shape';
import { growPart } from './object-generators';

/**
 * ShapeScript (PG-T13): a model written as a list of typed ops on named components, never code.
 * Spark answers ops (Zod-checked), the pure `compileScript` builds the recipe. Each op names one
 * component, so a bad op is dropped and reported and the others apply. Units are the recipe's:
 * fractions of the object's width / height / depth, centred; face anchors `u`, `v` are 0–1 across
 * the parent face (u left → right seen from outside, v ground → top). Constraints from the object
 * graph (PR-2.14): an opening stays inside its wall face, a chimney stands on the roof.
 */

/** Component name: lower-case, digits, `_ . -`, ≤ 32 characters (`wall`, `window.2`). */
export const ComponentIdSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,31}$/);
export type ComponentId = z.infer<typeof ComponentIdSchema>;

export const FACES = ['front', 'back', 'left', 'right', 'top'] as const;
export type Face = (typeof FACES)[number];
export const WALL_FACES = ['front', 'back', 'left', 'right'] as const;

/** Most copies one `repeat` makes (the original included). */
export const MAX_REPEAT = 8;
/** Thickness of an opening cut by `cut`, share of the wall-normal dimension. */
export const CUT_THICKNESS = 0.015;
/** Default colours of a cut window / door (data colours of the model, not UI tokens). */
export const CUT_GLASS = '#2b3440';
export const CUT_DOOR = '#6b4a2f';

const share = z.number().min(0).max(1);
const coord = z.number().min(-RECIPE_BOUND).max(RECIPE_BOUND);
const extent = z.number().min(0.01).max(1);
const vec = z.tuple([coord, coord, coord]);
const size = z.tuple([extent, extent, extent]);

/** Fields any op may change on a component (assembly options included, PG-T10). */
const options = {
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  material: RecipeMaterialSchema.optional(),
  grid: z
    .tuple([z.number().int().min(1).max(MAX_PANES), z.number().int().min(1).max(MAX_PANES)])
    .optional(),
  leaves: z.number().int().min(1).max(2).optional(),
  glazed: z.number().min(0).max(MAX_DOOR_GLAZED).optional(),
  panels: z.number().int().min(0).max(MAX_DOOR_PANELS).optional(),
  sill: z.boolean().optional(),
  lintel: z.boolean().optional(),
  cap: z.boolean().optional(),
  bulge: z.number().min(0).max(MAX_ROOF_BULGE).optional(),
  ridge: share.optional(),
  clip: z.number().min(0).max(HIP_CLIP_MAX).optional(),
  apex: share.optional(),
  details: z.array(DetailKindSchema).max(DETAIL_KINDS.length).optional(),
};

/**
 * A grown component (PQ-T50 §7.3): the op carries generator params plus the host's look; compile
 * grows once and bounds the host box by what grew. One colour slot: the op's `color` paints host
 * and growth (sweep / branch / drape params keep their own optional override for direct
 * `generator` fields; scatter always uses its palette).
 */
const grownOp = (params: z.ZodRawShape, op: 'sweep' | 'branch' | 'scatter' | 'drape') =>
  z.object({
    op: z.literal(op),
    ...params,
    id: ComponentIdSchema,
    parent: ComponentIdSchema.optional(),
    kind: PartKindSchema.optional(),
    // Required here (the params' own colour stays optional): the host box never guesses.
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    material: RecipeMaterialSchema.optional(),
  });

export const ShapeOpSchema = z.discriminatedUnion('op', [
  /** New component: a full recipe part (server seeds may carry rings; Spark sends boxes). */
  z.object({
    op: z.literal('add'),
    id: ComponentIdSchema,
    part: RecipePartSchema,
    parent: ComponentIdSchema.optional(),
  }),
  grownOp(SweepParamsSchema.omit({ op: true }).shape, 'sweep'),
  grownOp(BranchParamsSchema.omit({ op: true }).shape, 'branch'),
  grownOp(ScatterParamsSchema.omit({ op: true }).shape, 'scatter'),
  grownOp(DrapeParamsSchema.omit({ op: true }).shape, 'drape'),
  /** Change fields of an existing component. */
  z.object({
    op: z.literal('set'),
    id: ComponentIdSchema,
    at: vec.optional(),
    size: size.optional(),
    ...options,
  }),
  z.object({ op: z.literal('remove'), id: ComponentIdSchema }),
  /** Move a component onto a face of its parent, centred at (u, v) of that face. */
  z.object({
    op: z.literal('attach'),
    id: ComponentIdSchema,
    parent: ComponentIdSchema,
    face: z.enum(FACES),
    u: share,
    v: share,
  }),
  /** Opening in a wall face: centre (u, v), size (w, h) as shares of that face. */
  z.object({
    op: z.literal('cut'),
    id: ComponentIdSchema,
    wall: ComponentIdSchema,
    kind: z.enum(['window', 'door']),
    face: z.enum(WALL_FACES).default('front'),
    u: share,
    v: share,
    w: z.number().min(0.01).max(1),
    h: z.number().min(0.01).max(1),
    ...options,
  }),
  /** `count` copies (original included) `step` apart along `axis`: ids `id.2` … `id.n`. */
  z.object({
    op: z.literal('repeat'),
    id: ComponentIdSchema,
    count: z.number().int().min(2).max(MAX_REPEAT),
    axis: z.enum(['x', 'y', 'z']),
    step: z.number().min(-1).max(1),
  }),
  z.object({
    op: z.literal('material'),
    id: ComponentIdSchema,
    material: RecipeMaterialSchema,
    color: options.color,
  }),
]);
export type ShapeOp = z.infer<typeof ShapeOpSchema>;

export const ShapeScriptSchema = z.object({
  proportions: ObjectRecipeSchema.shape.proportions,
  ops: z.array(z.unknown()).max(256),
  source: ObjectRecipeSchema.shape.source,
  yaw: ObjectRecipeSchema.shape.yaw,
});
export type ShapeScript = Omit<z.infer<typeof ShapeScriptSchema>, 'ops'> & {
  ops: ReadonlyArray<ShapeOp | unknown>;
};

/** One component of a compiled script. */
export interface Component {
  id: ComponentId;
  part: RecipePart;
  parent?: ComponentId;
}

export type OpIssueReason =
  | 'invalid'
  | 'unknown_id'
  | 'duplicate_id'
  | 'unknown_parent'
  | 'locked'
  | 'budget'
  | 'out_of_bounds'
  | 'not_a_wall';

export interface OpIssue {
  index: number;
  reason: OpIssueReason;
  id?: string;
}

export interface CompileResult {
  /** Null when no component is left (or the result fails the recipe schema). */
  recipe: ObjectRecipe | null;
  components: Component[];
  /** Dropped ops, in order. */
  dropped: OpIssue[];
  /** Components moved by a constraint (opening into its wall, chimney onto the roof). */
  adjusted: ComponentId[];
}

export interface CompileOptions {
  /** Components no op may touch (accepted stages, PG-T16). */
  locked?: ReadonlySet<string>;
  /** Locks apply from this op index on (the seed ops before it build the locked parts). */
  lockedFrom?: number;
}

const AXIS = { x: 0, y: 1, z: 2 } as const;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const EPS = 1e-6;

/** Face geometry of a box: normal axis, its sign, and the two in-face axes (u, v). */
function faceAxes(face: Face): { n: 0 | 1 | 2; sign: 1 | -1; u: 0 | 2; uSign: 1 | -1 } {
  switch (face) {
    case 'front':
      return { n: 2, sign: 1, u: 0, uSign: 1 };
    case 'back':
      return { n: 2, sign: -1, u: 0, uSign: -1 };
    case 'right':
      return { n: 0, sign: 1, u: 2, uSign: -1 };
    case 'left':
      return { n: 0, sign: -1, u: 2, uSign: 1 };
    case 'top':
      return { n: 1, sign: 1, u: 0, uSign: 1 };
  }
}

/** Centre (recipe units) of the point (u, v) on a face of `parent`, plus the normal axis. */
function facePoint(parent: RecipePart, face: Face, u: number, v: number) {
  const ax = faceAxes(face);
  const at = [...parent.at] as [number, number, number];
  at[ax.n] = parent.at[ax.n] + (ax.sign * parent.size[ax.n]) / 2;
  at[ax.u] = parent.at[ax.u] + ax.uSign * (u - 0.5) * parent.size[ax.u];
  // v runs up a wall face, front → back across the top face.
  const vAxis = face === 'top' ? 2 : 1;
  const vSign = face === 'top' ? -1 : 1;
  at[vAxis] = parent.at[vAxis] + vSign * (v - 0.5) * parent.size[vAxis];
  return { at, ax };
}

const isOpening = (p: RecipePart) => p.kind === 'window' || p.kind === 'door';
const isWall = (p: RecipePart) => p.shape === 'box' && (p.kind === 'wall' || !!p.front);

/** Strips `undefined` so optional fields stay absent (recipe parts never hold `undefined`). */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Builds the recipe from a script. Pure and total: every op is checked on its own, a bad one is
 * dropped with its reason and the rest apply; it never throws.
 */
export function compileScript(script: ShapeScript, opts: CompileOptions = {}): CompileResult {
  const comps = new Map<ComponentId, Component>();
  const dropped: OpIssue[] = [];
  const locked = opts.locked ?? new Set<string>();
  const drop = (index: number, reason: OpIssueReason, id?: string) =>
    dropped.push({ index, reason, ...(id ? { id } : {}) });
  /** Validated replacement of a component's part, or null when it breaks the schema. */
  const checked = (part: RecipePart): RecipePart | null => {
    const r = RecipePartSchema.safeParse(part);
    return r.success ? r.data : null;
  };

  script.ops.forEach((raw, index) => {
    const parsed = ShapeOpSchema.safeParse(raw);
    if (!parsed.success) {
      const id =
        raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string'
          ? (raw as { id: string }).id
          : undefined;
      drop(index, 'invalid', id);
      return;
    }
    const op = parsed.data;
    const guarded = index >= (opts.lockedFrom ?? 0);
    if (guarded && locked.has(op.id)) return drop(index, 'locked', op.id);
    const cur = comps.get(op.id);
    switch (op.op) {
      case 'add': {
        if (cur) return drop(index, 'duplicate_id', op.id);
        if (comps.size >= MAX_COMPONENTS) return drop(index, 'budget', op.id);
        if (op.parent && !comps.has(op.parent)) return drop(index, 'unknown_parent', op.id);
        const part = checked(op.part);
        if (!part) return drop(index, 'out_of_bounds', op.id);
        comps.set(op.id, { id: op.id, part, ...(op.parent ? { parent: op.parent } : {}) });
        return;
      }
      case 'remove': {
        if (!cur) return drop(index, 'unknown_id', op.id);
        // Removing a parent would orphan locked children: refuse.
        const children = [...comps.values()].filter((c) => c.parent === op.id);
        if (guarded && children.some((c) => locked.has(c.id))) return drop(index, 'locked', op.id);
        comps.delete(op.id);
        for (const c of children) comps.delete(c.id);
        return;
      }
      case 'set':
      case 'material': {
        if (!cur) return drop(index, 'unknown_id', op.id);
        const fields = defined({ ...op, op: undefined, id: undefined });
        const part = checked({ ...cur.part, ...fields } as RecipePart);
        if (!part) return drop(index, 'out_of_bounds', op.id);
        comps.set(op.id, { ...cur, part });
        return;
      }
      case 'attach': {
        if (!cur) return drop(index, 'unknown_id', op.id);
        const parent = comps.get(op.parent);
        if (!parent || op.parent === op.id) return drop(index, 'unknown_parent', op.id);
        const { at, ax } = facePoint(parent.part, op.face, op.u, op.v);
        // Sits on the face: its own half size outward along the normal.
        at[ax.n] += (ax.sign * cur.part.size[ax.n]) / 2;
        const part = checked({ ...cur.part, at });
        if (!part) return drop(index, 'out_of_bounds', op.id);
        comps.set(op.id, { ...cur, part, parent: op.parent });
        return;
      }
      case 'cut': {
        if (cur) return drop(index, 'duplicate_id', op.id);
        if (comps.size >= MAX_COMPONENTS) return drop(index, 'budget', op.id);
        const wall = comps.get(op.wall);
        if (!wall) return drop(index, 'unknown_parent', op.id);
        if (!isWall(wall.part)) return drop(index, 'not_a_wall', op.id);
        const { at, ax } = facePoint(wall.part, op.face, op.u, op.v);
        const s = [0, 0, 0] as [number, number, number];
        s[ax.u] = op.w * wall.part.size[ax.u];
        s[1] = op.h * wall.part.size[1];
        s[ax.n] = CUT_THICKNESS;
        at[ax.n] += (ax.sign * CUT_THICKNESS) / 2;
        const kind = op.kind;
        // Assembly options only (placement fields are consumed above).
        const rest = defined({
          ...op,
          op: undefined,
          id: undefined,
          wall: undefined,
          kind: undefined,
          face: undefined,
          u: undefined,
          v: undefined,
          w: undefined,
          h: undefined,
          color: undefined,
          material: undefined,
        });
        const part = checked({
          shape: 'box',
          at,
          size: s,
          kind,
          color: op.color ?? (kind === 'window' ? CUT_GLASS : CUT_DOOR),
          material: op.material ?? (kind === 'window' ? 'glass' : 'wood'),
          ...rest,
        } as RecipePart);
        if (!part) return drop(index, 'out_of_bounds', op.id);
        comps.set(op.id, { id: op.id, part, parent: op.wall });
        return;
      }
      case 'sweep':
      case 'branch':
      case 'scatter':
      case 'drape': {
        if (cur) return drop(index, 'duplicate_id', op.id);
        if (comps.size >= MAX_COMPONENTS) return drop(index, 'budget', op.id);
        if (op.parent && !comps.has(op.parent)) return drop(index, 'unknown_parent', op.id);
        const { op: opName, id: _id, parent: _parent, kind, color, material, ...rest } = op;
        const params = { op: opName, ...rest } as GeneratorParams;
        // Grow once against a dummy host: the host box is measured, never proposed, so a
        // lying box is not expressible; growth past the recipe frame fails the schema below.
        const grown = growPart({
          shape: 'box',
          at: [0, 0, 0],
          size: [RECIPE_BOUND * 2, RECIPE_BOUND * 2, RECIPE_BOUND * 2],
          color,
          generator: params,
        });
        if (!grown.length) return drop(index, 'invalid', op.id);
        const lo: [number, number, number] = [Infinity, Infinity, Infinity];
        const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        for (const q of grown) {
          for (const a of [0, 1, 2] as const) {
            lo[a] = Math.min(lo[a], q.at[a] - q.size[a] / 2);
            hi[a] = Math.max(hi[a], q.at[a] + q.size[a] / 2);
          }
        }
        const part = checked(
          defined({
            shape: 'box',
            at: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
            size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
            color,
            material,
            kind,
            generator: params,
          }) as RecipePart
        );
        if (!part) return drop(index, 'out_of_bounds', op.id);
        comps.set(op.id, { id: op.id, part, ...(op.parent ? { parent: op.parent } : {}) });
        return;
      }
      case 'repeat': {
        if (!cur) return drop(index, 'unknown_id', op.id);
        const a = AXIS[op.axis];
        const copies: Component[] = [];
        for (let k = 2; k <= op.count; k++) {
          const id = `${op.id}.${k}`;
          if (comps.has(id) || !ComponentIdSchema.safeParse(id).success)
            return drop(index, 'duplicate_id', id);
          const at = [...cur.part.at] as [number, number, number];
          at[a] += (k - 1) * op.step;
          const part = checked({ ...cur.part, at });
          if (!part) return drop(index, 'out_of_bounds', id);
          copies.push({ ...cur, id, part });
        }
        if (comps.size + copies.length > MAX_COMPONENTS) return drop(index, 'budget', op.id);
        for (const c of copies) comps.set(c.id, c);
        return;
      }
    }
  });

  const adjusted: ComponentId[] = [];
  const list = [...comps.values()].map((c) => {
    const q = constrain(c, comps);
    if (q !== c.part) adjusted.push(c.id);
    return { ...c, part: q };
  });
  if (!list.length) return { recipe: null, components: [], dropped, adjusted };
  const recipe = ObjectRecipeSchema.safeParse({
    proportions: script.proportions,
    parts: list.map((c) => c.part),
    ...defined({ source: script.source, yaw: script.yaw }),
  });
  return {
    recipe: recipe.success ? recipe.data : null,
    components: list,
    dropped,
    adjusted,
  };
}

/** The roof part a chimney stands on: the first `roof` component. */
const roofOf = (comps: Map<ComponentId, Component>) =>
  [...comps.values()].find((c) => c.part.kind === 'roof')?.part;

/**
 * Graph constraints (PR-2.14) on one component; returns the same part when it already holds.
 * Opening: clamped inside its parent wall's face span. Chimney: foot inside the roof's height,
 * centre inside its footprint.
 */
function constrain(c: Component, comps: Map<ComponentId, Component>): RecipePart {
  const p = c.part;
  if (isOpening(p) && c.parent) {
    const wall = comps.get(c.parent)?.part;
    if (!wall) return p;
    const at = [...p.at] as [number, number, number];
    const size = [...p.size] as [number, number, number];
    // Normal = the thin axis of the opening; clamp along the two in-face axes.
    const n = p.size[0] < p.size[2] ? 0 : 2;
    let moved = false;
    for (const i of [n === 0 ? 2 : 0, 1]) {
      const half = wall.size[i]! / 2;
      size[i] = Math.min(size[i]!, wall.size[i]!);
      const lo = wall.at[i]! - half + size[i]! / 2;
      const hi = wall.at[i]! + half - size[i]! / 2;
      const v = clamp(at[i]!, lo, hi);
      if (Math.abs(v - at[i]!) > EPS || size[i] !== p.size[i]) moved = true;
      at[i] = v;
    }
    return moved ? { ...p, at, size } : p;
  }
  if (p.kind === 'chimney') {
    const roof = roofOf(comps);
    if (!roof) return p;
    const at = [...p.at] as [number, number, number];
    const roofLo = roof.at[1] - roof.size[1] / 2;
    const roofHi = roof.at[1] + roof.size[1] / 2;
    const foot = at[1] - p.size[1] / 2;
    const footOk = clamp(foot, roofLo, roofHi - EPS);
    at[1] += footOk - foot;
    for (const i of [0, 2]) {
      const half = roof.size[i]! / 2;
      at[i] = clamp(at[i]!, roof.at[i]! - half, roof.at[i]! + half);
    }
    return at.some((v, i) => Math.abs(v - p.at[i]!) > EPS) ? { ...p, at } : p;
  }
  return p;
}

/** Component name of a part: its kind (or shape), numbered from the second one (`window.2`). */
function baseName(p: RecipePart): string {
  return p.kind ?? (p.front ? 'body' : p.shape);
}

/**
 * Today's recipe as a script (PG-T14): one `add` per part, named by kind, openings and chimneys
 * parented to the wall / body they belong to. `compileScript(recipeToScript(r))` gives back `r`'s
 * parts, so the staged loop starts from the current builder's result (its floor).
 */
export function recipeToScript(recipe: ObjectRecipe): ShapeScript {
  const seen = new Map<string, number>();
  const ids = recipe.parts.map((p) => {
    const base = baseName(p);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}.${n}`;
  });
  const wallIdx = recipe.parts.findIndex(isWall);
  const ops: ShapeOp[] = recipe.parts.map((part, i) => ({
    op: 'add',
    id: ids[i]!,
    part,
    ...(isOpening(part) && wallIdx >= 0 && wallIdx < i && onWall(part, recipe.parts[wallIdx]!)
      ? { parent: ids[wallIdx]! }
      : {}),
  }));
  return {
    proportions: recipe.proportions,
    ops,
    ...defined({ source: recipe.source, yaw: recipe.yaw }),
  };
}

/** Whether an opening already lies inside the wall's face span (so parenting moves nothing). */
function onWall(p: RecipePart, wall: RecipePart): boolean {
  const n = p.size[0] < p.size[2] ? 0 : 2;
  return [n === 0 ? 2 : 0, 1].every(
    (i) =>
      p.size[i]! <= wall.size[i]! + EPS &&
      Math.abs(p.at[i]! - wall.at[i]!) + p.size[i]! / 2 <= wall.size[i]! / 2 + EPS
  );
}

/** Component ids of a compiled script with the given part kinds (a stage's editable set). */
export function componentsOfKind(
  components: ReadonlyArray<Component>,
  kinds: ReadonlyArray<PartKind>
): ComponentId[] {
  return components.filter((c) => c.part.kind && kinds.includes(c.part.kind)).map((c) => c.id);
}
