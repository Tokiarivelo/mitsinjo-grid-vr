import { atlasUv, faceSlot, type AtlasTile, type FaceView } from './face-atlas';

/**
 * Skinned parts (tour mock, VS-T43): a parts model wearing its 2D faces. Points and normals are
 * first turned into the camera frame of the front face (`SkinView`: the photo's yaw and pitch), so
 * the front tile falls on the model as the camera saw it. Every surface the camera saw reads the
 * front tile straight along the view; the others read the tile they look at (`lib/face-atlas.ts`
 * layout and canonical tiles), framed on the model's box in that frame: the back tile spans x and
 * y, the side tiles z and y. A surface turned up out of sight (a seat, a table top seen level)
 * reads the front tile from its own edge upward, a little further up the deeper it lies (in a photo
 * the top of a thing shows just above its front edge). Shared by the server (flat renders of the
 * 2D faces) and the 3D view (atlas uvs). Pure.
 */

/** Model box the faces span, camera frame of the front face: [x0, y0, z0, x1, y1, z1]. */
export type SkinBox = readonly [number, number, number, number, number, number];

/** Camera turn of the front face (rad): the photo's yaw of the model, pitch + = seen from above. */
export interface SkinView {
  yaw: number;
  pitch: number;
}

const STRAIGHT: SkinView = { yaw: 0, pitch: 0 };

/** A surface whose normal points this much at the camera (cosine) was seen on the front face. */
export const SKIN_SEEN = 0.3;
/** Share of the height a horizontal surface reads inside its own row (below a top, above an underside). */
export const SKIN_CAP_INSET = 0.015;
/** Highest share of the height a top surface reads above its front edge (at its back). */
export const SKIN_TOP_REACH = 0.3;

type V3 = readonly [number, number, number];

/** A vector of the model in the camera frame of the front face (yaw, then pitch). */
export function toCamera([x, y, z]: V3, { yaw, pitch }: SkinView): [number, number, number] {
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  const [x1, z1] = [x * cy + z * sy, -x * sy + z * cy];
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

/**
 * How the faces are read: `photo` (VS-T43) = one photographed front, tops read above its edge;
 * `box` (VS-T44) = six imagined faces, every surface reads the tile it faces (top and underside
 * included: columns on x, rows back → front).
 */
export type SkinMode = 'photo' | 'box';

/** Where a point of the model reads its colour: a face tile and its canonical [s, t] (t top → bottom). */
export interface SkinHit {
  tile: AtlasTile;
  s: number;
  t: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How a surface reads its tile: straight on the front (`seen`), as a wall, or as a top / underside. */
type Read =
  | { tile: FaceView; mode: 'seen' | 'wall' | 'top' | 'under' }
  | { tile: 'top' | 'bottom'; mode: 'plan' };

/** The tile a surface with camera-frame normal `n` reads among six imagined faces (`box` mode). */
export function boxRead(n: V3): Read {
  const [ax, ay, az] = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  if (ay >= ax && ay >= az) return { tile: n[1] > 0 ? 'top' : 'bottom', mode: 'plan' };
  if (az >= ax) return { tile: n[2] >= 0 ? 'front' : 'back', mode: 'wall' };
  return { tile: n[0] >= 0 ? 'right' : 'left', mode: 'wall' };
}

/** The tile a surface with camera-frame normal `n` at camera-frame depth `z` reads. */
export function skinRead(n: V3, z: number, box: SkinBox): Read {
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  if (n[2] / len >= SKIN_SEEN) return { tile: 'front', mode: 'seen' };
  const [ax, ay, az] = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  if (ay > ax && ay > az) {
    const tile = n[1] > 0 || z >= (box[2] + box[5]) / 2 ? 'front' : 'back';
    return { tile: n[1] > 0 ? 'front' : tile, mode: n[1] > 0 ? 'top' : 'under' };
  }
  if (az >= ax) return { tile: n[2] >= 0 ? 'front' : 'back', mode: 'wall' };
  return { tile: n[0] >= 0 ? 'right' : 'left', mode: 'wall' };
}

/** How far up the front a top surface reaches at its back (share of the height). */
export const topReach = (box: SkinBox) =>
  Math.min(SKIN_TOP_REACH, (0.35 * (box[5] - box[2])) / Math.max(1e-6, box[4] - box[1]));

/** Canonical tile coordinates of camera-frame point `p` read as `read`. */
export function skinCoords(p: V3, read: Read, box: SkinBox): [number, number] {
  const [x0, y0, z0, x1, y1, z1] = box;
  if (read.mode === 'plan')
    return [
      clamp01((p[0] - x0) / Math.max(1e-6, x1 - x0)),
      clamp01((p[2] - z0) / Math.max(1e-6, z1 - z0)),
    ];
  const H = Math.max(1e-6, y1 - y0);
  let t = (y1 - p[1]) / H;
  if (read.mode === 'top') {
    // From just below the front edge up to `topReach` above it at the back.
    const back = (z1 - p[2]) / Math.max(1e-6, z1 - z0);
    t += SKIN_CAP_INSET - back * topReach(box);
  } else if (read.mode === 'under') t -= SKIN_CAP_INSET;
  const s =
    read.tile === 'front' || read.tile === 'back'
      ? (p[0] - x0) / Math.max(1e-6, x1 - x0)
      : (p[2] - z0) / Math.max(1e-6, z1 - z0);
  return [clamp01(s), clamp01(t)];
}

/** The tile and coordinates model point `p` with normal `n` reads (both in the model's frame). */
export function skinSample(
  p: V3,
  n: V3,
  box: SkinBox,
  view: SkinView = STRAIGHT,
  mode: SkinMode = 'photo'
): SkinHit {
  const cp = toCamera(p, view);
  const cn = toCamera(n, view);
  const read = mode === 'box' ? boxRead(cn) : skinRead(cn, cp[2], box);
  const [s, t] = skinCoords(cp, read, box);
  return { tile: read.tile, s, t };
}

/**
 * Atlas uvs of a triangle soup in the model's frame (9 floats per triangle of `position` and
 * `normal`): per triangle, one reading from its summed normal and centroid (a triangle never
 * straddles two tiles), each vertex its own coordinates on it.
 */
export function skinUvs(
  position: ArrayLike<number>,
  normal: ArrayLike<number>,
  box: SkinBox,
  view: SkinView = STRAIGHT,
  mode: SkinMode = 'photo'
): Float32Array {
  const uv = new Float32Array((position.length / 3) * 2);
  for (let t = 0; t + 9 <= position.length; t += 9) {
    const n: [number, number, number] = [0, 0, 0];
    const pts: Array<[number, number, number]> = [];
    let cz = 0;
    for (let k = 0; k < 9; k += 3) {
      n[0] += normal[t + k]!;
      n[1] += normal[t + k + 1]!;
      n[2] += normal[t + k + 2]!;
      const p = toCamera([position[t + k]!, position[t + k + 1]!, position[t + k + 2]!], view);
      pts.push(p);
      cz += p[2] / 3;
    }
    const cn = toCamera(n, view);
    const read = mode === 'box' ? boxRead(cn) : skinRead(cn, cz, box);
    pts.forEach((p, k) => {
      const [s, tt] = skinCoords(p, read, box);
      const [u, v] = atlasUv(faceSlot(read.tile), s, tt);
      const j = (t / 3 + k) * 2;
      uv[j] = u;
      uv[j + 1] = v;
    });
  }
  return uv;
}
