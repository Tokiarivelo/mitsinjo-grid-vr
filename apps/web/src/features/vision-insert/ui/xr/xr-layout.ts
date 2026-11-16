/**
 * Placement of the in-headset panels on /village (metres, viewer at the origin facing -Z).
 * Panels sit about 1 m away, below eye level, so the centre of the webcam video stays clear
 * (Meta comfort guidance: ~1 m, slightly below the line of sight, ~70 cm reach for hands).
 */
export type Vec3 = [number, number, number];

/**
 * Inside the wrist menu (`wrist-menu.ts`), relative to its centre (0.9 m ahead, below the eyes,
 * facing the viewer): scan button in the middle, guide under it, « Close » at its top right.
 */
export const MENU_SCAN_OFFSET: Vec3 = [0, 0.06, 0];
export const MENU_GUIDE_OFFSET: Vec3 = [0, -0.25, 0];
/** « Show the controls help » button, under the guide (Meta: let people recall the help). */
export const MENU_HELP_OFFSET: Vec3 = [0, -0.37, 0];
/** « Hide the hands & controllers » button, under the help one (VS-T30). */
export const MENU_INPUTS_OFFSET: Vec3 = [0, -0.47, 0];
/**
 * « Leave the studio » / « Back to the studio » (VS-T26): right of where the menu opens, clear of
 * the scan panel, mirroring the floating « Menu » button on the left; lazy-follows the viewer.
 */
export const STUDIO_DOOR_OFFSET: Vec3 = [0.54, 0.06, 0];
/** « Cancel / Retry the analysis » (VS-T26): centred under the view, where the menu opens. */
export const SCAN_CONTROL_OFFSET: Vec3 = [0, 0.02, 0];
/** Scan card size (m), centred on `MENU_SCAN_OFFSET`. */
export const AIR_CARD = { width: 0.62, height: 0.38 } as const;
/** Outer radius of the scan button's orbit rings (m), and their floating bob (± m). */
export const AIR_RINGS_RADIUS = 0.094;
export const AIR_BOB = 0.04;
/**
 * Crystal and rings above the scan card (local to the button): clear of the card's top edge
 * even at the low end of the bob, so they never cover the « Targets acquired » pill or the title.
 */
export const AIR_CRYSTAL_Y = Number((AIR_CARD.height / 2 + AIR_RINGS_RADIUS + 0.03).toFixed(3));
/** « Close » the menu (VS-T32): above the scan card's top right (clear of its bob), right of the crystal. */
export const MENU_CLOSE_SIZE = { width: 0.14, height: 0.07 } as const;
export const MENU_CLOSE_OFFSET: Vec3 = [
  0.24,
  Number((MENU_SCAN_OFFSET[1] + AIR_CARD.height / 2 + AIR_BOB + 0.055).toFixed(3)),
  0.02,
];
/**
 * Event notice (VS-T32, replaces the telemetry HUD's event line): just under the line of sight
 * in the follow frame; above the scan button's crystal while the menu is open.
 */
export const EVENT_TOAST_OFFSET: Vec3 = [0, 0.2, 0];
export const EVENT_TOAST_OFFSET_MENU: Vec3 = [0, 0.62, 0];
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
/**
 * Label card and « Put away » button of a miniature (VS-T32), above its model, turned toward the
 * viewer at the origin (Y-rotation of a plane whose front faces (0, y, 0) from `slot`).
 */
export const MINIATURE_LABEL_Y = 0.24;
export const faceOrigin = (slot: Vec3) => Number(Math.atan2(-slot[0], -slot[2]).toFixed(3));

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

/**
 * Views carousel: slides on an arc round the viewer, this far apart (rad, ~32°). 0.6 m slides at
 * 1.25 m (~27° wide, VS-T25: they read from where the studio opens, without walking up).
 */
export const CAROUSEL_SPACING = 0.56;
export const CAROUSEL_RADIUS = 1.25;
export const SLIDE_SIZE = 0.6;

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

/**
 * 3D studio (VS-T24): the generation column (progress card + miniature) on the right of the panel
 * anchor, past the carousel's right neighbour, turned toward the viewer (~65° to the right).
 */
export const STUDIO_COLUMN_POSITION: Vec3 = [1.25, 0, 0.55];
export const STUDIO_COLUMN_YAW = 1.1;

/**
 * Chat of the 2D views (VS-T27): mirror of the generation column, on the left past the carousel's
 * left neighbour, turned toward the viewer (~1.4 m away: ray range). Lifted 8 cm so its holo
 * keyboard, tilted up below it, stays above ~30° under the line of sight (Meta: no neck strain).
 */
export const STUDIO_CHAT_POSITION: Vec3 = [-1.25, 0.12, 0.55];
export const STUDIO_CHAT_YAW = 1.1;
/**
 * Chat panel width and history height (m), and the distance it is read from (text sized in dmm
 * for it, VS-T29); keys ≈ 6.8 cm wide (≥ 3° hit target at 1.4 m).
 */
export const CHAT_PANEL = { width: 0.68, historyHeight: 0.4, distance: 1.4 } as const;

/**
 * Village hologram of the lab (VS-T28): a round table of the village core on the right, past the
 * lab tools, turned toward the viewer (~1.3 m) and tilted 35° so its far edge rises toward the eyes.
 */
export const VILLAGE_TABLE = {
  position: [1.18, -0.12, 0.62] as Vec3,
  yaw: -1.05,
  tilt: 0.6,
  /** Table radius (m): the 30-unit village core, a building ≈ 4 cm. */
  radius: 0.32,
  /** Distance (m) its title, status and buttons (above the far edge) are read from. */
  distance: 1.55,
} as const;

/**
 * Studio desks (VS-T31): the 2D lab (views) and the 3D lab (build, lab) stand back to back on a
 * turntable centred on the viewer. Going to the 3D lab turns it right to left (desks slide to
 * the left, the 3D one comes in from the right), going back turns it the other way. Only the desks
 * turn (the dome and the grid stay still: no vection); eased in and out over `DESK_TURN_SECONDS`.
 */
export const DESK_TURN_SECONDS = 1.1;

/** Smoothstep ease of a 0..1 progress. */
const ease = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};

/** Turntable angle (rad, + = counter-clockwise from above = to the left): 0 = 2D desk ahead, π = 3D. */
export function deskTurnAngle(to: '2d' | '3d', progress: number): number {
  const e = ease(progress);
  return Math.PI * (to === '3d' ? e : 1 - e);
}

/** Yaw (rad, about the viewer) of one desk at turntable angle `angle`: the 3D desk sits behind. */
export const deskYaw = (desk: '2d' | '3d', angle: number) =>
  desk === '2d' ? angle : angle - Math.PI;

/** Turntable centre: where the viewer stood when the panels' anchor was set. */
export function deskPivot(anchor: PanelAnchor, distance = EXTRACT_DISTANCE): Vec3 {
  const [x, y, z] = anchor.position;
  return [
    Number((x - Math.sin(anchor.yaw) * distance).toFixed(3)),
    y,
    Number((z + Math.cos(anchor.yaw) * distance).toFixed(3)),
  ];
}

/**
 * « 2D lab » button of the 3D lab (VS-T31): far left, past the pieces list (the 2D desk comes back
 * from the left), turned toward the viewer (~1.15 m away).
 */
export const LAB_TO_VIEWS = {
  position: [-1.02, -0.05, 0.55] as Vec3,
  yaw: Number(Math.atan2(1.02, EXTRACT_DISTANCE - 0.55).toFixed(3)),
  distance: 1.16,
} as const;
