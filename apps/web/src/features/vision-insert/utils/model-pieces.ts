import * as THREE from 'three';
import { CAR_SLOTS } from '@/lib/car-mesh';
import { HULL_SURFACES } from '@/lib/face-hull';
import { HOUSE_SLOTS } from '@/lib/house-mesh';
import type { ObjectRecipe } from '@/lib/object-shape';
import type { PieceEdit, PieceEdits, PieceMask } from '@/lib/piece-edits';
import { SURFACES } from './surface-look';

/**
 * The pieces of a model for the 3D Studio (PQ-T77): one per geometry group, named by its slot.
 * The geometry builders put one group per slot (material index = slot), so a piece is a slot: a
 * house's walls, roof, glass…; a car's body sides, glass, tyres…; a drawn hull's surfaces; a parts
 * recipe's materials. Also the edits as the views draw them (one mesh per piece, centred on its
 * pivot) and baked into a geometry for the village and the Blender export.
 */

export type ModelKind = 'house' | 'car' | 'faces' | 'parts';

/** How the model is built, as the object view and the village choose it. */
export function modelKind(
  recipe: Pick<ObjectRecipe, 'yaw' | 'house' | 'car' | 'faces'>
): ModelKind {
  if (recipe.yaw) return 'parts';
  if (recipe.house) return 'house';
  if (recipe.car?.body) return 'car';
  if (recipe.faces) return 'faces';
  return 'parts';
}

/** Slot names by material index, for a model of this kind. */
export function pieceNames(kind: ModelKind): readonly string[] {
  switch (kind) {
    case 'house':
      return HOUSE_SLOTS;
    case 'car':
      return CAR_SLOTS;
    case 'faces':
      return HULL_SURFACES;
    default:
      return SURFACES;
  }
}

/** The model's box (its geometry's bounds): offsets and masks are shares of it. */
export interface ModelBox {
  min: [number, number, number];
  size: [number, number, number];
}

/** The box of a geometry, every side at least 1 mm (a flat piece never divides by zero). */
export function modelBox(geometry: THREE.BufferGeometry): ModelBox {
  geometry.computeBoundingBox();
  const b = geometry.boundingBox!;
  const s = b.getSize(new THREE.Vector3());
  return {
    min: [b.min.x, b.min.y, b.min.z],
    size: [Math.max(s.x, 1e-3), Math.max(s.y, 1e-3), Math.max(s.z, 1e-3)],
  };
}

/** One piece: its triangles (centred on `center`), its slot and its name. */
export interface ModelPiece {
  name: string;
  slot: number;
  geometry: THREE.BufferGeometry;
  /** Its pivot: the centre of its bounding box, in the model's frame. */
  center: [number, number, number];
}

/** A geometry's triangles per group, non-indexed, every attribute kept. */
function groupsOf(geometry: THREE.BufferGeometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const groups = flat.groups.length
    ? flat.groups
    : [{ start: 0, count: flat.getAttribute('position').count, materialIndex: 0 }];
  return { flat, groups };
}

/** A copy of the vertices `[start, start + count)` of every attribute. */
function slice(src: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const size = a.itemSize;
    const arr = (a.array as Float32Array).slice(start * size, (start + count) * size);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
  }
  return out;
}

/**
 * Slots of a car drawn as several things of the same kind (PQ-T78): each window, each tyre and
 * each wheel face is a piece of its own (`glass-1`, `tyre-3`…), so one window moves without the
 * others. The body's surfaces stay one piece each.
 */
export const CAR_ITEM_SLOTS: ReadonlySet<string> = new Set(['glass', 'tyre', 'rim']);
/** Past this many separate things in a slot it stays one piece (a shattered slot is not a list). */
export const ITEMS_MAX = 12;
/** Vertices closer than this (model units) are one: triangles sharing one are the same thing. */
const WELD = 1e-4;

/** The slots split into their separate things, for a model with these slot names. */
export const itemSlots = (names: readonly string[]): ReadonlySet<string> =>
  names === CAR_SLOTS ? CAR_ITEM_SLOTS : NO_ITEMS;
const NO_ITEMS: ReadonlySet<string> = new Set();

/**
 * The connected parts of a non-indexed geometry (triangles sharing a vertex), each as the list
 * of its triangles. Ordered front to back, then left to right, then bottom to top (by centre).
 */
export function connectedTriangles(geometry: THREE.BufferGeometry): number[][] {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const tris = pos.count / 3;
  const parent = Array.from({ length: tris }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const seen = new Map<string, number>();
  for (let t = 0; t < tris; t++)
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      const key = `${Math.round(pos.getX(v) / WELD)},${Math.round(pos.getY(v) / WELD)},${Math.round(pos.getZ(v) / WELD)}`;
      const other = seen.get(key);
      if (other === undefined) seen.set(key, t);
      else parent[find(t)] = find(other);
    }
  const byRoot = new Map<number, number[]>();
  for (let t = 0; t < tris; t++) {
    const r = find(t);
    const list = byRoot.get(r);
    if (list) list.push(t);
    else byRoot.set(r, [t]);
  }
  const centre = (list: number[]) => {
    const c = [0, 0, 0];
    for (const t of list)
      for (let k = 0; k < 3; k++) {
        c[0]! += pos.getX(t * 3 + k);
        c[1]! += pos.getY(t * 3 + k);
        c[2]! += pos.getZ(t * 3 + k);
      }
    return c.map((v) => Math.round(v / (list.length * 3) / (WELD * 100)));
  };
  return [...byRoot.values()]
    .map((list) => ({ list, c: centre(list) }))
    .sort((a, b) => b.c[2]! - a.c[2]! || a.c[0]! - b.c[0]! || a.c[1]! - b.c[1]!)
    .map((x) => x.list);
}

/** The triangles `tris` of a non-indexed geometry, every attribute kept. */
function pickTriangles(src: THREE.BufferGeometry, tris: readonly number[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const size = a.itemSize * 3;
    const arr = new Float32Array(tris.length * size);
    tris.forEach((t, i) =>
      arr.set((a.array as Float32Array).subarray(t * size, (t + 1) * size), i * size)
    );
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  return out;
}

/**
 * The model split into its pieces (groups with triangles), each centred on its own pivot so it
 * turns and scales round itself. A slot of `items` (default: `itemSlots(names)`) gives one piece
 * per separate thing in it (`glass-1`, `glass-2`…). The caller disposes them.
 */
export function splitPieces(
  geometry: THREE.BufferGeometry,
  names: readonly string[],
  items: ReadonlySet<string> = itemSlots(names)
): ModelPiece[] {
  const { flat, groups } = groupsOf(geometry);
  const out: ModelPiece[] = [];
  const add = (piece: THREE.BufferGeometry, slot: number, name: string) => {
    piece.computeBoundingBox();
    const c = piece.boundingBox!.getCenter(new THREE.Vector3());
    piece.translate(-c.x, -c.y, -c.z);
    out.push({ name, slot, geometry: piece, center: [c.x, c.y, c.z] });
  };
  for (const g of groups) {
    if (!g.count) continue;
    const slot = g.materialIndex ?? 0;
    const name = names[slot] ?? `piece-${slot}`;
    const whole = slice(flat, g.start, g.count);
    const things = items.has(name) ? connectedTriangles(whole) : [];
    if (things.length < 2 || things.length > ITEMS_MAX) {
      add(whole, slot, name);
      continue;
    }
    things.forEach((tris, i) => add(pickTriangles(whole, tris), slot, `${name}-${i + 1}`));
    whole.dispose();
  }
  if (flat !== geometry) flat.dispose();
  return out;
}

/** Where a piece is drawn: its pivot moved by its offset (shares of the model's box), turned, scaled. */
export function pieceTransform(
  edit: PieceEdit | undefined,
  center: readonly [number, number, number],
  box: ModelBox
) {
  const dims = box.size;
  const o = edit?.offset ?? [0, 0, 0];
  return {
    position: [
      center[0] + o[0] * dims[0],
      center[1] + o[1] * dims[1],
      center[2] + o[2] * dims[2],
    ] as [number, number, number],
    rotation: (edit?.rotation ?? [0, 0, 0]) as [number, number, number],
    scale: (edit?.scale ?? [1, 1, 1]) as [number, number, number],
  };
}

/** The matrix that takes a vertex of the whole model to its edited place. */
export function pieceMatrix(
  edit: PieceEdit | undefined,
  center: readonly [number, number, number],
  box: ModelBox
): THREE.Matrix4 {
  const t = pieceTransform(edit, center, box);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...t.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rotation)),
    new THREE.Vector3(...t.scale)
  );
  return m.multiply(new THREE.Matrix4().makeTranslation(-center[0], -center[1], -center[2]));
}

/**
 * The clipping planes of a layer mask in the view's world (the model at the origin, scaled by
 * `scale`): kept inside = six planes, any one clips; inverted = six planes facing out, and a
 * fragment is clipped only when all of them clip it (`clipIntersection`).
 */
export function maskPlanes(
  mask: PieceMask | undefined,
  box: ModelBox,
  scale = 1
): { planes: THREE.Plane[]; intersection: boolean } | null {
  if (!mask || mask.off) return null;
  const [x0, x1, y0, y1, z0, z1] = mask.box;
  const at = (v: number, i: number) => (box.min[i]! + v * box.size[i]!) * scale;
  const lo = [at(x0, 0), at(y0, 1), at(z0, 2)];
  const hi = [at(x1, 0), at(y1, 1), at(z1, 2)];
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const planes: THREE.Plane[] = [];
  const s = mask.invert ? -1 : 1;
  axes.forEach((n, i) => {
    // Kept side: distance n·p + c ≥ 0. Inside = p ≥ lo and p ≤ hi.
    planes.push(new THREE.Plane(n.clone().multiplyScalar(s), -s * lo[i]!));
    planes.push(new THREE.Plane(n.clone().multiplyScalar(-s), s * hi[i]!));
  });
  return { planes, intersection: Boolean(mask.invert) };
}

/** A vertex with every attribute of its geometry, one after the other (position first). */
type Packed = Float32Array;

/**
 * The part of a convex polygon on the kept side of `axis ≥ limit` (sign +1) or `≤` (−1); `strict`
 * leaves out what lies exactly on the limit (the other side of a cut keeps it).
 */
function clipPolygon(
  poly: Packed[],
  axis: number,
  limit: number,
  sign: 1 | -1,
  strict = false
): Packed[] {
  const out: Packed[] = [];
  const keeps = (d: number) => (strict ? d > 0 : d >= 0);
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = [poly[i]!, poly[(i + 1) % poly.length]!];
    const [da, db] = [sign * (a[axis]! - limit), sign * (b[axis]! - limit)];
    if (keeps(da)) out.push(a);
    if (keeps(da) !== keeps(db)) {
      const t = da / (da - db);
      out.push(a.map((v, k) => v + (b[k]! - v) * t));
    }
  }
  return out;
}

/**
 * A geometry cut by a layer mask, as the studio's clipping planes show it: the triangles are cut
 * along the box (not dropped whole), every attribute interpolated. Kept inside the box, or
 * outside it when inverted. Non-indexed in, non-indexed out.
 */
export function maskGeometry(
  geometry: THREE.BufferGeometry,
  mask: PieceMask,
  box: ModelBox
): THREE.BufferGeometry {
  const attrs = Object.entries(geometry.attributes).sort(([a], [b]) =>
    a === 'position' ? -1 : b === 'position' ? 1 : a.localeCompare(b)
  ) as Array<[string, THREE.BufferAttribute]>;
  const stride = attrs.reduce((n, [, a]) => n + a.itemSize, 0);
  const count = geometry.getAttribute('position').count;
  const vertex = (v: number): Packed => {
    const out = new Float32Array(stride);
    let at = 0;
    for (const [, a] of attrs) {
      for (let k = 0; k < a.itemSize; k++) out[at + k] = a.array[v * a.itemSize + k]!;
      at += a.itemSize;
    }
    return out;
  };
  const lo = [0, 1, 2].map((i) => box.min[i]! + mask.box[i * 2]! * box.size[i]!);
  const hi = [0, 1, 2].map((i) => box.min[i]! + mask.box[i * 2 + 1]! * box.size[i]!);
  /** The six half-spaces of the box: [axis, limit, kept side]. */
  const sides: Array<[number, number, 1 | -1]> = [0, 1, 2].flatMap((i) => [
    [i, lo[i]!, 1] as [number, number, 1],
    [i, hi[i]!, -1] as [number, number, -1],
  ]);
  const kept: Packed[] = [];
  const fan = (poly: Packed[]) => {
    for (let k = 1; k + 1 < poly.length; k++) {
      const [a, b, c] = [poly[0]!, poly[k]!, poly[k + 1]!];
      const [ux, uy, uz] = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const [vx, vy, vz] = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      // A sliver left on the box's own face (a vertex exactly on it) is nothing to draw.
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-12)
        kept.push(a, b, c);
    }
  };
  for (let t = 0; t < count / 3; t++) {
    let inside: Packed[] = [vertex(t * 3), vertex(t * 3 + 1), vertex(t * 3 + 2)];
    for (const [axis, limit, sign] of sides) {
      if (!inside.length) break;
      // Inverted: what falls outside this side is kept, the rest goes on to the next side.
      if (mask.invert) fan(clipPolygon(inside, axis, limit, sign === 1 ? -1 : 1, true));
      inside = clipPolygon(inside, axis, limit, sign);
    }
    if (!mask.invert) fan(inside);
  }
  const out = new THREE.BufferGeometry();
  let at = 0;
  for (const [name, a] of attrs) {
    const arr = new Float32Array(kept.length * a.itemSize);
    kept.forEach((v, i) => arr.set(v.subarray(at, at + a.itemSize), i * a.itemSize));
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    at += a.itemSize;
  }
  return out;
}

/**
 * The model with its pieces' edits baked in (village, Blender): hidden pieces dropped, each piece
 * moved / turned / scaled round its pivot, then cut by its mask (`maskGeometry`: the same cut as
 * the studio's clipping planes). Groups and every attribute kept. Without edits: the same geometry.
 */
export function bakePieceEdits(
  geometry: THREE.BufferGeometry,
  names: readonly string[],
  edits: PieceEdits | undefined,
  box: ModelBox = modelBox(geometry)
): THREE.BufferGeometry {
  if (!edits || !Object.keys(edits).length) return geometry;
  const pieces = splitPieces(geometry, names);
  const chunks: Array<{ slot: number; geometry: THREE.BufferGeometry }> = [];
  for (const p of pieces) {
    const edit = edits[p.name];
    if (edit?.hidden) {
      p.geometry.dispose();
      continue;
    }
    // The piece is centred: back to its place, then edited.
    const g = p.geometry;
    g.translate(p.center[0], p.center[1], p.center[2]);
    g.applyMatrix4(pieceMatrix(edit, p.center, box));
    let kept = g;
    if (edit?.mask && !edit.mask.off) {
      kept = maskGeometry(g, edit.mask, box);
      g.dispose();
    }
    if (kept.getAttribute('position').count) chunks.push({ slot: p.slot, geometry: kept });
    else kept.dispose();
  }
  const out = new THREE.BufferGeometry();
  const first = chunks[0]?.geometry;
  if (!first) {
    out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    return out;
  }
  for (const [name, attr] of Object.entries(first.attributes)) {
    const size = (attr as THREE.BufferAttribute).itemSize;
    const total = chunks.reduce((n, c) => n + (c.geometry.getAttribute(name)?.count ?? 0), 0);
    const arr = new Float32Array(total * size);
    let at = 0;
    for (const c of chunks) {
      const a = c.geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!a) continue;
      arr.set(a.array as Float32Array, at * size);
      at += a.count;
    }
    out.setAttribute(
      name,
      new THREE.BufferAttribute(arr, size, (attr as THREE.BufferAttribute).normalized)
    );
  }
  let start = 0;
  for (const c of chunks) {
    const count = c.geometry.getAttribute('position').count;
    out.addGroup(start, count, c.slot);
    start += count;
    c.geometry.dispose();
  }
  return out;
}

/**
 * A model's geometry with its recipe's piece edits baked in (village, Blender export): the
 * original is disposed when a new one is returned. Without edits: the same geometry.
 */
export function withPieceEdits(
  geometry: THREE.BufferGeometry,
  recipe: Pick<ObjectRecipe, 'yaw' | 'house' | 'car' | 'faces' | 'pieces'>
): THREE.BufferGeometry {
  if (!recipe.pieces || !Object.keys(recipe.pieces).length) return geometry;
  const baked = bakePieceEdits(geometry, pieceNames(modelKind(recipe)), recipe.pieces);
  if (baked !== geometry) geometry.dispose();
  return baked;
}
