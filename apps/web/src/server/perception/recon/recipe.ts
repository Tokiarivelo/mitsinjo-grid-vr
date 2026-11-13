import {
  EXTRUDE_POINTS_MAX,
  MIN_EXTENT,
  ObjectRecipeSchema,
  RECIPE_BOUND,
  type ObjectRecipe,
  type RecipeMaterial,
  type RecipePart,
} from '@/lib/object-shape';
import { simplifyRing } from '../mask-outline';
import type { Solid } from './carve';
import type { Palette } from './palette';
import type { Span } from './pieces';

/**
 * Solids → the recipe the 3D view draws (PQ-T69). A hull solid keeps its two outlines (front
 * ring, side ring) so slopes and curves survive; boxes and discs stay primitives (12 and a few
 * dozen triangles). Pure.
 */

/** Outline simplification, in cells: a one-cell staircase becomes the slope it samples. */
export const RING_TOLERANCE = 0.75;

type Pt = readonly [number, number];
const SQUARE: Array<[number, number]> = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

/** Outline of a span read as rows → columns: points (column edge, row edge), y down. */
export function rowsPolygon(span: Span): Pt[] {
  const out: Pt[] = [];
  const n = span.lo.length;
  for (let i = 0; i < n; i++)
    out.push([span.hi[i]! + 1, span.start + i], [span.hi[i]! + 1, span.start + i + 1]);
  for (let i = n - 1; i >= 0; i--)
    out.push([span.lo[i]!, span.start + i + 1], [span.lo[i]!, span.start + i]);
  return out;
}

/** Outline of a span read as columns → rows: points (column edge, row edge), y down. */
export function colsPolygon(span: Span): Pt[] {
  const out: Pt[] = [];
  const n = span.lo.length;
  for (let k = 0; k < n; k++)
    out.push([span.start + k, span.lo[k]!], [span.start + k + 1, span.lo[k]!]);
  for (let k = n - 1; k >= 0; k--)
    out.push([span.start + k + 1, span.hi[k]! + 1], [span.start + k, span.hi[k]! + 1]);
  return out;
}

/**
 * A cell-space outline as a unit ring (±0.5, y up) inside the box [a0, a1] × [y0, y1]: repeated
 * points dropped, simplified until it fits the schema's point budget. A ring that collapses
 * (fewer than 3 points) becomes the full square.
 */
export function unitRing(
  polygon: readonly Pt[],
  a0: number,
  a1: number,
  y0: number,
  y1: number
): Array<[number, number]> {
  const distinct = polygon.filter((p, i) => {
    const q = polygon[(i + polygon.length - 1) % polygon.length]!;
    return p[0] !== q[0] || p[1] !== q[1];
  });
  let ring = simplifyRing(distinct, RING_TOLERANCE);
  for (let t = RING_TOLERANCE * 1.5; ring.length > EXTRUDE_POINTS_MAX; t *= 1.5)
    ring = simplifyRing(distinct, t);
  if (ring.length < 3) return SQUARE.map((p) => [...p] as [number, number]);
  const clamp = (v: number) => Math.max(-0.5, Math.min(0.5, v));
  const [w, h] = [Math.max(1e-6, a1 - a0), Math.max(1e-6, y1 - y0)];
  return ring.map(([a, y]) => [clamp((a - a0) / w - 0.5), clamp(0.5 - (y - y0) / h)]);
}

const STATUS = { volume: 'measured', fill: 'inferred', detail: 'measured' } as const;

/** The solids as recipe parts, same order (part i = solid i). */
export function solidsToRecipe(
  solids: readonly Solid[],
  palette: Palette,
  dims: { W: number; H: number; D: number },
  materials: ReadonlyArray<RecipeMaterial | undefined> = []
): ObjectRecipe {
  const { W, H, D } = dims;
  const max = Math.max(W, H, D);
  const bound = (v: number) => Math.max(-RECIPE_BOUND, Math.min(RECIPE_BOUND, v));
  const extent = (v: number) => Math.max(MIN_EXTENT, Math.min(1, v));
  // The main body: the solid the views see most (it gets the fine hull mesh).
  const main = solids.reduce(
    (best, s, i) => (s.role !== 'detail' && s.visible > (solids[best]?.visible ?? -1) ? i : best),
    0
  );
  const parts = solids.map((s, i): RecipePart => {
    const b = s.box;
    const material = materials[s.cls];
    const part: RecipePart = {
      shape: s.shape,
      at: [
        bound((b.x0 + b.x1) / 2 / W - 0.5),
        bound(0.5 - (b.y0 + b.y1) / 2 / H),
        bound((b.z0 + b.z1) / 2 / D - 0.5),
      ],
      size: [extent((b.x1 - b.x0) / W), extent((b.y1 - b.y0) / H), extent((b.z1 - b.z0) / D)],
      color: palette.classes[s.cls]!.hex,
      status: STATUS[s.role],
      ...(material ? { material } : {}),
      ...(s.axis ? { axis: s.axis } : {}),
      ...(i === main ? { front: true } : {}),
    };
    if (s.shape !== 'hull') return part;
    return {
      ...part,
      points: s.front
        ? unitRing(rowsPolygon(s.front), b.x0, b.x1, b.y0, b.y1)
        : SQUARE.map((p) => [...p] as [number, number]),
      section: s.side
        ? unitRing(colsPolygon(s.side), b.z0, b.z1, b.y0, b.y1)
        : s.profile
          ? unitRing(rowsPolygon(s.profile), b.z0, b.z1, b.y0, b.y1)
          : SQUARE.map((p) => [...p] as [number, number]),
    };
  });
  return ObjectRecipeSchema.parse({
    proportions: { w: extent(W / max), h: extent(H / max), d: extent(D / max) },
    parts,
    source: 'views',
    // Width, height and depth are read on the drawings; the metric scale is not.
    dimStatus: { depth: 'measured', scale: 'estimated' },
  });
}

/**
 * A front drawn from a hidden object (PQ-T23) is imagined where the photo shows nothing: every
 * part read on it is `inferred`, never `measured`, except the main body. Pure.
 */
export function markDrawnInferred(recipe: ObjectRecipe): ObjectRecipe {
  return {
    ...recipe,
    parts: recipe.parts.map((p) =>
      p.status === 'measured' && !p.front ? { ...p, status: 'inferred' as const } : p
    ),
  };
}
