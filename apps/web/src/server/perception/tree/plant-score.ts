import { plantMesh } from '@/lib/plant-mesh';
import type { PlantPlan } from '@/lib/plant-plan';
import type { AlignedViews } from '../recon/views';
import type { TreePlan } from './tree-fit';
import { FRAME_MARGIN } from './tree-parts';

/**
 * How well a plant plan matches its drawings (PQ-T82): the mesh the viewer draws (`plantMesh`),
 * built in cells on the recipe's box, filled orthographically onto the front and the side grids of
 * the aligned views, and compared with the drawn silhouettes (IoU). Pure.
 */

/** Silhouette of the mesh on one view's grid: 1 = covered. */
function fill(
  pos: Float32Array,
  cols: number,
  rows: number,
  at: (x: number, y: number, z: number) => [number, number]
): Uint8Array {
  const out = new Uint8Array(cols * rows);
  for (let t = 0; t < pos.length; t += 9) {
    const p = [0, 3, 6].map((k) => at(pos[t + k]!, pos[t + k + 1]!, pos[t + k + 2]!));
    const [a, b, c] = p as [[number, number], [number, number], [number, number]];
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) continue;
    const [x0, x1] = [
      Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))),
      Math.min(cols - 1, Math.ceil(Math.max(a[0], b[0], c[0]))),
    ];
    const [y0, y1] = [
      Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))),
      Math.min(rows - 1, Math.ceil(Math.max(a[1], b[1], c[1]))),
    ];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const [fx, fy] = [x + 0.5, y + 0.5];
        const u = ((b[0] - fx) * (c[1] - fy) - (c[0] - fx) * (b[1] - fy)) / area;
        const v = ((c[0] - fx) * (a[1] - fy) - (a[0] - fx) * (c[1] - fy)) / area;
        if (u >= 0 && v >= 0 && u + v <= 1) out[y * cols + x] = 1;
      }
  }
  return out;
}

const iou = (a: Uint8Array, b: Uint8Array) => {
  let [both, either] = [0, 0];
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return either ? both / either : 0;
};

/** The plan's silhouette IoU on the front and on the side, and their mean. */
export function scorePlant(
  plant: PlantPlan,
  tree: Pick<TreePlan, 'W' | 'H' | 'D'>,
  aligned: Pick<AlignedViews, 'views'>
): { front: number; side: number; mean: number } {
  const { W, H, D } = tree;
  const [fW, fH, fD] = [W * FRAME_MARGIN, H * FRAME_MARGIN, D * FRAME_MARGIN];
  const mesh = plantMesh(plant, [fW, fH, fD]);
  const { front, right } = aligned.views;
  /** Model (cells, centred) → a grid column and row: the box's margin is round the drawing. */
  const row = (y: number) => H - (y + fH / 2);
  const f = fill(mesh.position, front.cols, front.rows, (x, y) => [x + W / 2, row(y)]);
  const s = fill(mesh.position, right.cols, right.rows, (_, y, z) => [z + D / 2, row(y)]);
  const scores = { front: iou(f, front.mask), side: iou(s, right.mask) };
  return { ...scores, mean: (scores.front + scores.side) / 2 };
}
