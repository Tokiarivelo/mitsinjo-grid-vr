import type { ObjectRecipe, RecipePart } from '@/lib/object-shape';
import type { PlantHints } from '../tree/plant-build';

/**
 * Hand-built models of the 360° tour objects (VS-T41): what the AI answers for them in mock mode.
 * A spec is written like a modeller works, in metres: x right, y up, z toward the camera, each part
 * centred at `at` with its full `size`. `compileSpec` turns it into a recipe (fractions of the
 * object box, largest side = 1). Colours are a first guess: `make tour-mock` measures each part on
 * the photo and keeps the measured ones (`fixed` parts keep theirs). Pure, no I/O.
 */

export type V3 = readonly [number, number, number];

/** One part in metres; every other recipe field passes through unchanged. */
export type PartSpec = Omit<RecipePart, 'at' | 'size'> & {
  at: V3;
  size: V3;
  /** SAM part concept the part shows as on the photo (`model3dPart` key: door, window, wheel…). */
  concept?: string;
  /** Colour picked by hand (a lamp's lit bulb, a reflection): never re-measured. */
  fixed?: boolean;
  /**
   * Front ring = the traced outline (VS-T42), cut to `band` (shares of the object height from its
   * top, default all): the part becomes a hull of that shape, `section` its side (default round).
   */
  silhouette?: {
    band?: readonly [number, number];
    section?: ReadonlyArray<readonly [number, number]>;
  };
};

export interface TourPartsSpec {
  kind: 'parts';
  parts: PartSpec[];
  /** Turn of the front away from the camera (rad, + = right end farther), as seen on the photo. */
  yaw?: number;
}

/**
 * A plant, read the way the real pipeline reads one (PQ-T82): its outlined photo is the front view
 * measured by `reconstructTree`, and `hints` is what the plant team would answer (habit, leaves,
 * limbs traced on the front, image fractions of the outline's box).
 */
export interface TourPlantSpec {
  kind: 'plant';
  label: string;
  hints: PlantHints;
}

export type TourSpec = TourPartsSpec | TourPlantSpec;

/** Hand-built part list → recipe (proportions from the parts' bounds), concepts and fixed flags by part. */
export function compileSpec(spec: TourPartsSpec): {
  recipe: ObjectRecipe;
  concepts: Array<string | undefined>;
  fixed: boolean[];
} {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of spec.parts)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, p.at[i]! - p.size[i]! / 2);
      hi[i] = Math.max(hi[i]!, p.at[i]! + p.size[i]! / 2);
    }
  const dims = lo.map((l, i) => Math.max(1e-3, hi[i]! - l));
  const mid = lo.map((l, i) => (l + hi[i]!) / 2);
  const long = Math.max(...dims);
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const parts = spec.parts.map(({ at, size, ...spec }) => {
    const rest: Partial<PartSpec> = { ...spec };
    delete rest.concept;
    delete rest.fixed;
    delete rest.silhouette;
    return {
      ...rest,
      at: at.map((v, i) => r4((v - mid[i]!) / dims[i]!)) as unknown as RecipePart['at'],
      size: size.map((v, i) =>
        r4(Math.max(0.01, Math.min(1, v / dims[i]!)))
      ) as unknown as RecipePart['size'],
    };
  });
  return {
    recipe: {
      proportions: { w: r4(dims[0]! / long), h: r4(dims[1]! / long), d: r4(dims[2]! / long) },
      parts: parts as RecipePart[],
      ...(spec.yaw ? { yaw: spec.yaw } : {}),
    },
    concepts: spec.parts.map((p) => p.concept),
    fixed: spec.parts.map((p) => Boolean(p.fixed)),
  };
}

/** Part shorthands (metres). `o` carries any other recipe field (material, kind, axis, grid…). */
type Opts = Partial<Omit<PartSpec, 'shape' | 'at' | 'size' | 'color'>>;
const part =
  (shape: RecipePart['shape']) =>
  (at: V3, size: V3, color: string, o: Opts = {}): PartSpec => ({ shape, at, size, color, ...o });

export const box = part('box');
export const cyl = part('cylinder');
export const sphere = part('sphere');
export const cone = part('cone');
export const prism = part('prism');
export const hip = part('hip');

/** A lathe part: `profile` = [radius, height] pairs in unit space (r 0–0.5, y −0.5 → 0.5). */
export const lathe = (
  at: V3,
  size: V3,
  color: string,
  profile: ReadonlyArray<readonly [number, number]>,
  o: Opts = {}
): PartSpec => ({
  shape: 'lathe',
  at,
  size,
  color,
  profile: profile.map(([r, y]) => [r, y] as [number, number]),
  ...o,
});

/** An extruded part: `points` = closed ring in unit space (x, y −0.5 → 0.5), extruded along z. */
export const extrude = (
  at: V3,
  size: V3,
  color: string,
  points: ReadonlyArray<readonly [number, number]>,
  o: Opts = {}
): PartSpec => ({
  shape: 'extrude',
  at,
  size,
  color,
  points: points.map(([x, y]) => [x, y] as [number, number]),
  ...o,
});

/**
 * A visual hull: front ring `points` (x, y) ∩ side ring `section` (z, y), both unit space. A
 * parallelogram section makes a tilted slab (a solar panel, a leaning softbox).
 */
export const hull = (
  at: V3,
  size: V3,
  color: string,
  points: ReadonlyArray<readonly [number, number]>,
  section: ReadonlyArray<readonly [number, number]>,
  o: Opts = {}
): PartSpec => ({
  shape: 'hull',
  at,
  size,
  color,
  points: points.map(([x, y]) => [x, y] as [number, number]),
  section: section.map(([z, y]) => [z, y] as [number, number]),
  ...o,
});

/** Closed ring of a regular polygon in unit space (an octagon softbox: 8, `turn` = π/8). */
export function polygonRing(n: number, turn = 0): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const t = turn + (i / n) * Math.PI * 2;
    return [Math.round(0.5 * Math.cos(t) * 1e4) / 1e4, Math.round(0.5 * Math.sin(t) * 1e4) / 1e4];
  });
}

/** Ring of a glyph traced on a 0–1 grid (x right, y down, like the drawing) → unit space. */
export function glyphRing(pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  return pts.map(([x, y]) => [x - 0.5, 0.5 - y]);
}

/** A flat piece drawn on the front plane: any ring of points (metres, x right, y up), extruded `depth`. */
export function plate(
  pts: ReadonlyArray<readonly [number, number]>,
  z: number,
  depth: number,
  color: string,
  o: Opts = {}
): PartSpec {
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = Math.max(1e-3, x1 - x0);
  const h = Math.max(1e-3, y1 - y0);
  const r4 = (n: number) => Math.round(Math.min(0.5, Math.max(-0.5, n)) * 1e4) / 1e4;
  return extrude(
    [(x0 + x1) / 2, (y0 + y1) / 2, z],
    [w, h, depth],
    color,
    pts.map(([x, y]) => [r4((x - x0) / w - 0.5), r4((y - y0) / h - 0.5)] as const),
    o
  );
}

/** A straight limb or stem from `a` to `b` on the front plane (metres), `width` across. */
export function rod(
  a: readonly [number, number],
  b: readonly [number, number],
  width: number,
  z: number,
  color: string,
  o: Opts = {}
): PartSpec {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const [nx, ny] = [(-(b[1] - a[1]) / len) * (width / 2), ((b[0] - a[0]) / len) * (width / 2)];
  return plate(
    [
      [a[0] + nx, a[1] + ny],
      [b[0] + nx * 0.6, b[1] + ny * 0.6],
      [b[0] - nx * 0.6, b[1] - ny * 0.6],
      [a[0] - nx, a[1] - ny],
    ],
    z,
    width,
    color,
    o
  );
}

/** An oval leaf on the front plane: base at `c`, `length` along `angle` (rad, 0 = right), `width` across. */
export function leaf(
  c: readonly [number, number],
  length: number,
  width: number,
  angle: number,
  z: number,
  color: string,
  o: Opts = {}
): PartSpec {
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  const pts = Array.from({ length: 12 }, (_, i) => {
    const t = (i / 12) * Math.PI * 2;
    const along = (length / 2) * (1 + Math.cos(t));
    // Widest past the middle, pointed at the tip.
    const across = (width / 2) * Math.sin(t) * (0.6 + 0.4 * Math.sin((along / length) * Math.PI));
    return [c[0] + ux * along - uy * across, c[1] + uy * along + ux * across] as const;
  });
  return plate(pts, z, Math.max(0.02, width * 0.08), color, o);
}
