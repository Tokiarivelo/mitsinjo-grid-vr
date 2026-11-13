import { deltaE2000, kmeansLab, linearToHex, linearToLab, srgbToLinear } from '../color-measure';
import { absorbSpecks, majority } from './grid';
import { VIEW_NAMES, type AlignedViews, type ViewName } from './views';

/**
 * Colour classes shared by the views (PQ-T69): the object pixels of every view are clustered
 * together in CIELAB, so « the roof » carries the same class on the front and on the side. That
 * shared id is what lets the solver pair a region of one view with its counterpart on another.
 * Pure and deterministic (maximin k-means start, no PRNG).
 */

/** Clusters asked of k-means before near-identical ones are merged. */
export const PALETTE_CLUSTERS = 8;
/** Two clusters closer than this (CIEDE2000) are one material under two lights. */
export const PALETTE_MERGE_DELTA_E = 9;
/** A class under this share of the object pixels is noise: its pixels join their neighbours. */
export const CLASS_MIN_SHARE = 0.004;
/** Label smoothing passes (3 × 3 majority): texture grain and drawn outlines dissolve. */
export const SMOOTH_PASSES = 2;
/** A region smaller than this many cells joins the class around it. */
export const SPECK_CELLS = 6;

export interface PaletteClass {
  /** Mean colour of the class. */
  hex: string;
  lab: [number, number, number];
  /** Share of all object pixels (every view). */
  share: number;
}

export interface Palette {
  classes: PaletteClass[];
  /** Class per cell of each canonical view, −1 outside the object. */
  labels: Partial<Record<ViewName, Int16Array>>;
}

/** Classes of the aligned views, largest first, and each view's label map. */
export function buildPalette(aligned: AlignedViews): Palette {
  const names = VIEW_NAMES.filter((n) => aligned.views[n]);
  // Every object pixel of every view, in view order.
  let total = 0;
  for (const n of names) for (const m of aligned.views[n]!.mask) total += m;
  const lab = new Float32Array(total * 3);
  const linear = new Float32Array(total * 3);
  let k = 0;
  for (const n of names) {
    const v = aligned.views[n]!;
    for (let i = 0; i < v.mask.length; i++) {
      if (!v.mask[i]) continue;
      const l = srgbToLinear(v.rgb[i * 3]!, v.rgb[i * 3 + 1]!, v.rgb[i * 3 + 2]!);
      linear.set(l, k * 3);
      lab.set(linearToLab(...l), k * 3);
      k++;
    }
  }
  const raw = kmeansLab(lab, PALETTE_CLUSTERS);
  const groups = Math.max(1, Math.min(PALETTE_CLUSTERS, total));
  const mean = (members: (g: number) => boolean) => {
    const sum = [0, 0, 0, 0, 0, 0];
    let count = 0;
    for (let i = 0; i < total; i++) {
      if (!members(raw[i]!)) continue;
      count++;
      for (let c = 0; c < 3; c++) {
        sum[c]! += lab[i * 3 + c]!;
        sum[3 + c]! += linear[i * 3 + c]!;
      }
    }
    return { count, values: sum.map((s) => (count ? s / count : 0)) };
  };
  // Merge clusters of one material (single link on the cluster means).
  const parent = Array.from({ length: groups }, (_, g) => g);
  const root = (g: number): number => (parent[g] === g ? g : (parent[g] = root(parent[g]!)));
  const centres = parent.map((g) => mean((x) => x === g));
  for (let a = 0; a < groups; a++) {
    for (let b = a + 1; b < groups; b++) {
      if (!centres[a]!.count || !centres[b]!.count) continue;
      const d = deltaE2000(
        centres[a]!.values.slice(0, 3) as [number, number, number],
        centres[b]!.values.slice(0, 3) as [number, number, number]
      );
      if (d < PALETTE_MERGE_DELTA_E) parent[root(b)] = root(a);
    }
  }
  const merged = [...new Set(parent.map((_, g) => root(g)))]
    .map((r) => ({ r, ...mean((x) => root(x) === r) }))
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count || a.r - b.r);
  // Noise classes are dropped from the list; their pixels are relabelled by the smoothing below.
  const kept = merged.filter((m, i) => i === 0 || m.count / total >= CLASS_MIN_SHARE);
  const classOf = new Int16Array(groups).fill(-1);
  kept.forEach((m, id) => {
    for (let g = 0; g < groups; g++) if (root(g) === m.r) classOf[g] = id;
  });
  const classes: PaletteClass[] = kept.map((m) => ({
    hex: linearToHex(m.values[3]!, m.values[4]!, m.values[5]!),
    lab: [m.values[0]!, m.values[1]!, m.values[2]!],
    share: m.count / total,
  }));
  /** Nearest kept class of a dropped cluster's pixel. */
  const nearest = (i: number) => {
    let best = 0;
    let bestD = Infinity;
    classes.forEach((c, id) => {
      const d =
        (lab[i * 3]! - c.lab[0]) ** 2 +
        (lab[i * 3 + 1]! - c.lab[1]) ** 2 +
        (lab[i * 3 + 2]! - c.lab[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    });
    return best;
  };
  const labels: Palette['labels'] = {};
  k = 0;
  for (const n of names) {
    const v = aligned.views[n]!;
    let map: Int16Array = new Int16Array(v.mask.length).fill(-1);
    for (let i = 0; i < v.mask.length; i++) {
      if (!v.mask[i]) continue;
      const c = classOf[raw[k]!]!;
      map[i] = c >= 0 ? c : nearest(k);
      k++;
    }
    for (let p = 0; p < SMOOTH_PASSES; p++) map = majority(map, v.cols, v.rows, classes.length);
    labels[n] = absorbSpecks(map, v.cols, v.rows, classes.length, SPECK_CELLS);
  }
  return { classes, labels };
}
