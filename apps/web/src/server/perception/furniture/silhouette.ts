import type { PartSpec, V3 } from './part-spec';

/**
 * Outline-driven parts (VS-T42, shared since PQ-T90): a part marked `silhouette` takes the traced
 * outline (the SAM mask's contour, never its pixels) as its front ring, clipped to a vertical band
 * of the object, so soft or irregular things (a rock, a curtain, a crown) match their photo. Used by
 * the tour mock and by the teams' builders on the real path. Pure: outline fractions in, unit rings out.
 */

type Pt = readonly [number, number];
export interface OutlineBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Most points kept on a silhouette ring (the recipe allows 64). */
export const SILHOUETTE_POINTS = 48;

/** Twice the signed area of a ring (any orientation). */
const area2 = (r: ReadonlyArray<Pt>) =>
  r.reduce((s, [x, y], i) => {
    const [nx, ny] = r[(i + 1) % r.length]!;
    return s + x * ny - nx * y;
  }, 0);

/** The ring cut to `lo ≤ y ≤ hi` (Sutherland–Hodgman on two horizontal lines). */
export function clipBand(ring: ReadonlyArray<Pt>, lo: number, hi: number): Pt[] {
  const clip = (pts: ReadonlyArray<Pt>, keep: (y: number) => boolean, edge: number): Pt[] => {
    const out: Pt[] = [];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      const pin = keep(p[1]);
      const qin = keep(q[1]);
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = (edge - p[1]) / (q[1] - p[1]);
        out.push([p[0] + t * (q[0] - p[0]), edge]);
      }
    });
    return out;
  };
  return clip(
    clip(ring, (y) => y >= lo, lo),
    (y) => y <= hi,
    hi
  );
}

/**
 * The ring without zero-area spikes: a point whose neighbours sit on one line with it while it
 * lies outside them (a clip along an edge that runs on the cut line leaves one), or a repeat.
 */
export function dropSpikes(ring: ReadonlyArray<Pt>): Pt[] {
  let pts = [...ring];
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % pts.length]!;
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const dot = (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]);
      const repeat = Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-12;
      if (repeat || (Math.abs(cross) < 1e-12 && dot >= 0)) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        i--;
      }
    }
  }
  return pts;
}

/** At most `n` points evenly spaced along the ring's perimeter. */
export function resampleRing(ring: ReadonlyArray<Pt>, n: number): Pt[] {
  if (ring.length <= n) return [...ring];
  const seg = ring.map((p, i) =>
    Math.hypot(...([0, 1].map((k) => ring[(i + 1) % ring.length]![k]! - p[k]!) as [number, number]))
  );
  const total = seg.reduce((a, b) => a + b, 0);
  const out: Pt[] = [];
  let i = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (acc + seg[i]! < target && i < ring.length - 1) acc += seg[i++]!;
    const t = seg[i]! > 0 ? (target - acc) / seg[i]! : 0;
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
  }
  return out;
}

/**
 * The object's largest outline ring, cut to the band [top, bottom] (shares of the box height from
 * its top), as a unit ring (x, y in −0.5…0.5, y up), the band's width / height in photo pixels and
 * its centre's shift from the box centre (in band heights).
 */
export function silhouetteRing(
  rings: ReadonlyArray<ReadonlyArray<Pt>>,
  box: OutlineBox,
  pixelAspect: number,
  band: readonly [number, number] = [0, 1]
): { ring: Array<[number, number]>; aspect: number; offset: number } | null {
  const main = [...rings].sort((a, b) => Math.abs(area2(b)) - Math.abs(area2(a)))[0];
  if (!main || main.length < 3) return null;
  const lo = box.y + band[0] * box.h;
  const hi = box.y + band[1] * box.h;
  const cut = dropSpikes(clipBand(main, lo, hi));
  if (cut.length < 3) return null;
  const xs = cut.map(([x]) => x);
  const ys = cut.map(([, y]) => y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const ring = resampleRing(cut, SILHOUETTE_POINTS).map(
    ([x, y]) => [r4((x - x0) / (x1 - x0) - 0.5), r4(0.5 - (y - y0) / (y1 - y0))] as [number, number]
  );
  return {
    ring,
    aspect: ((x1 - x0) * pixelAspect) / (y1 - y0),
    offset: (((x0 + x1) / 2 - (box.x + box.w / 2)) * pixelAspect) / (y1 - y0),
  };
}

/** Side ring of a silhouette part: a rounded cushion (z, y), fuller at the middle. */
export const ROUND_SECTION: Array<[number, number]> = Array.from({ length: 16 }, (_, i) => {
  const t = (i / 16) * Math.PI * 2;
  return [Math.round(0.5 * Math.cos(t) * 1e4) / 1e4, Math.round(0.5 * Math.sin(t) * 1e4) / 1e4];
});

/**
 * Every `silhouette` part of a spec → a hull on the outline (its height, y and z kept; its width and
 * x from the outline band, so bands of one object stay aligned). Parts without one pass unchanged; null outline → spec unchanged.
 */
export function resolveSilhouettes<S extends { parts: PartSpec[] }>(
  spec: S,
  rings: ReadonlyArray<ReadonlyArray<Pt>>,
  box: OutlineBox,
  pixelAspect: number
): S {
  if (!spec.parts.some((p) => p.silhouette)) return spec;
  const parts = spec.parts.map((p): PartSpec => {
    if (!p.silhouette) return p;
    const s = silhouetteRing(rings, box, pixelAspect, p.silhouette.band);
    const { silhouette, ...rest } = p;
    if (!s) return { ...rest, shape: 'box' };
    const size: V3 = [p.size[1] * s.aspect, p.size[1], p.size[2]];
    return {
      ...rest,
      at: [p.at[0] + s.offset * p.size[1], p.at[1], p.at[2]],
      shape: 'hull',
      size,
      points: s.ring,
      section: silhouette.section
        ? silhouette.section.map(([z, y]) => [z, y] as [number, number])
        : ROUND_SECTION,
    };
  });
  return { ...spec, parts };
}
