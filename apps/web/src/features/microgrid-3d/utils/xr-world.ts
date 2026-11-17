import { MENU_DISTANCE } from '@/features/vision-insert/ui/xr/wrist-menu';
import { MINI_MAP_OFFSET } from './sim-xr-minimap';

/**
 * « Back to the lab » in the /village VR world (VS-T49): low left in the lazy-follow frame (m), at
 * the minimap's height, never ahead over the village labels. It sits well inside the follow's dead
 * zone (`FOLLOW_ANGLE`): turning the head (or the emulator mouse) toward it must not re-centre the
 * frame, else it runs away from the laser. A chip on its inner side hides or shows it.
 */
export const BACK_TO_LAB_SIZE: [number, number] = [0.26, 0.085];
export const BACK_TO_LAB_OFFSET: [number, number, number] = [-0.38, MINI_MAP_OFFSET[1], 0];
/** The hide / show chip: square, right of the button (local x, m). */
export const BACK_TO_LAB_CHIP = 0.07;
export const BACK_TO_LAB_CHIP_X = BACK_TO_LAB_SIZE[0] / 2 + 0.015 + BACK_TO_LAB_CHIP / 2;

/** Widest angle from straight ahead to any part of the button (rad): kept under the follow's. */
export function backToLabFarAngle(): number {
  const far = Math.abs(BACK_TO_LAB_OFFSET[0]) + BACK_TO_LAB_SIZE[0] / 2;
  return Math.atan2(far, MENU_DISTANCE);
}
