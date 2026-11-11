import type { KitArchetype, ObjectKit } from '@/lib/object-kit';
import { imageCard } from './skills';
import { sideDepthPlausible, sideLooksNew, type ViewMeasure } from './object-views';

/**
 * Side views from Muse Image, version 2 (PQ-T16, `docs/vision-to-3d-muse-skills.md` §12.1): the prompt is
 * the Side view card plus a family line, and several drawings are scored against the front before one is
 * kept. A generated view is a proposal; this code decides. Pure.
 */

/** Height of the side (image fractions) may differ from the front's by this much. */
export const SIDE_HEIGHT_TOL = 0.05;
/** Top-line correlation under this is another object's profile. */
export const SIDE_TOP_MIN = 0.3;
/** Samples of the top line compared. */
const TOP_SAMPLES = 16;

/** Family line appended to the card (§12.1); null for the families that get no generated view. */
export function sideFamilyLine(
  archetype: KitArchetype,
  roof?: 'slope' | 'end' | null
): string | null {
  switch (archetype) {
    case 'vehicle':
      return 'From the side a vehicle is much longer than its front is wide: show the full length, both wheels of this side as full circles on the ground line, the side windows and the doors.';
    case 'house':
    case 'building':
      return roof === 'slope'
        ? 'Seen from the side the roof is its long sloping plane above the wall, not a triangle. Do not redraw the front.'
        : roof === 'end'
          ? 'Seen from the side the roof shows its end: a triangle for a gable, a slope for a hipped end.'
          : null;
    case 'cabinet':
    case 'screen':
    case 'machine':
      return 'The side of an appliance is plain: show its true depth, the door edge and handle in profile, feet, and any pipe or cable entry at the back.';
    default:
      return null;
  }
}

/** The Side view card with the name and the family line filled in (prompt version 2). */
export function sideCardPrompt(
  label: string,
  archetype: KitArchetype,
  roof?: 'slope' | 'end' | null
): string {
  const name = label.replace(/["\n]/g, ' ').trim() || 'object';
  const line = sideFamilyLine(archetype, roof);
  return imageCard('side')
    .replaceAll('{name}', name)
    .replace(/\n?\{family line\}/, line ? `\n${line}` : '');
}

/** Top line of a silhouette: the highest v at each of `TOP_SAMPLES` columns (0 where the ring is absent). */
export function topLine(ring: ReadonlyArray<readonly [number, number]>): number[] {
  const out = new Array<number>(TOP_SAMPLES).fill(0);
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    // Walk the edge in small steps: a ring has few vertices.
    const steps = Math.max(1, Math.ceil(Math.abs(x1 - x0) * TOP_SAMPLES * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const k = Math.min(TOP_SAMPLES - 1, Math.max(0, Math.floor(x * TOP_SAMPLES)));
      out[k] = Math.max(out[k]!, y);
    }
  }
  return out;
}

/** Pearson correlation of two equal-length series; 0 when one is flat. */
export function correlation(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let [num, da, db] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export interface SideScore {
  /** Kept as a side view. */
  ok: boolean;
  /** Why not (first failed check), absent when kept. */
  reason?: 'not_a_side' | 'height' | 'top_line' | 'depth';
  /** 0–1, to choose between two kept candidates: height agreement and top-line correlation. */
  score: number;
}

/**
 * A generated side against the front: it must not be the front again (aspect), have the same height
 * within 5 %, a top line that follows the front's (correlation), and a depth Spark's kit finds plausible.
 * The colour per material of the plan needs SAM colours the views do not carry yet: not checked.
 */
export function scoreSide(front: ViewMeasure, side: ViewMeasure, kit?: ObjectKit): SideScore {
  if (!sideLooksNew(front, side)) return { ok: false, reason: 'not_a_side', score: 0 };
  const dh = Math.abs(side.box.h - front.box.h) / Math.max(1e-6, front.box.h);
  if (dh > SIDE_HEIGHT_TOL) return { ok: false, reason: 'height', score: 0 };
  const corr = correlation(topLine(front.ring), topLine(side.ring));
  if (corr < SIDE_TOP_MIN) return { ok: false, reason: 'top_line', score: 0 };
  if (kit && !sideDepthPlausible(front, side, kit)) return { ok: false, reason: 'depth', score: 0 };
  return {
    ok: true,
    score: Math.round(((1 - dh / SIDE_HEIGHT_TOL) * 0.5 + Math.max(0, corr) * 0.5) * 100) / 100,
  };
}

/** The best kept candidate, or null when every one failed a check (both dropped under the gate). */
export function pickSide<T extends { side: ViewMeasure }>(
  candidates: ReadonlyArray<T>,
  front: ViewMeasure,
  kit?: ObjectKit
): { pick: T; score: number } | null {
  let best: { pick: T; score: number } | null = null;
  for (const c of candidates) {
    const s = scoreSide(front, c.side, kit);
    if (s.ok && (!best || s.score > best.score)) best = { pick: c, score: s.score };
  }
  return best;
}
