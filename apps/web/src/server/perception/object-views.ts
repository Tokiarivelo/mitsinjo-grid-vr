import 'server-only';

import { pickSide, sideCardPrompt } from './view-candidates';
import { clipRing, ringRange, spanAt, type Ring } from '@/lib/hull';
import { kitToRecipe, TAIL_LIGHT_COLOR, type KitArchetype, type ObjectKit } from '@/lib/object-kit';
import {
  MAX_BUILT_PARTS,
  MAX_PANES,
  fitRecipe,
  type ObjectRecipe,
  type PartKind,
  type RecipeMaterial,
  type RecipePart,
} from '@/lib/object-shape';
import { pathToRings, polygonPath, type NormBox } from '@/lib/vision';
import sharp from 'sharp';
import { timeoutSignal } from './abort';
import type { PerceptionClient } from './client';
import { deltaE2000, hexToLab } from './color-measure';
import { compactDataUrl, imagineSideView } from './facade-views';
import { renderFlat, type FlatView } from './flat-render';
import { samBoxToNorm } from './outline';
import { fetchPartMasks } from './part-masks';
import { withLatheBody } from './lathe-body';
import { VIEW_STAGE_CAMERAS, renderView, tagRoundParts } from './view-stages';
import { budgetRing } from './profile-body';
import { MAX_MISSING, knownConcept, viewsCheckQuestion, type ViewsCheck } from './views-check';

/**
 * Any object from its validated 2D view (PV-H, user 2026-11-02 « le LLM peut générer n'importe
 * quel objet »): SAM reads the object's silhouette and parts on the front view, Muse Image draws
 * the side of the very same object, SAM reads that too; the body is the visual hull of the two
 * silhouettes (`hull` part), the parts SAM found are placed on it. Houses keep their elevation
 * builder (`facade-house.ts`). Meta models only; the LLM never gives coordinates.
 */

/** Archetypes rebuilt as a hull from their views; the others keep their own pipeline. */
export const VIEW_HULL_ARCHETYPES: ReadonlyArray<KitArchetype> = [
  'vehicle',
  'cabinet',
  'machine',
  'tank',
  'screen',
  'fan',
  'animal',
  'person',
  'other',
  // PG-T19: a solar panel's side drawing shows its tilt and legs.
  'panel',
];

/**
 * Round objects (PG-T19): their side looks like their front, so no side is drawn; the template
 * body becomes a lathe of the silhouette measured on the validated 2D view (`roundViewRecipe`).
 */
export const ROUND_VIEW_ARCHETYPES: ReadonlyArray<KitArchetype> = [
  'tree',
  'bush',
  'lamp_post',
  'pole',
];

/** Every archetype built from its validated 2D view (houses keep their elevation builder). */
export const VIEW_ARCHETYPES: ReadonlyArray<KitArchetype> = [
  ...VIEW_HULL_ARCHETYPES,
  ...ROUND_VIEW_ARCHETYPES,
];

/** SAM concepts read on each view, per archetype (placed on the hull by `viewsRecipe`). */
export const VIEW_PART_CONCEPTS: Partial<
  Record<KitArchetype, { front: ReadonlyArray<string>; side: ReadonlyArray<string> }>
> = {
  vehicle: {
    front: ['headlight', 'bumper', 'wheel', 'windshield', 'grille'],
    side: ['wheel', 'window'],
  },
  // PG-T20: the parts each archetype's stages score (`view-stages.ts` `CONCEPT_KIND`).
  cabinet: { front: ['door', 'handle', 'display'], side: [] },
  machine: { front: ['door', 'handle', 'display'], side: [] },
  screen: { front: ['screen'], side: [] },
  panel: { front: ['solar cells'], side: [] },
  tree: { front: ['trunk', 'foliage'], side: [] },
  lamp_post: { front: ['lamp'], side: [] },
};

/** One SAM call on a view (object or parts). */
export const VIEW_SAM_TIMEOUT_MS = 20_000;
/** Side drawings tried before keeping the front alone (Muse Image may redraw the front). */
export const VIEW_SIDE_ATTEMPTS = 2;
const MIN_CONFIDENCE = 0.5;

/** Side prompt: the same object turned 90°, its front on the left (the render's side view). */
export function objectSidePrompt(label: string): string {
  const name = label.replace(/["\n]/g, ' ').trim() || 'object';
  return `This image is the straight-on FRONT view of a ${name}. Draw the SIDE view of the very same ${name}, turned 90 degrees, as on the next sheet of a technical drawing: same drawing style, same colours, same height and scale, the whole object from end to end at its true length, its front pointing to the LEFT of the image. Straight-on orthographic view at eye level, the whole object centred on a plain white background, no perspective, no shadow, no text.`;
}

/** What SAM read on one view: the object's ring and its parts, in object-box fractions. */
export interface ViewMeasure {
  /** Object box width / height in pixels. */
  aspect: number;
  /** Silhouette, object-box fractions: u right 0–1, v up 0–1. */
  ring: Array<[number, number]>;
  /** Parts, object-box fractions (x right, y down, like `NormBox`); `look` = colour named by the AI check. */
  parts: Array<{
    concept: string;
    box: NormBox;
    look?: { color?: string; material?: RecipeMaterial };
  }>;
  /** Object box on the view image, image fractions (where later SAM hits are mapped from). */
  box: NormBox;
}

type Segment = PerceptionClient['segmentImage'];

const area = (ring: Ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return Math.abs(a) / 2;
};

/** SAM on one view → the object's silhouette and parts, or null (no real answer, no outline). */
export async function measureView(
  segment: Segment,
  url: string,
  concept: string,
  partConcepts: ReadonlyArray<string>,
  { timeoutMs = VIEW_SAM_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<ViewMeasure | null> {
  const src = await compactDataUrl(url);
  const [seg, masks] = await Promise.all([
    segment(src, concept, AbortSignal.timeout(timeoutMs)).catch(() => null),
    partConcepts.length
      ? fetchPartMasks(segment, src, 'other', { concepts: partConcepts, timeoutMs })
      : Promise.resolve([]),
  ]);
  if (!seg || seg.source !== 'meta' || seg.fallback) return null;
  const hits = seg.instances
    .filter((i) => (i.confidence ?? 1) >= MIN_CONFIDENCE && i.outline)
    .map((i) => ({ i, box: samBoxToNorm(i.box, seg.imageWidth, seg.imageHeight) }))
    .filter((h): h is { i: (typeof seg.instances)[number]; box: NormBox } => h.box !== null)
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  const best = hits[0];
  if (!best) return null;
  const rings = pathToRings(best.i.outline!).filter((r) => r.length >= 3);
  if (!rings.length) return null;
  // Ring bounds = the object box (the SAM box can be a few pixels off its own outline).
  const ring = rings.reduce((a, b) => (area(b) > area(a) ? b : a));
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
  if (!(box.w > 0.02 && box.h > 0.02)) return null;
  const parts = toObjectBox(masks, box);
  return {
    box,
    aspect: (box.w * seg.imageWidth) / (box.h * seg.imageHeight),
    ring: ring.map(([x, y]) => [(x - box.x) / box.w, 1 - (y - box.y) / box.h]),
    parts,
  };
}

/** Part boxes (image fractions) → object-box fractions, kept when centred on the object. */
function toObjectBox(
  masks: ReadonlyArray<{ concept: string; box: NormBox }>,
  box: NormBox
): ViewMeasure['parts'] {
  return (
    masks
      .map((m) => ({
        concept: m.concept,
        box: {
          x: (m.box.x - box.x) / box.w,
          y: (m.box.y - box.y) / box.h,
          w: m.box.w / box.w,
          h: m.box.h / box.h,
        },
      }))
      // Inside the object (a wheel drawn on the floor line may poke a little out).
      .filter(
        ({ box: b }) =>
          b.x + b.w / 2 > 0 && b.x + b.w / 2 < 1 && b.y + b.h / 2 > 0 && b.y + b.h / 2 < 1.05
      )
  );
}

/** Share of a part box that must lie on the object for the part to be kept. */
export const PART_INSIDE_MIN = 0.6;

/**
 * A part (not a wheel) kept only when most of its box lies on the object, then cut to it
 * (before: SAM took a topiary car's plinth for its bumper, a box larger than the car floating
 * under it, live 2026-11-03).
 */
function insideObject<P extends { box: NormBox }>(p: P): P[] {
  const { x, y, w, h } = p.box;
  const x0 = Math.max(0, x);
  const x1 = Math.min(1, x + w);
  const y0 = Math.max(0, y);
  const y1 = Math.min(1, y + h);
  if (!(x1 > x0 && y1 > y0)) return [];
  if (((x1 - x0) * (y1 - y0)) / Math.max(1e-6, w * h) < PART_INSIDE_MIN) return [];
  return [{ ...p, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }];
}

/** A side drawing that is really a redrawn front (same aspect, ±8 %) is no side. */
export function sideLooksNew(front: ViewMeasure, side: ViewMeasure): boolean {
  return Math.abs(side.aspect - front.aspect) / front.aspect > 0.08;
}

export interface ObjectViews {
  front: ViewMeasure;
  side: ViewMeasure | null;
  /** The validated 2D view and the side Muse Image drew (the AI check's sheet). */
  frontUrl: string;
  sidePng: Buffer | null;
}

/**
 * Front measured, side drawn by Muse Image and measured (twice at most), step by step. Null when
 * the archetype keeps its own pipeline or SAM gives no silhouette on the front. Never throws.
 */
export async function measureObjectViews(
  segment: Segment,
  frontUrl: string,
  archetype: KitArchetype,
  label: string,
  concept: string,
  {
    signal,
    withSide = !ROUND_VIEW_ARCHETYPES.includes(archetype),
    onSideView,
    sideV2,
  }: {
    signal?: AbortSignal;
    withSide?: boolean;
    onSideView?: (png: Buffer) => void;
    /** Side view cards and candidate pick (PQ-T16): drawings asked per attempt, and Spark's kit for the depth check. */
    sideV2?: { candidates: number; kit?: ObjectKit };
  } = {}
): Promise<ObjectViews | null> {
  if (!VIEW_ARCHETYPES.includes(archetype)) return null;
  const concepts = VIEW_PART_CONCEPTS[archetype];
  try {
    // The side is drawn while the front is measured (both ≈ 10–35 s).
    const sidePrompt = sideV2 ? sideCardPrompt(label, archetype) : objectSidePrompt(label);
    const perAttempt = sideV2 ? Math.max(1, sideV2.candidates) : 1;
    const drawSides = () =>
      Promise.all(
        Array.from({ length: perAttempt }, () => imagineSideView(frontUrl, sidePrompt, signal))
      );
    const firstSides = withSide ? drawSides() : Promise.resolve([null]);
    const front = await measureView(segment, frontUrl, concept, concepts?.front ?? []);
    if (!front) {
      console.info(`[vision] 3D views for "${label}": no silhouette on the 2D view`);
      return null;
    }
    if (!withSide) return { front, side: null, frontUrl, sidePng: null };
    for (let attempt = 1; attempt <= VIEW_SIDE_ATTEMPTS; attempt++) {
      if (signal?.aborted) break;
      const pngs = (attempt === 1 ? await firstSides : await drawSides()).filter(
        (p): p is Buffer => p !== null
      );
      if (!pngs.length) break;
      for (const png of pngs) onSideView?.(png);
      const measured = await Promise.all(
        pngs.map(async (png) => ({
          png,
          side: await measureView(
            segment,
            `data:image/png;base64,${png.toString('base64')}`,
            concept,
            concepts?.side ?? []
          ),
        }))
      );
      const readable = measured.filter((m): m is { png: Buffer; side: ViewMeasure } => !!m.side);
      if (sideV2) {
        const best = pickSide(readable, front, sideV2.kit);
        if (best) {
          console.info(
            `[vision] 3D side view kept: score ${best.score} of ${readable.length} readable / ${pngs.length} drawn`
          );
          return { front, side: best.pick.side, frontUrl, sidePng: best.pick.png };
        }
      }
      const side = readable[0]?.side ?? null;
      if (!sideV2 && side && sideLooksNew(front, side))
        return { front, side, frontUrl, sidePng: readable[0]!.png };
      console.info(
        `[vision] 3D side view ${attempt}/${VIEW_SIDE_ATTEMPTS} ${side ? 'looks like the front' : 'unreadable'}${attempt < VIEW_SIDE_ATTEMPTS ? ', drawing it again' : ', dropped'}`
      );
    }
    return { front, side: null, frontUrl, sidePng: null };
  } catch (err) {
    console.warn('[vision] 3D views failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** A person's torso band (hull y, -0.5 feet … 0.5 head top): hips to shoulders. */
export const PERSON_TORSO: readonly [number, number] = [-0.06, 0.34];
/** Below this CIEDE2000 the top and the trousers read as one colour: no torso patch. */
export const CLOTHES_MIN_DELTA_E = 8;
const clothesDiffer = (c: { main: string; secondary: string }) =>
  deltaE2000(hexToLab(c.main), hexToLab(c.secondary)) >= CLOTHES_MIN_DELTA_E;

/**
 * Round object from its validated 2D view (PG-T19): the kit template at the drawing's
 * proportions (width / height measured, depth = width), its main body turned into a lathe of
 * the drawn silhouette (`withLatheBody`, as on the photo outline). Trunk, head or arm keep the
 * template. Pure.
 */
export function roundViewRecipe(
  front: Pick<ViewMeasure, 'aspect' | 'ring'>,
  kit: ObjectKit
): ObjectRecipe {
  const template = kitToRecipe(kit);
  // Width / height from the drawing; a round object is as deep as it is wide.
  const w = Math.max(0.01, front.aspect);
  const m = Math.max(w, 1);
  const fitted = fitRecipe(
    { ...template, proportions: { w: w / m, h: 1 / m, d: w / m } },
    front.aspect
  );
  // Object-box fractions, y down: the outline the lathe scanner reads (box = the whole unit).
  const outline = polygonPath(front.ring.map(([u, v]) => [u, 1 - v] as [number, number]));
  const lathed = withLatheBody(kit.archetype, fitted, {
    box: { x: 0, y: 0, w: 1, h: 1 },
    outline,
  });
  return { ...tagRoundParts(kit.archetype, lathed), source: 'views' };
}

/** Depth over front width from Spark's kit when no side is drawn (a vehicle's `w` is its length). */
export function sparkDepthRatio(kit: Pick<ObjectKit, 'archetype' | 'proportions'>): number {
  const { w, d } = kit.proportions;
  const r = kit.archetype === 'vehicle' ? w / Math.max(0.01, d) : d / Math.max(0.01, w);
  return Math.min(6, Math.max(0.15, r));
}

/** A drawn side whose depth is this many times off Spark's estimate is a bad drawing, not the object. */
export const SIDE_DEPTH_MAX_FACTOR = 2;

/**
 * The drawn side's depth (side aspect / front aspect, the ratio `sparkDepthRatio` uses) agrees with
 * Spark's estimate within × `SIDE_DEPTH_MAX_FACTOR` either way. Muse Image sometimes draws a side
 * far too wide (a fridge 3.4 × deeper than wide, user report 2026-11-04); the silhouette fit then
 * matches the bad drawing, so it is checked against the kit instead. Pure.
 */
export function sideDepthPlausible(
  front: Pick<ViewMeasure, 'aspect'>,
  side: Pick<ViewMeasure, 'aspect'>,
  kit: Pick<ObjectKit, 'archetype' | 'proportions'>
): boolean {
  const drawn = side.aspect / Math.max(1e-6, front.aspect);
  const factor = drawn / sparkDepthRatio(kit);
  return factor <= SIDE_DEPTH_MAX_FACTOR && factor >= 1 / SIDE_DEPTH_MAX_FACTOR;
}

/** Drops an implausible drawn side (`sideDepthPlausible`): the model then takes Spark's depth. */
export function keepPlausibleSide<V extends Pick<ObjectViews, 'front' | 'side' | 'sidePng'>>(
  views: V,
  kit: Pick<ObjectKit, 'archetype' | 'proportions'>,
  label: string
): V {
  if (!views.side || sideDepthPlausible(views.front, views.side, kit)) return views;
  console.info(
    `[vision] 3D side view for "${label}" dropped: depth ${(views.side.aspect / views.front.aspect).toFixed(2)} vs Spark ${sparkDepthRatio(kit).toFixed(2)} (more than × ${SIDE_DEPTH_MAX_FACTOR} off), using Spark's depth`
  );
  return { ...views, side: null, sidePng: null };
}

/** Data colours of the parts SAM finds (model colours, not UI tokens). */
export const VIEW_PART_LOOK = {
  rubber: '#1d1d1f',
  chrome: '#c8cdd2',
  lamp: '#f1eee4',
  display: '#1b2230',
  cell: '#1f3550',
} as const;

/**
 * Front parts placed by kind on appliances and panels (PG-T20): doors and displays as skin
 * patches on the front face, handles as small bars proud of it, solar cells as one patch with
 * their grid (PG-T21). Colour by role.
 */
const FRONT_PART_LOOK: Partial<
  Record<string, { kind: PartKind; color?: string; material: RecipeMaterial; proud?: number }>
> = {
  door: { kind: 'door', material: 'metal' },
  display: { kind: 'display', color: VIEW_PART_LOOK.display, material: 'glass' },
  screen: { kind: 'display', color: VIEW_PART_LOOK.display, material: 'glass' },
  handle: { kind: 'handle', color: VIEW_PART_LOOK.chrome, material: 'metal', proud: 0.03 },
  'solar cells': { kind: 'cell', color: VIEW_PART_LOOK.cell, material: 'glass' },
};

const clampU = (v: number) => Math.min(0.5, Math.max(-0.5, v));
const centre = (b: NormBox) => [b.x + b.w / 2, b.y + b.h / 2] as const;

/** Part names placed on the back face when read on the side view. */
const BACK_PART = /\b(rear|back|tail|taillight|taillights|taillamp)\b/;

/** Wheel centres this share of the length in from each end when only the front is drawn. */
export const FRONT_AXLE = 0.18;

/** Cell columns × rows of a solar panel patch (≈ square cells, ≤ `MAX_PANES` each way). */
export function cellGrid(box: NormBox, aspect: number): [number, number] {
  const ratio = (box.w * aspect) / Math.max(0.01, box.h);
  const rows = Math.min(MAX_PANES, Math.max(1, Math.round(MAX_PANES / Math.max(1, ratio))));
  const cols = Math.min(MAX_PANES, Math.max(1, Math.round(rows * ratio)));
  return [cols, rows];
}

/** Skin patch thickness (unit space): half inside the body, half proud of it. */
export const SKIN = 0.012;
const SKIN_LEVELS = 6;

/** Thin ring hugging a surface: (f(y) ± SKIN, y) from y0 to y1, clamped. */
function strip(f: (y: number) => number, y0: number, y1: number): Array<[number, number]> {
  const ys = Array.from(
    { length: SKIN_LEVELS },
    (_, k) => y0 + ((y1 - y0) * k) / (SKIN_LEVELS - 1)
  );
  return [
    ...ys.map((y) => [clampU(f(y) + SKIN / 2), clampU(y)] as [number, number]),
    ...ys.reverse().map((y) => [clampU(f(y) - SKIN / 2), clampU(y)] as [number, number]),
  ];
}

/** A skin patch: a small hull over the body's unit box (front ring × side ring). */
const skin = (
  points: Array<[number, number]>,
  section: Array<[number, number]>
): Pick<RecipePart, 'shape' | 'at' | 'size' | 'points' | 'section'> => ({
  shape: 'hull',
  at: [0, 0, 0],
  size: [1, 1, 1],
  points,
  section,
});

/**
 * Hull recipe from the measured views: body = front ring along z ∩ side ring along x (front-only:
 * the front ring extruded to Spark's depth), then the parts SAM found — wheels from the side
 * (mirrored, the body notched above them), side glass, windshield and grille as skin patches
 * following the body, headlights and bumper from the front.
 * Unit space, fitted (`fitRecipe`). Pure.
 */
export function viewsRecipe(
  { front, side }: Pick<ObjectViews, 'front' | 'side'>,
  kit: Pick<ObjectKit, 'archetype' | 'proportions' | 'colors' | 'materials'>
): ObjectRecipe {
  const W = front.aspect;
  const H = 1;
  const D = side ? side.aspect : W * sparkDepthRatio(kit);
  const m = Math.max(W, H, D);
  const points = budgetRing(front.ring.map(([u, v]) => [clampU(u - 0.5), clampU(v - 0.5)]));
  // Side image: front of the object on the left = +z.
  let section = side
    ? budgetRing(side.ring.map(([u, v]) => [clampU(0.5 - u), clampU(v - 0.5)]))
    : null;
  const parts: RecipePart[] = [];
  /** Optional parts by group (a mirrored pair stays whole) and rank: lower fills the budget first. */
  const groups: Array<{ rank: number; parts: RecipePart[] }> = [];
  const add = (rank: number, ...ps: RecipePart[]) => {
    if (ps.length) groups.push({ rank, parts: ps });
  };
  /** Budget ranks: glass, then the AI check's parts, then lights and bumper, the grille last. */
  const RANK = { glass: 0, asked: 1, detail: 2, grille: 3 } as const;
  const glass = kit.colors.accent;
  const xSpan = (y: number) => spanAt(points, y) ?? ringRange(points, 0);
  const zSpan = (y: number) =>
    section ? (spanAt(section, y) ?? ringRange(section, 0)) : ([-0.5, 0.5] as [number, number]);
  /**
   * A patch's outline cut to the body ring it lies on, or null when it misses the body (before:
   * full rectangles, so glass and grille stuck out past the roof and the nose, live 2026-11-03).
   */
  const cut = (ring: Ring, a0: number, a1: number, y0: number, y1: number) => {
    const c = clipRing(
      ring,
      Math.min(a0, a1),
      Math.max(a0, a1),
      Math.min(y0, y1),
      Math.max(y0, y1)
    );
    return c.length >= 3 && area(c) > 1e-4 ? c : null;
  };
  /** Skin patch on the front or back face (`face(y)` = its z), cut to the front ring. */
  const faceSkin = (
    a0: number,
    a1: number,
    y0: number,
    y1: number,
    face: (y: number) => number
  ) => {
    const c = cut(points, a0, a1, y0, y1);
    if (!c) return [];
    const [lo, hi] = ringRange(c, 1);
    return [skin(c, strip(face, lo, hi))];
  };
  /** Skin patch on the right (edge 1) or left (edge 0) side, cut to the side ring. */
  const sideSkin = (edge: 0 | 1, z0: number, z1: number, y0: number, y1: number) => {
    const c = section ? cut(section, z0, z1, y0, y1) : null;
    if (!c) return [];
    const [lo, hi] = ringRange(c, 1);
    return [
      skin(
        strip((y) => xSpan(y)[edge], lo, hi),
        c
      ),
    ];
  };

  // Wheels (side view): the 3 largest apart along z, each mirrored on both sides.
  const onObject = (ps: ViewMeasure['parts']) =>
    ps.flatMap((p) => (p.concept === 'wheel' ? [p] : insideObject(p)));
  const sideParts = onObject(side?.parts ?? []);
  const frontParts = onObject(front.parts);
  const tire = (() => {
    const ws = frontParts.filter((p) => p.concept === 'wheel').map((p) => p.box.w);
    return ws.length ? Math.min(0.3, Math.max(0.06, Math.min(...ws))) : 0.14;
  })();
  const wheels: NormBox[] = [];
  for (const p of sideParts
    .filter((p) => p.concept === 'wheel' && p.box.w > 0.05)
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)) {
    const [cx] = centre(p.box);
    if (wheels.some((w) => Math.abs(centre(w)[0] - cx) < (w.w + p.box.w) / 2)) continue;
    if (wheels.length < 3) wheels.push(p.box);
  }
  if (section && wheels.length) {
    // Each wheel notches its own well: the body stops at the wheel top over its length.
    const wells = wheels.map((b) => ({
      z0: 0.5 - (b.x + b.w),
      z1: 0.5 - b.x,
      top: 0.5 - b.y - 0.15 * b.h,
    }));
    section = section.map(([z, y]) => {
      let ny = y;
      for (const w of wells) if (z >= w.z0 && z <= w.z1 && y < w.top) ny = Math.max(ny, w.top);
      return [z, ny] as [number, number];
    });
  }
  const body: RecipePart = section
    ? {
        shape: 'hull',
        at: [0, 0, 0],
        size: [1, 1, 1],
        points,
        section,
        color: kit.colors.main,
        ...(kit.materials?.main ? { material: kit.materials.main } : {}),
        kind: 'body',
        front: true,
        status: 'measured',
      }
    : {
        shape: 'extrude',
        at: [0, 0, 0],
        size: [1, 1, 1],
        points,
        color: kit.colors.main,
        ...(kit.materials?.main ? { material: kit.materials.main } : {}),
        kind: 'body',
        front: true,
        status: 'measured',
      };
  parts.push(body);
  // A person's top (user 2026-11-05: a woman in pink came out all grey): the secondary colour is
  // measured in the top band (`SECONDARY_BAND.person`), so the torso wears it on every face.
  if (kit.archetype === 'person' && section && clothesDiffer(kit.colors)) {
    const look = {
      color: kit.colors.secondary,
      ...(kit.materials?.secondary ? { material: kit.materials.secondary } : {}),
      status: 'measured' as const,
    };
    const [y0, y1] = PERSON_TORSO;
    const [zl, zh] = ringRange(section, 0);
    parts.push(
      ...[
        ...faceSkin(-0.5, 0.5, y0, y1, (y) => zSpan(y)[1]),
        ...faceSkin(-0.5, 0.5, y0, y1, (y) => zSpan(y)[0]),
        ...sideSkin(1, zl, zh, y0, y1),
        ...sideSkin(0, zl, zh, y0, y1),
      ].map((p): RecipePart => ({ ...p, ...look }))
    );
  }
  for (const b of wheels) {
    const [cx, cy] = centre(b);
    const y = 0.5 - cy;
    const z = 0.5 - cx;
    const [xl, xr] = xSpan(y);
    for (const [x, status] of [
      [xr - tire / 2, 'measured'],
      [xl + tire / 2, 'inferred'],
    ] as const)
      parts.push({
        shape: 'cylinder',
        axis: 'x',
        at: [x, y, z],
        size: [tire, Math.min(1, b.h), Math.min(1, b.w)],
        color: VIEW_PART_LOOK.rubber,
        material: 'rubber',
        kind: 'wheel',
        rim: true,
        status,
      });
  }
  // No wheel read on a side (front only, or a side SAM missed them): a vehicle's wheels come
  // from the front drawing — height and diameter as drawn, front and rear axles at the usual
  // place along the length (live 2026-11-03: a front-only car had no wheels at all).
  if (!wheels.length && kit.archetype === 'vehicle') {
    const seenFront = frontParts
      .filter((p) => p.concept === 'wheel' && p.box.h > 0.05)
      .sort((a, b) => b.box.h - a.box.h)[0];
    if (seenFront) {
      const b = seenFront.box;
      const y = 0.5 - (b.y + b.h / 2);
      const [xl, xr] = xSpan(y);
      const dz = Math.min(0.45, b.h / Math.max(0.1, D));
      const axle = 0.5 - Math.max(FRONT_AXLE, dz / 2 + 0.04);
      for (const z of [axle, -axle])
        for (const x of [xr - tire / 2, xl + tire / 2])
          parts.push({
            shape: 'cylinder',
            axis: 'x',
            at: [x, y, z],
            size: [tire, Math.min(1, b.h), dz],
            color: VIEW_PART_LOOK.rubber,
            material: 'rubber',
            kind: 'wheel',
            rim: true,
            status: 'inferred',
          });
    }
  }
  // Side glass: one band over every window SAM found, a skin patch on each side following the
  // body's width at every height (the cabin narrows toward the roof).
  const wins = sideParts.filter((p) => p.concept === 'window');
  if (section && wins.length) {
    const x0 = Math.min(...wins.map((p) => p.box.x));
    const x1 = Math.max(...wins.map((p) => p.box.x + p.box.w));
    const y0 = 0.5 - Math.max(...wins.map((p) => p.box.y + p.box.h));
    const y1 = 0.5 - Math.min(...wins.map((p) => p.box.y));
    const [zl, zh] = zSpan((y0 + y1) / 2);
    const z0 = Math.max(zl, 0.5 - x1);
    const z1 = Math.min(zh, 0.5 - x0);
    if (z1 - z0 > 0.02 && y1 - y0 > 0.02)
      add(
        RANK.glass,
        ...(
          [
            [1, 'measured'],
            [0, 'inferred'],
          ] as const
        ).flatMap(([edge, status]) =>
          sideSkin(edge, z0, z1, y0, y1).map((s): RecipePart => ({
            ...s,
            color: glass,
            material: 'glass',
            kind: 'window',
            status,
          }))
        )
      );
  }
  // Windshield and grille (front view): skin patches on the front face, following its slope.
  for (const [concept, look, rank] of [
    [
      'windshield',
      { color: glass, material: 'glass' as const, kind: 'window' as const },
      RANK.glass,
    ],
    [
      'grille',
      { color: VIEW_PART_LOOK.chrome, material: 'metal' as const, kind: 'grille' as const },
      RANK.grille,
    ],
  ] as const) {
    const p = frontParts
      .filter((q) => q.concept === concept && q.box.w > 0.15)
      .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
    if (!p || !section) continue;
    const y0 = 0.5 - (p.box.y + p.box.h);
    const y1 = 0.5 - p.box.y;
    add(
      rank,
      ...faceSkin(p.box.x - 0.5, p.box.x + p.box.w - 0.5, y0, y1, (y) => zSpan(y)[1]).map(
        (s): RecipePart => ({ ...s, ...look, status: 'measured' })
      )
    );
  }
  // Parts the AI check named that no rule knows: a patch on their face, in the colour it read.
  // The side drawing showed the rear end (tail lights, rear bumper): the rear is measured, not mirrored.
  let backSeen = false;
  for (const [view, list] of [
    ['front', frontParts],
    ['side', sideParts],
  ] as const) {
    for (const p of list) {
      if (!p.look || knownConcept(p.concept) || FRONT_PART_LOOK[p.concept]) continue;
      const y0 = 0.5 - (p.box.y + p.box.h);
      const y1 = 0.5 - p.box.y;
      const look = {
        color: p.look.color ?? kit.colors.secondary,
        ...(p.look.material ? { material: p.look.material } : {}),
        status: 'measured' as const,
      };
      if (view === 'front') {
        add(
          RANK.asked,
          ...faceSkin(p.box.x - 0.5, p.box.x + p.box.w - 0.5, y0, y1, (y) => zSpan(y)[1]).map(
            (s): RecipePart => ({ ...s, ...look })
          )
        );
      } else if (section && BACK_PART.test(p.concept)) {
        backSeen = true;
        // Seen on the side at the back end (rear bumper, tail lights): placed on the back face,
        // a pair of lamps at both corners or a band across the width.
        const yc = (y0 + y1) / 2;
        const [xl, xr] = xSpan(yc);
        // Lamps come in pairs at the corners; a bumper or a panel spans the width.
        const lamp = /light|lamp/.test(p.concept);
        const lw = Math.min(0.3, p.box.h / Math.max(0.1, W));
        const spans: Array<[number, number]> = lamp
          ? [
              [xr - 0.02 - lw, xr - 0.02],
              [xl + 0.02, xl + 0.02 + lw],
            ]
          : [[xl + 0.01, xr - 0.01]];
        add(
          RANK.asked,
          ...spans.flatMap(([a0, a1]) =>
            faceSkin(a0, a1, y0, y1, (y) => zSpan(y)[0]).map((s): RecipePart => ({ ...s, ...look }))
          )
        );
      } else if (section) {
        const z0 = 0.5 - (p.box.x + p.box.w);
        const z1 = 0.5 - p.box.x;
        add(
          RANK.asked,
          ...([1, 0] as const).flatMap((edge) =>
            sideSkin(edge, z0, z1, y0, y1).map((s): RecipePart => ({
              ...s,
              ...look,
              ...(edge === 0 ? { status: 'inferred' as const } : {}),
            }))
          )
        );
      }
    }
  }
  // Front details: headlights (2 largest) and the bumper, flush with the front at their height.
  const lights = frontParts
    .filter((p) => p.concept === 'headlight' && p.box.w < 0.35)
    // On the body: the light's centre inside the front ring at its height.
    .filter((p) => {
      const [cx, cy] = centre(p.box);
      const xs = spanAt(points, 0.5 - cy);
      return !!xs && cx - 0.5 >= xs[0] && cx - 0.5 <= xs[1];
    })
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
    .slice(0, 2);
  add(
    RANK.detail,
    ...lights.map((p): RecipePart => {
      const [cx, cy] = centre(p.box);
      const y = 0.5 - cy;
      return {
        shape: 'cylinder',
        axis: 'z',
        at: [cx - 0.5, y, zSpan(y)[1] - 0.01],
        size: [Math.max(0.01, p.box.w), Math.max(0.01, p.box.h), 0.04],
        color: VIEW_PART_LOOK.lamp,
        material: 'glass',
        kind: 'light',
        status: 'measured',
      };
    })
  );
  // PQ-T24: the rear end of a vehicle is its front mirrored (tail lights, rear bumper), never drawn.
  const rearByMirror = kit.archetype === 'vehicle' && !backSeen;
  if (rearByMirror) {
    add(
      RANK.detail,
      ...lights.map((p): RecipePart => {
        const [cx, cy] = centre(p.box);
        const y = 0.5 - cy;
        return {
          shape: 'cylinder',
          axis: 'z',
          at: [cx - 0.5, y, zSpan(y)[0] + 0.02],
          size: [Math.max(0.01, p.box.w), Math.max(0.01, p.box.h), 0.04],
          color: TAIL_LIGHT_COLOR,
          material: 'glass',
          kind: 'light',
          status: 'inferred',
        };
      })
    );
  }
  const bumper = frontParts
    .filter((p) => p.concept === 'bumper' && p.box.w > 0.4)
    .sort((a, b) => b.box.w - a.box.w)[0];
  // Cut to the body: its width at the bumper's height, never below or above the body.
  const bumperRect = (() => {
    if (!bumper) return null;
    const c = cut(
      points,
      bumper.box.x - 0.5,
      bumper.box.x + bumper.box.w - 0.5,
      0.5 - (bumper.box.y + bumper.box.h),
      0.5 - bumper.box.y
    );
    if (!c) return null;
    const [x0, x1] = ringRange(c, 0);
    const [y0, y1] = ringRange(c, 1);
    return x1 - x0 > 0.2 && y1 - y0 > 0.005 ? { x0, x1, y0, y1 } : null;
  })();
  if (bumperRect) {
    const { x0, x1, y0, y1 } = bumperRect;
    const zf = Math.max(...[y0, (y0 + y1) / 2, y1].map((y) => zSpan(y)[1]));
    add(RANK.detail, {
      shape: 'box',
      at: [(x0 + x1) / 2, (y0 + y1) / 2, zf],
      size: [x1 - x0, Math.max(0.01, y1 - y0), 0.06],
      color: VIEW_PART_LOOK.chrome,
      material: 'metal',
      kind: 'bumper',
      status: 'measured',
    });
    if (rearByMirror) {
      const zr = Math.min(...[y0, (y0 + y1) / 2, y1].map((y) => zSpan(y)[0]));
      add(RANK.detail, {
        shape: 'box',
        // Outer face flush with the rear, so the side silhouette keeps its length.
        at: [(x0 + x1) / 2, (y0 + y1) / 2, zr + 0.03],
        size: [x1 - x0, Math.max(0.01, y1 - y0), 0.06],
        color: VIEW_PART_LOOK.chrome,
        material: 'metal',
        kind: 'bumper',
        status: 'inferred',
      });
    }
  }
  // Appliance and panel front parts (PG-T20): doors, handles, displays, solar cells.
  for (const p of frontParts) {
    const look = FRONT_PART_LOOK[p.concept];
    if (!look || p.box.w < 0.02 || p.box.h < 0.02) continue;
    const y0 = 0.5 - (p.box.y + p.box.h);
    const y1 = 0.5 - p.box.y;
    const face = (y: number) => zSpan(y)[1] + (look.proud ?? 0);
    add(
      RANK.detail,
      ...faceSkin(p.box.x - 0.5, p.box.x + p.box.w - 0.5, y0, y1, face).map((s): RecipePart => ({
        ...s,
        color: p.look?.color ?? look.color ?? kit.colors.secondary,
        material: p.look?.material ?? look.material,
        kind: look.kind,
        ...(look.kind === 'cell' ? { grid: cellGrid(p.box, W) } : {}),
        status: 'measured',
      }))
    );
  }
  // 12-part budget, by rank (stable); a group that does not fit is skipped whole.
  const all = parts.slice(0, MAX_BUILT_PARTS);
  for (const g of groups.map((g, i) => ({ ...g, i })).sort((a, b) => a.rank - b.rank || a.i - b.i))
    if (all.length + g.parts.length <= MAX_BUILT_PARTS) all.push(...g.parts);
  const recipe: ObjectRecipe = {
    proportions: { w: W / m, h: H / m, d: D / m },
    parts: all,
    source: 'views',
  };
  return {
    ...fitRecipe(recipe, 0, 0),
    dimStatus: { depth: side ? 'measured' : 'estimated', yaw: 'estimated', scale: 'estimated' },
  };
}

/**
 * A clean front drawn from a hidden object (PQ-T23) is imagined where the photo shows nothing: every part
 * read on it is `inferred`, never `measured`, except the body that the photo's own silhouette also fixes. Pure.
 */
export function markDrawnInferred(recipe: ObjectRecipe): ObjectRecipe {
  return {
    ...recipe,
    parts: recipe.parts.map((p) =>
      p.status === 'measured' && !p.front ? { ...p, status: 'inferred' as const } : p
    ),
  };
}

/** Front and side cameras of the view score (the side camera sees +z on the left). */
export const VIEW_CAMERAS: Record<'front' | 'side', FlatView> = VIEW_STAGE_CAMERAS;

/**
 * Silhouette IoU of the model against one measured view (both framed on their own bounds): the
 * yardstick of the views path, 0–1. Pure.
 */
export function viewIou(recipe: ObjectRecipe, view: ViewMeasure, side: 'front' | 'side'): number {
  return Math.round(renderView(recipe, view, side).silhouette * 1000) / 1000;
}

/** Pixel height of one sheet tile. */
const SHEET_ROWS = 200;

/** An image URL (data: or https) → its bytes, or null. */
export async function imageBytes(url: string, signal?: AbortSignal): Promise<Buffer | null> {
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(url);
  if (m) return Buffer.from(m[1]!, 'base64');
  try {
    const res = await fetch(url, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** The model seen from one side, flat-shaded on white, framed on its bounds. */
async function modelTile(
  recipe: ObjectRecipe,
  side: 'front' | 'side',
  cols: number
): Promise<Buffer> {
  const rows = SHEET_ROWS;
  const r = renderFlat({ ...recipe, yaw: 0 }, 1, cols, rows, VIEW_CAMERAS[side], (b) => {
    const unit = Math.max((b.x1 - b.x0) / cols, (b.y1 - b.y0) / rows) * 1.1;
    return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, fw: unit * cols, fh: unit * rows };
  });
  const rgb = Buffer.from(r.rgb);
  for (let i = 0; i < r.mask.data.length; i++) if (!r.mask.data[i]) rgb.fill(255, i * 3, i * 3 + 3);
  return sharp(rgb, { raw: { width: cols, height: rows, channels: 3 } })
    .png()
    .toBuffer();
}

/** A drawing cropped around its object (10 % margin), fitted in a tile on white. */
async function drawingTile(bytes: Buffer, box: NormBox, cols: number): Promise<Buffer> {
  const meta = await sharp(bytes).metadata();
  const [W, H] = [meta.width ?? 1, meta.height ?? 1];
  const mx = box.w * 0.1;
  const my = box.h * 0.1;
  const left = Math.max(0, Math.floor((box.x - mx) * W));
  const top = Math.max(0, Math.floor((box.y - my) * H));
  const width = Math.min(W - left, Math.ceil((box.w + 2 * mx) * W));
  const height = Math.min(H - top, Math.ceil((box.h + 2 * my) * H));
  return sharp(bytes)
    .extract({ left, top, width: Math.max(1, width), height: Math.max(1, height) })
    .resize(cols, SHEET_ROWS, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
}

/**
 * The AI check's 2 × 2 sheet: front drawing | model front, side drawing | model side (JPEG data
 * URL), or null when the front drawing cannot be read. Never throws.
 */
export async function viewsSheet(
  recipe: ObjectRecipe,
  views: ObjectViews,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const front = await imageBytes(views.frontUrl, signal);
    if (!front) return null;
    const cols = Math.round(SHEET_ROWS * Math.min(2.5, Math.max(1, views.side?.aspect ?? 1.5)));
    const tiles = await Promise.all([
      drawingTile(front, views.front.box, cols),
      modelTile(recipe, 'front', cols),
      views.side && views.sidePng
        ? drawingTile(views.sidePng, views.side.box, cols)
        : sharp({ create: { width: cols, height: SHEET_ROWS, channels: 3, background: '#ffffff' } })
            .png()
            .toBuffer(),
      modelTile(recipe, 'side', cols),
    ]);
    const jpg = await sharp({
      create: { width: cols * 2, height: SHEET_ROWS * 2, channels: 3, background: '#ffffff' },
    })
      .composite(
        tiles.map((input, i) => ({
          input,
          left: (i % 2) * cols,
          top: Math.floor(i / 2) * SHEET_ROWS,
        }))
      )
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch (err) {
    console.warn('[vision] 3D views sheet failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Rounds of the AI check: the second runs only when the first changed the model. */
export const VIEW_CHECK_ROUNDS = 2;
/** One check round, measured live (Spark ≈ 20–30 s + SAM ≈ 10 s): started only with this left. */
export const VIEW_CHECK_ROUND_MS = 35_000;
/** Whole views path, first answer included (the house path's « up to 90 s »). */
export const VIEWS_TOTAL_MS = 90_000;

const meanIou = (recipe: ObjectRecipe, v: ObjectViews) => {
  const f = viewIou(recipe, v.front, 'front');
  return v.side ? (f + viewIou(recipe, v.side, 'side')) / 2 : f;
};

/**
 * One AI check round's fixes on the views: each missing part SAM finds on its view joins that
 * view's parts (with the colour the AI read); `redrawSide` draws and measures the side again.
 * Returns the new views, or null when nothing could be applied. Never throws.
 */
export async function applyViewsCheck(
  segment: Segment,
  views: ObjectViews,
  check: ViewsCheck,
  label: string,
  concept: string,
  /** SAM concepts read on a redrawn side (the archetype's). */
  sideConcepts: ReadonlyArray<string>,
  signal?: AbortSignal
): Promise<{ views: ObjectViews; applied: string[] } | null> {
  const applied: string[] = [];
  let next: ObjectViews = views;
  try {
    if (check.redrawSide && !signal?.aborted) {
      const png = await imagineSideView(views.frontUrl, objectSidePrompt(label), signal);
      const url = png ? `data:image/png;base64,${png.toString('base64')}` : null;
      const side = url ? await measureView(segment, url, concept, sideConcepts) : null;
      if (side && png && sideLooksNew(views.front, side)) {
        next = { ...next, side, sidePng: png };
        applied.push('side redrawn');
      }
    }
    // Known parts already measured on that view are placed by rule: asking SAM again adds nothing.
    const asks = check.missing.slice(0, MAX_MISSING).filter((m) => {
      const view = m.view === 'front' ? next.front : next.side;
      const known = knownConcept(m.part);
      return view && !(known && view.parts.some((p) => p.concept === known));
    });
    const found = await Promise.all(
      asks.map(async (m) => {
        const view = m.view === 'front' ? next.front : next.side!;
        const url =
          m.view === 'front'
            ? await compactDataUrl(next.frontUrl)
            : `data:image/png;base64,${next.sidePng!.toString('base64')}`;
        const masks = await fetchPartMasks(segment, url, 'other', {
          concepts: [knownConcept(m.part) ?? m.part],
          timeoutMs: VIEW_SAM_TIMEOUT_MS,
        });
        const parts = toObjectBox(masks, view.box)
          .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
          .slice(0, 2)
          .map((p) =>
            knownConcept(m.part)
              ? p
              : {
                  ...p,
                  concept: m.part,
                  look: {
                    ...(m.color ? { color: m.color } : {}),
                    ...(m.material ? { material: m.material } : {}),
                  },
                }
          );
        return { m, parts };
      })
    );
    for (const { m, parts } of found) {
      if (!parts.length) continue;
      const key = m.view === 'front' ? 'front' : 'side';
      const view = next[key]!;
      next = { ...next, [key]: { ...view, parts: [...view.parts, ...parts] } };
      applied.push(`${m.part} (${m.view})`);
    }
    return applied.length ? { views: next, applied } : null;
  } catch (err) {
    console.warn('[vision] 3D views check fixes failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * After the build, the AI checks the model side by side with the drawings and the model is fixed
 * from what it names (≤ `VIEW_CHECK_ROUNDS` rounds); a round is kept only when the silhouette
 * match does not drop. Mock / unusable answers keep the model. Never throws.
 */
export async function checkViewsModel(
  perception: Pick<PerceptionClient, 'checkViews' | 'segmentImage'>,
  recipe: ObjectRecipe,
  views: ObjectViews,
  kit: Pick<ObjectKit, 'archetype' | 'proportions' | 'colors' | 'materials'>,
  label: string,
  concept: string,
  { signal, deadline = Infinity }: { signal?: AbortSignal; deadline?: number } = {}
): Promise<{ recipe: ObjectRecipe; views: ObjectViews }> {
  let best = { recipe, views, iou: meanIou(recipe, views) };
  const segment = perception.segmentImage.bind(perception);
  for (let round = 1; round <= VIEW_CHECK_ROUNDS; round++) {
    if (signal?.aborted) break;
    if (Date.now() + VIEW_CHECK_ROUND_MS > deadline) {
      console.info(`[vision] 3D views check ${round}: no time left, model kept`);
      break;
    }
    const sheet = await viewsSheet(best.recipe, best.views, signal);
    if (!sheet) break;
    let check: ViewsCheck | null = null;
    // The deadline also bounds the call itself: a stalled Spark answer once ran into Vercel's
    // 300 s kill (live 2026-11-03). Aborted = no answer, the model is kept.
    const callSignal = timeoutSignal(deadline - Date.now(), signal);
    try {
      const out = await perception.checkViews(
        sheet,
        viewsCheckQuestion(label, {
          front: viewIou(best.recipe, best.views.front, 'front'),
          side: best.views.side ? viewIou(best.recipe, best.views.side, 'side') : null,
        }),
        callSignal
      );
      check = out.source === 'meta' ? out.check : null;
    } catch (err) {
      console.warn('[vision] 3D views check failed:', err instanceof Error ? err.message : err);
    }
    if (!check || (!check.missing.length && !check.redrawSide)) {
      console.info(`[vision] 3D views check ${round}: ${check ? 'model complete' : 'no answer'}`);
      break;
    }
    const fixed = await applyViewsCheck(
      segment,
      best.views,
      check,
      label,
      concept,
      VIEW_PART_CONCEPTS[kit.archetype]?.side ?? [],
      signal
    );
    if (!fixed) {
      console.info(`[vision] 3D views check ${round}: nothing SAM could find, model kept`);
      break;
    }
    const rebuilt = viewsRecipe(fixed.views, kit);
    const iou = meanIou(rebuilt, fixed.views);
    const kept = iou >= best.iou - 0.02 && rebuilt.parts.length >= best.recipe.parts.length - 1;
    console.info(
      `[vision] 3D views check ${round}: +${fixed.applied.join(', +')} → ${rebuilt.parts.length} parts, IoU ${best.iou.toFixed(3)} → ${iou.toFixed(3)}, ${kept ? 'kept' : 'dropped'}`
    );
    if (!kept) break;
    best = { recipe: rebuilt, views: fixed.views, iou };
  }
  return { recipe: best.recipe, views: best.views };
}
