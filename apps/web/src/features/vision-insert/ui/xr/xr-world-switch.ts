import { create } from 'zustand';
import { dissolveProgress } from './lab-dissolve';

/**
 * Lab ↔ village in ONE XR session (VS-T49). A WebXR session lives on one canvas and Meta documents
 * no cross-page immersive navigation, so « Go to the simulation » no longer ends the session and
 * opens /simulation: the /village canvas swaps its world in place, behind a hand-over like the
 * lab's 2D → 3D one (a holographic shell builds up bottom-first around the viewer, the world
 * changes behind it, then it crumbles bottom-first). The viewer never moves (Meta comfort).
 */
export type XrWorld = 'lab' | 'village';
export type XrWorldPhase = 'idle' | 'cover' | 'reveal';

/** Shell building up around the viewer (ms). */
export const WORLD_COVER_MS = 1100;
/** Shell crumbling away on the new world (ms). */
export const WORLD_REVEAL_MS = 1300;

export interface XrWorldSwitch {
  world: XrWorld;
  phase: XrWorldPhase;
  /** World shown once the shell has covered the view. */
  target: XrWorld;
  /** Phase start (ms, `performance.now()` clock). */
  startedAt: number;
}

export const WORLD_SWITCH_START: XrWorldSwitch = {
  world: 'lab',
  phase: 'idle',
  target: 'lab',
  startedAt: 0,
};

/** Asks for `target`: starts covering, unless already there or a hand-over runs. */
export function startWorldSwitch(s: XrWorldSwitch, target: XrWorld, now: number): XrWorldSwitch {
  if (s.phase !== 'idle' || s.world === target) return s;
  return { ...s, phase: 'cover', target, startedAt: now };
}

/** Advances the hand-over: covered → the world swaps and the reveal starts; revealed → idle. */
export function advanceWorldSwitch(s: XrWorldSwitch, now: number): XrWorldSwitch {
  if (s.phase === 'cover' && now - s.startedAt >= WORLD_COVER_MS)
    return { ...s, world: s.target, phase: 'reveal', startedAt: now };
  if (s.phase === 'reveal' && now - s.startedAt >= WORLD_REVEAL_MS) return { ...s, phase: 'idle' };
  return s;
}

/**
 * The shell's band on the viewer's sphere, as heights 0 (feet) – 1 (top): shown between `low` and
 * `high`. Cover: rises from the floor; reveal: the bottom crumbles first. Eased like the lab.
 */
export function worldShellBand(s: XrWorldSwitch, now: number): { low: number; high: number } {
  if (s.phase === 'cover')
    return { low: 0, high: dissolveProgress(now - s.startedAt, WORLD_COVER_MS) };
  if (s.phase === 'reveal')
    return { low: dissolveProgress(now - s.startedAt, WORLD_REVEAL_MS), high: 1 };
  return { low: 0, high: 0 };
}

interface XrWorldStore extends XrWorldSwitch {
  go: (target: XrWorld) => void;
  step: () => void;
  reset: () => void;
}

/** The /village canvas's world, shared by the lab's table, the village's back button and the shell. */
export const useXrWorld = create<XrWorldStore>()((set, get) => ({
  ...WORLD_SWITCH_START,
  go: (target) => {
    const next = startWorldSwitch(get(), target, performance.now());
    if (next !== get()) set(next);
  },
  step: () => {
    const next = advanceWorldSwitch(get(), performance.now());
    if (next !== get()) set(next);
  },
  reset: () => set(WORLD_SWITCH_START),
}));

/** The lab is hidden behind the simulation's village: its frame loops and keys stand still. */
export const labSuspended = (): boolean => useXrWorld.getState().world !== 'lab';
