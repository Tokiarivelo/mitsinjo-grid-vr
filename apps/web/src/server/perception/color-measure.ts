import type { KitArchetype, ObjectKit } from '@/lib/object-kit';

/**
 * Measured colours of an object (PF-T2): the 3 kit colours come from the photo pixels inside the object
 * outline, not from the LLM. Pure and deterministic: k-means in CIELAB (perceptual distances) with a
 * farthest-point start, then roles by where each colour sits in the object (roof on top, trunk below…).
 */

/** Pixels of the object: CIELAB triples, linear RGB triples, and vertical position (0 = box top, 1 = bottom). */
export interface ObjectPixels {
  lab: Float32Array;
  linear: Float32Array;
  y: Float32Array;
}

/** Fewer pixels than this inside the outline → not measured (the LLM colours stay). */
export const MIN_MEASURED_PIXELS = 64;
/** Colour groups per object: walls, roof, glass, shadow + one spare. */
export const COLOR_CLUSTERS = 5;
/** A plaster group holds at least this share of the biggest wall group's pixels (not a highlight). */
export const PLASTER_MIN_SHARE = 0.35;
const ITERATIONS = 12;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);

/** 8-bit sRGB → linear RGB (0–1). */
export function srgbToLinear(r: number, g: number, b: number): [number, number, number] {
  return [toLinear(r / 255), toLinear(g / 255), toLinear(b / 255)];
}

/** Linear RGB → CIELAB (D65). */
export function linearToLab(r: number, g: number, b: number): [number, number, number] {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Linear RGB → `#rrggbb`. */
export function linearToHex(r: number, g: number, b: number): string {
  const byte = (c: number) =>
    Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** Builds `ObjectPixels` from interleaved 8-bit RGB and each pixel's vertical position. */
export function objectPixels(rgb: ArrayLike<number>, y: ArrayLike<number>): ObjectPixels {
  const n = y.length;
  const lab = new Float32Array(n * 3);
  const linear = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const l = srgbToLinear(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!);
    linear.set(l, i * 3);
    lab.set(linearToLab(...l), i * 3);
  }
  return { lab, linear, y: Float32Array.from(y) };
}

const dist2 = (p: Float32Array, i: number, c: Float32Array, j: number) => {
  const a = p[i * 3]! - c[j * 3]!;
  const b = p[i * 3 + 1]! - c[j * 3 + 1]!;
  const d = p[i * 3 + 2]! - c[j * 3 + 2]!;
  return a * a + b * b + d * d;
};

/**
 * k-means on CIELAB points. Start: the point nearest the mean, then each next centre = the point farthest
 * from the centres so far (maximin, deterministic, no PRNG). Returns each point's group.
 */
export function kmeansLab(lab: Float32Array, k: number, iterations = ITERATIONS): Uint8Array {
  const n = lab.length / 3;
  const labels = new Uint8Array(n);
  if (n === 0) return labels;
  const groups = Math.max(1, Math.min(k, n, 255));
  const centres = new Float32Array(groups * 3);
  const mean = new Float32Array(3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c]! += lab[i * 3 + c]! / n;
  let first = 0;
  for (let i = 1; i < n; i++) if (dist2(lab, i, mean, 0) < dist2(lab, first, mean, 0)) first = i;
  centres.set(lab.subarray(first * 3, first * 3 + 3), 0);
  const nearest = new Float32Array(n).fill(Infinity);
  for (let j = 1; j < groups; j++) {
    let far = 0;
    for (let i = 0; i < n; i++) {
      nearest[i] = Math.min(nearest[i]!, dist2(lab, i, centres, j - 1));
      if (nearest[i]! > nearest[far]!) far = i;
    }
    centres.set(lab.subarray(far * 3, far * 3 + 3), j * 3);
  }
  const sums = new Float64Array(groups * 3);
  const counts = new Uint32Array(groups);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      for (let j = 1; j < groups; j++) {
        if (dist2(lab, i, centres, j) < dist2(lab, i, centres, best)) best = j;
      }
      if (labels[i] !== best || it === 0) moved = true;
      labels[i] = best;
    }
    if (!moved) break;
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const j = labels[i]!;
      counts[j]!++;
      for (let c = 0; c < 3; c++) sums[j * 3 + c]! += lab[i * 3 + c]!;
    }
    for (let j = 0; j < groups; j++) {
      if (counts[j]) for (let c = 0; c < 3; c++) centres[j * 3 + c] = sums[j * 3 + c]! / counts[j]!;
    }
  }
  return labels;
}

/** Where the secondary colour (roof, trunk, stand…) sits in the object box, by archetype. */
const SECONDARY_BAND: Partial<Record<KitArchetype, 'top' | 'bottom'>> = {
  house: 'top',
  building: 'top',
  vehicle: 'top',
  lamp_post: 'top',
  person: 'top',
  tree: 'bottom',
  screen: 'bottom',
  fan: 'bottom',
  panel: 'bottom',
};
const inBand = (band: 'top' | 'bottom' | undefined, y: number) =>
  band === 'top' ? y < 0.4 : band === 'bottom' ? y > 0.7 : false;

interface Group {
  count: number;
  inSecondary: number;
  lightness: number;
  hex: string;
  /** Mean CIELAB a, b: the hue and chroma, to tell a shadow from another material. */
  a: number;
  b: number;
}

/** A colour is read on its brightest share of pixels: the lit surface, not the shadow mixed in (PQ-T10). */
export const LIT_SHARE = 0.6;
/**
 * A group is the shadow of a brighter one when its a, b sit within this distance of the brighter group's a, b
 * faded to its lightness (`shadeOf`: a shadow darkens a surface and fades its colour with it)…
 */
export const SHADOW_CHROMA_MAX = 10;
/** …and it is darker by this much CIELAB L (at least, at most). */
export const SHADOW_L_MIN = 6;
export const SHADOW_L_MAX = 50;
/**
 * …and the brighter group has a colour of its own (CIELAB chroma). Greys all share one hue: without this a
 * black object (cast-iron pump, black motorbike) was read as the shadow of its own grey highlights. A grey
 * wall in shadow is therefore not read apart. Values set with `make shadow-compare` (13 real photos, a shadow
 * painted over each): main colour kept in 20 of 39 cases against 12 without, none lost.
 */
export const SHADOW_LIT_CHROMA_MIN = 16;

/** Factor on the a, b of `lit` to get the a, b expected for it at `dark`'s lightness. */
const shadeOf = (lit: Group, dark: Group) => (dark.lightness + 16) / (lit.lightness + 16);

/**
 * Object pixels → the kit's 3 colours (PF-T2), or null when too few pixels were measured.
 * main = biggest group outside the secondary band (walls, body, crown); secondary = biggest other group
 * inside that band (roof, trunk, stand), else the next biggest group; accent = darkest group left (glass).
 * Vehicles (PQ-T43): accent and secondary swap — the glasshouse fills the top band, so it is the
 * accent glass while secondary takes the darkest trim.
 * `plaster` (PG-T22, half-timbered walls): main = the lightest big group outside the band, so the
 * walls read as their plaster and not as plaster, beams and shadow averaged together.
 */
export function measureKitColors(
  px: ObjectPixels,
  archetype: KitArchetype,
  {
    plaster = false,
    litSurface = false,
    onShadowShare,
  }: {
    plaster?: boolean;
    /**
     * Read the lit surface (PQ-T10): a darker group of the same hue counts as the shadow of a brighter,
     * coloured one and its pixels go to it. Off by default: dark beams and a shadow cannot be told apart by
     * colour alone.
     */
    litSurface?: boolean;
    /** Receives the share of object pixels read as shadow of a brighter group (0–1). */
    onShadowShare?: (share: number) => void;
  } = {}
): ObjectKit['colors'] | null {
  const n = px.y.length;
  if (n < MIN_MEASURED_PIXELS) return null;
  const labels = kmeansLab(px.lab, COLOR_CLUSTERS);
  const band = SECONDARY_BAND[archetype];
  const members: number[][] = Array.from({ length: COLOR_CLUSTERS }, () => []);
  const inSec = new Array<number>(COLOR_CLUSTERS).fill(0);
  for (let i = 0; i < n; i++) {
    members[labels[i]!]!.push(i);
    if (inBand(band, px.y[i]!)) inSec[labels[i]!]!++;
  }
  const all: Group[] = [];
  members.forEach((idx, k) => {
    if (idx.length === 0) return;
    let l = 0;
    let a = 0;
    let b = 0;
    for (const i of idx) {
      l += px.lab[i * 3]!;
      a += px.lab[i * 3 + 1]!;
      b += px.lab[i * 3 + 2]!;
    }
    // Colour on the brighter part of the group only.
    const lit = [...idx]
      .sort((p, q) => px.lab[q * 3]! - px.lab[p * 3]!)
      .slice(0, Math.max(1, Math.ceil(idx.length * LIT_SHARE)));
    const rgb = [0, 0, 0];
    for (const i of lit) for (let c = 0; c < 3; c++) rgb[c]! += px.linear[i * 3 + c]!;
    all.push({
      count: idx.length,
      inSecondary: inSec[k]!,
      lightness: l / idx.length,
      a: a / idx.length,
      b: b / idx.length,
      hex: linearToHex(rgb[0]! / lit.length, rgb[1]! / lit.length, rgb[2]! / lit.length),
    });
  });
  // A darker group of the same hue as a brighter one is its shadow: its pixels count for the lit group.
  // Brightest first, and a group only joins a group that stayed (no chains: roof → shadow → wall).
  const groups: Group[] = [];
  let shadowPixels = 0;
  for (const g of [...all].sort((p, q) => q.lightness - p.lightness)) {
    // A group living in the secondary band (roof, trunk) is a part of its own, never a shadow.
    const lit = (litSurface && g.inSecondary < 0.5 * g.count ? groups : [])
      .filter(
        (o) =>
          Math.hypot(o.a, o.b) >= SHADOW_LIT_CHROMA_MIN &&
          o.lightness - g.lightness >= SHADOW_L_MIN &&
          o.lightness - g.lightness <= SHADOW_L_MAX &&
          Math.hypot(o.a * shadeOf(o, g) - g.a, o.b * shadeOf(o, g) - g.b) <= SHADOW_CHROMA_MAX
      )
      .sort((p, q) => q.count - p.count)[0];
    if (lit) {
      lit.count += g.count;
      lit.inSecondary += g.inSecondary;
      shadowPixels += g.count;
    } else groups.push(g);
  }
  onShadowShare?.(shadowPixels / n);
  const by = (score: (g: Group) => number, from: Group[]) =>
    from.reduce<Group | undefined>(
      (best, g) => (!best || score(g) > score(best) ? g : best),
      undefined
    );

  const outside = (g: Group) => g.count - g.inSecondary;
  const biggest = by(outside, groups)!;
  const big = groups.filter((g) => outside(g) >= PLASTER_MIN_SHARE * outside(biggest));
  const main = plaster ? by((g) => g.lightness, big)! : biggest;
  const rest = groups.filter((g) => g !== main);
  const bandPixels = groups.reduce((s, g) => s + g.inSecondary, 0);
  const inBandBest = by((g) => g.inSecondary, rest);
  const secondary =
    inBandBest && bandPixels > 0 && inBandBest.inSecondary >= 0.05 * bandPixels
      ? inBandBest
      : (by((g) => g.count, rest) ?? main);
  const left = rest.filter((g) => g !== secondary && g.count >= 0.01 * n);
  const accent = by((g) => -g.lightness, left) ?? main;
  // The glasshouse fills the top band: it is the accent glass, not the wheels (else the cabin
  // renders black and the fit hides it — golden car score 93 → 80).
  if (archetype === 'vehicle')
    return { main: main.hex, secondary: accent.hex, accent: secondary.hex };
  return { main: main.hex, secondary: secondary.hex, accent: accent.hex };
}

/** Even-odd point-in-polygon over several rings (photo fractions). */
export function insideRings(
  x: number,
  y: number,
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]!;
      const [xj, yj] = r[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** `#rrggbb` → sRGB 0–255. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `#rrggbb` → CIELAB. */
export function hexToLab(hex: string): [number, number, number] {
  return linearToLab(...srgbToLinear(...hexToRgb(hex)));
}

/** CIEDE2000 colour difference (Sharma 2005); < 2 hard to see, < 10 the same colour family. */
export function deltaE2000(
  [L1, a1, b1]: readonly [number, number, number],
  [L2, a2, b2]: readonly [number, number, number]
): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dL = L2 - L1;
  const dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2p - h1p;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hm /= 2;
    else hm = h1p + h2p < 360 ? (hm + 360) / 2 : (hm - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hm - 30) * rad) +
    0.24 * Math.cos(2 * hm * rad) +
    0.32 * Math.cos((3 * hm + 6) * rad) -
    0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}
