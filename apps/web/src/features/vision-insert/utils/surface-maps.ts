import type { Surface } from './surface-look';

/**
 * Procedural surface maps (PR-1.4): per material a tileable height pattern (stone blocks, brick courses,
 * wood grain, thatch, slate rows, brushed metal, tyre tread…) turned into a normal map, a roughness map
 * and a light-variation map. The part colour still comes from the photo (vertex colour): the maps only
 * add relief and grain, grey around 1 so the measured colour is kept. Pure, seeded, no DOM.
 */

/** Texture side, pixels. */
export const MAP_SIZE = 128;
/** Object units covered by one texture repeat (largest object side = 1). */
export const MAP_TILE = 0.25;

/**
 * Tiles the shade map spans per side (PQ-T35): the pattern repeats inside it, a larger noise layer does not,
 * so the light variation repeats every `SHADE_SPAN` tiles instead of every tile and the grid of repeats breaks.
 */
export const SHADE_SPAN = 2;
/** Share of the shade map's light variation that comes from the large noise layer. */
export const SHADE_LARGE_SHARE = 0.25;

/** Texture side for photo swatches (PR-1.5), pixels. */
export const SWATCH_SIZE = 64;
/** Baseline grey level of the normalised swatch (0–255), keeps highlights and shadows without clipping. */
export const SWATCH_BASELINE = 200;
/** Brightness multiplier so a swatch at SWATCH_BASELINE averages to 1 in linear space. */
export const SWATCH_GAIN = 1.74;

/** Height pattern 0–1 at integer pixel (x, y) of a `n`-pixel tile; wraps at n (tileable). */
type Pattern = (x: number, y: number, n: number) => number;

/** Seeded integer hash → 0–1 (no `Math.random`). */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Tileable value noise: `cx` × `cy` lattice cells across the tile (cx ≠ cy stretches it: streaks, strands). */
function valueNoise(x: number, y: number, n: number, cx: number, cy: number, seed: number): number {
  const fx = (x / n) * cx;
  const fy = (y / n) * cy;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const v = (i: number, j: number) => hash(mod(x0 + i, cx), mod(y0 + j, cy), seed);
  const a = v(0, 0) + (v(1, 0) - v(0, 0)) * tx;
  const b = v(0, 1) + (v(1, 1) - v(0, 1)) * tx;
  return a + (b - a) * ty;
}

/** Fractal noise, 0–1: octaves of value noise from `cells` (× `stretch` cells along y) up. */
function fbm(
  x: number,
  y: number,
  n: number,
  cells: number,
  seed: number,
  octaves = 4,
  stretch = 1
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    sum += amp * valueNoise(x, y, n, c, c * stretch, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * Courses of blocks in running bond: `rows` courses, `cols` blocks per course, every other course offset
 * by half a block, mortar `gap` (share of a block). Each block gets its own seeded height and a rounded top.
 */
function blocks(rows: number, cols: number, gap: number, jitter: number, seed: number): Pattern {
  return (x, y, n) => {
    const fy = (y / n) * rows;
    const row = Math.floor(fy);
    const fx = (x / n) * cols + (row % 2 ? 0.5 : 0);
    const col = Math.floor(fx);
    const u = fx - col;
    const v = fy - row;
    const edge = Math.min(u, 1 - u, v * (cols / rows), (1 - v) * (cols / rows));
    if (edge < gap) return 0.15 * fbm(x, y, n, 16, seed);
    const face = 0.75 + jitter * (hash(mod(col, cols), row, seed) - 0.5);
    const bevel = Math.min(1, (edge - gap) / gap);
    return Math.min(1, face * (0.6 + 0.4 * bevel) + 0.12 * (fbm(x, y, n, 8, seed + 3) - 0.5));
  };
}

const PATTERNS: Partial<Record<Surface, Pattern>> = {
  stone: blocks(5, 3, 0.06, 0.35, 11),
  brick: blocks(8, 4, 0.05, 0.15, 23),
  // Plaster and concrete: soft trowel / aggregate noise.
  plaster: (x, y, n) => fbm(x, y, n, 4, 31),
  concrete: (x, y, n) => 0.7 * fbm(x, y, n, 8, 37) + 0.3 * hash(x, y, 41),
  // Wood: grain lines along v (up a trunk, a post, a plank wall), wobbled by noise.
  wood: (x, y, n) => 0.5 + 0.5 * Math.sin(((x / n) * 12 + 2.5 * fbm(x, y, n, 2, 43)) * 2 * Math.PI),
  // Thatch: straw strands along y in overlapping layers.
  thatch: (x, y, n) =>
    0.6 * fbm(x, y, n, 32, 47, 2, 1 / 16) + 0.4 * (1 - mod((y / n) * 6, 1)) * fbm(x, y, n, 8, 53),
  // Roof tiles and slate: rows of shingles, thick at their lower edge, split per shingle.
  tile: blocks(6, 6, 0.04, 0.2, 59),
  slate: (x, y, n) => {
    const fy = (y / n) * 7;
    const row = Math.floor(fy);
    const fx = (x / n) * 5 + (row % 2 ? 0.5 : 0);
    const u = fx - Math.floor(fx);
    if (Math.min(u, 1 - u) < 0.03) return 0.1;
    return 0.3 + 0.6 * (fy - row) + 0.1 * hash(mod(Math.floor(fx), 5), row, 61);
  },
  // Brushed metal: fine streaks along x.
  metal: (x, y, n) => 0.5 + 0.5 * (fbm(x, y, n, 2, 67, 2, 32) - 0.5),
  // Tyre tread: diagonal grooves.
  rubber: (x, y, n) => (mod((x + y) / n, 1 / 8) * 8 < 0.3 ? 0.2 : 0.8),
  // Leaves: blotchy clumps.
  foliage: (x, y, n) => Math.pow(fbm(x, y, n, 8, 71), 1.5) * 1.6,
  // Fabric: plain weave.
  fabric: (x, y, n) =>
    0.5 + 0.25 * Math.sin((x / n) * 64 * Math.PI) + 0.25 * Math.sin((y / n) * 64 * Math.PI),
};

/** Relief strength of the normal map per material (higher = deeper grooves). */
const RELIEF: Partial<Record<Surface, number>> = {
  stone: 4,
  brick: 3,
  plaster: 1.5,
  concrete: 1.5,
  wood: 1,
  thatch: 4,
  tile: 3,
  slate: 3,
  metal: 0.6,
  rubber: 3,
  foliage: 3,
  fabric: 1.5,
};

/** Surfaces that get maps (glass, water, plastic and painted parts stay smooth). */
export const MAPPED_SURFACES = Object.keys(PATTERNS) as Surface[];

export interface SurfaceMaps {
  size: number;
  /** RGBA bytes, tangent-space normal (128, 128, 255 = flat). */
  normal: Uint8Array;
  /** RGBA bytes, roughness factor in green (three reads G), 1 = the material's own roughness. */
  roughness: Uint8Array;
  /**
   * RGBA bytes, grey 205–255: grooves slightly darker (cheap occlusion), multiplies the part colour. Spans
   * `SHADE_SPAN` × `SHADE_SPAN` tiles (`shadeSize` pixels a side): the pattern repeats in it, a large noise layer
   * (PQ-T35) does not.
   */
  shade: Uint8Array;
  /** Side of the shade map, pixels (`size` × `SHADE_SPAN`). */
  shadeSize: number;
  /** Brightness multiplier so the shade map does not darken the measured colour on average (PR-1.5). */
  gain: number;
}

/** Height field of a material's pattern, 0–1, `size`² row-major; null for smooth surfaces. */
export function surfaceHeight(surface: Surface, size = MAP_SIZE): Float32Array | null {
  const pattern = PATTERNS[surface];
  if (!pattern) return null;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) h[y * size + x] = Math.min(1, Math.max(0, pattern(x, y, size)));
  return h;
}

/** Normal, roughness and shade maps of a material (null for smooth surfaces). Wraps at the edges. */
export function surfaceMaps(surface: Surface, size = MAP_SIZE): SurfaceMaps | null {
  const h = surfaceHeight(surface, size);
  if (!h) return null;
  const relief = RELIEF[surface] ?? 1;
  const at = (x: number, y: number) => h[mod(y, size) * size + mod(x, size)]!;
  const normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const shadeSize = size * SHADE_SPAN;
  const shade = new Uint8Array(shadeSize * shadeSize * 4);
  let sumLinear = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Texture v runs up while rows run down: flip dy so a bump lights from above.
      const dx = (at(x + 1, y) - at(x - 1, y)) * relief;
      const dy = (at(x, y - 1) - at(x, y + 1)) * relief;
      const len = Math.hypot(dx, dy, 1);
      normal.set([128 - (dx / len) * 127, 128 - (dy / len) * 127, 128 + (1 / len) * 127, 255], i);
      const v = h[y * size + x]!;
      // Grooves and mortar rougher, raised faces a bit smoother.
      const r = Math.min(255, Math.round(255 * (1.1 - 0.3 * v)));
      roughness.set([r, r, r, 255], i);
    }
  }
  // Shade (PQ-T35): the pattern's grooves plus a large noise layer whose period is the whole map.
  const seed = SURFACE_SEED[surface] ?? 0;
  for (let y = 0; y < shadeSize; y++) {
    for (let x = 0; x < shadeSize; x++) {
      const large = valueNoise(x, y, shadeSize, SHADE_SPAN * 2, SHADE_SPAN * 2, 101 + seed);
      const v =
        (1 - SHADE_LARGE_SHARE) * h[mod(y, size) * size + mod(x, size)]! +
        SHADE_LARGE_SHARE * large;
      const s = Math.round(205 + 50 * v);
      shade.set([s, s, s, 255], (y * shadeSize + x) * 4);
      const srgb = s / 255;
      sumLinear += srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
    }
  }
  const meanLinear = sumLinear / (shadeSize * shadeSize);
  const gain = Math.round((1 / meanLinear) * 1000) / 1000;
  return { size, normal, roughness, shade, shadeSize, gain };
}

/** Seed of each surface's large noise layer and UV offset: same surface → same look, run after run. */
const SURFACE_SEED: Partial<Record<Surface, number>> = Object.fromEntries(
  Object.keys(PATTERNS).map((k, i) => [k, i + 1])
);

/**
 * Seeded UV offset of a surface, in texture repeats (0–1 each way, PQ-T35): two materials never start their
 * pattern at the same corner. Applied to the surface's maps alike, so a wall stays continuous across its parts.
 */
export function surfaceOffset(surface: Surface): [number, number] {
  const seed = SURFACE_SEED[surface] ?? 0;
  return [hash(seed, 1, 7), hash(seed, 2, 13)];
}

/** A face is a roof slope (not a wall, not a flat top) when its normal's up share is inside this. */
export const SLOPE_RANGE = [0.1, 0.98] as const;

/**
 * Planar UVs in object units (box projection per triangle): each triangle is projected on the plane its
 * normal faces most, scaled by `MAP_TILE`, so a pattern keeps its size whatever the part's size.
 * With `slopes` (roof parts, PG-T7): a sloped face is mapped in its own plane instead — u along the
 * eave, v up the fall line — so thatch strands and slate rows run downhill, not stretched across.
 * `position` and `normal` are non-indexed xyz triplets; returns uv pairs.
 */
export function planarUvs(
  position: ArrayLike<number>,
  normal: ArrayLike<number>,
  slopes = false
): Float32Array {
  const count = position.length / 3;
  const uv = new Float32Array(count * 2);
  for (let t = 0; t + 2 < count; t += 3) {
    let [nx, ny, nz] = [0, 0, 0];
    for (let k = t; k < t + 3; k++) {
      nx += normal[k * 3]!;
      ny += normal[k * 3 + 1]!;
      nz += normal[k * 3 + 2]!;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    [nx, ny, nz] = [nx / len, ny / len, nz / len];
    const up = Math.abs(ny);
    const slope = slopes && up >= SLOPE_RANGE[0] && up <= SLOPE_RANGE[1];
    // Slope frame: eave direction (horizontal, in the face) and fall line (up projected on the face).
    const hl = Math.hypot(nx, nz) || 1;
    const eave = [nz / hl, 0, -nx / hl] as const;
    const fall = [-nx * ny, 1 - ny * ny, -nz * ny] as const;
    const fl = Math.hypot(...fall) || 1;
    const [ax, ay, az] = [Math.abs(nx), up, Math.abs(nz)];
    for (let k = t; k < t + 3; k++) {
      const [x, y, z] = [position[k * 3]!, position[k * 3 + 1]!, position[k * 3 + 2]!];
      // Walls: u along the wall, v up. Faces turned up (tops): u along z = along a gable
      // ridge (ridges run front to back), so slate rows and courses follow the ridge.
      const [u, v] = slope
        ? [x * eave[0] + z * eave[2], (x * fall[0] + y * fall[1] + z * fall[2]) / fl]
        : ax >= ay && ax >= az
          ? [z, y]
          : az >= ay
            ? [x, y]
            : [z, x];
      uv[k * 2] = u / MAP_TILE;
      uv[k * 2 + 1] = v / MAP_TILE;
    }
  }
  return uv;
}
