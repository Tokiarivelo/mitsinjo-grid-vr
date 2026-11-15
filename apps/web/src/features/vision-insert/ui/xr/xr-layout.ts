/**
 * Placement of the in-headset panels on /village (metres, viewer at the origin facing -Z).
 * Panels sit about 1 m away, below eye level, so the centre of the webcam video stays clear
 * (Meta comfort guidance: ~1 m, slightly below the line of sight, ~70 cm reach for hands).
 */
type Vec3 = [number, number, number];

/**
 * Inside the wrist menu (`wrist-menu.ts`), relative to its centre (0.9 m ahead, below the eyes,
 * facing the viewer): scan button in the middle, guide under it, HUD angled on the left.
 */
export const MENU_SCAN_OFFSET: Vec3 = [0, 0.06, 0];
export const MENU_GUIDE_OFFSET: Vec3 = [0, -0.25, 0];
export const MENU_HUD_OFFSET: Vec3 = [-0.66, 0.06, 0.22];
export const MENU_HUD_ROTATION: Vec3 = [-0.1, 0.55, 0];
/** Ray-pick radius around the scan button (its panel is 0.62 × 0.38 m). */
export const AIR_BUTTON_RADIUS = 0.32;
/** Fingertip distance that counts as pressing the button. */
export const AIR_BUTTON_TOUCH_RADIUS = 0.12;

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

/**
 * Extraction panels (VS-T19–T22): world-locked where the viewer looks when they open (Meta: static
 * once shown), 1.1 m ahead (ray range 0.8–3 m, out of the 0.5–0.8 m hand-off zone), a little
 * below the eyes, level (no pitch, no roll).
 */
export const EXTRACT_DISTANCE = 1.1;
export const EXTRACT_DROP = 0.12;

export interface PanelAnchor {
  position: Vec3;
  /** Heading (rad), 0 = facing -Z; the panel group turns by -yaw about Y. */
  yaw: number;
}

/** Anchor `distance` m ahead of `eye` along the horizontal heading of `dir`, `drop` m lower. */
export function anchorAhead(
  eye: Vec3,
  dir: Vec3,
  distance = EXTRACT_DISTANCE,
  drop = EXTRACT_DROP
): PanelAnchor {
  const flat = Math.hypot(dir[0], dir[2]);
  const yaw = flat < 1e-6 ? 0 : Math.atan2(dir[0], -dir[2]);
  const round = (n: number) => Number(n.toFixed(3));
  return {
    position: [
      round(eye[0] + Math.sin(yaw) * distance),
      round(eye[1] - drop),
      round(eye[2] - Math.cos(yaw) * distance),
    ],
    yaw,
  };
}

/** Views carousel: slides on an arc round the viewer, this far apart (rad, ~26°). */
export const CAROUSEL_SPACING = 0.45;
export const CAROUSEL_RADIUS = 1.25;
export const SLIDE_SIZE = 0.46;

/**
 * Position and turn of a slide `rel` steps from the focused one (rel 0 = straight ahead), on an
 * arc of `CAROUSEL_RADIUS` round the viewer (local panel space: viewer at +Z of the anchor).
 */
export function slidePose(rel: number): { position: Vec3; yaw: number; focus: number } {
  const a = rel * CAROUSEL_SPACING;
  const back = EXTRACT_DISTANCE; // anchor sits this far ahead of the eye
  return {
    position: [
      Number((Math.sin(a) * CAROUSEL_RADIUS).toFixed(3)),
      0,
      Number((back - Math.cos(a) * CAROUSEL_RADIUS).toFixed(3)),
    ],
    yaw: -a,
    focus: Math.max(0, 1 - Math.abs(rel)),
  };
}
