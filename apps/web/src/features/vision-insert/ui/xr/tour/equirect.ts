/**
 * 360° tour math (pure, no allocation-heavy work in hot paths except `renderView`).
 *
 * Conventions: viewer looks along -Z at yaw 0; yaw > 0 turns right (+X); pitch > 0 looks up.
 * Equirect image coords (u, v) in [0, 1], top-left origin; `uFront` = image column seen at yaw 0.
 * Turning right shows the image further right (u grows), as in any panorama viewer.
 */
export type Vec3 = [number, number, number];

const TAU = Math.PI * 2;
const frac = (n: number) => n - Math.floor(n);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Unit direction of a heading. */
export function dirFromYawPitch(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

export function yawPitchOf(d: Vec3): { yaw: number; pitch: number } {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return {
    yaw: Math.atan2(d[0], -d[2]),
    pitch: Math.asin(Math.max(-1, Math.min(1, d[1] / len))),
  };
}

/** Image coords of a world direction. */
export function equirectUv(d: Vec3, uFront: number): { u: number; v: number } {
  const { yaw, pitch } = yawPitchOf(d);
  return { u: frac(uFront + yaw / TAU), v: 0.5 - pitch / Math.PI };
}

/** Heading of an image point (inverse of `equirectUv`). */
export function equirectYawPitch(u: number, v: number, uFront: number) {
  return { yaw: wrapPi((u - uFront) * TAU), pitch: (0.5 - v) * Math.PI };
}

/** `uFront` that shows image column `u` straight ahead of a viewer facing `yaw`. */
export function uFrontFacing(u: number, yaw: number): number {
  return frac(u - yaw / TAU);
}

/** A camera at the viewer's eye: what a scan photographs. */
export interface CaptureView {
  yaw: number;
  pitch: number;
  /** Horizontal field of view (rad). */
  hfov: number;
  /** Width / height. */
  aspect: number;
  /**
   * `gnomonic` (default): a pinhole photo. `equirect`: a panorama strip, linear in yaw and pitch
   * (`hfov` wide, `hfov / aspect` tall): wider than any pinhole without stretching its edges, so
   * an object only half in the viewer's sight is still whole in the photo.
   */
  projection?: 'gnomonic' | 'equirect';
}

/** Heading of a strip photo point (u, v) of an `equirect` view. */
export function stripYawPitch(u: number, v: number, view: CaptureView) {
  return {
    yaw: wrapPi(view.yaw + (u - 0.5) * view.hfov),
    pitch: view.pitch + ((0.5 - v) * view.hfov) / view.aspect,
  };
}

/** Strip photo coords of a heading (inverse of `stripYawPitch`); may fall outside [0, 1]. */
export function stripUv(yaw: number, pitch: number, view: CaptureView): { u: number; v: number } {
  return {
    u: 0.5 + wrapPi(yaw - view.yaw) / view.hfov,
    v: 0.5 - ((pitch - view.pitch) * view.aspect) / view.hfov,
  };
}

/** Photo coords of a direction in any view (null behind a pinhole camera). */
export function projectInView(
  d: Vec3,
  view: CaptureView,
  b: ViewBasis = viewBasis(view)
): { u: number; v: number } | null {
  if (view.projection !== 'equirect') return projectDir(d, b);
  const { yaw, pitch } = yawPitchOf(d);
  return stripUv(yaw, pitch, view);
}

export interface ViewBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  /** tan(hfov / 2) and tan(vfov / 2). */
  tx: number;
  ty: number;
}

export function viewBasis(view: CaptureView): ViewBasis {
  const forward = dirFromYawPitch(view.yaw, view.pitch);
  const right: Vec3 = [Math.cos(view.yaw), 0, Math.sin(view.yaw)];
  // up = right × forward
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const tx = Math.tan(view.hfov / 2);
  return { forward, right, up, tx, ty: tx / view.aspect };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Photo coords of a direction, or null when it is behind the camera. May fall outside [0, 1]. */
export function projectDir(d: Vec3, b: ViewBasis): { u: number; v: number } | null {
  const z = dot(d, b.forward);
  if (z <= 1e-6) return null;
  return {
    u: 0.5 + dot(d, b.right) / z / (2 * b.tx),
    v: 0.5 - dot(d, b.up) / z / (2 * b.ty),
  };
}

/** Direction of a photo pixel (u, v) (inverse of `projectDir`), normalised. */
export function unprojectUv(u: number, v: number, b: ViewBasis): Vec3 {
  const x = (u - 0.5) * 2 * b.tx;
  const y = (0.5 - v) * 2 * b.ty;
  const d: Vec3 = [
    b.forward[0] + b.right[0] * x + b.up[0] * y,
    b.forward[1] + b.right[1] * x + b.up[1] * y,
    b.forward[2] + b.right[2] * x + b.up[2] * y,
  ];
  const len = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / len, d[1] / len, d[2] / len];
}

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Renders what the viewer sees through `view` from an equirect panorama into `out`
 * (gnomonic projection, bilinear sampling, opaque RGBA). This is the photo a scan sends.
 */
export function renderView(src: Pixels, out: Pixels, view: CaptureView, uFront: number): void {
  const b = viewBasis(view);
  const strip = view.projection === 'equirect';
  const { width: W, height: H, data: o } = out;
  const { width: SW, height: SH, data: s } = src;
  for (let j = 0; j < H; j++) {
    const y = (0.5 - (j + 0.5) / H) * 2 * b.ty;
    for (let i = 0; i < W; i++) {
      let u: number;
      let v: number;
      if (strip) {
        // Panorama strip: a straight crop of the equirect photo (clamped at the poles).
        const h = stripYawPitch((i + 0.5) / W, (j + 0.5) / H, view);
        u = frac(uFront + h.yaw / TAU);
        v = Math.min(1, Math.max(0, 0.5 - h.pitch / Math.PI));
      } else {
        const x = ((i + 0.5) / W - 0.5) * 2 * b.tx;
        const dx = b.forward[0] + b.right[0] * x + b.up[0] * y;
        const dy = b.forward[1] + b.right[1] * x + b.up[1] * y;
        const dz = b.forward[2] + b.right[2] * x + b.up[2] * y;
        const len = Math.hypot(dx, dy, dz);
        u = frac(uFront + Math.atan2(dx, -dz) / TAU);
        v = 0.5 - Math.asin(dy / len) / Math.PI;
      }
      // Bilinear, wrapping horizontally.
      const fx = u * SW - 0.5;
      const fy = Math.min(SH - 1, Math.max(0, v * SH - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const xa = ((x0 % SW) + SW) % SW;
      const xb = (xa + 1) % SW;
      const ya = y0;
      const yb = Math.min(SH - 1, y0 + 1);
      const p00 = (ya * SW + xa) * 4;
      const p10 = (ya * SW + xb) * 4;
      const p01 = (yb * SW + xa) * 4;
      const p11 = (yb * SW + xb) * 4;
      const q = (j * W + i) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[p00 + c]! + (s[p10 + c]! - s[p00 + c]!) * ax;
        const bot = s[p01 + c]! + (s[p11 + c]! - s[p01 + c]!) * ax;
        o[q + c] = top + (bot - top) * ay;
      }
      o[q + 3] = 255;
    }
  }
}

/** A box drawn on the panorama (image fractions). `u1 < u0` crosses the image seam. */
export interface PanoBox {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** A closed outline on the panorama: (u, v) image fractions, like a SAM ring (VS-T41). */
export type PanoRing = ReadonlyArray<readonly [number, number]>;

/** `u` moved by whole turns to sit within half a turn of `ref` (outlines across the image seam). */
const nearU = (u: number, ref: number) => u + Math.round(ref - u);

/** Bounds of panorama rings as a box (`u1 < u0` when they cross the seam); null without points. */
export function panoRingsBounds(rings: ReadonlyArray<PanoRing>): PanoBox | null {
  const first = rings[0]?.[0];
  if (!first) return null;
  let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const ring of rings)
    for (const [u, v] of ring) {
      const uu = nearU(u, first[0]);
      u0 = Math.min(u0, uu);
      u1 = Math.max(u1, uu);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
  const r = (n: number) => Number(n.toFixed(5));
  return { u0: r(frac(u0)), v0: r(v0), u1: r(frac(u1)), v1: r(v1) };
}

/**
 * Panorama rings drawn in the photo of `view` as an outline path (photo fractions, the SAM path
 * format), or null when a point falls behind the camera. Points may fall outside [0, 1]: the
 * outline is clipped by the photo like a real mask cut at the frame.
 */
export function projectPanoRings(
  rings: ReadonlyArray<PanoRing>,
  uFront: number,
  view: CaptureView
): string | null {
  const b = viewBasis(view);
  const r = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
  const parts: string[] = [];
  for (const ring of rings) {
    const pts: string[] = [];
    for (const [u, v] of ring) {
      const { yaw, pitch } = equirectYawPitch(u, v, uFront);
      const p = projectInView(dirFromYawPitch(yaw, pitch), view, b);
      if (!p) return null;
      pts.push(`${r(p.u)} ${r(p.v)}`);
    }
    if (pts.length >= 3) parts.push(`M${pts.join('L')}Z`);
  }
  return parts.length ? parts.join('') : null;
}

const SAMPLES = 7;

/**
 * Where a panorama box lands in the photo of `view` ({ x, y, w, h } fractions), or null when
 * less than half of it is in the frame (or its centre is out). Used as ground truth.
 */
export function projectPanoBox(
  box: PanoBox,
  uFront: number,
  view: CaptureView
): { x: number; y: number; w: number; h: number } | null {
  const b = viewBasis(view);
  const u1 = box.u1 < box.u0 ? box.u1 + 1 : box.u1;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  let inside = 0;
  for (let a = 0; a < SAMPLES; a++) {
    for (let c = 0; c < SAMPLES; c++) {
      const u = box.u0 + ((u1 - box.u0) * a) / (SAMPLES - 1);
      const v = box.v0 + ((box.v1 - box.v0) * c) / (SAMPLES - 1);
      const { yaw, pitch } = equirectYawPitch(frac(u), v, uFront);
      const p = projectInView(dirFromYawPitch(yaw, pitch), view, b);
      if (!p || p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1) continue;
      inside++;
      minU = Math.min(minU, p.u);
      maxU = Math.max(maxU, p.u);
      minV = Math.min(minV, p.v);
      maxV = Math.max(maxV, p.v);
    }
  }
  if (inside < (SAMPLES * SAMPLES) / 2) return null;
  const centre = equirectYawPitch(frac((box.u0 + u1) / 2), (box.v0 + box.v1) / 2, uFront);
  const pc = projectInView(dirFromYawPitch(centre.yaw, centre.pitch), view, b);
  if (!pc || pc.u < 0 || pc.u > 1 || pc.v < 0 || pc.v > 1) return null;
  const r = (n: number) => Number(n.toFixed(4));
  return { x: r(minU), y: r(minV), w: r(maxU - minU), h: r(maxV - minV) };
}
