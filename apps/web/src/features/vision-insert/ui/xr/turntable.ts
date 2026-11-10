/**
 * Turntable state of a 3D miniature: spins on its own, and the viewer can hold it to rotate it
 * (kinematic, no alignment: it stays on its pedestal, Meta grab specs). Mutated in the frame
 * loop, never through React state.
 */
export interface Turntable {
  yaw: number;
  pitch: number;
  /** Input currently holding it (0/1 = XR controller or hand, 'mouse'), or null. */
  heldBy: number | 'mouse' | null;
  /** Time (ms) the hold started; used to tell a tap from a drag. */
  heldSince: number;
  /** Absolute rotation (rad) applied during the current hold. */
  dragged: number;
  /** Time (ms) of the last release: auto-spin resumes after `SPIN_RESUME_MS`. */
  releasedAt: number;
}

/** Auto-spin speed (rad/s): one turn in ~12 s. */
export const SPIN_SPEED = 0.5;
export const SPIN_RESUME_MS = 1500;
/** Pitch limit (rad) so the model never turns upside down. */
export const MAX_PITCH = Math.PI / 3;
/**
 * A release counts as a tap when almost not rotated, within this time. Generous on purpose:
 * the emulator holds `select` ~1 s; any real rotation (> TAP_MAX_ANGLE) is never a tap.
 */
export const TAP_MAX_MS = 1200;
export const TAP_MAX_ANGLE = 0.15;

export function createTurntable(): Turntable {
  return { yaw: 0, pitch: 0, heldBy: null, heldSince: 0, dragged: 0, releasedAt: -Infinity };
}

/** Advances the auto-spin; a held or just-released miniature stays where the viewer left it. */
export function spinTurntable(t: Turntable, dt: number, now: number): void {
  if (t.heldBy !== null || now - t.releasedAt < SPIN_RESUME_MS) return;
  t.yaw = wrapAngle(t.yaw + SPIN_SPEED * dt);
  // Ease the tilt back to level while spinning.
  t.pitch *= Math.max(0, 1 - dt * 1.5);
}

export function grabTurntable(t: Turntable, by: number | 'mouse', now: number): void {
  t.heldBy = by;
  t.heldSince = now;
  t.dragged = 0;
}

export function rotateTurntable(t: Turntable, dYaw: number, dPitch: number): void {
  t.yaw = wrapAngle(t.yaw + dYaw);
  t.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, t.pitch + dPitch));
  t.dragged += Math.abs(dYaw) + Math.abs(dPitch);
}

/** Releases the miniature; returns true when the hold was a tap (short, almost no rotation). */
export function releaseTurntable(t: Turntable, now: number): boolean {
  if (t.heldBy === null) return false;
  const tap = now - t.heldSince <= TAP_MAX_MS && t.dragged <= TAP_MAX_ANGLE;
  t.heldBy = null;
  t.releasedAt = now;
  return tap;
}

function wrapAngle(a: number): number {
  const TAU = Math.PI * 2;
  return ((a % TAU) + TAU) % TAU;
}
