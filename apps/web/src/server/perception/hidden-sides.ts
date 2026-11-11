import 'server-only';

import type { KitArchetype, ObjectKit } from '@/lib/object-kit';
import { frontPartIndex, type ObjectRecipe, type RecipePart } from '@/lib/object-shape';
import { MASK_YAW_MAX, PART_MIRROR_MIN_Z } from './mask-geometry';

/**
 * Hidden-side deduction (PR-2.16): rule-based multiview completion, pre-S4. From the fitted
 * recipe + yaw + one symmetry rule per archetype, derives the parts the photo cannot show —
 * back facade, gable-end windows, sedan rear door — as inferred parts (PR-2.15 statuses are
 * stamped later by the graph). No generative views: every size and colour is copied from a
 * visible part, never invented. Gated like the mirrors (low yaw only: past ~17° the far side
 * is guesswork, PR-2.12) and set-atomic against the caller's room (a half-mirrored back is
 * incoherent, so a set that does not fit is withheld whole). Deduced plates protrude 0.001
 * past their face: visible from outside, silhouette-neutral from the photo view.
 */

/** How far a deduced plate sticks out of its face. */
const FACE_PROTRUDE = 0.001;

/** Thin face plate (glass, door, decal): same cut as the graph's panels. */
function isFacePlate(p: RecipePart, main: RecipePart): boolean {
  return p !== main && p.shape === 'box' && p.size[2] <= 0.05;
}

/**
 * A back-side plate already mirroring the front one (e.g. the panels mirror ran first, exact
 * z-negated or face-derived: x/y within float dust, size and colour exact).
 */
function hasBackTwin(parts: ReadonlyArray<RecipePart>, p: RecipePart): boolean {
  return parts.some(
    (q) =>
      q.at[2] < -PART_MIRROR_MIN_Z &&
      q.shape === p.shape &&
      q.color === p.color &&
      q.size[0] === p.size[0] &&
      q.size[1] === p.size[1] &&
      q.size[2] === p.size[2] &&
      Math.abs(q.at[0] - p.at[0]) < 0.02 &&
      Math.abs(q.at[1] - p.at[1]) < 0.02
  );
}

/** The same deduced plate twice (two identical front decals): exact match, same sign. */
function samePlace(a: RecipePart, b: RecipePart): boolean {
  return (
    a.shape === b.shape &&
    a.color === b.color &&
    a.size[0] === b.size[0] &&
    a.size[1] === b.size[1] &&
    a.size[2] === b.size[2] &&
    a.at[0] === b.at[0] &&
    a.at[1] === b.at[1] &&
    a.at[2] === b.at[2]
  );
}

/** A plate already sitting where the candidate goes (measured or deduced earlier). */
function occupied(parts: ReadonlyArray<RecipePart>, c: RecipePart): boolean {
  return parts.some(
    (q) =>
      q.shape === c.shape &&
      Math.abs(q.at[0] - c.at[0]) < 0.06 &&
      Math.abs(q.at[1] - c.at[1]) < 0.06 &&
      Math.abs(q.at[2] - c.at[2]) < 0.06
  );
}

export interface HiddenSidesOptions {
  /** Fitted yaw (rad): past the mirror gate nothing is deduced. */
  yaw: number;
  /** Palette: the rear door reads the trim colour, never a fresh hex. */
  colors: ObjectKit['colors'];
  /** Free part slots; sets that do not fit are withheld whole. */
  room: number;
  /** Slots for the far-side mirror (PQ-T22), which may use measured-part room up to `MAX_COMPONENTS`; default `room`. */
  farRoom?: number;
}

/**
 * Hidden-side parts to append to a fitted recipe. Pure: same inputs → same parts. The caller
 * owns the budget backstop; statuses are stamped by the graph pass that follows.
 */
export function deduceHiddenSides(
  archetype: KitArchetype,
  recipe: ObjectRecipe,
  { yaw, colors, room, farRoom = room }: HiddenSidesOptions
): RecipePart[] {
  if (Math.abs(yaw) > MASK_YAW_MAX || Math.max(room, farRoom) <= 0) return [];
  const main = recipe.parts[frontPartIndex(recipe)]!;
  const sets: Array<{ parts: RecipePart[]; far?: true }> = [];
  if (archetype === 'house') {
    sets.push({ parts: endWindows(recipe.parts, main) }, { parts: backFacade(recipe.parts, main) });
  } else if (archetype === 'building') {
    sets.push({ parts: backFacade(recipe.parts, main) });
  } else if (archetype === 'vehicle') {
    sets.push(
      { parts: farSide(recipe.parts, main, VEHICLE_MIRRORED), far: true },
      { parts: rearDoor(recipe.parts, main, colors) }
    );
  } else if (archetype === 'cabinet') {
    sets.push({ parts: farSide(recipe.parts, main, CABINET_MIRRORED), far: true });
  }
  const out: RecipePart[] = [];
  let left = Math.floor(room);
  let leftFar = Math.floor(farRoom);
  for (const { parts, far } of sets) {
    if (parts.length === 0 || parts.length > (far ? leftFar : left)) continue;
    out.push(...parts);
    left -= parts.length;
    leftFar -= parts.length;
  }
  return out;
}

/** Rear door opposite the front door, back windows: front plates mirrored onto the back face. */
function backFacade(parts: ReadonlyArray<RecipePart>, main: RecipePart): RecipePart[] {
  const back = main.at[2] - main.size[2] / 2;
  const twins: RecipePart[] = [];
  for (const p of parts) {
    if (!isFacePlate(p, main) || p.at[2] < PART_MIRROR_MIN_Z) continue;
    const t = p.size[2] / 2;
    const twin: RecipePart = {
      ...p,
      at: [p.at[0], p.at[1], back - FACE_PROTRUDE + t],
      status: undefined,
    };
    if (hasBackTwin(parts, p) || twins.some((q) => samePlace(q, twin))) continue;
    twins.push(twin);
  }
  return twins;
}

/**
 * One window per gable end, copied from the shortest front plate (doors stand taller than
 * windows, so the shortest plate is a window). Thin in x: the graph never clamps it.
 */
function endWindows(parts: ReadonlyArray<RecipePart>, main: RecipePart): RecipePart[] {
  const plates = parts.filter((p) => isFacePlate(p, main) && p.at[2] > PART_MIRROR_MIN_Z);
  if (plates.length === 0) return [];
  const ref = plates.reduce((a, b) => (a.size[1] <= b.size[1] ? a : b));
  const t = 0.02;
  const halfW = main.size[0] / 2;
  const wins = (forX: 1 | -1): RecipePart => ({
    shape: 'box',
    at: [main.at[0] + forX * (halfW - t / 2 + FACE_PROTRUDE), ref.at[1], main.at[2]],
    size: [t, ref.size[1], ref.size[0]],
    color: ref.color,
  });
  const pair = [wins(1), wins(-1)];
  return pair.some((w) => occupied(parts, w)) ? [] : pair;
}

/**
 * Sedan rear door: the trunk shut-line on the rear face, in the trim colour. Bikes (narrow
 * bodies) have no rear face to shut; lenses are cylinders, so they never block the seam.
 */
function rearDoor(
  parts: ReadonlyArray<RecipePart>,
  main: RecipePart,
  colors: ObjectKit['colors']
): RecipePart[] {
  if (main.size[2] < 0.5) return [];
  const rear = main.at[0] - main.size[0] / 2;
  const t = 0.02;
  const seam: RecipePart = {
    shape: 'box',
    at: [rear - FACE_PROTRUDE + t / 2, main.at[1] + main.size[1] * 0.3, main.at[2]],
    size: [t, 0.03, 0.6 * main.size[2]],
    color: colors.secondary,
  };
  return occupied(parts, seam) ? [] : [seam];
}

/**
 * Kinds that are the same on both sides of a symmetric object (PQ-T22): wheels, glass and lamps of a
 * vehicle, the frame of a cabinet. On a vehicle a part with no kind counts as trim (mirrors, decals). On a
 * cabinet it does not: the kit template's handle and door line carry no kind and sit on the front face,
 * so a kindless cabinet part never crosses to the back. One-sided parts — door, handle, display,
 * chimney, grille, bumper (centred) — are never mirrored.
 */
const VEHICLE_MIRRORED: ReadonlyArray<RecipePart['kind'] | undefined> = [
  'wheel',
  'window',
  'light',
  undefined,
];
const CABINET_MIRRORED: ReadonlyArray<RecipePart['kind'] | undefined> = ['frame'];

/** The same part already stands on the far side (measured or deduced earlier, any dust in x / y). */
function hasFarTwin(parts: ReadonlyArray<RecipePart>, p: RecipePart): boolean {
  return parts.some(
    (q) =>
      q !== p &&
      q.shape === p.shape &&
      q.axis === p.axis &&
      q.at[2] < -PART_MIRROR_MIN_Z &&
      Math.abs(q.at[0] - p.at[0]) < 0.03 &&
      Math.abs(q.at[1] - p.at[1]) < 0.03
  );
}

/**
 * The measured near side mirrored onto the far side (z negated), status left for the graph to stamp
 * `inferred`: wheels, windows and mirrors of a vehicle, trim of a cabinet. Needs parts well clear of
 * the centre plane; the body itself, thin one-sided kinds and details like a handle never move over.
 */
function farSide(
  parts: ReadonlyArray<RecipePart>,
  main: RecipePart,
  kinds: ReadonlyArray<RecipePart['kind'] | undefined>
): RecipePart[] {
  const out: RecipePart[] = [];
  for (const p of parts) {
    if (p === main || p.front || p.at[2] < PART_MIRROR_MIN_Z) continue;
    if (!kinds.includes(p.kind) || hasFarTwin(parts, p)) continue;
    const details = p.details?.filter((d) => d !== 'handle' && d !== 'seam');
    const twin: RecipePart = {
      ...p,
      at: [p.at[0], p.at[1], -p.at[2]],
      status: undefined,
      ...(details?.length ? { details } : {}),
    };
    if (!details?.length) delete (twin as Partial<RecipePart>).details;
    if (out.some((q) => samePlace(q, twin))) continue;
    out.push(twin);
  }
  return out;
}
