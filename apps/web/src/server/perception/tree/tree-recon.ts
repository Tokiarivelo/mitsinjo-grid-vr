import type { ObjectRecipe } from '@/lib/object-shape';
import { deltaE2000, hexToLab } from '../color-measure';
import type { Palette } from '../recon/palette';
import type { ReconReport } from '../recon/reconstruct';
import { scoreRecipeOnViews } from '../recon/score';
import type { AlignedViews } from '../recon/views';
import { fitTree, type TreePlan } from './tree-fit';
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
}

export function reconstructTree(aligned: AlignedViews, palette: Palette): TreeOutcome | null {
  const plan = fitTree(aligned);
  if (!plan) return null;
  const recipe = treeRecipe(plan);
  // Each part answers for the colour class nearest to its own: the score then reads colour as well.
  const classLab = palette.classes.map((c) => hexToLab(c.hex));
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
  const iou = ious.length ? ious.reduce((a, b) => a + b, 0) / ious.length : 0;
  if (iou < TREE_MIN_IOU) {
    console.info(`[vision] tree: silhouette iou ${iou.toFixed(2)} under ${TREE_MIN_IOU}, not used`);
    return null;
  }
  const { W, H, D } = aligned;
  return {
    recipe,
    plan,
    report: {
      grid: { W, H, D },
      views: aligned.read,
      flipped: aligned.flipped,
      rightFromLeft: aligned.rightFromLeft,
      agreement: aligned.agreement,
      classes: palette.classes.map((c) => ({ hex: c.hex, share: c.share })),
      counts: { volumes: recipe.parts.length, details: 0, hidden: 0 },
      // Colour classes of a twig web or a fan of fronds say little: the tree is judged on its silhouette.
      score: { ...score, overall: iou },
    },
  };
}
