/**
 * /simulation VR walker sizing and desktop keys (VS-T33). Pure.
 *
 * The village is a half-scale model (house walls 1.3 m, doors ≈ 0.9 m) while a headset puts the eyes
 * 1.6–1.8 m above the floor: at 1:1 the viewer towers over the roofs. The camera rig is scaled
 * instead, so eyes, hands, steps and speed shrink together and a house reads like a house. The rooms
 * you enter (`SimXrInterior`, 2.7 m ceiling) are built at 1:1.
 */
export const XR_VILLAGE_SCALE = 0.5;

/** Rig scale: village outside (half scale), rooms inside (1:1). */
export function xrWorldScale(interior: boolean): number {
  return interior ? 1 : XR_VILLAGE_SCALE;
}

/** Keyboard head turn (rad/s): ← / → turn while walking, no mouse needed. */
export const XR_KEY_TURN_SPEED = Math.PI / 2;

export interface XrKeyAxes {
  /** −1 left … +1 right (strafe). */
  moveX: number;
  /** −1 forward … +1 back. */
  moveZ: number;
  /** +1 turns left, −1 right (three.js yaw). */
  turn: number;
  run: boolean;
}

/**
 * Held keys (`KeyboardEvent.code`) → walk axes. W / Z / ↑ forward, S / ↓ back, A / Q / D strafe
 * (QWERTY and AZERTY), ← / → turn the head: a laptop touchpad is off while a key is held
 * (« disable while typing »), so the mouse can't look around during a walk.
 */
export function readXrKeys(keys: ReadonlySet<string>): XrKeyAxes {
  const has = (...codes: string[]) => codes.some((c) => keys.has(c));
  return {
    moveX: (has('KeyD') ? 1 : 0) - (has('KeyA', 'KeyQ') ? 1 : 0),
    moveZ: (has('KeyS', 'ArrowDown') ? 1 : 0) - (has('KeyW', 'KeyZ', 'ArrowUp') ? 1 : 0),
    turn: (has('ArrowLeft') ? 1 : 0) - (has('ArrowRight') ? 1 : 0),
    run: has('ShiftLeft', 'ShiftRight'),
  };
}
