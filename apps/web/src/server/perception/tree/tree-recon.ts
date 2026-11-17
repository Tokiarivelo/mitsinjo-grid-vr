import type { ObjectRecipe } from '@/lib/object-shape';
import { deltaE2000, hexToLab } from '../color-measure';
import type { Palette } from '../recon/palette';
import type { ReconReport } from '../recon/reconstruct';
import { scoreRecipeOnViews } from '../recon/score';
import type { AlignedViews } from '../recon/views';
import type { PlantPlan } from '@/lib/plant-plan';
import { buildPlant, type PlantHints } from './plant-build';
import { cropRows, findPot, potPlan, raisePlant } from './plant-pot';
import { scorePlant } from './plant-score';
import { fitTree, type TreePlan } from './tree-fit';
import { FROND_LABEL } from './tree-fronds';
import { treeRecipe } from './tree-parts';

/**
 * A tree or a bush from its drawn views (PQ-T79): read (`fitTree`), written as trunk and crown
 * parts (`treeRecipe`), scored by the same flat renderer as every reconstruction. The generic
 * carving solver stays the fallback when no crown is found or the model disagrees with the drawings.
 */

/** Mean silhouette IoU under which the drawings and the tree disagree: the generic solver is kept. */
export const TREE_MIN_IOU = 0.4;

export interface TreeOutcome {
  recipe: ObjectRecipe;
  report: ReconReport;
  plan: TreePlan;
  /** The plant plan's silhouette IoU on the front and the side (PQ-T82). */
  plantScore: { front: number; side: number; mean: number };
}

export interface TreeOptions {
  /** The side view is the front reused (PQ-T81: a plant is round). */
  sideIsFront?: boolean;
  /** What the plant team read (PQ-T82). */
  hints?: PlantHints;
}

export function reconstructTree(
  aligned: AlignedViews,
  palette: Palette,
  label = '',
  { sideIsFront = false, hints = {} }: TreeOptions = {}
): TreeOutcome | null {
  const fronds = hints.habit ? hints.habit === 'palm' : FROND_LABEL.test(label);
  const plan = fitTree(aligned, { fronds, sideIsFront });
  if (!plan) return null;
  const classLab = palette.classes.map((c) => hexToLab(c.hex));
  const scored = (recipe: ObjectRecipe) => {
    // Each part answers for the colour class nearest to its own: the score then reads colour as well.
    const classOf = recipe.parts.map((p) => {
      const lab = hexToLab(p.color);
      let best = 0;
      let bestDelta = Infinity;
      classLab.forEach((c, i) => {
        const d = deltaE2000(lab, c);
        if (d < bestDelta) [best, bestDelta] = [i, d];
      });
      return best;
    });
    const score = scoreRecipeOnViews(recipe, classOf, aligned, palette);
    const ious = Object.values(score.views).map((v) => v.iou);
    return { score, iou: ious.length ? ious.reduce((a, b) => a + b, 0) / ious.length : 0 };
  };
  const recipe = treeRecipe(plan);
  const { score, iou: own } = scored(recipe);
  // Fronds are a few leaves inside the measured outline (they never fill it): the reading is
  // judged on the outline itself, the packed crown.
  const iou = plan.fronds ? scored(treeRecipe({ ...plan, fronds: undefined })).iou : own;
  // The plant the 3D views build (PQ-T82); the clumps above stay its parts for the parts views.
  const plant =
    (hints.ground ? null : potted(aligned, label, hints, { fronds, sideIsFront })) ??
    buildPlant(plan, label, hints, seedOf(label));
  // A potted plant stands in the whole drawing, pot included (the tree's foot stops at its rim).
  const frame = plant.pot ? { W: aligned.W, H: aligned.H, D: aligned.D } : plan;
  const plantScore = scorePlant(plant, frame, aligned);
  // Spikes, canes and blades are no clumps: the plant answers for the drawing when it fits better.
  if (Math.max(iou, plantScore.mean) < TREE_MIN_IOU) {
    console.info(
      `[vision] tree: silhouette iou ${iou.toFixed(2)}, plant ${plantScore.mean.toFixed(2)}, under ${TREE_MIN_IOU}, not used`
    );
    return null;
  }
  const { W, H, D } = aligned;
  return {
    recipe: {
      ...recipe,
      ...(plant.pot ? { proportions: frameProportions(frame) } : {}),
      plant,
    },
    plan,
    plantScore,
    report: {
      grid: { W, H, D },
      views: aligned.read,
      flipped: aligned.flipped,
      rightFromLeft: aligned.rightFromLeft,
      agreement: aligned.agreement,
      classes: palette.classes.map((c) => ({ hex: c.hex, share: c.share })),
      counts: { volumes: recipe.parts.length, details: 0, hidden: 0 },
      // Colour classes of a twig web or a fan of fronds say little: the tree is judged on its silhouette.
      score: { ...score, overall: own },
    },
  };
}

/**
 * A potted plant (VS-T25): the pot at the foot of the drawing turned round its axis, and the
 * plant fitted on the rows above its rim, stood on its soil. Null when no pot is drawn (or the
 * rows above it hold no plant): the plant then grows from the ground as before.
 */
export function potted(
  aligned: AlignedViews,
  label: string,
  hints: PlantHints,
  options: { fronds: boolean; sideIsFront: boolean }
): PlantPlan | null {
  const pot = findPot(aligned, options.sideIsFront);
  if (!pot || pot.top < 2) return null;
  const upper = fitTree(cropRows(aligned, pot.top), options);
  if (!upper) return null;
  // The team traced on the whole drawing: its heights are re-read on the rows above the rim.
  const scale = aligned.H / pot.top;
  const lift = (lines?: Array<{ points: Array<[number, number]>; width: number }>) =>
    lines?.map((l) => ({
      ...l,
      points: l.points.map(([x, y]) => [x, Math.min(1, y * scale)] as [number, number]),
    }));
  const own: PlantHints = {
    ...hints,
    ...(hints.branches ? { branches: lift(hints.branches)! } : {}),
    ...(hints.trunks ? { trunks: lift(hints.trunks)! } : {}),
    ...(hints.traces ? { traces: lift(hints.traces)! } : {}),
  };
  const plant = raisePlant(buildPlant(upper, label, own, seedOf(label)), aligned, pot.top);
  return { ...plant, pot: potPlan(pot, aligned) };
}

/** Box proportions of a frame (cells): its largest side is 1, the margin cancels out. */
function frameProportions({ W, H, D }: { W: number; H: number; D: number }) {
  const max = Math.max(W, H, D);
  return { w: W / max, h: H / max, d: D / max };
}

/** A seed from the label: the same plant always gets the same leaves. */
export function seedOf(label: string): number {
  let h = 2166136261;
  for (const ch of label) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 2147483647;
}
