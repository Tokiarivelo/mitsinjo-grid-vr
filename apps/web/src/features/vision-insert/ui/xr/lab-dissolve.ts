/**
 * The 2D → 3D hand-over on the lab pedestal (pure part): the drawn card disintegrates bottom-up
 * into the plate while the 3D model rises in its place below the same line. Times in ms, heights
 * in metres above the plate top.
 */

/** Length of the hand-over once the model is there. */
export const DISSOLVE_MS = 2600;
/** Longest wait for the model's meshes before the hand-over starts anyway. */
export const DISSOLVE_WAIT_MS = 4000;
/** Share of the card height the noisy edge spans. */
export const DISSOLVE_EDGE = 0.12;
/** Grains falling from the card into the plate (one draw call). */
export const DISSOLVE_GRAINS = 220;
/** Share of the card height a grain falls over before it is gone. */
export const GRAIN_LIFE = 0.35;

/** Eased progress 0 → 1 of the hand-over (smooth start and landing). */
export function dissolveProgress(elapsedMs: number, durationMs = DISSOLVE_MS): number {
  const t = Math.min(1, Math.max(0, elapsedMs / Math.max(1, durationMs)));
  return t * t * (3 - 2 * t);
}

/**
 * The line (m above the plate) at `progress`: from the plate to past the higher of the card and
 * the model, plus the edge, so both finish together.
 */
export function dissolveLevel(progress: number, top: number): number {
  return Math.max(0, progress) * Math.max(top, 0) * (1 + DISSOLVE_EDGE);
}

/** The line as a share of the card's height (0 = its bottom), clamped to 0 – 1 + edge. */
export function cardLevel(level: number, bottom: number, height: number): number {
  const v = (level - bottom) / Math.max(height, 1e-6);
  return Math.min(1 + DISSOLVE_EDGE, Math.max(0, v));
}

/**
 * Grain seeds: x across the card (−0.5 – 0.5), the height share it leaves at (0 – 1) and a
 * jitter (0 – 1), from a seeded generator (same grains every time, no `Math.random`).
 */
export function dissolveSeeds(n = DISSOLVE_GRAINS, seed = 7): Float32Array {
  let s = seed >>> 0;
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = next() - 0.5;
    out[i * 3 + 1] = next();
    out[i * 3 + 2] = next();
  }
  return out;
}

/** A grain's age 0 – 1 at card level `v` (< 0 = not yet left, ≥ 1 = gone), as the shader does it. */
export function grainAge(born: number, v: number): number {
  return (v - born) / GRAIN_LIFE;
}

/** Dev only: what `make vr-probe` reads of the lab's motion (one object, mutated in place). */
export interface LabMotionProbe {
  /** Hand-over progress 0 – 1. */
  dissolve: number;
  /** Frames drawn mid-way (0 < progress < 1) in the last hand-over: many = a gradual change. */
  frames: number;
  /** Model turn on the plate (rad). */
  yaw: number;
}

export function labMotionProbe(): LabMotionProbe | null {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return null;
  const w = window as Window & { __VR_LAB_MOTION__?: LabMotionProbe };
  w.__VR_LAB_MOTION__ ??= { dissolve: 0, frames: 0, yaw: 0 };
  return w.__VR_LAB_MOTION__;
}
