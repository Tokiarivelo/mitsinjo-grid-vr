/**
 * Placement of the in-headset panels on /village (metres, viewer at the origin facing -Z).
 * Panels sit about 1 m away, below eye level, so the centre of the webcam video stays clear
 * (Meta comfort guidance: ~1 m, slightly below the line of sight, ~70 cm reach for hands).
 */
type Vec3 = [number, number, number];

export const AIR_BUTTON_POSITION: Vec3 = [0, 1.05, -0.95];
/** Ray-pick radius around the scan button (its panel is 0.62 × 0.38 m). */
export const AIR_BUTTON_RADIUS = 0.32;
/** Fingertip distance that counts as pressing the button. */
export const AIR_BUTTON_TOUCH_RADIUS = 0.12;

export const INTERACTION_GUIDE_POSITION: Vec3 = [0, 0.78, -0.9];
export const HUD_POSITION: Vec3 = [-0.78, 1.12, -0.82];
export const HUD_ROTATION: Vec3 = [-0.35, 0.65, 0];
export const LIVE_PILL_POSITION: Vec3 = [0.62, 1.32, -0.9];
