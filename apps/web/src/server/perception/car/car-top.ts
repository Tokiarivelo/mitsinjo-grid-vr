import 'server-only';
import sharp from 'sharp';
import type { ViewImage } from '../recon/grid';
import { alignTop, type GridView } from '../recon/views';

/**
 * A vehicle's view from above, turned the way the model reads it (PQ-T78): length down the sheet,
 * front at the bottom. Muse Image sometimes lays a long vehicle across the sheet (a pick-up, a
 * bus), which the plan's aspect check rejects, or draws it front up. Each quarter turn is tried;
 * among those whose proportions agree with the elevations, the one whose colours along the car
 * (bonnet, roof, canopy, boot, read down its centre line) best match the top edge of the profile
 * is kept. An upright drawing wins unless another turn is clearly better. Car code only.
 */

/** Quarter turns tried, upright first. */
export const TOP_TURNS = [0, 180, 90, 270] as const;
/** Another turn replaces an upright drawing only under this share of its colour gap. */
export const TOP_TURN_GAIN = 0.75;
/** Rows read under the profile's top edge, and the share of the width read round the centre line. */
export const TOP_EDGE_ROWS = 4;
export const TOP_SPINE = 0.4;

type Read = NonNullable<ReturnType<typeof alignTop>>;
type Rgb = [number, number, number] | null;

/** Colour of the body just under its top edge, per column of the profile (null where empty). */
export function topEdgeColors(side: Pick<GridView, 'cols' | 'rows' | 'rgb' | 'mask'>): Rgb[] {
  const out: Rgb[] = [];
  for (let c = 0; c < side.cols; c++) {
    let r = 0;
    while (r < side.rows && !side.mask[r * side.cols + c]) r++;
    const sum = [0, 0, 0];
    let n = 0;
    for (let k = r + 1; k <= r + TOP_EDGE_ROWS && k < side.rows; k++) {
      const i = k * side.cols + c;
      if (!side.mask[i]) continue;
      for (let j = 0; j < 3; j++) sum[j]! += side.rgb[i * 3 + j]!;
      n++;
    }
    out.push(n ? [sum[0]! / n, sum[1]! / n, sum[2]! / n] : null);
  }
  return out;
}

/** Colour of the view from above along the car's centre line, per row (null where empty). */
export function spineColors(top: Pick<GridView, 'cols' | 'rows' | 'rgb' | 'mask'>): Rgb[] {
  const [c0, c1] = [
    Math.floor((top.cols * (1 - TOP_SPINE)) / 2),
    Math.ceil((top.cols * (1 + TOP_SPINE)) / 2),
  ];
  const out: Rgb[] = [];
  for (let r = 0; r < top.rows; r++) {
    const sum = [0, 0, 0];
    let n = 0;
    for (let c = c0; c < c1; c++) {
      const i = r * top.cols + c;
      if (!top.mask[i]) continue;
      for (let j = 0; j < 3; j++) sum[j]! += top.rgb[i * 3 + j]!;
      n++;
    }
    out.push(n ? [sum[0]! / n, sum[1]! / n, sum[2]! / n] : null);
  }
  return out;
}

/** Mean colour distance of two rows of colours of the same length (0 = same, 1 = black vs white). */
export function colorGap(a: readonly Rgb[], b: readonly Rgb[]): number {
  let [sum, n] = [0, 0];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const [p, q] = [a[i], b[i]];
    if (!p || !q) continue;
    sum += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 441.7;
    n++;
  }
  return n ? sum / n : 1;
}

/**
 * The view from above turned to the model's frame: its png (turned), its read grid and frame (on
 * that png) and the turn applied; null when no turn agrees with the elevations. `side` is the
 * canonical profile (columns back → front, `D` of them).
 */
export async function readCarTop(
  png: Buffer,
  side: Pick<GridView, 'cols' | 'rows' | 'rgb' | 'mask'> | null,
  W: number,
  D: number,
  decode: (bytes: Buffer) => Promise<ViewImage | null>
): Promise<{ png: Buffer; read: Read; turn: number } | null> {
  const edge = side ? topEdgeColors(side) : null;
  let best: { png: Buffer; read: Read; turn: number; gap: number } | null = null;
  for (const turn of TOP_TURNS) {
    const turned = turn ? await sharp(png).rotate(turn).png().toBuffer() : png;
    const img = await decode(turned);
    const read = img ? alignTop(img, W, D) : null;
    if (!read) continue;
    if (!edge) return { png: turned, read, turn };
    const gap = colorGap(spineColors(read.view), edge);
    // The drawing as asked (front at the bottom) stays unless a turn is clearly better.
    const beats = best ? gap < best.gap * (best.turn === 0 ? TOP_TURN_GAIN : 1) - 1e-9 : true;
    if (beats) best = { png: turned, read, turn, gap };
  }
  return best && { png: best.png, read: best.read, turn: best.turn };
}
