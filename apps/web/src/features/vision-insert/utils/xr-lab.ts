import type { PieceEdit } from '@/lib/piece-edits';

/**
 * Edits of the VR 3D lab (VS-T22), pure: one tap = one step, the same piece edits as the page's
 * 3D Studio (scale round the piece's centre, quarter turns, opacity steps), inside their bounds.
 */
type Vec3 = [number, number, number];

/** Rows shown at once in the lab's pieces list (each row ≥ 6 cm, Meta hit target). */
export const LAB_PAGE = 7;
const SCALE_MIN = 0.05;
const SCALE_MAX = 5;
/** Opacity steps a tap goes through (1 = opaque), then back to opaque. */
export const LAB_OPACITY_STEPS = [1, 0.6, 0.3] as const;

/** The piece's scale times `k` on every axis, kept in the edit bounds. */
export function labScale(edit: PieceEdit | undefined, k: number): Vec3 {
  const s = edit?.scale ?? [1, 1, 1];
  return s.map((v) => Math.max(SCALE_MIN, Math.min(SCALE_MAX, Number((v * k).toFixed(4))))) as Vec3;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The piece turned a quarter more about the vertical axis (wrapped to ±π). */
export function labRotate(edit: PieceEdit | undefined): Vec3 {
  const [x, y, z] = edit?.rotation ?? [0, 0, 0];
  return [x, Number(wrap(y + Math.PI / 2).toFixed(6)), z];
}

/** Next opacity step after `current` (absent = opaque). */
export function nextOpacity(current: number | undefined): number {
  const o = current ?? 1;
  const i = LAB_OPACITY_STEPS.findIndex((s) => Math.abs(s - o) < 0.01);
  return LAB_OPACITY_STEPS[(i + 1) % LAB_OPACITY_STEPS.length]!;
}

/** Height of one row of the lab's pieces list (m). */
export const LAB_ROW = 0.068;
/** Rows scrolled per radian of pointer pitch: the list follows the ray at about 1 m. */
export const LAB_SCROLL_GAIN = 1 / LAB_ROW;

/**
 * Scroll of the pieces list (VS-T26), in rows from the top: kept between the first row and the
 * last full window (`LAB_PAGE` rows). Pinch-and-drag up / down moves it, like the views carousel.
 */
export function clampScroll(scroll: number, count: number): number {
  return Math.max(0, Math.min(Math.max(0, count - LAB_PAGE), scroll));
}

/** Row `i` is inside the list's window at `scroll` (a row half out is hidden). */
export function rowShown(i: number, scroll: number): boolean {
  const at = i - scroll;
  return at > -0.5 && at < LAB_PAGE - 0.5;
}
