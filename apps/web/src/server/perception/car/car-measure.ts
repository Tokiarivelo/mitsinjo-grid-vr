import 'server-only';

import type { CarPlan } from '@/lib/car-plan';
import { sharpView } from '../house/house-specialist';
import type { AlignedViews, ViewFrame, ViewName } from '../recon/views';
import { dropShadow, measureCar } from './car-wheels';

/**
 * The measured car plan (PQ-T76): the profile and the front cut from their validated drawings at
 * their own resolution (square cells, about `CAR_MEASURE_ROWS` rows: the reading grid's 128 rows
 * leave a tyre's lower arc a few cells high), then `measureCar`. Never throws: null = no plan.
 */

/** Rows of the sharp views the wheels are measured on. */
export const CAR_MEASURE_ROWS = 400;

/** Columns that keep the drawing's cells square at `rows` rows. */
export const squareCols = (frame: ViewFrame, rows = CAR_MEASURE_ROWS) =>
  Math.max(
    8,
    Math.round((rows * (frame.box.x1 - frame.box.x0 + 1)) / (frame.box.y1 - frame.box.y0 + 1))
  );

export async function measureCarPlan(
  pngs: Partial<Record<ViewName, Buffer>>,
  aligned: Pick<AlignedViews, 'frames' | 'rightFromLeft'>
): Promise<CarPlan | null> {
  try {
    const sideFrame = aligned.frames.right;
    const sidePng = aligned.rightFromLeft ? pngs.left : pngs.right;
    if (!sideFrame || !sidePng) return null;
    const sharpSide = await sharpView(sidePng, sideFrame, squareCols(sideFrame));
    if (!sharpSide) return null;
    const side = dropShadow(sharpSide, sideFrame.paper);
    const frontFrame = aligned.frames.front;
    const front =
      frontFrame && pngs.front
        ? await sharpView(pngs.front, frontFrame, squareCols(frontFrame))
        : null;
    return measureCar(side, front);
  } catch (err) {
    console.warn('[vision] car measure failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
