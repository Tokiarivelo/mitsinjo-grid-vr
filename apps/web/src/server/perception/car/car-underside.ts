import 'server-only';
import sharp from 'sharp';
import type { ViewImage } from '../recon/grid';
import { alignTop, type GridView } from '../recon/views';

/**
 * A vehicle's underside drawing read like its plan (PQ-T76). Muse Image sometimes draws it lying
 * across the sheet (front to a side) or upside down, which the plan's aspect check rejects. Each
 * quarter turn is tried; the one whose outline (width row by row, front to back) best matches the
 * plan from above is kept, so the floor wears it the right way round. Without a plan, the first
 * turn that reads. Car code only: the house never draws an underside.
 */

/** Quarter turns tried, upright first (an upright drawing wins a tie). */
export const UNDERSIDE_TURNS = [0, 180, 90, 270] as const;

type Read = NonNullable<ReturnType<typeof alignTop>>;

/** The object's width on each row of a grid view, as shares of the row. */
export function rowWidths(view: Pick<GridView, 'cols' | 'rows' | 'mask'>): number[] {
  const out: number[] = [];
  for (let r = 0; r < view.rows; r++) {
    let n = 0;
    for (let c = 0; c < view.cols; c++) n += view.mask[r * view.cols + c]!;
    out.push(n / view.cols);
  }
  return out;
}

/** Mean gap between two width profiles of the same length (0 = same outline). */
export function profileGap(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 1;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i]! - b[i]!);
  return s / n;
}

/**
 * The underside, turned the way its plan is drawn: its png (turned), and its read grid and frame
 * (on that png); null when no turn agrees with the elevations.
 */
export async function readUnderside(
  png: Buffer,
  plan: Pick<GridView, 'cols' | 'rows' | 'mask'> | null,
  W: number,
  D: number,
  decode: (bytes: Buffer) => Promise<ViewImage | null>
): Promise<{ png: Buffer; read: Read; turn: number } | null> {
  const target = plan ? rowWidths(plan) : null;
  let best: { png: Buffer; read: Read; turn: number; gap: number } | null = null;
  for (const turn of UNDERSIDE_TURNS) {
    const turned = turn ? await sharp(png).rotate(turn).png().toBuffer() : png;
    const img = await decode(turned);
    const read = img ? alignTop(img, W, D) : null;
    if (!read) continue;
    if (!target) return { png: turned, read, turn };
    const gap = profileGap(rowWidths(read.view), target);
    if (!best || gap < best.gap - 1e-6) best = { png: turned, read, turn, gap };
  }
  return best && { png: best.png, read: best.read, turn: best.turn };
}
