import type { ObjectKit, PartMaterialKey } from '@/lib/object-kit';
import {
  MAX_PANES,
  MAX_TIMBER,
  MAX_COMPONENTS,
  MAX_DOOR_GLAZED,
  HIP_CLIP_MAX,
  type ObjectRecipe,
  type RecipeMaterial,
  type RecipePart,
} from '@/lib/object-shape';
import { deltaE2000, hexToLab, hexToRgb } from './color-measure';
import type { NormBox } from './schemas';
import { skylineFromRings } from './roofline';

/**
 * House rebuilt from its 2D elevations (user 2026-11-02): the validated front facade and, when
 * Muse Image drew it, the side elevation of the same house. Both are straight-on and unoccluded,
 * so SAM's boxes on them are measurements: walls, eave, roof shape, chimneys, windows, door, and
 * the depth from the side. The photo then only gives colours, materials and the yaw. Pure.
 */

type Ring = ReadonlyArray<readonly [number, number]>;

/** SAM answers on one elevation image (image fractions, x right, y down). */
export interface ElevationMasks {
  /** Image width / height in pixels. */
  aspect: number;
  house?: NormBox;
  roof?: { box: NormBox; rings?: ReadonlyArray<Ring> };
  wall?: NormBox;
  windows: ReadonlyArray<NormBox>;
  doors: ReadonlyArray<NormBox>;
  chimneys: ReadonlyArray<NormBox>;
  /** PG-T3, optional: stone base band, entry steps, glass panes (window / door grid). */
  plinths?: ReadonlyArray<NormBox>;
  steps?: ReadonlyArray<NormBox>;
  panes?: ReadonlyArray<NormBox>;
  /** Exposed timber beams on the walls (posts and rails of a half-timbered house). */
  beams?: ReadonlyArray<NormBox>;
  /**
   * Every house, roof and wall instance SAM found, united (PQ-T62). A house made of several
   * volumes has several roofs and walls: `roof` and `wall` hold the largest one only, and the
   * object used to be measured as that single volume (a wide house rebuilt as its central tower).
   */
  extent?: NormBox;
  /** Top of the highest roof instance, image fraction. */
  roofTop?: number;
}

/** A united extent wider than the main roof / wall by this factor means several volumes. */
export const MULTI_VOLUME_MIN = 1.1;

/** One elevation measured in its own pixel-aspect units (u = x · aspect, v = y). */
export interface Elevation {
  aspect: number;
  /** Roof edges (or walls when there is no roof), x image fractions. */
  left: number;
  right: number;
  wallLeft: number;
  wallRight: number;
  /** Roof top (ridge), eave and ground, y image fractions. */
  top: number;
  eave: number;
  bottom: number;
  /** Flat top of the roof as a share of its width (0 = pointed, 1 = flat); null = not measured. */
  ridge: number | null;
  windows: NormBox[];
  doors: NormBox[];
  chimneys: NormBox[];
  /** Base band at the foot of the walls (PG-T3), null when SAM sees none. */
  plinth: NormBox | null;
  /** Entry steps in front of a door (PG-T3). */
  steps: NormBox[];
  /** Glass panes inside the windows and doors (PG-T3): their grid gives the mullions. */
  panes: NormBox[];
  /** Thin timber beams on the walls, below the eave. */
  beams: NormBox[];
  /** Roof outline on the drawing (SAM rings), for the elevation score (PG-T2). */
  roofRings?: Ring[];
  /** Several volumes (PQ-T62): `eave` and `ridge` describe the largest roof only. */
  multi?: boolean;
}

/** A roof thinner than this share of the body height is a flat top (shop, block). */
export const MIN_ROOF_SHARE = 0.06;
/** Skyline columns within this share of the roof height from its top are on the ridge. */
const RIDGE_BAND = 0.08;
/** A ridge shorter than this share of the roof width is a peak (gable end, pyramid). */
export const PEAK_RIDGE = 0.15;
/** Walls narrower than this share of the body are a SAM miss (a pier, a door frame). */
const MIN_WALL_SHARE = 0.5;
/** Depth / wall width without a side view nor a Spark proportion. */
export const DEFAULT_DEPTH_RATIO = 0.6;
const DEPTH_RANGE = [0.2, 3] as const;
/** Decal thickness (windows, doors), share of the body height. */
const DECAL = 0.015;
/** How far the plinth stands proud of the walls, share of the depth. */
const PLINTH_PROUD = 0.02;
/** Fixed door paint when no colour says otherwise: a door is wood or painted, never the roof. */
export const DOOR_COLOR = '#6b4a2f';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const right = (b: NormBox) => b.x + b.w;
const bottomOf = (b: NormBox) => b.y + b.h;
/** Whether the centre of `b` lies inside `o`. */
const centreIn = (b: NormBox, o: NormBox) => {
  const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
  return cx > o.x && cx < right(o) && cy > o.y && cy < bottomOf(o);
};

/**
 * Flat share of the roof top from its outline: skyline columns within `RIDGE_BAND` of the
 * highest roof point, chimney columns left out (they stand on the roof, they are not it).
 */
export function ridgeShare(
  rings: ReadonlyArray<Ring>,
  box: NormBox,
  chimneys: ReadonlyArray<NormBox> = []
): number | null {
  const sky = skylineFromRings(rings, box);
  const cols = sky.length;
  const tops: number[] = [];
  for (let c = 0; c < cols; c++) {
    const x = box.x + ((c + 0.5) / cols) * box.w;
    if (chimneys.some((ch) => x >= ch.x && x <= right(ch))) continue;
    if (Number.isFinite(sky[c]!)) tops.push(sky[c]!);
  }
  if (tops.length < cols / 3) return null;
  const min = Math.min(...tops);
  const flat = tops.filter((t) => t <= min + RIDGE_BAND).length;
  return clamp(flat / tops.length, 0, 1);
}

/**
 * One elevation from its SAM boxes, or null without a house, wall or roof to stand on. The
 * body spans roof + walls (chimneys excluded); the eave is the roof's lower edge.
 */
export function measureElevation(m: ElevationMasks): Elevation | null {
  const base = m.wall ?? m.house ?? m.roof?.box;
  if (!base || !(m.aspect > 0)) return null;
  const roof = m.roof?.box;
  let left = Math.min(
    ...[roof, m.wall, roof || m.wall ? undefined : m.house].flatMap((b) => (b ? [b.x] : []))
  );
  let rightX = Math.max(
    ...[roof, m.wall, roof || m.wall ? undefined : m.house].flatMap((b) => (b ? [right(b)] : []))
  );
  // PQ-T62: several volumes — the whole object, not its largest roof.
  const multi = !!m.extent && m.extent.w > MULTI_VOLUME_MIN * (rightX - left);
  if (multi) {
    left = Math.min(left, m.extent!.x);
    rightX = Math.max(rightX, right(m.extent!));
  }
  const bottom = Math.max(
    ...[m.house, m.wall, multi ? m.extent : undefined, ...m.doors].flatMap((b) =>
      b ? [bottomOf(b)] : []
    )
  );
  // Roof top: the roof mask, else the house box below its chimneys.
  const chimneyFoot = m.chimneys.length ? Math.max(...m.chimneys.map(bottomOf)) : -1;
  const top = roof
    ? Math.min(roof.y, multi && m.roofTop !== undefined ? m.roofTop : roof.y)
    : m.house
      ? Math.max(m.house.y, Math.min(chimneyFoot, m.wall?.y ?? 1))
      : base.y;
  const bodyH = bottom - top;
  if (!(bodyH > 0) || !(rightX > left)) return null;
  let eave = roof ? bottomOf(roof) : (m.wall?.y ?? top);
  if (eave - top < MIN_ROOF_SHARE * bodyH) eave = top;
  eave = clamp(eave, top, bottom - 0.2 * bodyH);
  const wallOk = m.wall && m.wall.w >= MIN_WALL_SHARE * (rightX - left);
  const ridge =
    eave > top && m.roof?.rings?.length ? ridgeShare(m.roof.rings, m.roof.box, m.chimneys) : null;
  const inside = (b: NormBox) => b.x >= left - 0.02 && right(b) <= rightX + 0.02;
  return {
    aspect: m.aspect,
    left,
    right: rightX,
    wallLeft: wallOk ? m.wall!.x : left,
    wallRight: wallOk ? right(m.wall!) : rightX,
    top,
    eave,
    bottom,
    ridge,
    // A glazed door's panes come back as « windows » (live 2026-11-02): drop those inside a door.
    windows: m.windows.filter(
      (b) => inside(b) && b.y >= eave - 0.02 && !m.doors.some((d) => centreIn(b, d))
    ),
    doors: m.doors.filter((b) => inside(b) && b.y >= eave - 0.02),
    chimneys: m.chimneys.filter((b) => b.y < top + 0.5 * (eave - top) && inside(b)),
    plinth: plinthOf(m.plinths ?? [], left, rightX, bottom, bodyH),
    steps: (m.steps ?? []).filter((b) => inside(b) && Math.abs(bottomOf(b) - bottom) < 0.1 * bodyH),
    // Windows SAM found inside a door are that door's glass panes (PG-T10 glazed top).
    panes: [
      ...(m.panes ?? []),
      ...m.windows.filter((b) => m.doors.some((d) => centreIn(b, d))),
    ].filter((p) =>
      [...m.windows, ...m.doors].some(
        (o) =>
          p.x >= o.x - 0.01 &&
          right(p) <= right(o) + 0.01 &&
          p.y >= o.y - 0.01 &&
          bottomOf(p) <= bottomOf(o) + 0.01
      )
    ),
    beams: (m.beams ?? []).filter(
      (b) =>
        inside(b) &&
        b.y >= eave - 0.02 &&
        bottomOf(b) <= bottom + 0.02 &&
        (b.h >= BEAM_ASPECT * b.w * m.aspect || b.w * m.aspect >= BEAM_ASPECT * b.h)
    ),
    ...(m.roof?.rings?.length ? { roofRings: m.roof.rings.map((r) => [...r]) } : {}),
    ...(multi ? { multi: true } : {}),
  };
}

/** A plinth is a low band (≤ this share of the body height) across most of the walls, on the ground. */
const PLINTH_MAX_SHARE = 0.2;

/** The widest base band SAM found that sits on the ground and spans half the body, else null. */
function plinthOf(
  boxes: ReadonlyArray<NormBox>,
  left: number,
  rightX: number,
  bottom: number,
  bodyH: number
): NormBox | null {
  const ok = boxes.filter(
    (b) =>
      b.h <= PLINTH_MAX_SHARE * bodyH &&
      b.w >= 0.5 * (rightX - left) &&
      Math.abs(bottomOf(b) - bottom) < 0.05 * bodyH
  );
  return ok.length ? ok.reduce((a, b) => (b.w > a.w ? b : a)) : null;
}

/** Roof and walls closer than this ΔE2000 read as one surface (the user's 2026-11-02 render). */
export const ROOF_WALL_MIN_DE = 10;

/** Typical colour of each roofing / walling material, used only to pull apart look-alike parts. */
export const MATERIAL_BASE: Partial<Record<RecipeMaterial, string>> = {
  thatch: '#b8955a',
  slate: '#5f5a55',
  tile: '#a0522d',
  metal: '#8a9099',
  wood: '#7a5a3a',
  stone: '#a39a8a',
  brick: '#9c4a32',
  plaster: '#e6dccb',
  concrete: '#9a9a96',
};

const mixHex = (a: string, b: string, t: number) => {
  const [p, q] = [hexToRgb(a), hexToRgb(b)];
  return `#${p
    .map((v, i) =>
      Math.round(v + (q[i]! - v) * t)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
};

/**
 * PG-T9 guard: when the drawing names different materials for a part and the surface next to it
 * but their colours are one surface (ΔE < `ROOF_WALL_MIN_DE`), the part is pulled toward its
 * material's typical colour, in quarter steps, until they part. Same materials or no base →
 * unchanged. Used for the roof against the walls, and chimney / plinth against walls and roof.
 */
export function separateColor(
  part: { color: string; material?: RecipeMaterial | undefined },
  ...others: ReadonlyArray<{ color: string; material?: RecipeMaterial | undefined }>
): { color: string; nudged: boolean } {
  const base = part.material && MATERIAL_BASE[part.material];
  const against = others.filter((o) => o.material !== part.material).map((o) => hexToLab(o.color));
  if (!base || !against.length) return { color: part.color, nudged: false };
  const far = (c: string) =>
    against.every((lab) => deltaE2000(hexToLab(c), lab) >= ROOF_WALL_MIN_DE);
  if (far(part.color)) return { color: part.color, nudged: false };
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const c = mixHex(part.color, base, t);
    if (far(c)) return { color: c, nudged: true };
  }
  return { color: base, nudged: true };
}

/** The roof against the walls (PG-T9). */
export const separateRoofColor = (
  roof: { color: string; material?: RecipeMaterial | undefined },
  wall: { color: string; material?: RecipeMaterial | undefined }
) => separateColor(roof, wall);

/** Base band height without a measured one, share of the wall height (≈ 400 mm on 3 m). */
export const PLINTH_SHARE = 0.12;

/**
 * Usual half-timbering when Spark reads a timber frame but SAM finds no beam: posts at the wall
 * ends and beside every opening, rails at the window heads and sills (shares, `timberFrame` form).
 */
export function inferredTimber(
  e: Pick<Elevation, 'windows' | 'doors' | 'wallLeft' | 'wallRight' | 'eave' | 'bottom'>
): { posts: number[]; rails: number[] } | null {
  const W = e.wallRight - e.wallLeft;
  const H = e.bottom - e.eave;
  if (!(W > 0 && H > 0)) return null;
  const sx = (x: number) => clamp((x - e.wallLeft) / W, 0, 1);
  const sy = (y: number) => clamp((e.bottom - y) / H, 0, 1);
  const pad = 0.012;
  const openings = [...e.windows, ...e.doors];
  const posts = mergeClose(
    [0, 1, ...openings.flatMap((o) => [sx(o.x) - pad, sx(right(o)) + pad])].map((v) =>
      clamp(v, 0, 1)
    ),
    BEAM_MERGE
  ).slice(0, MAX_TIMBER);
  const rails = e.windows.length
    ? mergeClose(
        [
          sy(Math.min(...e.windows.map((w) => w.y))) + pad,
          sy(Math.max(...e.windows.map(bottomOf))) - pad,
        ].map((v) => clamp(v, 0, 1)),
        BEAM_MERGE
      )
    : [];
  return { posts, rails };
}

/** A beam is this many times longer than thick (pixels). */
const BEAM_ASPECT = 4;
/** Beam lines closer than this share of the wall are one beam. */
const BEAM_MERGE = 0.03;

/** Sorted values of `xs`, those closer than `tol` merged to their mean. */
function mergeClose(xs: number[], tol: number): number[] {
  const v = [...xs].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const x of v) {
    const last = out.at(-1);
    if (last && x - last.at(-1)! <= tol) last.push(x);
    else out.push([x]);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/**
 * Timber frame of the front wall from its beams (PV-G): vertical beams → post x, horizontal ones →
 * rail y, as shares of the wall (x from its left, y from the ground up to the eave). Null under
 * 2 beams (no half-timbering read).
 */
export function timberFrame(
  e: Pick<Elevation, 'beams' | 'aspect' | 'wallLeft' | 'wallRight' | 'eave' | 'bottom'>
): { posts: number[]; rails: number[] } | null {
  if (e.beams.length < 2) return null;
  const W = e.wallRight - e.wallLeft;
  const H = e.bottom - e.eave;
  if (!(W > 0 && H > 0)) return null;
  const vertical = (b: NormBox) => b.h >= b.w * e.aspect;
  const share = (v: number) => clamp(v, 0, 1);
  const posts = mergeClose(
    e.beams.filter(vertical).map((b) => share((b.x + b.w / 2 - e.wallLeft) / W)),
    BEAM_MERGE
  ).slice(0, MAX_TIMBER);
  const rails = mergeClose(
    e.beams.filter((b) => !vertical(b)).map((b) => share((e.bottom - (b.y + b.h / 2)) / H)),
    BEAM_MERGE
  ).slice(0, MAX_TIMBER);
  return posts.length + rails.length >= 2 ? { posts, rails } : null;
}

/** Distinct values of `xs` (sorted), merged when closer than `tol`. */
function clusters(xs: number[], tol: number): number {
  const v = [...xs].sort((a, b) => a - b);
  let n = 0;
  let last = -Infinity;
  for (const x of v) {
    if (x - last > tol) n++;
    last = x;
  }
  return n;
}

/**
 * Pane grid of one opening (PG-T8) from the SAM panes inside it: columns and rows of distinct
 * pane centres. Null below 2 panes (the 3D view then draws its default cross).
 */
export function paneGrid(opening: NormBox, panes: ReadonlyArray<NormBox>): [number, number] | null {
  const inside = panes.filter((p) => {
    const [cx, cy] = [p.x + p.w / 2, p.y + p.h / 2];
    return cx > opening.x && cx < right(opening) && cy > opening.y && cy < bottomOf(opening);
  });
  if (inside.length < 2) return null;
  const mw = Math.min(...inside.map((p) => p.w));
  const mh = Math.min(...inside.map((p) => p.h));
  const cap = (k: number) => clamp(k, 1, MAX_PANES);
  return [
    cap(
      clusters(
        inside.map((p) => p.x + p.w / 2),
        mw / 2
      )
    ),
    cap(
      clusters(
        inside.map((p) => p.y + p.h / 2),
        mh / 2
      )
    ),
  ];
}

/** A door this wide for its height is a pair of leaves (the drawing's double door). */
export const DOUBLE_DOOR_RATIO = 0.6;
/** Glazed share of a door top: at least this (one pane row reads), at most `MAX_DOOR_GLAZED`. */
const MIN_DOOR_GLAZED = 0.15;

/**
 * Glazed top of a door (PG-T10) from the SAM panes inside it: share of the door height from its
 * top down to the lowest pane, and their grid. Null without a pane in the door.
 */
export function doorGlazing(
  door: NormBox,
  panes: ReadonlyArray<NormBox>
): { glazed: number; grid: [number, number] } | null {
  const inside = panes.filter((p) => centreIn(p, door));
  if (!inside.length || !(door.h > 0)) return null;
  const low = Math.max(...inside.map(bottomOf));
  const glazed = clamp((low - door.y) / door.h, MIN_DOOR_GLAZED, MAX_DOOR_GLAZED);
  return { glazed, grid: paneGrid(door, inside) ?? [1, 1] };
}

/** Wall width over body height, in pixels. */
const wallRatio = (e: Elevation) => ((e.wallRight - e.wallLeft) * e.aspect) / (e.bottom - e.top);

/**
 * Depth / front wall width from the side elevation: both are scaled to the same body height
 * (walls + roof). Null without a side; clamped to a sane house.
 */
export function depthRatio(front: Elevation, side: Elevation | null): number | null {
  if (!side) return null;
  const r = wallRatio(side) / wallRatio(front);
  return Number.isFinite(r) ? clamp(r, ...DEPTH_RANGE) : null;
}

/** Side and Spark depths further apart than this factor: the side drawing's width is not trusted. */
export const DEPTH_AGREEMENT = 1.3;

/**
 * Depth / width, fused (live 2026-11-02: Muse Image draws a side sheet « fit to frame », once a
 * 4.6 m side as wide as the 7.8 m front). Spark reads the depth on the photo, where the side wall
 * is seen; the side drawing only refines it when both agree (geometric mean), else Spark wins.
 * Neither → `DEFAULT_DEPTH_RATIO`.
 */
export function fuseDepth(sideRatio: number | null, sparkRatio: number | undefined): number {
  const spark =
    sparkRatio && Number.isFinite(sparkRatio) && sparkRatio > 0
      ? clamp(sparkRatio, ...DEPTH_RANGE)
      : null;
  if (sideRatio === null) return spark ?? DEFAULT_DEPTH_RATIO;
  if (spark === null) return sideRatio;
  const factor = Math.max(sideRatio, spark) / Math.min(sideRatio, spark);
  return factor <= DEPTH_AGREEMENT ? Math.sqrt(sideRatio * spark) : spark;
}

/** Side and front body shapes closer than this (ratio) with both roofs peaked = a copied front. */
const COPY_RATIO = 0.15;
/** Eave share (roof height / body height) may differ this much between two views of one house. */
const EAVE_SHARE_TOLERANCE = 0.15;

const eaveShare = (e: Elevation) => (e.eave - e.top) / (e.bottom - e.top);
const peaked = (e: Elevation) => e.eave > e.top && e.ridge !== null && e.ridge < PEAK_RIDGE;

/**
 * What the side view must show of the roof, read on the front: a peaked front (gable on the
 * street) shows its long slope from the side, a long front ridge shows the roof's end.
 */
export function sideRoofHint(front: Elevation): 'slope' | 'end' | null {
  if (front.eave <= front.top || front.ridge === null) return null;
  return front.ridge < PEAK_RIDGE ? 'slope' : 'end';
}

/**
 * Whether a drawn side view can be trusted (user 2026-11-02, live: Muse Image once redrew the
 * front as the « side »). Rejected: storeys at another height (eave share apart), or a peaked
 * roof on both views with the same body shape — a copy, unless the plan is square.
 */
export function sideConsistent(front: Elevation, side: Elevation): boolean {
  // PQ-T65: a house of several volumes has no single eave line; its largest roof's eave differs
  // from one view to the other by nature (live: both side drawings of a stepped shed-roof house
  // were rejected, so nothing guided the depth). Only the copied-front test applies there.
  if (front.multi || side.multi) {
    const r = wallRatio(side) / wallRatio(front);
    const sameOpenings = side.windows.length === front.windows.length && front.windows.length > 0;
    return !(Math.abs(r - 1) < COPY_RATIO && sameOpenings);
  }
  if (Math.abs(eaveShare(front) - eaveShare(side)) > EAVE_SHARE_TOLERANCE) return false;
  if (peaked(front) && peaked(side)) {
    const r = wallRatio(side) / wallRatio(front);
    if (Math.abs(r - 1) < COPY_RATIO) return false;
  }
  return true;
}

export type RoofKind = 'flat' | 'gable' | 'hip';

/** Outer share of the roof width read for its end height (half-hip shoulders, PG-T22). */
const END_BAND = 0.04;
/** A gable share below this is a full hip (thatch rolls and overhangs round the corners). */
export const MIN_HIP_CLIP = 0.2;

/**
 * Half-hip (PG-T22): how high the roof's ends stand vertical, share of the roof height from the
 * eave, read on the front outline. A full hip slopes down to its corners (≈ 0); a half-hip shows
 * vertical ends up to its shoulders, then the small hip. Null without an outline.
 */
export function gableShare(e: Elevation): number | null {
  if (!e.roofRings?.length || e.eave <= e.top) return null;
  const box: NormBox = { x: e.left, y: e.top, w: e.right - e.left, h: e.eave - e.top };
  const sky = skylineFromRings(e.roofRings, box);
  const n = sky.length;
  const band = Math.max(1, Math.round(END_BAND * n));
  const xOf = (c: number) => box.x + ((c + 0.5) / n) * box.w;
  const end = (cols: number[]) => {
    const tops = cols
      .filter((c) => !e.chimneys.some((ch) => xOf(c) >= ch.x && xOf(c) <= right(ch)))
      .map((c) => sky[c]!)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    return tops.length ? tops[Math.floor(tops.length / 2)]! : null;
  };
  const ends = [
    end(Array.from({ length: band }, (_, i) => i)),
    end(Array.from({ length: band }, (_, i) => n - 1 - i)),
  ].filter((v): v is number => v !== null);
  if (!ends.length) return null;
  return clamp(1 - ends.reduce((a, b) => a + b, 0) / ends.length, 0, 1);
}

/**
 * Roof form from the two flat shares. Front ridge long → hipped (or side gable when ≈ 1), a
 * half-hip (`clip`) when the front outline's ends stand vertical. Front peaked → gable facing the
 * street, unless the side is peaked too (pyramid = hip, ridge 0).
 */
export function roofKind(
  front: Elevation,
  side: Elevation | null
): { kind: RoofKind; ridge: number; clip?: number } {
  if (front.eave <= front.top) return { kind: 'flat', ridge: 0 };
  const f = front.ridge;
  if (f === null || f < PEAK_RIDGE) {
    if (side && side.ridge !== null && side.ridge < PEAK_RIDGE) return { kind: 'hip', ridge: 0 };
    return { kind: 'gable', ridge: 0 };
  }
  const clip = gableShare(front);
  if (clip !== null && clip >= MIN_HIP_CLIP && clip <= HIP_CLIP_MAX && f < 1 - PEAK_RIDGE / 3) {
    return { kind: 'hip', ridge: f, clip };
  }
  return { kind: 'hip', ridge: f > 1 - PEAK_RIDGE ? 1 : f };
}

/** Measured beams first; else Spark says the walls are half-timbered → the usual layout. */
export function wallTimber(
  front: Elevation,
  details?: ObjectKit['details']
): ReturnType<typeof timberFrame> {
  return timberFrame(front) ?? (details?.timberFrame ? inferredTimber(front) : null);
}

export interface FacadeHouseInput {
  front: Elevation;
  side: Elevation | null;
  colors: ObjectKit['colors'];
  materials?: ObjectKit['materials'];
  /** Material per part read on the drawing (PG-T5); wins over the colour-role materials. */
  partMaterials?: ObjectKit['partMaterials'];
  /** Spark's details read on the drawing (plinth, timber frame, panes): used where SAM finds none. */
  details?: ObjectKit['details'];
  /** Depth / width read by Spark on the photo (its kit proportions). */
  sparkDepth?: number;
}

/**
 * The house recipe: walls, the measured roof, chimneys, front door and windows from the front
 * elevation, side windows from the side one (right wall), ≤ 12 parts in that priority. Units:
 * front body height = 1; proportions carry the measured width / height / depth.
 */
export function facadeHouseRecipe({
  front,
  side,
  colors,
  materials,
  partMaterials,
  details,
  sparkDepth,
}: FacadeHouseInput): ObjectRecipe {
  const A = front.aspect;
  const H = front.bottom - front.top;
  const X = (x: number) => (x * A) / H;
  const Y = (y: number) => -(y - front.top) / H; // 0 at the ridge, −1 at the ground
  const cx = (X(front.wallLeft) + X(front.wallRight)) / 2;
  const wallW = X(front.wallRight) - X(front.wallLeft);
  const roofW = X(front.right) - X(front.left);
  const overhang = Math.max(0, (roofW - wallW) / 2);
  const depth = wallW * fuseDepth(depthRatio(front, side), sparkDepth);
  const yMid = -0.5; // body centre: half way from the ridge (0) to the ground (−1)
  const eaveY = Y(front.eave);
  // Colour from the photo role, material from the drawing first (PG-T5), else the role's.
  const role = (r: keyof ObjectKit['colors'], part?: PartMaterialKey) => {
    const material = (part && partMaterials?.[part]) ?? materials?.[r];
    return { color: colors[r], ...(material ? { material } : {}) };
  };
  const at = (x: number, y: number, z: number): RecipePart['at'] => [x, y - yMid, z];
  const box = (b: NormBox, z: number, thick: number): Pick<RecipePart, 'at' | 'size'> => ({
    at: at((X(b.x) + X(right(b))) / 2 - cx, (Y(b.y) + Y(bottomOf(b))) / 2, z),
    size: [X(right(b)) - X(b.x), Y(b.y) - Y(bottomOf(b)), thick],
  });
  const t = DECAL;
  const timber = wallTimber(front, details);
  const walls: RecipePart = {
    shape: 'box',
    at: at(0, (eaveY - 1) / 2, 0),
    size: [wallW, eaveY + 1, depth],
    front: true,
    kind: 'wall',
    ...(timber ? { timber } : {}),
    ...role('main', 'walls'),
  };
  const { kind, ridge, clip } = roofKind(front, side);
  const roofLook = role('secondary', 'roof');
  const roofColor = separateRoofColor(roofLook, walls).color;
  const roofFinal = { ...roofLook, color: roofColor };
  // Chimney and base have no measured colour of their own: their material's typical colour
  // (brick red, stone grey), not the wall's (white chimneys on white walls, review 2026-11-02).
  const chimneyMat = partMaterials?.chimney ?? 'brick';
  const chimneyLook = {
    material: chimneyMat,
    color:
      MATERIAL_BASE[chimneyMat] ??
      separateColor({ color: colors.main, material: chimneyMat }, walls, roofFinal).color,
  };
  const baseMat = partMaterials?.plinth ?? 'stone';
  const baseLook = {
    material: baseMat,
    color:
      MATERIAL_BASE[baseMat] ??
      separateColor({ color: colors.main, material: baseMat }, walls, roofFinal).color,
  };
  const roofH = -eaveY;
  const roof: RecipePart[] =
    kind === 'flat'
      ? []
      : [
          {
            shape: kind === 'hip' ? 'hip' : 'prism',
            at: at((X(front.left) + X(front.right)) / 2 - cx, eaveY / 2, 0),
            size: [roofW, roofH, depth + 2 * overhang],
            ...(kind === 'hip' ? { ridge, ...(clip ? { clip } : {}) } : { apex: 0.5 }),
            kind: 'roof' as const,
            ...roofLook,
            color: roofColor,
          },
        ];
  // Side image → house frame: x maps to depth z (image left = front, the right wall seen from
  // +x), y to the same body height. Null without a side view.
  const sideMap = side
    ? (() => {
        const sH = side.bottom - side.top;
        const mid = (side.wallLeft + side.wallRight) / 2;
        const zPerX = depth / Math.max(1e-6, side.wallRight - side.wallLeft);
        return {
          z: (x: number) => clamp(-(x - mid) * zPerX, -depth / 2, depth / 2),
          dz: (w: number) => w * zPerX,
          y: (v: number) => -(v - side.top) / sH,
        };
      })()
    : null;
  // Chimneys stand from the eave (hidden in the roof) to their measured top; their depth
  // position comes from the side view when it shows one.
  const sideChimney = side?.chimneys[0];
  const chimneyZ = sideChimney && sideMap ? sideMap.z(sideChimney.x + sideChimney.w / 2) : 0;
  const chimneys: RecipePart[] = front.chimneys.slice(0, 2).map((c) => {
    const w = X(right(c)) - X(c.x);
    const topY = Y(c.y);
    return {
      shape: 'box',
      at: at((X(c.x) + X(right(c))) / 2 - cx, (topY + eaveY) / 2, chimneyZ),
      size: [w, topY - eaveY, w],
      kind: 'chimney',
      cap: true,
      ...chimneyLook,
    };
  });
  const zFront = depth / 2 + t / 2;
  // Lintels over the openings unless the timber frame already draws a rail there.
  const lintel = timber ? {} : { lintel: true };
  const doors: RecipePart[] = front.doors.slice(0, 2).map((d) => {
    const glazing = doorGlazing(d, front.panes);
    return {
      shape: 'box',
      ...box(d, zFront, t),
      kind: 'door',
      // Wide door → two leaves (pixel ratio, image fractions × aspect).
      ...((d.w * A) / d.h > DOUBLE_DOOR_RATIO ? { leaves: 2 } : {}),
      ...(glazing ?? {}),
      ...lintel,
      color: DOOR_COLOR,
      material: partMaterials?.door ?? 'wood',
    };
  });
  const glass = { color: colors.accent, material: 'glass' as const };
  const byArea = (a: NormBox, b: NormBox) => b.w * b.h - a.w * a.h;
  const windows: RecipePart[] = [...front.windows].sort(byArea).map((w) => {
    const grid = paneGrid(w, front.panes) ?? details?.panes ?? null;
    return {
      shape: 'box',
      ...box(w, zFront, t),
      kind: 'window',
      ...(grid ? { grid } : {}),
      sill: true,
      ...lintel,
      ...glass,
    };
  });
  // Side windows on the right wall: side image x → depth z (image left = front).
  const sideWindows: RecipePart[] =
    side && sideMap
      ? [...side.windows].sort(byArea).map((w) => ({
          shape: 'box' as const,
          at: at(
            wallW / 2 + t / 2,
            (sideMap.y(w.y) + sideMap.y(bottomOf(w))) / 2,
            sideMap.z(w.x + w.w / 2)
          ),
          size: [t, sideMap.y(w.y) - sideMap.y(bottomOf(w)), sideMap.dz(w.w)] as RecipePart['size'],
          kind: 'window' as const,
          ...glass,
          // Seen on the imagined side elevation only.
          status: 'inferred' as const,
        }))
      : [];
  // Stone base and entry step (PG-T3 boxes): proud of the wall by `PLINTH_PROUD` of the depth.
  const proud = PLINTH_PROUD * depth;
  // Base band: measured, else Spark's « plinth » → a standard band at the wall foot (inferred).
  const plinthBox =
    front.plinth ??
    (details?.plinth
      ? {
          x: front.wallLeft,
          y: front.bottom - PLINTH_SHARE * (front.bottom - front.eave),
          w: front.wallRight - front.wallLeft,
          h: PLINTH_SHARE * (front.bottom - front.eave),
        }
      : null);
  const plinthInferred = !front.plinth && plinthBox !== null;
  const base: RecipePart[] = plinthBox
    ? [
        {
          shape: 'box',
          at: at(0, (Y(plinthBox.y) + Y(front.bottom)) / 2, 0),
          size: [wallW + 2 * proud, Y(plinthBox.y) - Y(front.bottom), depth + 2 * proud],
          kind: 'plinth',
          ...baseLook,
        },
      ]
    : [];
  // Step: measured, else one in front of the main door when the house stands on a base.
  const door0 = front.doors[0];
  const stepBoxes: NormBox[] = front.steps.length
    ? front.steps.slice(0, 1)
    : plinthBox && door0
      ? [
          {
            x: door0.x - 0.1 * door0.w,
            y: front.bottom - 0.6 * plinthBox.h,
            w: 1.2 * door0.w,
            h: 0.6 * plinthBox.h,
          },
        ]
      : [];
  const steps: RecipePart[] = stepBoxes.map((st) => {
    const h = Math.max(Y(st.y) - Y(bottomOf(st)), 0.02);
    const d = Math.max(4 * h, 2 * proud);
    return {
      shape: 'box',
      at: at((X(st.x) + X(right(st))) / 2 - cx, Y(front.bottom) + h / 2, depth / 2 + d / 2),
      size: [X(right(st)) - X(st.x), h, d],
      kind: 'step',
      ...baseLook,
    };
  });
  const measuredParts: RecipePart[] = [
    walls,
    ...roof,
    ...doors,
    ...chimneys,
    ...windows,
    ...(plinthInferred ? [] : [...base, ...(front.steps.length ? steps : [])]),
  ].map((p) => ({
    ...p,
    status: 'measured' as const,
  }));
  // Read by Spark, placed by rule: inferred, after the measured parts.
  const inferredBase: RecipePart[] = [
    ...(plinthInferred ? base : []),
    ...(front.steps.length && !plinthInferred ? [] : steps),
  ].map((p) => ({ ...p, status: 'inferred' as const }));
  const parts = [...measuredParts, ...inferredBase, ...sideWindows].slice(0, MAX_COMPONENTS);
  // Bounds of every part → proportions (largest side 1); fitRecipe re-centres the parts.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, p.at[i]! - p.size[i]! / 2);
      hi[i] = Math.max(hi[i]!, p.at[i]! + p.size[i]! / 2);
    }
  const span = lo.map((l, i) => hi[i]! - l);
  const max = Math.max(...span);
  return {
    proportions: { w: span[0]! / max, h: span[1]! / max, d: span[2]! / max },
    parts,
  };
}
