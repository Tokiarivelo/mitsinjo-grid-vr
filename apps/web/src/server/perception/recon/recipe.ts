import {
  EXTRUDE_POINTS_MAX,
  MAX_VIEW_PARTS,
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

/** Ridge length of a pitched roof, share of its width: the measured value is kept in this range. */
/** Row of the roof where its ridge length is read, share of its height from the top. */
export const RIDGE_ROW = 0.15;
export const RIDGE_RANGE: readonly [number, number] = [0.2, 0.9];

const STATUS = { volume: 'measured', detail: 'measured' } as const;

/** The solids as recipe parts, and the colour class of each part (`classOf[i]` for part i). */
export function solidsToRecipe(
  solids: readonly Solid[],
  palette: Palette,
  dims: { W: number; H: number; D: number },
  materials: ReadonlyArray<RecipeMaterial | undefined> = []
): { recipe: ObjectRecipe; classOf: number[] } {
  const { W, H, D } = dims;
  const max = Math.max(W, H, D);
  const bound = (v: number) => Math.max(-RECIPE_BOUND, Math.min(RECIPE_BOUND, v));
  const extent = (v: number) => Math.max(MIN_EXTENT, Math.min(1, v));
  // The main body: the solid the views see most (it gets the fine hull mesh).
  const main = solids.reduce(
    (best, s, i) => (s.role !== 'detail' && s.visible > (solids[best]?.visible ?? -1) ? i : best),
    0
  );
  /**
   * The pitched roof: the bodies the solver marked are one roof rising to a ridge along the width.
   * The ridge length is read on the front drawing (a row near the top / widest row of the widest of them).
   */
  const roofing = solids.flatMap((s, i) => (s.role === 'volume' && s.roof ? [i] : []));
  let roof: { keep: number; box: Solid['box']; ridge: number } | null = null;
  if (roofing.length) {
    const boxes = roofing.map((i) => solids[i]!.box);
    const box = {
      x0: Math.min(...boxes.map((b) => b.x0)),
      x1: Math.max(...boxes.map((b) => b.x1)),
      y0: Math.min(...boxes.map((b) => b.y0)),
      y1: Math.max(...boxes.map((b) => b.y1)),
      z0: Math.min(...boxes.map((b) => b.z0)),
      z1: Math.max(...boxes.map((b) => b.z1)),
    };
    const keep = roofing.reduce((best, i) =>
      solids[i]!.box.x1 - solids[i]!.box.x0 > solids[best]!.box.x1 - solids[best]!.box.x0 ? i : best
    );
    const front = solids[keep]!.front!;
    const widths = front.lo.map((lo, r) => front.hi[r]! - lo + 1);
    // Read a little under the top: the first rows may be a chimney foot or a ridge cap.
    const top = widths[Math.floor(widths.length * RIDGE_ROW)]!;
    const ridge = Math.max(RIDGE_RANGE[0], Math.min(RIDGE_RANGE[1], top / Math.max(...widths)));
    roof = { keep, box, ridge };
  }
  const inRoof = (i: number | undefined) => roof !== null && i !== undefined && roofing.includes(i);
  const classOf: number[] = [];
  const parts = solids.flatMap((s, i): RecipePart[] => {
    // The roofing bodies are one roof: the widest carries it, the others are in it.
    if (inRoof(i) && i !== roof!.keep) return [];
    classOf.push(s.cls);
    let b = s.box;
    if (roof && i === roof.keep) b = roof.box;
    else if (roof && s.roof && s.role === 'detail') {
      // A gable runs back to the ridge.
      const cz = (roof.box.z0 + roof.box.z1) / 2;
      b = s.face === 'front' ? { ...b, z0: Math.min(b.z0, cz) } : { ...b, z1: Math.max(b.z1, cz) };
    }
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
    if (roof && i === roof.keep)
      return [{ ...part, shape: 'hip', ridge: roof.ridge, status: 'inferred' }];
    if (roof && s.roof && s.role === 'detail' && s.front) {
      // A gable: a roof-coloured prism from the face back to the ridge, and the drawn face on it.
      const apex = ((s.front.lo[0]! + s.front.hi[0]! + 1) / 2 - b.x0) / Math.max(1, b.x1 - b.x0);
      const top = solids[roof.keep]!;
      const topMaterial = materials[top.cls];
      classOf.push(s.cls);
      classOf[classOf.length - 2] = top.cls;
      const f = s.box;
      return [
        {
          ...part,
          shape: 'prism',
          apex: Math.max(0, Math.min(1, apex)),
          color: palette.classes[top.cls]!.hex,
          status: 'inferred',
          material: topMaterial,
        },
        {
          ...part,
          shape: 'extrude',
          at: [part.at[0], part.at[1], bound((f.z0 + f.z1) / 2 / D - 0.5)],
          size: [part.size[0], part.size[1], extent((f.z1 - f.z0) / D)],
          points: unitRing(rowsPolygon(s.front), f.x0, f.x1, f.y0, f.y1),
        },
      ];
    }
    if (s.shape === 'extrude')
      return [{ ...part, points: unitRing(rowsPolygon(s.front!), b.x0, b.x1, b.y0, b.y1) }];
    if (s.shape !== 'hull') return [part];
    return [
      {
        ...part,
        points: s.front
          ? unitRing(rowsPolygon(s.front), b.x0, b.x1, b.y0, b.y1)
          : SQUARE.map((p) => [...p] as [number, number]),
        section: s.side
          ? unitRing(colsPolygon(s.side), b.z0, b.z1, b.y0, b.y1)
          : s.profile
            ? unitRing(rowsPolygon(s.profile), b.z0, b.z1, b.y0, b.y1)
            : SQUARE.map((p) => [...p] as [number, number]),
      },
    ];
  });
  // A gable gives two parts: past the recipe's limit the last (smallest) ones are left out, the
  // whole model is not lost (PQ-T74: a half-timbered house came back with no model at all).
  parts.length = Math.min(parts.length, MAX_VIEW_PARTS);
  classOf.length = parts.length;
  const recipe = ObjectRecipeSchema.parse({
    proportions: { w: extent(W / max), h: extent(H / max), d: extent(D / max) },
    parts,
    source: 'views',
    // Width, height and depth are read on the drawings; the metric scale is not.
    dimStatus: { depth: 'measured', scale: 'estimated' },
  });
  return { recipe, classOf };
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
