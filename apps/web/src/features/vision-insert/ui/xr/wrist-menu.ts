import * as THREE from 'three';

/**
 * Wrist menu of the /village VR studio: a small button on the left wrist opens the menu
 * (scan button, guide, HUD) in world space in front of the viewer. Meta hands UI guidance:
 * spawn the menu *from* the wrist but never anchor it to the wrist; keep it static once shown,
 * at ray distance (≥ 0.8 m). Here it lazy-follows: it stays still and only re-centres when
 * the viewer turns or walks away from it.
 */
export const WRIST_BUTTON_ID = 'wrist-menu-button';
/** Visual radius of the wrist button (m). Hit areas are larger (Meta: ≥ 22 mm hit target). */
export const WRIST_BUTTON_RADIUS = 0.022;
/** Fingertip distance from the wrist button that presses it. */
export const WRIST_TOUCH_RADIUS = 0.04;
/** Ray distance from the wrist button centre that hits it. */
export const WRIST_RAY_RADIUS = 0.06;

/** Wrist button offset in the WebXR `wrist` joint space (+Y = back of the hand, +Z = forearm). */
export const WRIST_OFFSET_HAND: [number, number, number] = [0, 0.03, 0.035];
/** Wrist button offset in the left controller grip space (+Y up, +Z toward the forearm). */
export const WRIST_OFFSET_GRIP: [number, number, number] = [0, 0.035, 0.11];
/** Fallback when no left hand / controller is tracked (desktop, mouse): camera space, bottom-left. */
export const WRIST_OFFSET_CAMERA: [number, number, number] = [-0.24, -0.16, -0.6];

/** Menu distance in front of the viewer (Meta ray range 0.8–3 m) and drop below the eyes. */
export const MENU_DISTANCE = 0.9;
export const MENU_DROP = 0.32;
/** Re-centre when the viewer looks this far away from the menu (rad, ~35°)… */
export const FOLLOW_ANGLE = 0.6;
/** …or when its distance / height drifts this much (m). */
export const FOLLOW_DISTANCE = 0.35;
const FOLLOW_SPEED = 5;

/** Shared, mutable menu state: written by the 3D parts each frame, read by the input controller. */
export interface WristMenu {
  open: boolean;
  /** World position of the wrist button, and whether it is placed this frame. */
  button: THREE.Vector3;
  buttonVisible: boolean;
  /** Controller / hand index wearing the button (its own fingertip can't press it), or null. */
  wearer: 0 | 1 | null;
  /** World position of the scan button inside the open menu. */
  scan: THREE.Vector3;
  toggle: () => void;
}

export function createWristMenu(toggle: () => void = () => {}): WristMenu {
  return {
    open: false,
    button: new THREE.Vector3(),
    buttonVisible: false,
    wearer: null,
    scan: new THREE.Vector3(),
    toggle,
  };
}

/** Pose of the menu: where it is drawn, and where it is easing to. */
export interface MenuPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  goalX: number;
  goalY: number;
  goalZ: number;
  goalYaw: number;
}

export function createMenuPose(): MenuPose {
  return { x: 0, y: 0, z: 0, yaw: 0, goalX: 0, goalY: 0, goalZ: 0, goalYaw: 0 };
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Horizontal heading of a direction, 0 = -Z (forward), positive = to the right (+X). */
export const yawOfDirection = (dx: number, dz: number) => Math.atan2(dx, -dz);

/** Sets the goal in front of the head, at `MENU_DISTANCE` along `headYaw`, below the eyes. */
function setGoal(pose: MenuPose, hx: number, hy: number, hz: number, headYaw: number) {
  pose.goalX = hx + Math.sin(headYaw) * MENU_DISTANCE;
  pose.goalZ = hz - Math.cos(headYaw) * MENU_DISTANCE;
  pose.goalY = hy - MENU_DROP;
  pose.goalYaw = headYaw;
}

/**
 * Lazy follow: re-targets only when the viewer looks away (> FOLLOW_ANGLE) or the menu
 * drifts out of place (> FOLLOW_DISTANCE), then eases there. `snap` jumps straight to the
 * goal (menu just opened). Mutates `pose`; no allocation (frame loop).
 */
export function updateLazyFollow(
  pose: MenuPose,
  hx: number,
  hy: number,
  hz: number,
  headYaw: number,
  dt: number,
  snap = false
): MenuPose {
  const dx = pose.goalX - hx;
  const dz = pose.goalZ - hz;
  const away = Math.abs(wrapPi(headYaw - yawOfDirection(dx, dz)));
  const drift = Math.abs(Math.hypot(dx, dz) - MENU_DISTANCE);
  const height = Math.abs(pose.goalY - (hy - MENU_DROP));
  if (snap || away > FOLLOW_ANGLE || drift > FOLLOW_DISTANCE || height > FOLLOW_DISTANCE) {
    setGoal(pose, hx, hy, hz, headYaw);
  }
  if (snap) {
    pose.x = pose.goalX;
    pose.y = pose.goalY;
    pose.z = pose.goalZ;
    pose.yaw = pose.goalYaw;
    return pose;
  }
  const k = 1 - Math.exp(-Math.max(0, dt) * FOLLOW_SPEED);
  pose.x += (pose.goalX - pose.x) * k;
  pose.y += (pose.goalY - pose.y) * k;
  pose.z += (pose.goalZ - pose.z) * k;
  pose.yaw += wrapPi(pose.goalYaw - pose.yaw) * k;
  return pose;
}

/** The parts of `renderer.xr` the wrist button reads. */
export interface WristXR {
  isPresenting?: boolean;
  getControllerGrip?: (i: number) => THREE.Object3D;
  getHand?: (i: number) => THREE.Object3D & { joints?: Record<string, THREE.Object3D> };
}

const pointIn = (space: THREE.Object3D, offset: [number, number, number], out: THREE.Vector3) => {
  space.updateMatrixWorld();
  return out.set(...offset).applyMatrix4(space.matrixWorld);
};

/**
 * Where the wrist button goes this frame (world, into `out`). Returns the input index wearing
 * it: the left hand's `wrist` joint when tracked, else the left controller grip; null when
 * neither is tracked (desktop, emulator mouse): then it sits bottom-left of the camera view.
 */
export function placeWristButton(
  xr: WristXR | undefined,
  handedness: readonly (string | null)[],
  camera: THREE.Object3D,
  out: THREE.Vector3
): 0 | 1 | null {
  const i = handedness.indexOf('left');
  if (xr?.isPresenting && (i === 0 || i === 1)) {
    const hand = xr.getHand?.(i);
    const wrist = hand?.joints?.['wrist'];
    if (hand?.visible && wrist?.visible) {
      pointIn(wrist, WRIST_OFFSET_HAND, out);
      return i;
    }
    const grip = xr.getControllerGrip?.(i);
    if (grip?.visible) {
      pointIn(grip, WRIST_OFFSET_GRIP, out);
      return i;
    }
  }
  pointIn(camera, WRIST_OFFSET_CAMERA, out);
  return null;
}

/** World position of `offset` inside the menu drawn at `pose` with uniform `scale` (into `out`). */
export function menuPointToWorld(
  pose: MenuPose,
  scale: number,
  offset: [number, number, number],
  out: THREE.Vector3
): THREE.Vector3 {
  const [ox, oy, oz] = offset;
  // Rotation about Y by -yaw: local +Z (toward the viewer) maps to (-sin yaw, 0, cos yaw).
  const c = Math.cos(-pose.yaw);
  const s = Math.sin(-pose.yaw);
  return out.set(
    pose.x + scale * (ox * c + oz * s),
    pose.y + scale * oy,
    pose.z + scale * (-ox * s + oz * c)
  );
}

/** Spawn scale of the menu `age` seconds after it opened: eases 60 % → 100 % (fade-in). */
export function menuSpawnScale(age: number, seconds = 0.22): number {
  const k = Math.min(1, Math.max(0, age) / seconds);
  return 0.6 + 0.4 * k * (2 - k);
}
