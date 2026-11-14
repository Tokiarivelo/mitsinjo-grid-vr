import type { AlignedViews, GridView } from '../recon/views';

/**
 * Car proportions (PQ-T76): a car's shape is its profile. Read on the elevations only, never on the
 * view from above (Muse draws it too wide), and not clamped by the views grid. Pure.
 */

/**
 * Proportions read on the elevations only (PQ-T76, vehicles): width from the front, depth from the
 * side profile, both per unit height (`AlignedViews.aspects`, not clamped by the grid). A car's
 * shape is its profile; Muse draws its view from above too wide (mirrors, perspective), so the plan
 * does not set the depth here. Largest side = 1.
 */
export function profileProportions(aspects: { w: number; d: number }): {
  w: number;
  h: number;
  d: number;
} {
  const ok = (v: number) => (v > 0 && Number.isFinite(v) ? v : 1);
  const [w, h, d] = [ok(aspects.w), 1, ok(aspects.d)];
  const max = Math.max(w, h, d);
  const unit = (v: number) => Math.max(0.01, Math.min(1, v / max));
  return { w: unit(w), h: unit(h), d: unit(d) };
}

/**
 * Share of the front view's width taken by the body (PQ-T76): its widest row in the lower half
 * over its widest row anywhere. Wing mirrors stick out above the beltline only, so a front drawn
 * with them reads narrower (0.91 on the drawn SUV); a bumper or a body that is widest low reads 1.
 */
export function bodyWidthShare(view: GridView): number {
  const span = (y: number) => {
    let [a, b] = [-1, -1];
    for (let x = 0; x < view.cols; x++)
      if (view.mask[y * view.cols + x]) {
        if (a < 0) a = x;
        b = x;
      }
    return a < 0 ? 0 : b - a + 1;
  };
  let [all, low] = [0, 0];
  for (let y = 0; y < view.rows; y++) {
    const s = span(y);
    all = Math.max(all, s);
    if (y >= view.rows / 2) low = Math.max(low, s);
  }
  return all && low ? low / all : 1;
}

/** Width and depth per unit height of a vehicle: the front's body width (no mirrors), the profile's length. */
export function vehicleAspects(aligned: Pick<AlignedViews, 'aspects' | 'views'>): {
  w: number;
  d: number;
} {
  return {
    w: aligned.aspects.w * bodyWidthShare(aligned.views.front),
    d: aligned.aspects.d,
  };
}
