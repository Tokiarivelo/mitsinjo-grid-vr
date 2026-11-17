import type { ObjectRecipe, RecipeMaterial } from '@/lib/object-shape';
import type { SkinBox } from '@/lib/face-skin';
import { FLAT_LIGHT, unturn, type FlatPaint, type FlatRender, type FlatView } from '../flat-render';

/**
 * The look of an imagined face (VS-T44): a model's parts drawn as a game / animated-film render,
 * no photo. Each material has its own surface (wood grain, fabric weave, brushed metal, glazed
 * glass reflecting the sky, leaf clusters, stone mottling, brick courses, roof courses), lit by a
 * key light, a sky / ground fill, a cool rim light, a specular highlight and, on shiny materials,
 * the sky and the ground reflected with a Fresnel falloff; a contact shadow darkens what touches
 * the ground; filmic tone mapping. `inkEdges` then draws the outline and the part seams. Pure and
 * deterministic (hashed noise, no `Math.random`).
 */

type V3 = [number, number, number];

const dot = (a: Readonly<V3>, b: Readonly<V3>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: Readonly<V3>): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const mixv = (a: Readonly<V3>, b: Readonly<V3>, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** sRGB hex → linear rgb 0–1. */
export function linearOf(hex: string): V3 {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return c.map((v) => Math.pow(v, 2.2)) as V3;
}

// ------------------------------------------------------------------ noise

function hash(x: number, y: number, z: number): number {
  // Integer lattice hash (fast, no trigonometry): x, y, z are whole numbers here.
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [0, 1], trilinear with smoothstep (no allocation: it runs per pixel). */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);
  const a = hash(ix, iy, iz) + (hash(ix + 1, iy, iz) - hash(ix, iy, iz)) * fx;
  const b = hash(ix, iy + 1, iz) + (hash(ix + 1, iy + 1, iz) - hash(ix, iy + 1, iz)) * fx;
  const c = hash(ix, iy, iz + 1) + (hash(ix + 1, iy, iz + 1) - hash(ix, iy, iz + 1)) * fx;
  const d =
    hash(ix, iy + 1, iz + 1) + (hash(ix + 1, iy + 1, iz + 1) - hash(ix, iy + 1, iz + 1)) * fx;
  const ab = a + (b - a) * fy;
  return ab + (c + (d - c) * fy - ab) * fz;
}

/** Fractal noise (`oct` octaves) in [0, 1]. */
export function fbm(x: number, y: number, z: number, oct = 4): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let tot = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise3(x * f, y * f, z * f);
    tot += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / tot;
}

// ------------------------------------------------------------------ materials

interface Surface {
  albedo: V3;
  /** Specular strength and sharpness. */
  ks: number;
  shine: number;
  /** Reflectance facing the camera (0 = none; Fresnel raises it at grazing angles). */
  f0: number;
  /** Wrap of the diffuse light (soft materials). */
  wrap: number;
}

const BASE: Record<RecipeMaterial | 'painted', Omit<Surface, 'albedo'>> = {
  wood: { ks: 0.12, shine: 24, f0: 0.02, wrap: 0.1 },
  fabric: { ks: 0.03, shine: 6, f0: 0, wrap: 0.35 },
  metal: { ks: 0.7, shine: 60, f0: 0.55, wrap: 0 },
  plastic: { ks: 0.35, shine: 48, f0: 0.05, wrap: 0.1 },
  glass: { ks: 0.9, shine: 120, f0: 0.12, wrap: 0 },
  rubber: { ks: 0.05, shine: 8, f0: 0.01, wrap: 0.1 },
  foliage: { ks: 0.08, shine: 16, f0: 0.01, wrap: 0.45 },
  stone: { ks: 0.06, shine: 12, f0: 0.01, wrap: 0.05 },
  brick: { ks: 0.04, shine: 10, f0: 0.01, wrap: 0.05 },
  plaster: { ks: 0.04, shine: 10, f0: 0.01, wrap: 0.1 },
  concrete: { ks: 0.04, shine: 10, f0: 0.01, wrap: 0.05 },
  thatch: { ks: 0.02, shine: 6, f0: 0, wrap: 0.3 },
  tile: { ks: 0.18, shine: 30, f0: 0.03, wrap: 0.05 },
  slate: { ks: 0.25, shine: 36, f0: 0.04, wrap: 0.05 },
  water: { ks: 0.9, shine: 90, f0: 0.3, wrap: 0 },
  painted: { ks: 0.2, shine: 32, f0: 0.03, wrap: 0.1 },
};

/** The albedo of a material at object point `p` (`s` = noise scale: features per model unit). */
function albedoAt(
  material: RecipeMaterial | 'painted',
  base: V3,
  p: Readonly<V3>,
  grain: 0 | 1 | 2,
  s: number
): V3 {
  const [x, y, z] = p;
  const tone = (k: number): V3 => [base[0] * k, base[1] * k, base[2] * k];
  switch (material) {
    case 'wood': {
      // Grain along the part's long axis: rings from noise-warped bands across it.
      const q: V3 = [x * s, y * s, z * s];
      const along = q[grain];
      const across =
        grain === 0 ? q[1] + q[2] * 0.7 : grain === 1 ? q[0] + q[2] * 0.7 : q[0] + q[1] * 0.7;
      const warp = fbm(q[0] * 0.6, q[1] * 0.6, q[2] * 0.6, 3) * 6 + along * 0.15;
      const ring = 0.5 + 0.5 * Math.sin((across * 5 + warp * 0.6) * Math.PI);
      const fleck = fbm(along * 0.3, across * 14, 0.5, 2);
      return tone(0.88 + 0.12 * ring + 0.1 * (fleck - 0.5));
    }
    case 'fabric': {
      const w = Math.sin(x * s * 90) * Math.sin(y * s * 90 + z * s * 90);
      const fuzz = fbm(x * s * 6, y * s * 6, z * s * 6, 3);
      return tone(0.92 + 0.05 * w + 0.14 * (fuzz - 0.5));
    }
    case 'metal': {
      const brush = fbm(x * s * 0.8, y * s * 40, z * s * 0.8, 2);
      return tone(0.9 + 0.12 * (brush - 0.5));
    }
    case 'foliage': {
      // Leaf clusters: bright tips on dark hollows, a few yellower leaves.
      const c = fbm(x * s * 5, y * s * 5, z * s * 5, 4);
      const leaf = fbm(x * s * 22, y * s * 22, z * s * 22, 2);
      const k = 0.55 + 0.75 * smooth(clamp01((c - 0.35) * 2.2)) + 0.18 * (leaf - 0.5);
      const warm = clamp01((leaf - 0.7) * 3) * 0.25;
      return mixv(tone(k), [base[0] * 1.3 * k, base[1] * 1.15 * k, base[2] * 0.6 * k], warm);
    }
    case 'stone':
    case 'concrete':
    case 'plaster': {
      const amp = material === 'stone' ? 0.32 : material === 'concrete' ? 0.18 : 0.1;
      const m = fbm(x * s * 3, y * s * 3, z * s * 3, 5);
      return tone(1 + amp * (m - 0.5) * 2);
    }
    case 'brick': {
      // Courses of bricks with a light mortar, staggered every other row.
      const row = y * s * 12;
      const r = Math.floor(row);
      const u = (x + z) * s * 6 + (r % 2) * 0.5;
      const mortar = Math.min(row - r, 1 - (row - r)) < 0.08 || Math.min(u % 1, 1 - (u % 1)) < 0.05;
      if (mortar) return [0.55, 0.53, 0.5];
      return tone(
        0.85 + 0.3 * hash(Math.floor(u), r, 1) + 0.1 * (fbm(x * s * 20, y * s * 20, z, 2) - 0.5)
      );
    }
    case 'tile':
    case 'slate':
    case 'thatch': {
      const row = (y - x * 0.0) * s * (material === 'thatch' ? 8 : 16);
      const r = Math.floor(row);
      const shade = 0.75 + 0.35 * (row - r);
      const v = hash(Math.floor((x + z) * s * 10 + (r % 2) * 0.5), r, 3);
      return tone(shade * (0.9 + 0.2 * v));
    }
    case 'glass':
    case 'water':
      return tone(0.6);
    default:
      return tone(0.97 + 0.06 * (fbm(x * s * 4, y * s * 4, z * s * 4, 2) - 0.5));
  }
}

// ------------------------------------------------------------------ lighting

const SKY: V3 = [0.5, 0.66, 0.9];
const HORIZON: V3 = [0.92, 0.93, 0.94];
const GROUND: V3 = [0.24, 0.21, 0.18];
const KEY: V3 = [1.25, 1.18, 1.05];
const RIM: V3 = [0.55, 0.7, 1.0];

/** The sky and the ground reflected along `r`. */
function environment(r: Readonly<V3>): V3 {
  return r[1] >= 0
    ? mixv(HORIZON, SKY, Math.pow(r[1], 0.6))
    : mixv(HORIZON, GROUND, Math.pow(-r[1], 0.4));
}

/** Whether two parts of `recipe` are drawn as one (no seam between them): leaves on leaves. */
export const partSeams =
  (recipe: ObjectRecipe) =>
  (a: number, b: number): boolean =>
    !(recipe.parts[a]?.material === 'foliage' && recipe.parts[b]?.material === 'foliage');

/** Filmic tone map (ACES fit) and sRGB. */
function display(c: Readonly<V3>): [number, number, number] {
  return [toByte(c[0]), toByte(c[1]), toByte(c[2])];
}

function toByte(v: number): number {
  const x = v * 0.95;
  const t = clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
  return Math.round(255 * Math.pow(t, 1 / 2.2));
}

/**
 * The imagined look of `recipe` seen along `view`: a paint for `renderFlat` returning lit sRGB.
 * `box` = the model's box (contact shadow at its floor, noise scaled to its size).
 */
export function imaginedPaint(recipe: ObjectRecipe, view: FlatView, box: SkinBox): FlatPaint {
  const L = norm(unturn(FLAT_LIGHT as V3, view));
  const V = norm(unturn([0, 0, 1], view));
  const H = norm([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
  const size = Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2], 1e-6);
  // Features per model unit: a small object gets finer grain than a house.
  const s = 6 / size;
  const floor = box[1];
  const height = Math.max(1e-6, box[4] - box[1]);
  const looks = recipe.parts.map((part) => {
    const material: RecipeMaterial | 'painted' = part.material ?? 'painted';
    const [sx, sy, sz] = part.size;
    const grain = (sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2) as 0 | 1 | 2;
    return { material, base: linearOf(part.color ?? '#9a9a9a'), grain, ...BASE[material] };
  });
  const paint: FlatPaint = (p, n0, k) => {
    const look = looks[k];
    if (!look) return null;
    const n = norm(n0 as V3);
    const albedo = albedoAt(look.material, look.base, p, look.grain, s);
    const ndl = dot(n, L);
    const diffuse = Math.max(0, (ndl + look.wrap) / (1 + look.wrap));
    const fill = mixv(GROUND, SKY, 0.5 + 0.5 * n[1]);
    const ndv = Math.max(0, dot(n, V));
    const spec = look.ks * Math.pow(Math.max(0, dot(n, H)), look.shine) * (ndl > 0 ? 1 : 0);
    const fresnel = look.f0 + (1 - look.f0) * Math.pow(1 - ndv, 5) * (look.f0 > 0 ? 1 : 0);
    const r: V3 = [2 * ndv * n[0] - V[0], 2 * ndv * n[1] - V[1], 2 * ndv * n[2] - V[2]];
    const env = environment(norm(r));
    const rim = Math.pow(1 - ndv, 3) * 0.2;
    // Contact shadow: darker where the model meets the floor.
    const ao = 1 - 0.38 * Math.exp(-(p[1] - floor) / (0.06 * height));
    // Hollows of the foliage and folds of fabric stay a little darker underneath.
    const under = n[1] < 0 ? 1 + 0.25 * n[1] : 1;
    const out: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const lit = albedo[i]! * (KEY[i]! * diffuse * 0.95 + fill[i]! * 0.55) * ao * under;
      const metalTint = look.material === 'metal' ? albedo[i]! * 1.6 : 1;
      out[i] =
        lit * (1 - fresnel * 0.85) +
        env[i]! * fresnel * metalTint * ao +
        spec * KEY[i]! +
        rim * RIM[i]! * (look.material === 'glass' ? 0.4 : 0.6) * ao;
    }
    return display(out);
  };
  paint.lit = true;
  return paint;
}

const NEIGHBOUR_X = [1, -1, 0, 0];
const NEIGHBOUR_Y = [0, 0, 1, -1];

/**
 * Ink lines (VS-T44): the silhouette and the seams between parts darkened (one pixel), like the
 * outlines of an animated film; `seam(a, b)` = false keeps two parts as one (the blobs of a crown).
 * In place on `render.rgb`.
 */
export function inkEdges(
  render: FlatRender,
  cols: number,
  rows: number,
  strength = 0.55,
  seam: (a: number, b: number) => boolean = () => true
): void {
  const { mask, part, rgb } = render;
  const edge = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!mask.data[i]) continue;
      for (let k = 0; k < 4; k++) {
        const nx = x + NEIGHBOUR_X[k]!;
        const ny = y + NEIGHBOUR_Y[k]!;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (!mask.data[j] || (part[j] !== part[i] && seam(part[i]!, part[j]!))) {
          edge[i] = 1;
          break;
        }
      }
    }
  for (let i = 0; i < edge.length; i++)
    if (edge[i])
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(rgb[i * 3 + c]! * (1 - strength));
}
