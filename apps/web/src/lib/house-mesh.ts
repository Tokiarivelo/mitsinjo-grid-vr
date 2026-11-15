import { atlasUv, faceSlot, FACE_VIEWS, type AtlasView, type FaceView } from './face-atlas';
import {
  isOpenVolume,
  shedFall,
  type HouseHead,
  type HouseOpening,
  type HousePlan,
  type HouseVolume,
  type HouseWall,
} from './house-plan';

/**
 * Model of a house plan (PQ-T72): every volume a closed block of walls with its own roof, the
 * openings cut through the walls (reveal, frame, sill, glass and glazing bars, door leaf), the
 * veranda open on posts over its deck, the chimneys, the bands. Shared by the 3D object view and
 * the village. Pure: triangles, normals, atlas uvs and a slot per triangle.
 *
 * Slots: the five editable surfaces first (`HULL_SURFACES` order: roof, then each wall that can
 * wear its drawing), then the plain wall (a wall no drawing sees: behind a veranda, inside a
 * corner, a chimney), the trim (frames, sills, fascias, posts, bands), the glass, the doors and
 * the base (deck, steps); then the other finishes (PQ-T73): a second cladding, the masonry of the
 * piers, a second roofing, the timber of posts, brackets and trusses.
 */
export const HOUSE_SLOTS = [
  'roof',
  'front',
  'right',
  'back',
  'left',
  'wall',
  'trim',
  'glass',
  'door',
  'base',
  'wall2',
  'stone',
  'roof2',
  'timber',
] as const;
export type HouseSlot = (typeof HOUSE_SLOTS)[number];

export interface HouseMesh {
  position: Float32Array;
  normal: Float32Array;
  /** Atlas uvs: each point read on the drawing that looks at it (`faceSlot`). */
  uv: Float32Array;
  /** Slot index per triangle (`HOUSE_SLOTS`). */
  slot: Uint8Array;
}

// Detail sizes, shares of the model's largest side (the model is 1 unit at most).
/** Depth of an opening's reveal: the glass sits this far behind the wall. */
export const REVEAL = 0.014;
/** Width of a frame bar and how far it stands out of the wall. */
export const FRAME_WIDTH = 0.007;
export const FRAME_OUT = 0.005;
/** Window sill: thickness, overhang past the frame, and how far it stands out. */
export const SILL_HEIGHT = 0.007;
export const SILL_OVER = 0.006;
export const SILL_OUT = 0.014;
/** Glazing bar width. */
export const MUNTIN = 0.0035;
/** Roof overhang past the walls, fascia height. */
export const OVERHANG = 0.03;
export const FASCIA = 0.012;
/** Side of a veranda post, height of the beam it carries. */
export const POST = 0.018;
export const BEAM = 0.016;
/** Band (string course): height, how far it stands out. */
export const BAND_HEIGHT = 0.01;
export const BAND_OUT = 0.004;
/** Deck of a veranda that has no raised floor. */
export const DECK_MIN = 0.006;
/** Plinth under every closed block (share of the model's largest side): height, step out. */
export const PLINTH = 0.02;
export const PLINTH_OUT = 0.006;
/** Chimney cap: overhang and thickness. */
export const CAP_OVER = 0.006;
export const CAP_HEIGHT = 0.01;
/** Openings keep this clear of a wall's edges and of its eave. */
export const OPENING_MARGIN = 0.008;
/** Post spacing when the plan gives no count. */
export const POST_SPACING = 0.14;
/** Panes of a window the plan gives none for. */
export const DEFAULT_PANES: readonly [number, number] = [2, 2];
/** Balcony slab thickness, railing height, rail and baluster sizes. */
export const SLAB = 0.012;
/** Height under which an open volume is a bare deck (terrace): no posts, no beam, no roof. */
export const HEADROOM = 0.04;
export const RAIL_HEIGHT = 0.07;
export const RAIL = 0.005;
export const BALUSTER_SPACING = 0.022;
/** Points along an arched head (each half). */
export const ARCH_STEPS = 8;
/** Rise of a segmental head, share of its half width. */
export const SEGMENT_RISE = 0.35;
/** Rise of a bracketed bay (timber knees), share of the bay's width. */
export const BRACKET_RISE = 0.22;
/** Pier cap: overhang past the pier and height (share of the model). */
export const PIER_CAP_OVER = 0.006;
export const PIER_CAP = 0.012;
/** Truss member width (share of the model) and how far it stands proud of the gable. */
export const TRUSS = 0.012;
/** Plan share a veranda may stick out of the volume it sits under and still count as inside it. */
export const HOST_SLACK = 0.02;

const OPPOSITE = { front: 'back', back: 'front', right: 'left', left: 'right' } as const;

type V3 = [number, number, number];
type Rect = [number, number, number, number]; // u0, u1, v0, v1 (world)

const EPS = 1e-6;

/** Outward normal of a wall. */
const WALL_NORMAL: Record<HouseWall, V3> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

export interface HouseMeshOptions {
  /** Tiles the atlas holds; absent = the uvs read the front tile (they are unused). */
  views?: ReadonlyArray<AtlasView>;
}

/** The house plan as triangles, in the model's frame (centred, `dims` = w, h, d). */
export function houseMesh(
  plan: HousePlan,
  dims: readonly [number, number, number],
  { views = ['front'] }: HouseMeshOptions = {}
): HouseMesh {
  const [w, h, d] = dims;
  const S = Math.max(w, h, d) || 1;
  const has = new Set<AtlasView>(views);
  const tile = (v: FaceView): FaceView => {
    if (has.has(v)) return v;
    const other = ({ front: 'back', back: 'front', right: 'left', left: 'right' } as const)[v];
    return has.has(other) ? other : (views.find((x): x is FaceView => x !== 'top') ?? 'front');
  };
  // World ↔ plan shares.
  const X = (x: number) => (x - 0.5) * w;
  const Y = (y: number) => (y - 0.5) * h;
  const Z = (z: number) => (z - 0.5) * d;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

  // Finish slots (PQ-T73): a plan that reads none builds exactly as before.
  const timber: HouseSlot = plan.look.timber ? 'timber' : 'trim';
  const roofSlot = (v: HouseVolume): HouseSlot => (v.roofFinish === 'roof2' ? 'roof2' : 'roof');
  const wallSlot = (v: HouseVolume): HouseSlot | null =>
    v.wallFinish && v.wallFinish !== 'wall' ? v.wallFinish : null;

  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const slots: number[] = [];
  const slotOf = (s: HouseSlot) => HOUSE_SLOTS.indexOf(s);

  /** Atlas uv of a world point read on `view` (an elevation, or the plan for 'top'). */
  const uvOf = (p: V3, view: AtlasView): [number, number] => {
    const [x, y, z] = [p[0] / w + 0.5, p[1] / h + 0.5, p[2] / d + 0.5];
    if (view === 'top') return atlasUv(faceSlot(has.has('top') ? 'top' : 'front'), x, z);
    const s = view === 'front' || view === 'back' ? x : z;
    return atlasUv(faceSlot(tile(view)), clamp01(s), clamp01(1 - y));
  };
  const viewOfNormal = (n: V3): AtlasView => {
    const [ax, ay, az] = n.map(Math.abs) as V3;
    if (ay > ax && ay > az) return 'top';
    if (ax > az) return n[0] > 0 ? 'right' : 'left';
    return n[2] > 0 ? 'front' : 'back';
  };

  /** Triangle, wound so it faces `out`. */
  const tri = (a: V3, b: V3, c: V3, out: V3, slot: HouseSlot, view?: AtlasView) => {
    const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n);
    if (len < 1e-12) return;
    n = [n[0] / len, n[1] / len, n[2] / len];
    let pts = [a, b, c];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) {
      pts = [a, c, b];
      n = [-n[0], -n[1], -n[2]];
    }
    const seen = view ?? viewOfNormal(n);
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
      uvs.push(...uvOf(p, seen));
    }
    slots.push(slotOf(slot));
  };
  const quad = (a: V3, b: V3, c: V3, e: V3, out: V3, slot: HouseSlot, view?: AtlasView) => {
    tri(a, b, c, out, slot, view);
    tri(a, c, e, out, slot, view);
  };
  /** Axis-aligned box; `skip` = faces not drawn (by outward normal). */
  const box = (lo: V3, hi: V3, slot: HouseSlot, skip: ReadonlyArray<'bottom' | 'top'> = []) => {
    const [x0, y0, z0] = lo;
    const [x1, y1, z1] = hi;
    if (x1 - x0 < EPS || y1 - y0 < EPS || z1 - z0 < EPS) return;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], slot);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], slot);
    quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], slot);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], slot);
    if (!skip.includes('top'))
      quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], slot);
    if (!skip.includes('bottom'))
      quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], slot);
  };

  /** A wall's frame: plane coordinate, u axis (x or z), and the world point of (u, v, depth). */
  interface WallFrame {
    wall: HouseWall;
    out: V3;
    plane: number;
    /** u, v (world, v = height) and a depth along the outward normal → world point. */
    at: (u: number, v: number, depth?: number) => V3;
  }
  const frameOf = (wall: HouseWall, plane: number): WallFrame => {
    const out = WALL_NORMAL[wall];
    const at =
      wall === 'front' || wall === 'back'
        ? (u: number, v: number, dep = 0): V3 => [u, v, plane + out[2] * dep]
        : (u: number, v: number, dep = 0): V3 => [plane + out[0] * dep, v, u];
    return { wall, out, plane, at };
  };
  /** World box of a volume. */
  const boxOf = (v: HouseVolume) => ({
    x0: X(v.plan[0]),
    x1: X(v.plan[1]),
    z0: Z(v.plan[2]),
    z1: Z(v.plan[3]),
    eave: Y(v.eave),
    ridge: Y(Math.max(v.ridge, v.eave)),
  });
  type WorldBox = ReturnType<typeof boxOf>;
  const boxes = plan.volumes.map(boxOf);
  const planeOf = (b: WorldBox, wall: HouseWall) =>
    ({ front: b.z1, back: b.z0, right: b.x1, left: b.x0 })[wall];
  const spanOf = (b: WorldBox, wall: HouseWall): [number, number] =>
    wall === 'front' || wall === 'back' ? [b.x0, b.x1] : [b.z0, b.z1];
  /** Signed distance a box reaches past a plane, along a wall's outward normal. */
  const reach = (b: WorldBox, wall: HouseWall) =>
    ({ front: b.z1, back: -b.z0, right: b.x1, left: -b.x0 })[wall];
  const depthOf = (b: WorldBox, wall: HouseWall) =>
    ({ front: b.z0, back: -b.z1, right: b.x0, left: -b.x1 })[wall];
  const outward = (wall: HouseWall, plane: number) =>
    wall === 'back' || wall === 'left' ? -plane : plane;
  /** World distance under which a veranda side counts as on its host's wall. */
  const slack = HOST_SLACK * Math.max(w, d);
  /**
   * Host of an open volume: the smallest solid volume whose plan holds it (a veranda under the
   * main roof). Its open sides then cut the host's walls, and its other sides become the walls
   * at the back of the recess. -1 = a veranda standing out on its own.
   */
  const hosts = plan.volumes.map((v, j) => {
    if (!isOpenVolume(v)) return -1;
    let best = -1;
    let area = Infinity;
    plan.volumes.forEach((a, i) => {
      if (i === j || isOpenVolume(a)) return;
      const inside =
        v.plan[0] >= a.plan[0] - HOST_SLACK &&
        v.plan[1] <= a.plan[1] + HOST_SLACK &&
        v.plan[2] >= a.plan[2] - HOST_SLACK &&
        v.plan[3] <= a.plan[3] + HOST_SLACK;
      const size = (a.plan[1] - a.plan[0]) * (a.plan[3] - a.plan[2]);
      if (inside && size < area) [best, area] = [i, size];
    });
    return best;
  });
  /** A hosted veranda's side `wall` is open on its host's wall of that side. */
  const opensHost = (j: number, wall: HouseWall) =>
    hosts[j]! >= 0 &&
    Boolean(plan.volumes[j]!.open?.includes(wall)) &&
    Math.abs(planeOf(boxes[j]!, wall) - planeOf(boxes[hosts[j]!]!, wall)) <= slack;

  /** Rectangles of a wall that another volume hides (cover) or stands in front of (shadow). */
  const wallMasks = (index: number, wall: HouseWall) => {
    const a = boxes[index]!;
    const p = outward(wall, planeOf(a, wall));
    const cover: Rect[] = [];
    const shadow: Rect[] = [];
    const [u0, u1] = spanOf(a, wall);
    boxes.forEach((b, j) => {
      if (j === index) return;
      const [b0, b1] = spanOf(b, wall);
      const [lo, hi] = [Math.max(u0, b0), Math.min(u1, b1)];
      if (hi - lo < EPS) return;
      if (hosts[j] === index) {
        // A veranda under this roof: no wall where it opens.
        if (opensHost(j, wall)) cover.push([lo, hi, Y(0), b.eave]);
        return;
      }
      const open = isOpenVolume(plan.volumes[j]!);
      const front = reach(b, wall);
      const back = depthOf(b, wall);
      // Inside a solid neighbour (flush walls: the first volume keeps its own).
      if (!open && back < p - EPS && (front > p + EPS || (front > p - EPS && j < index)))
        cover.push([lo, hi, Y(0), b.eave]);
      // Something stands in front: the drawing shows it, not this wall.
      else if (front > p + EPS && (back >= p - EPS || open)) {
        // A balcony shades its own storey only.
        const vol = plan.volumes[j]!;
        const low = vol.kind === 'balcony' ? Y(vol.floor ?? 0) - SLAB * S : Y(0);
        shadow.push([lo, hi, low, b.ridge]);
      }
    });
    return { cover, shadow };
  };

  /** Roof line along a wall: its height at u (linear between `breaks`), the wall's top. */
  interface TopLine {
    at: (u: number) => number;
    breaks: number[];
  }
  const topLine = (vol: HouseVolume, b: WorldBox, wall: HouseWall): TopLine => {
    const flat: TopLine = { at: () => b.eave, breaks: [] };
    if (b.ridge - b.eave < EPS || isOpenVolume(vol)) return flat;
    const [s0, s1] = spanOf(b, wall);
    const sideWall = wall === 'left' || wall === 'right';
    const lerp = (u: number, ua: number, ha: number, ub: number, hb: number) =>
      ha + ((hb - ha) * (u - ua)) / Math.max(ub - ua, EPS);
    if (vol.roof === 'gable' && (vol.ridgeAxis === 'x') === sideWall) {
      const mid = (s0 + s1) / 2;
      return {
        at: (u) =>
          u <= mid ? lerp(u, s0, b.eave, mid, b.ridge) : lerp(u, mid, b.ridge, s1, b.eave),
        breaks: [mid],
      };
    }
    if (vol.roof === 'shed') {
      const fall = shedFall(vol);
      if (wall === fall) return flat;
      if (wall === OPPOSITE[fall]) return { at: () => b.ridge, breaks: [] };
      // A side wall: the slope runs along it, high at the side opposite the fall.
      const highAtStart = fall === 'front' || fall === 'right';
      return {
        at: (u) =>
          highAtStart ? lerp(u, s0, b.ridge, s1, b.eave) : lerp(u, s0, b.eave, s1, b.ridge),
        breaks: [],
      };
    }
    return flat;
  };

  /**
   * A wall from `floor` up to its roof line, with holes: cut in strips on every hole / cover /
   * shadow edge and roof-line break, each strip in cells, every cell drawn unless it falls in a
   * hole or a cover, as the wall's drawing or as a plain wall when shadowed. The top cell of a
   * strip follows the roof line (a gable's rake, a shed's slope).
   */
  const wallPiece = (
    f: WallFrame,
    span: [number, number],
    floor: number,
    line: TopLine,
    holes: Rect[],
    cover: Rect[],
    shadow: Rect[],
    drawn: HouseSlot
  ) => {
    const [u0, u1] = span;
    if (u1 - u0 < EPS) return;
    const all = [...holes, ...cover, ...shadow];
    const cut = (lo: number, hi: number, vals: number[]) =>
      [...new Set([lo, hi, ...vals.filter((x) => x > lo + EPS && x < hi - EPS)])].sort(
        (p, q) => p - q
      );
    const us = cut(u0, u1, [...all.flatMap((r) => [r[0], r[1]]), ...line.breaks]);
    const inside = (r: Rect, u: number, v: number) => u > r[0] && u < r[1] && v > r[2] && v < r[3];
    const slotAt = (u: number, v: number): HouseSlot | null =>
      holes.some((r) => inside(r, u, v)) || cover.some((r) => inside(r, u, v))
        ? null
        : shadow.some((r) => inside(r, u, v))
          ? 'wall'
          : drawn;
    for (let i = 0; i + 1 < us.length; i++) {
      const [ua, ub] = [us[i]!, us[i + 1]!];
      const [ta, tb] = [line.at(ua), line.at(ub)];
      const low = Math.min(ta, tb);
      if (Math.max(ta, tb) <= floor + EPS) continue;
      const vs = cut(
        floor,
        Math.max(floor, low),
        all.flatMap((r) => [r[2], r[3]])
      );
      const cu = (ua + ub) / 2;
      for (let j = 0; j + 1 < vs.length; j++) {
        const slot = slotAt(cu, (vs[j]! + vs[j + 1]!) / 2);
        if (slot)
          quad(
            f.at(ua, vs[j]!),
            f.at(ub, vs[j]!),
            f.at(ub, vs[j + 1]!),
            f.at(ua, vs[j + 1]!),
            f.out,
            slot,
            f.wall
          );
      }
      // The sloped top: from the last cut up to the roof line.
      const base = vs[vs.length - 1]!;
      if (Math.max(ta, tb) - base > EPS) {
        const slot = slotAt(cu, (base + (ta + tb) / 2) / 2);
        if (!slot) continue;
        const [a, b2, c, e] = [f.at(ua, base), f.at(ub, base), f.at(ub, tb), f.at(ua, ta)];
        if (ta - base > EPS && tb - base > EPS) quad(a, b2, c, e, f.out, slot, f.wall);
        else if (ta - base > EPS) tri(a, b2, e, f.out, slot, f.wall);
        else tri(a, b2, c, f.out, slot, f.wall);
      }
    }
  };

  /** The opening as a world rectangle on its wall, kept inside the wall and under its roof line. */
  const openingRect = (o: HouseOpening, b: WorldBox, vol: HouseVolume): Rect | null => {
    const axis = o.wall === 'front' || o.wall === 'back' ? X : Z;
    const [s0, s1] = spanOf(b, o.wall);
    const m = OPENING_MARGIN * S;
    const u0 = Math.max(s0 + m, axis(o.along[0]));
    const u1 = Math.min(s1 - m, axis(o.along[1]));
    const line = topLine(vol, b, o.wall);
    // Under the roof line all along the opening (a gable's apex may stand between its ends).
    const top =
      Math.min(
        line.at(u0),
        line.at(u1),
        ...line.breaks.filter((u) => u > u0 && u < u1).map(line.at)
      ) - m;
    const floor = isOpenVolume(vol) ? Y(vol.floor ?? 0) : Y(0);
    const v0 = Math.max(floor, Y(o.rise[0]));
    const v1 = Math.min(top, Y(o.rise[1]));
    if (u1 - u0 < 2 * m || v1 - v0 < 2 * m) return null;
    return [u0, u1, v0, v1];
  };

  /**
   * Arched head of a rectangle [u0, u1] × [.., v1]: the curve's points from the left spring to the
   * right one (null for a flat head). A half-round arch springs half its width under the top (a
   * segment when the opening is too low for it).
   */
  const archCurve = (head: HouseHead, u0: number, u1: number, v0: number, v1: number) => {
    if (head === 'flat') return null;
    const half = (u1 - u0) / 2;
    const rise =
      head === 'arch'
        ? Math.min(half, (v1 - v0) * 0.6)
        : head === 'bracket'
          ? Math.min((u1 - u0) * BRACKET_RISE, (v1 - v0) * 0.5)
          : Math.min(half * SEGMENT_RISE, (v1 - v0) * 0.4);
    if (rise < EPS) return null;
    const spring = v1 - rise;
    const pts: Array<[number, number]> = [];
    const n = ARCH_STEPS * 2;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = u0 + (u1 - u0) * t;
      // Elliptic for an arch, a flatter circle-like segment, quarter knees for brackets.
      const k = 2 * t - 1;
      const lift =
        head === 'bracket'
          ? Math.min(1, Math.min(t, 1 - t) * 4) ** 0.5
          : Math.sqrt(Math.max(0, 1 - k * k));
      pts.push([u, spring + rise * lift]);
    }
    return { spring, pts };
  };

  /**
   * Spandrels of an arched head: the wall between the curve and the top of its rectangle, at
   * depth `d0` (wall plane) back to `d1` (the soffit along the curve), and an arched frame.
   */
  const spandrel = (
    f: WallFrame,
    curve: NonNullable<ReturnType<typeof archCurve>>,
    top: number,
    face: HouseSlot,
    soffit: HouseSlot,
    d1: number,
    frame: HouseSlot | null
  ) => {
    const { pts } = curve;
    const down: V3 = [0, -1, 0];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ua, va] = pts[i]!;
      const [ub, vb] = pts[i + 1]!;
      if (top - Math.min(va, vb) > EPS)
        quad(f.at(ua, va), f.at(ub, vb), f.at(ub, top), f.at(ua, top), f.out, face, f.wall);
      // The soffit faces down into the opening (the inner side of the arch).
      quad(f.at(ua, va), f.at(ub, vb), f.at(ub, vb, d1), f.at(ua, va, d1), down, soffit);
      if (frame) {
        const fw = FRAME_WIDTH * S;
        const fo = FRAME_OUT * S;
        quad(
          f.at(ua, va, fo),
          f.at(ub, vb, fo),
          f.at(ub, vb + fw, fo),
          f.at(ua, va + fw, fo),
          f.out,
          frame,
          f.wall
        );
      }
    }
  };

  /** Reveal, glass or leaf, frame, sill and glazing bars of one opening. */
  const opening = (f: WallFrame, r: Rect, o: HouseOpening, face: HouseSlot = 'wall') => {
    const [u0, u1, v0, v1] = r;
    const curve = archCurve(o.head ?? (o.kind === 'arch' ? 'arch' : 'flat'), u0, u1, v0, v1);
    const rev = REVEAL * S;
    const inward = (u: number, v: number) => f.at(u, v, -rev);
    // Reveal: the four sides of the hole, facing its centre.
    const [uc, vc] = [(u0 + u1) / 2, (v0 + v1) / 2];
    const toward = (u: number, v: number): V3 => {
      const p = f.at(u, v);
      const c = f.at(uc, vc);
      return [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
    };
    quad(f.at(u0, v0), f.at(u0, v1), inward(u0, v1), inward(u0, v0), toward(u0, vc), 'wall');
    quad(f.at(u1, v0), f.at(u1, v1), inward(u1, v1), inward(u1, v0), toward(u1, vc), 'wall');
    quad(f.at(u0, v1), f.at(u1, v1), inward(u1, v1), inward(u0, v1), toward(uc, v1), 'wall');
    quad(f.at(u0, v0), f.at(u1, v0), inward(u1, v0), inward(u0, v0), toward(uc, v0), 'trim');
    // Back: glass for a window, a leaf for a door.
    // A door with panes is a glazed door (French window, sliding glass door).
    const glazed =
      o.kind === 'window' ||
      o.kind === 'arch' ||
      (o.kind === 'door' && Boolean(o.panes) && o.panes![0] * o.panes![1] > 1);
    const back: HouseSlot = glazed ? 'glass' : 'door';
    quad(inward(u0, v0), inward(u1, v0), inward(u1, v1), inward(u0, v1), f.out, back, f.wall);
    /** A bar on the wall plane: from (a0, b0) to (a1, b1), standing `out` proud of `depth`. */
    const bar = (a0: number, a1: number, b0: number, b1: number, depth: number, out: number) => {
      const p = f.at(a0, b0, depth);
      const q = f.at(a1, b1, depth + out);
      box(
        [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])],
        [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])],
        'trim'
      );
    };
    const fw = FRAME_WIDTH * S;
    const fo = FRAME_OUT * S;
    // Frame round the hole (no bottom bar under a door or a garage door).
    const floorLevel = o.kind === 'door' || o.kind === 'garage';
    if (curve) {
      bar(u0 - fw, u0, v0, curve.spring, 0, fo);
      bar(u1, u1 + fw, v0, curve.spring, 0, fo);
      spandrel(f, curve, v1, face, 'wall', -rev, 'trim');
    } else {
      bar(u0 - fw, u0, v0, v1 + fw, 0, fo);
      bar(u1, u1 + fw, v0, v1 + fw, 0, fo);
      bar(u0, u1, v1, v1 + fw, 0, fo);
    }
    if (!floorLevel && o.kind !== 'vent') {
      // Sill: wider than the frame, standing out.
      const so = SILL_OVER * S;
      bar(u0 - fw - so, u1 + fw + so, v0 - SILL_HEIGHT * S, v0, 0, SILL_OUT * S);
    }
    if (glazed) {
      const [cols, rows] = o.panes ?? DEFAULT_PANES;
      const mw = (MUNTIN * S) / 2;
      const depth = -rev + mw;
      for (let i = 1; i < cols; i++) {
        const u = u0 + ((u1 - u0) * i) / cols;
        bar(u - mw, u + mw, v0, v1, depth, mw * 2);
      }
      for (let j = 1; j < rows; j++) {
        const v = v0 + ((v1 - v0) * j) / rows;
        bar(u0, u1, v - mw, v + mw, depth, mw * 2);
      }
    } else if (o.kind === 'door' || o.kind === 'garage') {
      // Leaf panels: a raised rail across a door, grooves across a garage door.
      const lines = o.kind === 'garage' ? 4 : 1;
      for (let j = 1; j <= lines; j++) {
        const v = v0 + ((v1 - v0) * j) / (lines + 1);
        bar(u0 + fw, u1 - fw, v - fw / 2, v + fw / 2, -rev, fo * 0.6);
      }
    }
  };

  // Openings by volume and wall, once fitted on their wall.
  const fitted = plan.openings.flatMap((o) => {
    const vol = plan.volumes[o.volume];
    const b = boxes[o.volume];
    if (!vol || !b) return [];
    if (vol.open?.includes(o.wall)) return [];
    const r = openingRect(o, b, vol);
    if (!r) return [];
    // An opening of the host's wall behind a veranda under its roof: on the back of the recess.
    const [um, vm] = [(r[0] + r[1]) / 2, (r[2] + r[3]) / 2];
    const recess = hosts.findIndex((host, j) => {
      if (host !== o.volume || !opensHost(j, o.wall)) return false;
      const [s0, s1] = spanOf(boxes[j]!, o.wall);
      return um > s0 && um < s1 && vm < boxes[j]!.eave;
    });
    if (recess < 0) return [{ o, r, recess: -1, plane: planeOf(b, o.wall) }];
    const rb = boxes[recess]!;
    const [s0, s1] = spanOf(rb, o.wall);
    const m = OPENING_MARGIN * S;
    const moved: Rect = [
      Math.max(r[0], s0 + m),
      Math.min(r[1], s1 - m),
      r[2],
      Math.min(r[3], rb.eave - m),
    ];
    if (moved[1] - moved[0] < 2 * m || moved[3] - moved[2] < 2 * m) return [];
    return [{ o, r: moved, recess, plane: planeOf(rb, OPPOSITE[o.wall]) }];
  });

  /** The roof of a volume over its walls, with fascias. */
  const roof = (vol: HouseVolume, b: WorldBox) => {
    const rs = roofSlot(vol);
    const ov = OVERHANG * S;
    const fa = FASCIA * S;
    const rise = b.ridge - b.eave;
    const kind = rise < EPS && vol.roof !== 'none' ? 'flat' : vol.roof;
    if (kind === 'none') {
      box([b.x0, b.eave - fa / 2, b.z0], [b.x1, b.eave, b.z1], 'trim', ['bottom']);
      return;
    }
    if (kind === 'flat') {
      const o = ov * 0.4;
      box([b.x0 - o, b.eave, b.z0 - o], [b.x1 + o, b.eave + fa, b.z1 + o], 'trim');
      box(
        [b.x0 - o + fa / 2, b.eave + fa, b.z0 - o + fa / 2],
        [b.x1 + o - fa / 2, Math.max(b.ridge, b.eave + fa * 1.2), b.z1 + o - fa / 2],
        rs,
        ['bottom']
      );
      return;
    }
    const alongX = vol.ridgeAxis === 'x';
    const [lx, lz] = [b.x1 - b.x0, b.z1 - b.z0];
    const up: V3 = [0, 1, 0];
    /** Fascia under an eave line from p to q (world, at eave height). */
    const fascia = (p: V3, q: V3, out: V3) =>
      quad([p[0], p[1] - fa, p[2]], [q[0], q[1] - fa, q[2]], q, p, out, 'trim');
    if (kind === 'shed') {
      // One slope, high on the side opposite its fall.
      const fall = shedFall(vol);
      const alongZ = fall === 'front' || fall === 'back';
      const run = alongZ ? lz : lx;
      const drop = (ov * rise) / Math.max(run, EPS);
      const [x0, x1, z0, z1] = [b.x0 - ov, b.x1 + ov, b.z0 - ov, b.z1 + ov];
      const [hi, lo] = [b.ridge + drop, b.eave - drop];
      const height = (x: number, z: number) =>
        ({
          front: z === z1 ? lo : hi,
          back: z === z0 ? lo : hi,
          right: x === x1 ? lo : hi,
          left: x === x0 ? lo : hi,
        })[fall];
      const c = ([x, z]: [number, number]): V3 => [x, height(x, z), z];
      const [c00, c10, c11, c01] = [c([x0, z0]), c([x1, z0]), c([x1, z1]), c([x0, z1])];
      quad(c00, c10, c11, c01, up, rs, 'top');
      fascia(c01, c11, [0, 0, 1]);
      fascia(c10, c00, [0, 0, -1]);
      fascia(c11, c10, [1, 0, 0]);
      fascia(c00, c01, [-1, 0, 0]);
      return;
    }
    // Gable and hip: two slopes meeting at a ridge along `alongX`.
    const half = (alongX ? lz : lx) / 2;
    const drop = (ov * rise) / Math.max(half, EPS);
    const [x0, x1, z0, z1] = [b.x0 - ov, b.x1 + ov, b.z0 - ov, b.z1 + ov];
    const e = b.eave - drop;
    const r = b.ridge;
    const [cx, cz] = [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
    if (kind === 'gable') {
      if (alongX) {
        const ra: V3 = [x0, r, cz];
        const rb: V3 = [x1, r, cz];
        quad([x0, e, z1], [x1, e, z1], rb, ra, [0, 1, 1], rs, 'top');
        quad([x1, e, z0], [x0, e, z0], ra, rb, [0, 1, -1], rs, 'top');
        fascia([x0, e, z1], [x1, e, z1], [0, 0, 1]);
        fascia([x1, e, z0], [x0, e, z0], [0, 0, -1]);
      } else {
        const ra: V3 = [cx, r, z0];
        const rb: V3 = [cx, r, z1];
        quad([x1, e, z0], [x1, e, z1], rb, ra, [1, 1, 0], rs, 'top');
        quad([x0, e, z1], [x0, e, z0], ra, rb, [-1, 1, 0], rs, 'top');
        fascia([x1, e, z0], [x1, e, z1], [1, 0, 0]);
        fascia([x0, e, z1], [x0, e, z0], [-1, 0, 0]);
      }
      return;
    }
    // Hip: the ridge shortened by the half span at each end (a pyramid when it would vanish).
    const length = alongX ? x1 - x0 : z1 - z0;
    const across = alongX ? z1 - z0 : x1 - x0;
    const inset = Math.min(across / 2, length / 2);
    const [ra, rb]: [V3, V3] = alongX
      ? [
          [x0 + inset, r, cz],
          [x1 - inset, r, cz],
        ]
      : [
          [cx, r, z0 + inset],
          [cx, r, z1 - inset],
        ];
    const c00: V3 = [x0, e, z0];
    const c10: V3 = [x1, e, z0];
    const c11: V3 = [x1, e, z1];
    const c01: V3 = [x0, e, z1];
    if (alongX) {
      quad(c01, c11, rb, ra, [0, 1, 1], rs, 'top');
      quad(c10, c00, ra, rb, [0, 1, -1], rs, 'top');
      tri(c00, c01, ra, [-1, 1, 0], rs, 'top');
      tri(c11, c10, rb, [1, 1, 0], rs, 'top');
    } else {
      quad(c10, c11, rb, ra, [1, 1, 0], rs, 'top');
      quad(c01, c00, ra, rb, [-1, 1, 0], rs, 'top');
      tri(c00, c10, ra, [0, 1, -1], rs, 'top');
      tri(c11, c01, rb, [0, 1, 1], rs, 'top');
    }
    fascia(c01, c11, [0, 0, 1]);
    fascia(c10, c00, [0, 0, -1]);
    fascia(c11, c10, [1, 0, 0]);
    fascia(c00, c01, [-1, 0, 0]);
  };

  /** A box between two points of a wall frame (any order). */
  const frameBox = (
    f: WallFrame,
    a: V3,
    b: V3,
    slot: HouseSlot,
    skip?: Array<'bottom' | 'top'>
  ) => {
    const p = f.at(a[0], a[1], a[2]);
    const q = f.at(b[0], b[1], b[2]);
    box(
      [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])],
      [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])],
      slot,
      skip
    );
  };

  /**
   * Spans of the piers standing on a side of a box (their plan crosses the side's line, within a
   * pier's depth), along that side's axis.
   */
  const piersOn = (b: WorldBox, wall: HouseWall, beam: number): Array<[number, number]> => {
    const plane = planeOf(b, wall);
    const [s0, s1] = spanOf(b, wall);
    return (plan.piers ?? []).flatMap((pier) => {
      const [x0, x1, z0, z1] = [X(pier.plan[0]), X(pier.plan[1]), Z(pier.plan[2]), Z(pier.plan[3])];
      const along = wall === 'front' || wall === 'back';
      const [a0, a1] = along ? [x0, x1] : [z0, z1];
      const [c0, c1] = along ? [z0, z1] : [x0, x1];
      const depth = c1 - c0;
      if (plane < c0 - depth || plane > c1 + depth) return [];
      if (a1 < s0 - EPS || a0 > s1 + EPS) return [];
      // A pier carries the side when it rises at least half way to its beam (a post base does not).
      if (Y(pier.top) - Y(0) < (beam - Y(0)) / 2) return [];
      return [[Math.max(a0, s0), Math.min(a1, s1)] as [number, number]];
    });
  };

  /**
   * A timber truss in both gable ends of a gable roof: tie beam at the eave, king post to the
   * ridge, two struts, rafters under the rake, standing proud of the gable wall.
   */
  const truss = (vol: HouseVolume, b: WorldBox) => {
    const ends: HouseWall[] = vol.ridgeAxis === 'z' ? ['front', 'back'] : ['left', 'right'];
    const t = TRUSS * S;
    for (const wall of ends) {
      const f = frameOf(wall, planeOf(b, wall));
      const [s0, s1] = spanOf(b, wall);
      const mid = (s0 + s1) / 2;
      const [e, r] = [b.eave, b.ridge];
      const d0 = OVERHANG * S * 0.5;
      const member = (ua: number, va: number, ub: number, vb: number) => {
        // A bar of width t between two points of the gable plane, from d0 to d0 + t.
        const len = Math.hypot(ub - ua, vb - va);
        if (len < EPS) return;
        const [nu, nv] = [(-(vb - va) / len) * (t / 2), ((ub - ua) / len) * (t / 2)];
        const corners = (d: number): V3[] => [
          f.at(ua - nu, va - nv, d),
          f.at(ub - nu, vb - nv, d),
          f.at(ub + nu, vb + nv, d),
          f.at(ua + nu, va + nv, d),
        ];
        const [a, c] = [corners(d0 + t), corners(d0)];
        const o = f.at(0, 0);
        const side = f.at(nu, nv);
        const n: V3 = [side[0] - o[0], side[1] - o[1], side[2] - o[2]];
        quad(a[0]!, a[1]!, a[2]!, a[3]!, f.out, timber);
        quad(a[0]!, a[1]!, c[1]!, c[0]!, [-n[0], -n[1], -n[2]], timber);
        quad(a[3]!, a[2]!, c[2]!, c[3]!, n, timber);
      };
      member(s0, e, s1, e);
      member(mid, e, mid, r - t);
      member(s0, e + t / 2, mid, r);
      member(s1, e + t / 2, mid, r);
      const q = (s1 - s0) / 4;
      const h = (r - e) / 2;
      member(mid, e + h * 0.3, mid - q, e + h);
      member(mid, e + h * 0.3, mid + q, e + h);
    }
  };

  /**
   * A gallery (PQ-T73): a balcony with no roof of its own but posts read and its eave well over
   * its slab (a storey of a two-level veranda, under the main eave).
   */
  const isGallery = (vol: HouseVolume, b: WorldBox) =>
    vol.kind === 'balcony' &&
    vol.roof === 'none' &&
    (vol.columns ?? 0) >= 2 &&
    b.eave - Math.max(Y(vol.floor ?? 0), Y(0) + DECK_MIN * S) > HEADROOM * S;

  /** Deck or slab, posts, beam, railing and steps of an open volume. */
  const openVolume = (vol: HouseVolume, b: WorldBox) => {
    const balcony = vol.kind === 'balcony';
    const floor = Y(vol.floor ?? 0);
    const slab = SLAB * S;
    const deck = Math.max(floor, Y(0) + DECK_MIN * S);
    if (balcony) box([b.x0, deck - slab, b.z0], [b.x1, deck, b.z1], 'base');
    else box([b.x0, Y(0), b.z0], [b.x1, deck, b.z1], 'base', ['bottom']);
    const p = POST * S;
    const beam = BEAM * S;
    // A terrace (its eave at its deck) has no posts and no beam; a balcony only under a roof,
    // or (PQ-T73) as a gallery.
    const gallery = isGallery(vol, b);
    const covered = balcony ? vol.roof !== 'none' || gallery : b.eave - deck > HEADROOM * S;
    for (const wall of vol.open ?? []) {
      const [s0, s1] = spanOf(b, wall);
      const f = frameOf(wall, planeOf(b, wall));
      // Piers standing on this side (PQ-T73) carry it: no posts, the bays run between them.
      const onSide = piersOn(b, wall, b.eave - beam);
      // Posts: up from the deck to the beam; under a balcony, from the ground to its slab.
      const posts = vol.columns ?? 0;
      const n = onSide.length
        ? 0
        : posts >= 2
          ? posts
          : balcony
            ? 0
            : Math.max(2, Math.round((s1 - s0) / (POST_SPACING * S)) + 1);
      const supports: Array<[number, number]> = onSide.length ? [...onSide] : [];
      for (let i = 0; i < n; i++) {
        const u = s0 + p / 2 + ((s1 - s0 - p) * i) / (n - 1);
        const [lo, hi] = balcony
          ? [gallery ? deck : Y(0), covered ? b.eave - beam : deck - slab]
          : [deck, b.eave - beam];
        frameBox(f, [u - p / 2, lo, -p], [u + p / 2, hi, 0], timber, ['bottom']);
        supports.push([u - p / 2, u + p / 2]);
      }
      if (covered) frameBox(f, [s0, b.eave - beam, -p], [s1, b.eave, 0], timber);
      // Arcade: each bay between two supports gets an arched or bracketed head under the beam.
      if (covered && vol.arcade && vol.arcade !== 'flat') {
        const sorted = supports.sort((m, q) => m[0] - q[0]);
        const gaps: Array<[number, number]> = [];
        if (sorted.length && sorted[0]![0] - s0 > p) gaps.push([s0, sorted[0]![0]]);
        for (let i = 0; i + 1 < sorted.length; i++) gaps.push([sorted[i]![1], sorted[i + 1]![0]]);
        if (sorted.length && s1 - sorted[sorted.length - 1]![1] > p)
          gaps.push([sorted[sorted.length - 1]![1], s1]);
        if (!sorted.length) gaps.push([s0, s1]);
        const top = b.eave - beam;
        const low = deck;
        const face: HouseSlot = vol.arcade === 'bracket' ? timber : (wallSlot(vol) ?? 'wall');
        for (const [g0, g1] of gaps) {
          if (g1 - g0 < 2 * p) continue;
          const curve = archCurve(vol.arcade, g0, g1, low, top);
          if (!curve) continue;
          // Front face, then the back face of the same spandrel (seen from inside the veranda).
          spandrel(f, curve, top, face, face, -p, null);
          const back = frameOf(OPPOSITE[wall], planeOf(b, wall) - f.out[0] * p - f.out[2] * p);
          for (let i = 0; i + 1 < curve.pts.length; i++) {
            const [ua, va] = curve.pts[i]!;
            const [ub, vb] = curve.pts[i + 1]!;
            if (top - Math.min(va, vb) > EPS)
              quad(
                back.at(ua, va),
                back.at(ub, vb),
                back.at(ub, top),
                back.at(ua, top),
                back.out,
                face
              );
          }
        }
      }
      if (balcony || vol.rail) {
        // Railing: top rail, bottom rail, balusters.
        const top = deck + RAIL_HEIGHT * S;
        const r = RAIL * S;
        frameBox(f, [s0, top - r, -r * 2], [s1, top, 0], 'trim');
        frameBox(f, [s0, deck + r, -r * 2], [s1, deck + r * 2, 0], 'trim');
        const count = Math.max(2, Math.round((s1 - s0) / (BALUSTER_SPACING * S)));
        for (let i = 0; i <= count; i++) {
          const u = s0 + r + ((s1 - s0 - 2 * r) * i) / count;
          frameBox(f, [u - r / 2, deck, -r * 1.5], [u + r / 2, top - r, -r / 2], 'trim', [
            'bottom',
          ]);
        }
      }
      // Steps in front of a raised deck.
      if (!balcony && wall === 'front' && deck - Y(0) > 0.02 * S) {
        const mid = (s0 + s1) / 2;
        const half = Math.min((s1 - s0) / 4, 0.08 * S);
        const steps = Math.max(1, Math.round((deck - Y(0)) / (0.012 * S)));
        for (let k = 0; k < steps; k++) {
          const top = Y(0) + ((deck - Y(0)) * (k + 1)) / (steps + 1);
          box([mid - half, Y(0), b.z1], [mid + half, top, b.z1 + 0.014 * S * (steps - k)], 'base', [
            'bottom',
          ]);
        }
      }
    }
  };

  /** Walls of a solid volume (or the closed sides of a free-standing veranda), holed by their openings. */
  const walls = (vol: HouseVolume, b: WorldBox, index: number) => {
    const open = new Set(vol.open ?? []);
    const floor = isOpenVolume(vol) ? Y(vol.floor ?? 0) : Y(0);
    for (const wall of FACE_VIEWS as ReadonlyArray<HouseWall>) {
      if (open.has(wall)) continue;
      const f = frameOf(wall, planeOf(b, wall));
      const [s0, s1] = spanOf(b, wall);
      const { cover, shadow } = wallMasks(index, wall);
      const mine = fitted.filter((x) => x.o.volume === index && x.o.wall === wall && x.recess < 0);
      wallPiece(
        f,
        [s0, s1],
        floor,
        topLine(vol, b, wall),
        mine.map((x) => x.r),
        cover,
        shadow,
        // A veranda's own wall is seen through its posts: never its drawing.
        isOpenVolume(vol) ? 'wall' : (wallSlot(vol) ?? wall)
      );
      const face: HouseSlot = isOpenVolume(vol) ? 'wall' : (wallSlot(vol) ?? wall);
      for (const x of mine) {
        const um = (x.r[0] + x.r[1]) / 2;
        const vm = (x.r[2] + x.r[3]) / 2;
        if (cover.some((c) => um > c[0] && um < c[1] && vm > c[2] && vm < c[3])) continue;
        opening(f, x.r, x.o, face);
      }
      for (const band of vol.bands ?? []) {
        const v = Y(band);
        if (v <= floor || v >= b.eave) continue;
        const bh = (BAND_HEIGHT * S) / 2;
        frameBox(f, [s0, v - bh, 0], [s1, v + bh, BAND_OUT * S], 'trim');
      }
    }
  };

  /** Walls at the back and sides of a veranda under its host's roof, facing into the recess. */
  const recessWalls = (vol: HouseVolume, b: WorldBox, index: number, host: WorldBox) => {
    for (const side of FACE_VIEWS as ReadonlyArray<HouseWall>) {
      if (vol.open?.includes(side)) continue;
      // A closed side on the host's own wall is that wall.
      if (Math.abs(planeOf(b, side) - planeOf(host, side)) <= slack) continue;
      const facing = OPPOSITE[side];
      const f = frameOf(facing, planeOf(b, side));
      const [s0, s1] = spanOf(b, side);
      const mine = fitted.filter((x) => x.recess === index && x.o.wall === facing);
      wallPiece(
        f,
        [s0, s1],
        Y(vol.floor ?? 0),
        { at: () => b.eave, breaks: [] },
        mine.map((x) => x.r),
        [],
        [],
        'wall'
      );
      for (const x of mine) opening(f, x.r, x.o);
    }
  };

  /** Some closed block's roof reaches over this volume's plan, above its eave. */
  const roofedOver = (index: number) => {
    const b = boxes[index]!;
    return boxes.some(
      (a, i) =>
        i !== index &&
        !isOpenVolume(plan.volumes[i]!) &&
        a.eave >= b.eave - EPS &&
        a.x0 <= b.x0 + EPS &&
        a.x1 >= b.x1 - EPS &&
        a.z0 <= b.z0 + EPS &&
        a.z1 >= b.z1 - EPS
    );
  };

  plan.volumes.forEach((vol, index) => {
    if (vol.truss && vol.roof === 'gable' && !isOpenVolume(vol)) truss(vol, boxes[index]!);
  });

  // Piers (PQ-T73): masonry pillars from the ground to their top, a course band and a cap.
  for (const pier of plan.piers ?? []) {
    const [x0, x1, z0, z1] = [X(pier.plan[0]), X(pier.plan[1]), Z(pier.plan[2]), Z(pier.plan[3])];
    // A pier under a pitched veranda roof stops at its beam (never through it); under a deck
    // (a flat roof, a balcony on top) it rises through, carrying the railing above.
    const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
    const carried = plan.volumes.flatMap((v, i) => {
      const b = boxes[i]!;
      const inside = cx >= b.x0 - EPS && cx <= b.x1 + EPS && cz >= b.z0 - EPS && cz <= b.z1 + EPS;
      const pitched = v.roof === 'hip' || v.roof === 'gable' || v.roof === 'shed';
      return isOpenVolume(v) && pitched && inside && b.eave > Y(0) ? [b.eave - BEAM * S] : [];
    });
    const top = Math.min(Y(pier.top), ...carried);
    const cap = PIER_CAP * S;
    const o = PIER_CAP_OVER * S;
    if (top - Y(0) < cap * 2) continue;
    box([x0, Y(0), z0], [x1, top - cap, z1], 'stone', ['bottom']);
    box([x0 - o, top - cap, z0 - o], [x1 + o, top, z1 + o], 'stone');
    if (pier.band !== undefined && Y(pier.band) > Y(0) + cap && Y(pier.band) < top - cap * 2) {
      const v = Y(pier.band);
      box([x0 - o / 2, v - cap / 3, z0 - o / 2], [x1 + o / 2, v + cap / 3, z1 + o / 2], timber);
    }
  }

  plan.volumes.forEach((vol, index) => {
    const b = boxes[index]!;
    const host = hosts[index]!;
    if (isOpenVolume(vol)) openVolume(vol, b);
    if (host >= 0) {
      // Under its host's roof: the recess walls only.
      recessWalls(vol, b, index, boxes[host]!);
      return;
    }
    if (vol.kind === 'balcony') {
      if (vol.roof !== 'none') roof(vol, b);
      // A gallery under no other roof is covered by a flat roof skirt at its eave.
      else if (isGallery(vol, b) && !roofedOver(index)) roof({ ...vol, roof: 'flat' }, b);
      return;
    }
    // A bare deck (terrace): nothing stands on it but its railing.
    if (isOpenVolume(vol) && b.eave - Math.max(Y(vol.floor ?? 0), Y(0)) <= HEADROOM * S) return;
    walls(vol, b, index);
    roof(vol, b);
    // A plinth under the block: it stands on something and is closed underneath.
    const o = PLINTH_OUT * S;
    box([b.x0 - o, Y(0), b.z0 - o], [b.x1 + o, Y(0) + PLINTH * S, b.z1 + o], 'base');
  });

  // Chimneys: from inside the roof up to their top, with a cap.
  for (const c of plan.chimneys) {
    const [x0, x1, z0, z1] = [X(c.plan[0]), X(c.plan[1]), Z(c.plan[2]), Z(c.plan[3])];
    const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
    const under = boxes.filter((b) => cx >= b.x0 && cx <= b.x1 && cz >= b.z0 && cz <= b.z1);
    const base = under.length ? Math.min(...under.map((b) => b.eave)) : Y(0);
    const top = Math.max(Y(c.top), base + CAP_HEIGHT * S * 3);
    box([x0, base, z0], [x1, top - CAP_HEIGHT * S, z1], 'wall', ['bottom']);
    const o = CAP_OVER * S;
    box([x0 - o, top - CAP_HEIGHT * S, z0 - o], [x1 + o, top, z1 + o], 'trim');
  }

  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    uv: new Float32Array(uvs),
    slot: Uint8Array.from(slots),
  };
}
