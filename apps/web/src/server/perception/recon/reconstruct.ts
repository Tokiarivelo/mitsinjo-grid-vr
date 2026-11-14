import { eaveRow, hullRows } from '@/lib/face-hull';
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

/** The drawings read: one frame, shared colour classes. What the labelling step looks at. */
export interface ViewsReading {
  aligned: AlignedViews;
  palette: Palette;
}

export interface Reconstruction extends ViewsReading {
  carved: CarveResult;
  /** Material of each colour class, as given to the solver (may be empty). */
  materials: ReadonlyArray<RecipeMaterial | undefined>;
}

/** The roof class holds at least this share of the front above the eave… */
export const ROOF_CLASS_SHARE = 0.5;
/** …and at most this share of the front under it (else walls and roof are one colour). */
export const ROOF_CLASS_WALL_SHARE = 0.35;

/**
 * The colour class of the roof, read on the geometry (PQ-T71): the class that fills the front
 * above the eave of the silhouettes and not the walls under it. Null when the silhouettes show
 * no eave (flat roof), or when one class covers both (brick under clay tiles). The naming model
 * answers this badly; it is asked only when the geometry cannot tell.
 */
export function roofClassOf(reading: ViewsReading): number | null {
  const { front, right } = reading.aligned.views;
  const labels = reading.palette.labels.front;
  if (!labels) return null;
  const rows = hullRows(front, right);
  const eave = eaveRow(rows, 0, rows.length);
  if (eave >= rows.length || eave < 2) return null;
  const classes = reading.palette.classes.length;
  const above = new Uint32Array(classes);
  const under = new Uint32Array(classes);
  labels.forEach((l, i) => {
    if (l >= 0) (Math.floor(i / front.cols) < eave ? above : under)[l]!++;
  });
  const total = (v: Uint32Array) => v.reduce((t, n) => t + n, 0);
  let best = 0;
  for (let c = 1; c < classes; c++) if (above[c]! > above[best]!) best = c;
  const [roof, walls] = [total(above), total(under)];
  if (!roof || above[best]! < ROOF_CLASS_SHARE * roof) return null;
  if (walls && under[best]! > ROOF_CLASS_WALL_SHARE * walls) return null;
  return best;
}

/** Null when the front or both sides are unreadable. */
export function readViews(input: Partial<Record<ViewName, ViewImage>>): ViewsReading | null {
  const aligned = alignViews(input);
  return aligned ? { aligned, palette: buildPalette(aligned) } : null;
}

/** The solids of a reading; null when nothing solid comes out. */
export function solveViews(
  reading: ViewsReading,
  materials: ReadonlyArray<RecipeMaterial | undefined> = [],
  roofClass: number | null = null
): Reconstruction | null {
  const carved = carve(reading.aligned, reading.palette, materials, roofClass);
  if (!carved.solids.some((s) => s.role !== 'detail')) return null;
  return { ...reading, carved, materials };
}

/** Reading then solving; null when the front or both sides are unreadable, or nothing solid comes out. */
export function reconstructFromViews(
  input: Partial<Record<ViewName, ViewImage>>,
  materials: ReadonlyArray<RecipeMaterial | undefined> = []
): Reconstruction | null {
  const reading = readViews(input);
  return reading ? solveViews(reading, materials) : null;
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

/** The recipe of a reconstruction and its report. */
export function finishRecipe(recon: Reconstruction): { recipe: ObjectRecipe; report: ReconReport } {
  const { aligned, palette, carved, materials } = recon;
  const { W, H, D } = aligned;
  const { recipe, classOf } = solidsToRecipe(carved.solids, palette, { W, H, D }, materials);
  const score = scoreRecipeOnViews(recipe, classOf, aligned, palette, carved.group);
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
  return `grid ${r.grid.W}×${r.grid.H}×${r.grid.D}, ${r.classes.length} classes (${r.classes.map((c) => `${c.hex}${c.material ? ` ${c.material}` : ''} ${pct(c.share)}`).join(', ')}), ${r.counts.volumes} bodies + ${r.counts.details} details (${r.counts.hidden} hidden dropped)${r.flipped.length ? `, flipped ${r.flipped.join('+')}` : ''}${r.rightFromLeft ? ', right side from the left drawing' : ''}; ${views}; overall ${r.score.overall.toFixed(3)}`;
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
export function classSheet(recon: ViewsReading): ViewImage {
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
