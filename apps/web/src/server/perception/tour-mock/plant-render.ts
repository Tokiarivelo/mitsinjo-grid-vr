import { PLANT_SLOTS, plantMesh, plantSlotColors } from '@/lib/plant-mesh';
import type { ObjectRecipe } from '@/lib/object-shape';
import type { FlatRender, FlatView } from '../flat-render';

/**
 * A plant as the viewer draws it (VS-T46): the `plantMesh` of its plan (trunk, limbs, lumpy
 * foliage, leaf cards, pot) on the recipe's box, seen along `view` (orthographic, like
 * `renderFlat`), z-buffered and shaded by slot colour (sun from the upper left, sky fill; light
 * near 1 on average, the look being measured as photographed). The
 * tour mock scores a plant on this, not on the clumps of its parts: the clumps are never shown.
 * `part` holds the slot index. Framed on the mesh bounds (`fill`) or with a 10 % margin. Pure.
 */

const SUN: [number, number, number] = (() => {
  const v = [-0.45, 0.75, 0.5];
  const l = Math.hypot(...v);
  return v.map((x) => x / l) as [number, number, number];
})();
/** Light round 1 on average: the look is the photo's colour, its light already in it. */
const AMBIENT = 0.72;
const DIFFUSE = 0.48;
/** Tone spread between two leaf cards (a crown is never one flat green). */
export const LEAF_JITTER = 0.2;
/** Leaves deep in the crown and low under it get this much less light (self-shadow). */
export const CROWN_SHADE = 0.25;

/** A fixed tone in [0, 1) per triangle: the same plant always looks the same. */
const tone = (i: number) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const LEAF_SLOTS = new Set(['leaf', 'leafDark', 'flower']);

const rgbOf = (hex: string) => [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));

export function renderPlant(
  recipe: ObjectRecipe,
  cols: number,
  rows: number,
  view: FlatView,
  fill = false
): FlatRender {
  const plan = recipe.plant!;
  const { w, h, d } = recipe.proportions;
  const mesh = plantMesh(plan, [w, h, d]);
  const n = cols * rows;
  const mask = { cols, rows, data: new Uint8Array(n) };
  const rgb = new Uint8ClampedArray(n * 3);
  const part = new Int16Array(n).fill(-1);
  const depth = new Float64Array(n).fill(-Infinity);
  const colors = PLANT_SLOTS.map((s) => plantSlotColors(plan)[s]);
  const shades = colors.map(rgbOf);
  // View turn: yaw round y (+ = right end farther), then pitch round x (+ = seen from above).
  const [cy, sy, cp, sp] = [
    Math.cos(view.yaw),
    Math.sin(view.yaw),
    Math.cos(view.pitch),
    Math.sin(view.pitch),
  ];
  const turn = (x: number, y: number, z: number): [number, number, number] => {
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  };
  const P = mesh.position;
  const N = mesh.normal;
  const pts = new Float64Array(P.length);
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    const [x, y, z] = turn(P[i]!, P[i + 1]!, P[i + 2]!);
    pts[i] = x;
    pts[i + 1] = y;
    pts[i + 2] = z;
    [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
  }
  if (!(x1 > x0 && y1 > y0)) return { mask, rgb, part, colors };
  const unit = fill ? null : Math.max((x1 - x0) / cols, (y1 - y0) / rows) * 1.1;
  const [fw, fh] = unit ? [unit * cols, unit * rows] : [x1 - x0, y1 - y0];
  const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const col = (x: number) => ((x - mx + fw / 2) / fw) * cols;
  const row = (y: number) => ((my + fh / 2 - y) / fh) * rows;

  for (let t = 0, tri = 0; t < P.length; t += 9, tri++) {
    const a = [col(pts[t]!), row(pts[t + 1]!), pts[t + 2]!];
    const b = [col(pts[t + 3]!), row(pts[t + 4]!), pts[t + 5]!];
    const c = [col(pts[t + 6]!), row(pts[t + 7]!), pts[t + 8]!];
    const area = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (c[0]! - a[0]!) * (b[1]! - a[1]!);
    if (Math.abs(area) < 1e-9) continue;
    const slot = mesh.slot[tri]!;
    // Face normal turned to the view, flipped to face the eye (cards are two-sided).
    const nt = turn(
      (N[t]! + N[t + 3]! + N[t + 6]!) / 3,
      (N[t + 1]! + N[t + 4]! + N[t + 7]!) / 3,
      (N[t + 2]! + N[t + 5]! + N[t + 8]!) / 3
    );
    const nl = Math.hypot(...nt) || 1;
    const s = nt[2] < 0 ? -1 : 1;
    let lit =
      AMBIENT +
      DIFFUSE * Math.max(0, (s * (nt[0] * SUN[0] + nt[1] * SUN[1] + nt[2] * SUN[2])) / nl);
    if (LEAF_SLOTS.has(PLANT_SLOTS[slot]!)) {
      // Each leaf card its own tone; the crown darker toward its heart and its underside.
      const [mx3, my3, mz3] = [0, 1, 2].map((k) => (P[t + k]! + P[t + 3 + k]! + P[t + 6 + k]!) / 3);
      const out = Math.min(1, Math.hypot(mx3! / w, mz3! / d) * 2);
      const up = Math.min(1, Math.max(0, my3! / h + 0.5));
      lit *= 1 - LEAF_JITTER / 2 + LEAF_JITTER * tone(tri);
      lit *= 1 - CROWN_SHADE * (1 - 0.5 * (out + up));
    }
    const base = shades[slot]!;
    const [xa, xb] = [
      Math.max(0, Math.floor(Math.min(a[0]!, b[0]!, c[0]!))),
      Math.min(cols - 1, Math.ceil(Math.max(a[0]!, b[0]!, c[0]!))),
    ];
    const [ya, yb] = [
      Math.max(0, Math.floor(Math.min(a[1]!, b[1]!, c[1]!))),
      Math.min(rows - 1, Math.ceil(Math.max(a[1]!, b[1]!, c[1]!))),
    ];
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const [fx, fy] = [x + 0.5, y + 0.5];
        const u = ((b[0]! - fx) * (c[1]! - fy) - (c[0]! - fx) * (b[1]! - fy)) / area;
        const v = ((c[0]! - fx) * (a[1]! - fy) - (a[0]! - fx) * (c[1]! - fy)) / area;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const z = u * a[2]! + v * b[2]! + (1 - u - v) * c[2]!;
        const i = y * cols + x;
        if (z <= depth[i]!) continue;
        depth[i] = z;
        mask.data[i] = 1;
        part[i] = slot;
        for (let k = 0; k < 3; k++) rgb[i * 3 + k] = base[k]! * lit;
      }
  }
  return { mask, rgb, part, colors };
}
