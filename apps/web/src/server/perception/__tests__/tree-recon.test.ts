import { describe, expect, it } from 'vitest';
import { buildPalette } from '../recon/palette';
import { reconstructTree, TREE_MIN_IOU } from '../tree/tree-recon';
import { alignedTree } from './tree-fixture';

describe('reconstructTree', () => {
  it('rebuilds a drawn tree and its silhouette agrees with the drawings', () => {
    const aligned = alignedTree();
    const out = reconstructTree(aligned, buildPalette(aligned))!;
    expect(out).not.toBeNull();
    const ious = Object.values(out.report.score.views).map((v) => v.iou);
    expect(ious.length).toBe(4);
    for (const iou of ious) expect(iou).toBeGreaterThan(TREE_MIN_IOU);
    expect(out.report.counts.volumes).toBe(out.recipe.parts.length);
    expect(out.report.score.overall).toBeGreaterThan(TREE_MIN_IOU);
  });

  it('gives up on a drawing without leaves, the generic solver keeps it', () => {
    const aligned = alignedTree({ bare: true });
    expect(reconstructTree(aligned, buildPalette(aligned))).toBeNull();
  });
});
