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

/**
 * 3D miniatures: on pedestals within arm's reach (~0.55 m, Meta: ~45–70 cm for direct
 * manipulation), just below eye level, fanned right then left so the video centre stays clear.
 */
export const MINIATURE_SIZE = 0.22;
/** Ray / hand distance (m) from a miniature's centre that grabs it. */
export const MINIATURE_GRAB_RADIUS = 0.16;
const MINIATURE_REACH = 0.55;
const MINIATURE_Y = 1.28;
const MINIATURE_ANGLES = [18, -18, 42, -42, 66, -66];

/** Pedestal position of the `index`-th materialized object (beyond 6: a second, higher row). */
export function miniatureSlot(index: number): Vec3 {
  const i = Math.max(0, Math.floor(index));
  const deg = MINIATURE_ANGLES[i % MINIATURE_ANGLES.length]!;
  const row = Math.floor(i / MINIATURE_ANGLES.length);
  const a = (deg * Math.PI) / 180;
  const round = (n: number) => Number(n.toFixed(3));
  return [
    round(Math.sin(a) * MINIATURE_REACH),
    round(MINIATURE_Y + row * 0.3),
    round(-Math.cos(a) * MINIATURE_REACH),
  ];
}

/** Scales a model's size so its largest side is `MINIATURE_SIZE`, keeping proportions. */
export function miniatureDimensions(size: Vec3): Vec3 {
  const k = MINIATURE_SIZE / Math.max(size[0], size[1], size[2], 1e-6);
  return size.map((s) => Number((s * k).toFixed(3))) as Vec3;
}
