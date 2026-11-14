import * as THREE from 'three';
import { CAR_SLOTS } from '@/lib/car-mesh';
import { HULL_SURFACES } from '@/lib/face-hull';
import { HOUSE_SLOTS } from '@/lib/house-mesh';
import type { ObjectRecipe } from '@/lib/object-shape';
import { maskKeeps, type PieceEdit, type PieceEdits, type PieceMask } from '@/lib/piece-edits';
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
 * The model split into its pieces (groups with triangles), each centred on its own pivot so it
 * turns and scales round itself. The caller disposes them.
 */
export function splitPieces(
  geometry: THREE.BufferGeometry,
  names: readonly string[]
): ModelPiece[] {
  const { flat, groups } = groupsOf(geometry);
  const out: ModelPiece[] = [];
  for (const g of groups) {
    if (!g.count) continue;
    const piece = slice(flat, g.start, g.count);
    piece.computeBoundingBox();
    const c = piece.boundingBox!.getCenter(new THREE.Vector3());
    piece.translate(-c.x, -c.y, -c.z);
    const slot = g.materialIndex ?? 0;
    out.push({
      name: names[slot] ?? `piece-${slot}`,
      slot,
      geometry: piece,
      center: [c.x, c.y, c.z],
    });
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

/**
 * The model with its pieces' edits baked in (village, Blender): hidden pieces dropped, each piece
 * moved / turned / scaled round its pivot, the triangles its mask hides (centre outside the box,
 * after the move) dropped. Groups and every attribute kept. Without edits: the same geometry.
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
  const tri = new THREE.Vector3();
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
      const pos = g.getAttribute('position');
      const keep: number[] = [];
      for (let t = 0; t < pos.count / 3; t++) {
        tri.set(0, 0, 0);
        for (let k = 0; k < 3; k++)
          tri.add(new THREE.Vector3().fromBufferAttribute(pos, t * 3 + k));
        tri.divideScalar(3);
        const share: [number, number, number] = [
          (tri.x - box.min[0]) / box.size[0],
          (tri.y - box.min[1]) / box.size[1],
          (tri.z - box.min[2]) / box.size[2],
        ];
        if (maskKeeps(edit.mask, share)) keep.push(t);
      }
      kept = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(g.attributes)) {
        const a = attr as THREE.BufferAttribute;
        const size = a.itemSize;
        const arr = new Float32Array(keep.length * 3 * size);
        keep.forEach((t, i) =>
          arr.set(
            (a.array as Float32Array).subarray(t * 3 * size, (t + 1) * 3 * size),
            i * 3 * size
          )
        );
        kept.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
      }
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
