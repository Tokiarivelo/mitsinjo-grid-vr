import 'server-only';

import type { KitArchetype } from '@/lib/object-kit';
import {
  frontPartIndex,
  type DimStatus,
  type ObjectRecipe,
  type PartMask,
  type RecipePart,
} from '@/lib/object-shape';
import { isChimneyStack } from './mask-chimney';
import { isWheelPart, PART_MIRROR_MIN_Z, roofTopAbove, type MaskMapGeom } from './mask-geometry';
import { vehicleShell } from './mask-panels';
import { CONCEPT_KINDS } from './detail-score';
import { buildLandmarks, detailParts } from './score-shape';

export interface GraphNode {
  index: number;
  /** Parent part index, or null for the main body (root). */
  parent: number | null;
  status: DimStatus;
}

/** Parent → child graph of one recipe: panel → wall, chimney → roof, wheel → body, gable → wall. */
export interface ObjectGraph {
  nodes: GraphNode[];
}

/** Photo evidence the statuses are judged against (masks need their mapping geometry). */
export interface GraphEvidence {
  outline?: boolean;
  masks?: ReadonlyArray<PartMask>;
  geom?: MaskMapGeom;
  /** A photo was available at all (without one every template prior reads unknown). */
  photo?: boolean;
}

/**
 * Clampable face plate (glass, door, decal): a box whose thinnest axis is z, sitting on (or
 * proud of) either face of its parent. Inset leaves (PR-2.17, centred in the wall) and side
 * plates (end windows, seams: thinnest in x/y) are placed by construction, never clamped.
 */
function isPanelPart(p: RecipePart, parent: RecipePart): boolean {
  if (p === parent || p.shape !== 'box' || p.size[2] > 0.05) return false;
  if (p.size[2] > Math.min(p.size[0], p.size[1])) return false;
  const front = parent.at[2] + parent.size[2] / 2;
  const back = parent.at[2] - parent.size[2] / 2;
  return p.at[2] + p.size[2] / 2 >= front - 0.02 || p.at[2] - p.size[2] / 2 <= back + 0.02;
}

/** Far-side twin of a near part: the same plate back to back. */
function isMirrorTwin(p: RecipePart, q: RecipePart): boolean {
  return (
    p.shape === q.shape &&
    p.color === q.color &&
    p.size[0] === q.size[0] &&
    p.size[1] === q.size[1] &&
    p.size[2] === q.size[2] &&
    p.at[0] === q.at[0] &&
    p.at[1] === q.at[1] &&
    Math.sign(p.at[2]) !== Math.sign(q.at[2])
  );
}

/**
 * Measured lathe check: the lathe pass closes both poles at r = 0, the three template lathes
 * (tank, lamp head, lamp bowl) never do. Extrudes need no check: only the profile pass builds them.
 */
function isMeasuredLathe(p: RecipePart): boolean {
  const profile = p.profile;
  return (
    p.shape === 'lathe' &&
    !!profile &&
    profile.length > 0 &&
    profile[0]![0] === 0 &&
    profile[profile.length - 1]![0] === 0
  );
}

/**
 * Parent → child graph of a recipe (PR-2.14), built once after the mask passes. Panels hang under
 * the face behind them (vehicle shell, else the main body), wheels and gables under the main body,
 * chimney stacks under the roof part they pierce. Pure.
 */
export function buildGraph(
  archetype: KitArchetype,
  recipe: ObjectRecipe,
  evidence?: GraphEvidence
): ObjectGraph {
  const main = recipe.parts[frontPartIndex(recipe)]!;
  const eave = main.at[1] + main.size[1] / 2;
  const shell = archetype === 'vehicle' ? (vehicleShell(recipe.parts, main) ?? main) : main;
  // Mask-matched parts (same matching as the landmark score, PR-0.8): grid numbers discarded.
  const measured = new Set<number>();
  if (evidence?.masks?.length && evidence.geom) {
    for (const lm of buildLandmarks(recipe, evidence.masks, evidence.geom, 1, 1)) {
      measured.add(lm.part);
    }
  }
  const measuredStructure = !!evidence?.outline || (evidence?.masks?.length ?? 0) > 0;
  const roofs = recipe.parts.filter(
    (p) =>
      p !== main &&
      !(archetype === 'house' && isChimneyStack(p, main.at[1], eave)) &&
      p.at[1] + p.size[1] / 2 > eave
  );
  const nodes = recipe.parts.map((p, i) => {
    let parent: number | null = null;
    if (p !== main) {
      if (isPanelPart(p, shell)) {
        parent = recipe.parts.indexOf(shell);
      } else if (isWheelPart(p, main.at[1])) {
        parent = recipe.parts.indexOf(main);
      } else if (archetype === 'house' && isChimneyStack(p, main.at[1], eave)) {
        let best = -1;
        let bestTop = -Infinity;
        for (const r of roofs) {
          if (Math.abs(p.at[0] - r.at[0]) > r.size[0] / 2 + p.size[0] / 2) continue;
          const top = r.at[1] + r.size[1] / 2;
          if (top > bestTop) {
            bestTop = top;
            best = recipe.parts.indexOf(r);
          }
        }
        parent = best >= 0 ? best : recipe.parts.indexOf(main);
      } else {
        parent = recipe.parts.indexOf(main);
      }
    }
    let status: DimStatus;
    if (measured.has(i) || p.shape === 'extrude' || isMeasuredLathe(p)) {
      status = 'measured';
    } else if (
      p.at[2] < -PART_MIRROR_MIN_Z &&
      recipe.parts.some((q) => q !== p && q.at[2] > 0 && isMirrorTwin(p, q))
    ) {
      status = 'inferred';
    } else if (measuredStructure) {
      // Template part placed on measured structure (fitted body, outline): derived, not guessed.
      status = 'inferred';
    } else {
      status = evidence?.photo ? 'estimated' : 'unknown';
    }
    return { index: i, parent, status };
  });
  return { nodes };
}

/** Move smaller than this is float dust, not a fix. */
const FIX_EPS = 1e-9;

/** Clamp a panel into its parent face span (generalises the panels clamp); same ref when clean. */
function clampPanel(p: RecipePart, parent: RecipePart): RecipePart {
  const x0 = parent.at[0] - parent.size[0] / 2;
  const x1 = parent.at[0] + parent.size[0] / 2;
  const y0 = parent.at[1] - parent.size[1] / 2;
  const y1 = parent.at[1] + parent.size[1] / 2;
  const w = Math.min(p.size[0], x1 - x0);
  const h = Math.min(p.size[1], y1 - y0);
  const cx = Math.min(x1 - w / 2, Math.max(x0 + w / 2, p.at[0]));
  const cy = Math.min(y1 - h / 2, Math.max(y0 + h / 2, p.at[1]));
  if (
    Math.abs(cx - p.at[0]) <= FIX_EPS &&
    Math.abs(cy - p.at[1]) <= FIX_EPS &&
    Math.abs(w - p.size[0]) <= FIX_EPS &&
    Math.abs(h - p.size[1]) <= FIX_EPS
  ) {
    return p;
  }
  const at: [number, number, number] = [cx, cy, p.at[2]];
  const size: [number, number, number] = [w, h, p.size[2]];
  return { ...p, at, size };
}

/**
 * Constraint pass (PR-2.14): panels clamp into their parent span, chimney feet drop onto the roof
 * plane. Runs after every reshape; returns the recipe unchanged (same reference) when coherent.
 * Pure: same inputs → same recipe.
 */
export function applyConstraints(archetype: KitArchetype, recipe: ObjectRecipe): ObjectRecipe {
  const main = recipe.parts[frontPartIndex(recipe)]!;
  const eave = main.at[1] + main.size[1] / 2;
  const shell = archetype === 'vehicle' ? (vehicleShell(recipe.parts, main) ?? main) : main;
  const isStack = (p: RecipePart) => archetype === 'house' && isChimneyStack(p, main.at[1], eave);
  const roofTop = roofTopAbove(recipe.parts, eave, (p) => p === main || isStack(p));
  let moved = false;
  const parts = recipe.parts.map((p) => {
    if (isPanelPart(p, shell)) {
      const q = clampPanel(p, shell);
      if (q !== p) moved = true;
      return q;
    }
    if (isStack(p)) {
      const bottom = p.at[1] - p.size[1] / 2;
      if (bottom > roofTop + FIX_EPS) {
        moved = true;
        const at: [number, number, number] = [p.at[0], p.at[1] - (bottom - roofTop), p.at[2]];
        return { ...p, at };
      }
    }
    return p;
  });
  return moved ? { ...recipe, parts } : recipe;
}

/**
 * Coherence violations of a recipe (PR-2.14): panels outside their parent span, chimney stacks
 * floating above the roof. The loop report shows the count; the shipped recipe always scores 0.
 */
export function checkConstraints(archetype: KitArchetype, recipe: ObjectRecipe): number {
  const main = recipe.parts[frontPartIndex(recipe)]!;
  const eave = main.at[1] + main.size[1] / 2;
  const shell = archetype === 'vehicle' ? (vehicleShell(recipe.parts, main) ?? main) : main;
  const isStack = (p: RecipePart) => archetype === 'house' && isChimneyStack(p, main.at[1], eave);
  const roofTop = roofTopAbove(recipe.parts, eave, (p) => p === main || isStack(p));
  let n = 0;
  for (const p of recipe.parts) {
    if (isPanelPart(p, shell)) {
      if (clampPanel(p, shell) !== p) n++;
    } else if (isStack(p)) {
      if (p.at[1] - p.size[1] / 2 > roofTop + FIX_EPS) n++;
    }
  }
  return n;
}

/** Gap (unit space) still counted as touching. */
export const TOUCH_EPS = 0.01;
/** Two parts of one kind closer than this (each axis, unit space) with sizes within `FUSED_SIZE` are one part twice. */
export const FUSED_DIST = 0.02;
export const FUSED_SIZE = 0.1;

type Box3 = { lo: [number, number, number]; hi: [number, number, number] };
const box3 = (p: RecipePart): Box3 => ({
  lo: p.at.map((v, i) => v - p.size[i]! / 2) as [number, number, number],
  hi: p.at.map((v, i) => v + p.size[i]! / 2) as [number, number, number],
});

/** Per-axis move that brings `a` against `b` (0 on an axis where they already overlap or touch). */
function gapShift(a: Box3, b: Box3): [number, number, number] {
  return [0, 1, 2].map((i) =>
    a.hi[i]! < b.lo[i]! - TOUCH_EPS
      ? b.lo[i]! - a.hi[i]!
      : a.lo[i]! > b.hi[i]! + TOUCH_EPS
        ? b.hi[i]! - a.lo[i]!
        : 0
  ) as [number, number, number];
}

export interface GraphRepair {
  recipe: ObjectRecipe;
  /** Parts moved against their parent (they floated in mid-air). */
  pulled: number[];
  /** Duplicates dropped (same kind fused at one place), indices in the input recipe. */
  merged: number[];
}

/**
 * Hard geometry gates (PQ-T37), fixed by rule without asking a model: a part held by nothing (it touches
 * neither the ground, nor its graph parent, nor a part that is itself held: a roof tier on the tier
 * below) is pulled against its parent; two parts of the same kind at one place (centres within
 * `FUSED_DIST`, sizes within `FUSED_SIZE`) keep only the first. Same reference when clean. Pure.
 */
export function repairGraph(archetype: KitArchetype, recipe: ObjectRecipe): GraphRepair {
  const kinds = detailParts(recipe).map((d, i) => {
    const p = recipe.parts[i]!;
    return d.kinds.length ? d.kinds.join('|') : `${p.shape}:${p.color}`;
  });
  const merged: number[] = [];
  recipe.parts.forEach((p, i) => {
    if (merged.includes(i)) return;
    for (let j = i + 1; j < recipe.parts.length; j++) {
      const q = recipe.parts[j]!;
      if (merged.includes(j) || kinds[j] !== kinds[i] || q.shape !== p.shape) continue;
      const close = [0, 1, 2].every(
        (k) =>
          Math.abs(p.at[k]! - q.at[k]!) <= FUSED_DIST &&
          Math.abs(p.size[k]! - q.size[k]!) <= FUSED_SIZE * Math.max(p.size[k]!, q.size[k]!)
      );
      if (close) merged.push(j);
    }
  });
  const kept = merged.length
    ? { ...recipe, parts: recipe.parts.filter((_, i) => !merged.includes(i)) }
    : recipe;
  const keptIndex = recipe.parts.map((_, i) => i).filter((i) => !merged.includes(i));
  const graph = buildGraph(archetype, kept);
  const ground = Math.min(...kept.parts.map((p) => box3(p).lo[1]));
  const pulled: number[] = [];
  const parts = [...kept.parts];
  const touches = (i: number, j: number) =>
    gapShift(box3(parts[i]!), box3(parts[j]!)).every((v) => v === 0);
  // Held = the body, a part on the ground, or a part touching a held one (stacked tiers, arm → head).
  const held = new Set<number>();
  const spread = () => {
    for (let grew = true; grew;) {
      grew = false;
      parts.forEach((p, i) => {
        if (held.has(i)) return;
        const rooted = graph.nodes[i]!.parent === null || box3(p).lo[1] <= ground + TOUCH_EPS;
        if (rooted || [...held].some((j) => touches(i, j))) {
          held.add(i);
          grew = true;
        }
      });
    }
  };
  spread();
  for (let i = 0; i < parts.length; i++) {
    if (held.has(i)) continue;
    const p = parts[i]!;
    const shift = gapShift(box3(p), box3(parts[graph.nodes[i]!.parent!]!));
    parts[i] = { ...p, at: p.at.map((v, k) => v + shift[k]!) as RecipePart['at'] };
    pulled.push(keptIndex[i]!);
    held.add(i);
    spread();
  }
  return {
    recipe: pulled.length ? { ...kept, parts } : kept,
    pulled,
    merged,
  };
}

/**
 * Parts seen but not built (PQ-T37): per SAM concept, masks beyond the parts that can draw it, as
 * `wheel ×1`; and every `listed` part name (the kit's visible parts, PQ-T12) no part kind draws.
 * Empty when everything seen is built. Pure.
 */
export function notBuilt(
  recipe: ObjectRecipe,
  masks: ReadonlyArray<PartMask> = [],
  listed: ReadonlyArray<string> = []
): string[] {
  const kinds = detailParts(recipe).map((d) => d.kinds);
  const drawing = (concept: string) => {
    const want = CONCEPT_KINDS[concept] ?? [concept];
    return kinds.filter((ks) => ks.some((k) => (want as ReadonlyArray<string>).includes(k))).length;
  };
  const out: string[] = [];
  const seen = new Map<string, number>();
  for (const m of masks) seen.set(m.concept, (seen.get(m.concept) ?? 0) + 1);
  for (const [concept, n] of seen) {
    const missing = n - drawing(concept);
    if (missing > 0) out.push(`${concept} ×${missing}`);
  }
  for (const name of new Set(listed)) {
    if (!seen.has(name) && drawing(name) === 0) out.push(name);
  }
  return out;
}
