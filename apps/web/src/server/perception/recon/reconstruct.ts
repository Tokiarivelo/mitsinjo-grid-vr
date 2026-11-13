import type { ObjectRecipe, RecipeMaterial } from '@/lib/object-shape';
import { carve, type CarveResult } from './carve';
import type { ViewImage } from './grid';
import { buildPalette, type Palette } from './palette';
import { solidsToRecipe } from './recipe';
import { scoreRecipeOnViews, type ReconScore } from './score';
import { alignViews, type AlignedViews, type ViewName } from './views';

/**
 * Drawn views → 3D recipe (PQ-T69), the whole pure chain: read the views, class their colours
 * together, carve the solids, write the recipe, score it on every view. The same code for a
 * house, a car, a tree or a pump: nothing here knows what the object is.
 */

export interface Reconstruction {
  aligned: AlignedViews;
  palette: Palette;
  carved: CarveResult;
}

/** Null when the front or both sides are unreadable, or nothing solid comes out. */
export function reconstructFromViews(
  input: Partial<Record<ViewName, ViewImage>>
): Reconstruction | null {
  const aligned = alignViews(input);
  if (!aligned) return null;
  const palette = buildPalette(aligned);
  const carved = carve(aligned, palette);
  if (!carved.solids.some((s) => s.role !== 'detail')) return null;
  return { aligned, palette, carved };
}

export interface ReconReport {
  grid: { W: number; H: number; D: number };
  views: ViewName[];
  flipped: ViewName[];
  rightFromLeft: boolean;
  agreement: AlignedViews['agreement'];
  classes: Array<{ hex: string; share: number; material?: RecipeMaterial }>;
  counts: CarveResult['counts'];
  score: ReconScore;
}

/** The recipe of a reconstruction (`materials[class]` from the labelling step, optional) and its report. */
export function finishRecipe(
  recon: Reconstruction,
  materials: ReadonlyArray<RecipeMaterial | undefined> = []
): { recipe: ObjectRecipe; report: ReconReport } {
  const { aligned, palette, carved } = recon;
  const { W, H, D } = aligned;
  const recipe = solidsToRecipe(carved.solids, palette, { W, H, D }, materials);
  const score = scoreRecipeOnViews(
    recipe,
    carved.solids.map((s) => s.cls),
    aligned,
    palette
  );
  return {
    recipe,
    report: {
      grid: { W, H, D },
      views: aligned.read,
      flipped: aligned.flipped,
      rightFromLeft: aligned.rightFromLeft,
      agreement: aligned.agreement,
      classes: palette.classes.map((c, i) => ({
        hex: c.hex,
        share: c.share,
        ...(materials[i] ? { material: materials[i] } : {}),
      })),
      counts: carved.counts,
      score,
    },
  };
}

/** One log line for a report. */
export function reportLine(r: ReconReport): string {
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const views = r.views
    .map((v) => {
      const s = r.score.views[v];
      return s ? `${v} iou ${s.iou.toFixed(2)} match ${s.match.toFixed(2)}` : `${v} unread`;
    })
    .join(' · ');
  return `grid ${r.grid.W}×${r.grid.H}×${r.grid.D}, ${r.classes.length} classes (${r.classes.map((c) => `${c.hex}${c.material ? ` ${c.material}` : ''} ${pct(c.share)}`).join(', ')}), ${r.counts.volumes} volumes + ${r.counts.fills} fills + ${r.counts.details} details (${r.counts.hidden} hidden dropped)${r.flipped.length ? `, flipped ${r.flipped.join('+')}` : ''}${r.rightFromLeft ? ', right side from the left drawing' : ''}; ${views}; overall ${r.score.overall.toFixed(3)}`;
}

/** Pixel scale and gap of the class sheet tiles. */
const TILE_SCALE = 3;
const TILE_GAP = 8;
const PAPER = 255;
const SILHOUETTE = 205;
const MARK: readonly [number, number, number] = [220, 20, 30];

/**
 * The sheet the labelling model looks at: tile 0 is the front view as drawn, then one tile per
 * colour class, left to right, with that class's cells in red on the grey silhouette. The model
 * answers by tile number, never by colour code or coordinate.
 */
export function classSheet(recon: Reconstruction): ViewImage {
  const { front } = recon.aligned.views;
  const labels = recon.palette.labels.front!;
  const tiles = recon.palette.classes.length + 1;
  const [tw, th] = [front.cols * TILE_SCALE, front.rows * TILE_SCALE];
  const cols = tiles * tw + (tiles + 1) * TILE_GAP;
  const rows = th + 2 * TILE_GAP;
  const rgb = new Uint8Array(cols * rows * 3).fill(PAPER);
  for (let t = 0; t < tiles; t++) {
    const left = TILE_GAP + t * (tw + TILE_GAP);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const cell = Math.floor(y / TILE_SCALE) * front.cols + Math.floor(x / TILE_SCALE);
        if (!front.mask[cell]) continue;
        const o = ((TILE_GAP + y) * cols + left + x) * 3;
        const pixel: readonly [number, number, number] =
          t === 0
            ? [front.rgb[cell * 3]!, front.rgb[cell * 3 + 1]!, front.rgb[cell * 3 + 2]!]
            : labels[cell] === t - 1
              ? MARK
              : [SILHOUETTE, SILHOUETTE, SILHOUETTE];
        rgb[o] = pixel[0];
        rgb[o + 1] = pixel[1];
        rgb[o + 2] = pixel[2];
      }
    }
  }
  return { cols, rows, rgb };
}
