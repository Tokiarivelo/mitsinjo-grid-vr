import type { KitArchetype } from '@/lib/object-kit';
import type { ObjectRecipe, PartKind } from '@/lib/object-shape';
import type { NormBox } from '@/lib/vision';
import { iou as boxIou } from './box-match';
import { renderFlat, type FlatView } from './flat-render';
import type { StageScorer, StageSpec } from './shape-stages';

/**
 * Stages per archetype for objects built from their 2D view (PG-T20): same runner as the house
 * (`runShapeStages`), scored on the views instead of the elevation — the body by silhouette IoU,
 * each other stage by its parts: the boxes SAM read on the drawings against the boxes of the
 * model's parts of that kind, rendered at the same view. Pure, no energy values.
 */

export type ViewStage =
  | 'body'
  | 'glass'
  | 'wheels'
  | 'doors'
  | 'cells'
  | 'trunk'
  | 'crown'
  | 'head'
  | 'details'
  | 'openings'
  | 'chimney';

const S = {
  // Raised (user 2026-11-05) so the stages work past a first match; was body 0.85 (the plan's
  // silhouette target), parts 0.75–0.85.
  body: { id: 'body', kinds: ['body'], gate: 0.92 },
  glass: { id: 'glass', kinds: ['window'], gate: 0.88 },
  wheels: { id: 'wheels', kinds: ['wheel'], gate: 0.88 },
  vehicleDetails: { id: 'details', kinds: ['light', 'bumper', 'grille'], gate: 0.85 },
  doors: { id: 'doors', kinds: ['door'], gate: 0.88 },
  applianceDetails: { id: 'details', kinds: ['handle', 'display'], gate: 0.85 },
  cells: { id: 'cells', kinds: ['cell'], gate: 0.9 },
  trunk: { id: 'trunk', kinds: ['trunk'], gate: 0.88 },
  crown: { id: 'crown', kinds: ['crown'], gate: 0.9 },
  head: { id: 'head', kinds: ['head'], gate: 0.88 },
} as const satisfies Record<string, StageSpec<ViewStage>>;

type Stages = ReadonlyArray<StageSpec<ViewStage>>;
const VEHICLE: Stages = [S.body, S.glass, S.wheels, S.vehicleDetails];
const APPLIANCE: Stages = [S.body, S.doors, S.applianceDetails];
const PANEL: Stages = [S.body, S.cells];
const TREE: Stages = [S.trunk, S.crown];
const POLE: Stages = [S.body, S.head];
const GENERIC: Stages = [S.body];

/** The stage list of an archetype built from its views (houses keep `HOUSE_STAGES`). */
export const VIEW_STAGES: Partial<Record<KitArchetype, Stages>> = {
  vehicle: VEHICLE,
  cabinet: APPLIANCE,
  machine: APPLIANCE,
  screen: APPLIANCE,
  tank: APPLIANCE,
  fan: APPLIANCE,
  panel: PANEL,
  tree: TREE,
  bush: TREE,
  lamp_post: POLE,
  pole: POLE,
  animal: GENERIC,
  person: GENERIC,
  other: GENERIC,
};

/**
 * Stages of the photo-path loop (PQ-T19): the views list of the archetype, and for a house or a building
 * the walls and roof, then openings, then the chimney (SAM reads them on the photo; the facade elevation
 * stays the facade route's). Null when the archetype has no stage list.
 */
export function photoStages(archetype: KitArchetype): Stages | null {
  if (archetype === 'house' || archetype === 'building')
    return [
      { id: 'body', kinds: ['body', 'wall', 'roof'], gate: 0.92 },
      { id: 'openings', kinds: ['window', 'door'], gate: 0.88 },
      { id: 'chimney', kinds: ['chimney'], gate: 0.88 },
    ];
  return VIEW_STAGES[archetype] ?? null;
}

/** SAM concept (as asked on the views) → the part kind it measures. */
export const CONCEPT_KIND: Readonly<Record<string, PartKind>> = {
  wheel: 'wheel',
  window: 'window',
  windshield: 'window',
  headlight: 'light',
  taillight: 'light',
  bumper: 'bumper',
  grille: 'grille',
  door: 'door',
  handle: 'handle',
  display: 'display',
  screen: 'display',
  'solar cells': 'cell',
  trunk: 'trunk',
  foliage: 'crown',
  lamp: 'head',
};

/** What a stage scorer needs of one measured view (a `ViewMeasure` subset). */
export interface ScoredView {
  aspect: number;
  /** Silhouette, object-box fractions, u right, v up. */
  ring: ReadonlyArray<readonly [number, number]>;
  /** Parts SAM read, object-box fractions, y down. */
  parts: ReadonlyArray<{ concept: string; box: NormBox }>;
}

/** Front and side cameras (same as the views path: the side camera sees +z on the left). */
export const VIEW_STAGE_CAMERAS: Record<'front' | 'side', FlatView> = {
  front: { yaw: 0, pitch: 0 },
  side: { yaw: -Math.PI / 2, pitch: 0 },
};
const ROWS = 96;

function insideRing(ring: ScoredView['ring'], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]!;
    const [bx, by] = ring[i]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export interface ViewRender {
  silhouette: number;
  /** Visible box of each part with a kind, object-box fractions (y down). */
  parts: Array<{ kind: PartKind; box: NormBox }>;
}

/** The model at one view, framed on its own bounds like the drawing's object box. */
export function renderView(
  recipe: ObjectRecipe,
  view: ScoredView,
  side: 'front' | 'side'
): ViewRender {
  const rows = ROWS;
  const cols = Math.max(8, Math.round(rows * view.aspect));
  const r = renderFlat({ ...recipe, yaw: 0 }, 1, cols, rows, VIEW_STAGE_CAMERAS[side], (b) => ({
    cx: (b.x0 + b.x1) / 2,
    cy: (b.y0 + b.y1) / 2,
    fw: b.x1 - b.x0,
    fh: b.y1 - b.y0,
  }));
  let inter = 0;
  let union = 0;
  const bounds = recipe.parts.map(() => [Infinity, -Infinity, Infinity, -Infinity]);
  for (let row = 0; row < rows; row++)
    for (let c = 0; c < cols; c++) {
      const i = row * cols + c;
      const a = r.mask.data[i] === 1;
      const b = insideRing(view.ring, (c + 0.5) / cols, 1 - (row + 0.5) / rows);
      if (a && b) inter++;
      if (a || b) union++;
      const k = r.part[i]!;
      if (k < 0) continue;
      const bb = bounds[k]!;
      bb[0] = Math.min(bb[0]!, c);
      bb[1] = Math.max(bb[1]!, c);
      bb[2] = Math.min(bb[2]!, row);
      bb[3] = Math.max(bb[3]!, row);
    }
  const parts: ViewRender['parts'] = [];
  recipe.parts.forEach((p, k) => {
    const [c0, c1, r0, r1] = bounds[k]!;
    if (!p.kind || c1! < c0!) return;
    parts.push({
      kind: p.kind,
      box: { x: c0! / cols, y: r0! / rows, w: (c1! + 1 - c0!) / cols, h: (r1! + 1 - r0!) / rows },
    });
  });
  return { silhouette: union ? inter / union : 0, parts };
}

/**
 * Drawn boxes against built boxes: greedy best-IoU pairs, score = Σ IoU / max(drawn, built), so a
 * missing or an extra part costs as much as a misplaced one. Null when nothing is drawn.
 */
export function matchPartBoxes(
  drawn: ReadonlyArray<NormBox>,
  built: ReadonlyArray<NormBox>
): { score: number; matched: number } | null {
  if (!drawn.length) return null;
  const pairs: Array<{ d: number; b: number; iou: number }> = [];
  drawn.forEach((d, di) =>
    built.forEach((b, bi) => {
      const iou = boxIou(d, b);
      if (iou > 0) pairs.push({ d: di, b: bi, iou });
    })
  );
  pairs.sort((a, b) => b.iou - a.iou);
  const usedD = new Set<number>();
  const usedB = new Set<number>();
  let sum = 0;
  for (const p of pairs) {
    if (usedD.has(p.d) || usedB.has(p.b)) continue;
    usedD.add(p.d);
    usedB.add(p.b);
    sum += p.iou;
  }
  return { score: sum / Math.max(drawn.length, built.length), matched: usedD.size };
}

export interface ScoredViews {
  /** 0–1 per stage; a stage nothing was drawn for is not measured (1, passes its gate). */
  stages: Partial<Record<ViewStage, number>>;
  /** Stages with drawn parts (the ones the loop can improve). */
  measured: ViewStage[];
  silhouette: number;
  /** Mean of the silhouette and the measured part stages. */
  overall: number;
  /** Drawn / built / matched part counts per measured stage (question notes). */
  counts: Partial<Record<ViewStage, { drawn: number; built: number; matched: number }>>;
}

/** Scores the model on the measured views for every stage of the list. Pure. */
export function scoreViews(
  recipe: ObjectRecipe,
  views: { front: ScoredView; side: ScoredView | null },
  stages: Stages
): ScoredViews {
  const shown = [
    { view: views.front, r: renderView(recipe, views.front, 'front') },
    ...(views.side ? [{ view: views.side, r: renderView(recipe, views.side, 'side') }] : []),
  ];
  const silhouette = shown.reduce((s, v) => s + v.r.silhouette, 0) / shown.length;
  const out: ScoredViews = {
    stages: {},
    measured: [],
    silhouette,
    overall: silhouette,
    counts: {},
  };
  const partScores: number[] = [];
  for (const st of stages) {
    if (st.kinds.includes('body') && st.id === 'body') {
      out.stages.body = silhouette;
      continue;
    }
    const kinds = st.kinds as ReadonlyArray<PartKind>;
    const per: number[] = [];
    const count = { drawn: 0, built: 0, matched: 0 };
    for (const { view, r } of shown) {
      const drawn = view.parts
        .filter((p) => {
          const k = CONCEPT_KIND[p.concept];
          return k !== undefined && kinds.includes(k);
        })
        .map((p) => p.box);
      const built = r.parts.filter((p) => kinds.includes(p.kind)).map((p) => p.box);
      const m = matchPartBoxes(drawn, built);
      if (!m) continue;
      per.push(m.score);
      count.drawn += drawn.length;
      count.built += built.length;
      count.matched += m.matched;
    }
    if (!per.length) {
      out.stages[st.id] = 1;
      continue;
    }
    const v = per.reduce((a, b) => a + b, 0) / per.length;
    out.stages[st.id] = v;
    out.measured.push(st.id);
    out.counts[st.id] = count;
    partScores.push(v);
  }
  if (partScores.length)
    out.overall = (silhouette + partScores.reduce((a, b) => a + b, 0) / partScores.length) / 2;
  return out;
}

/** Runner scorer for the views path (stage share from `scoreViews`). */
export function viewStageScorer(
  views: { front: ScoredView; side: ScoredView | null },
  stages: Stages
): StageScorer<ViewStage> {
  return (recipe, stage) => {
    const s = scoreViews(recipe, views, stages);
    return { stage: s.stages[stage] ?? 1, overall: s.overall };
  };
}

/** Plain notes for the stage question: silhouette and parts drawn vs built. */
export function viewStageNotes(s: ScoredViews): string[] {
  return [
    `silhouette overlap ${Math.round(s.silhouette * 100)} %`,
    ...s.measured.map((id) => {
      const c = s.counts[id]!;
      return `${id}: ${c.drawn} drawn, ${c.built} built, ${c.matched} matched`;
    }),
  ];
}

/**
 * Kinds of a round object's parts (PG-T20), from the template's own layout: tree / bush →
 * cylinders are the trunk, the rest the crown; lamp post / pole → the top quarter is the head
 * (lamp, cross-arm), the rest the body. Parts that already have a kind keep it.
 */
export function tagRoundParts(archetype: KitArchetype, recipe: ObjectRecipe): ObjectRecipe {
  const kindOf = (p: ObjectRecipe['parts'][number]): PartKind | undefined => {
    if (archetype === 'tree' || archetype === 'bush')
      return p.shape === 'cylinder' ? 'trunk' : 'crown';
    if (archetype === 'lamp_post' || archetype === 'pole')
      return p.at[1] - p.size[1] / 2 > 0.2 ? 'head' : 'body';
    return undefined;
  };
  return {
    ...recipe,
    parts: recipe.parts.map((p) => {
      const kind = p.kind ?? kindOf(p);
      return kind ? { ...p, kind } : p;
    }),
  };
}
