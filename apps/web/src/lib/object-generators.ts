import {
  AXIS,
  facePoint,
  MIN_EXTENT,
  type BranchParams,
  type DrapeParams,
  type InsetParams,
  type LoftParams,
  type RecipePart,
  type ScatterParams,
  type SweepParams,
} from './object-shape';
import { mulberry32 } from './seeded-random';

/**
 * Generators (PQ-T50/51 §7.3): seeded, bounded growth of trunks, limbs, leaves, strands, lofted
 * bodies and face pockets. Every function is pure: same params, same parts, on every platform
 * (no `Math.random`). A part that carries `generator` expands through `expandGenerators` —
 * inside `expandAssemblies`, so the viewer and the judge render grow the identical parts, with
 * no server twin to drift. Grown parts are plain boxes and cylinders in the host's look: the fit
 * reads the host box, the renders see the growth. Growth is clamped into the host box plus
 * `GROW_MARGIN`.
 */

type Vec3 = [number, number, number];

/** Growth may overshoot the host box by this much (flare, lean); past it, it is clamped. */
export const GROW_MARGIN = 0.05;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l < 1e-9 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

interface HostLook {
  color: string;
  material: RecipePart['material'];
  status: RecipePart['status'];
  kind: RecipePart['kind'];
}

const lookOf = (
  host: RecipePart,
  over: { color?: string; material?: HostLook['material'] }
): HostLook => ({
  color: over.color ?? host.color,
  material: over.material ?? host.material,
  status: host.status,
  kind: host.kind,
});

function grownPart(
  shape: 'box' | 'cylinder',
  at: Vec3,
  size: Vec3,
  look: HostLook,
  axis?: RecipePart['axis']
): RecipePart {
  return {
    shape,
    at,
    size: [
      Math.max(MIN_EXTENT, size[0]),
      Math.max(MIN_EXTENT, size[1]),
      Math.max(MIN_EXTENT, size[2]),
    ],
    color: look.color,
    ...(look.material ? { material: look.material } : {}),
    ...(look.status ? { status: look.status } : {}),
    ...(look.kind ? { kind: look.kind } : {}),
    ...(axis ? { axis } : {}),
  };
}

/** A limb segment from `a` to `b`: the bounding box, grown 20 % to fuse the joints. */
function limbBox(a: Vec3, b: Vec3, thick: number): { at: Vec3; size: Vec3 } {
  const pad = thick * 0.2;
  return {
    at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    size: [
      Math.abs(b[0] - a[0]) + thick + pad,
      Math.abs(b[1] - a[1]) + thick + pad,
      Math.abs(b[2] - a[2]) + thick + pad,
    ],
  };
}

/** Clamp a grown part into the host box plus the margin (total functions never poke out). */
function clampInto(host: RecipePart, part: RecipePart): RecipePart {
  const at = [...part.at] as Vec3;
  const size = [...part.size] as Vec3;
  for (const a of [0, 1, 2] as const) {
    const lo = host.at[a] - host.size[a] / 2 - GROW_MARGIN;
    const hi = host.at[a] + host.size[a] / 2 + GROW_MARGIN;
    size[a] = Math.min(size[a], hi - lo);
    const half = size[a] / 2;
    at[a] = Math.min(hi - half, Math.max(lo + half, at[a]));
  }
  return { ...part, at, size };
}

/**
 * Tube along a centre line (§7.3 `sweep`): near-vertical rising runs become tapered cylinders
 * (trunks, pipes, antennas), the rest thin boxes. The first segment carries the base flare.
 */
export function sweepTube(host: RecipePart, p: SweepParams): RecipePart[] {
  const look = lookOf(host, p);
  const pts = p.points;
  const out: RecipePart[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const d = sub(b, a);
    const length = len(d);
    if (length < 1e-9) continue;
    const r =
      (p.r0 + ((p.r1 - p.r0) * (i + 0.5)) / (pts.length - 1)) * (i === 0 ? 1 + (p.flare ?? 0) : 1);
    if (Math.hypot(d[0], d[2]) < length * 0.35 && d[1] > 0) {
      out.push(
        grownPart(
          'cylinder',
          [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
          [r * 2, length * 1.1, r * 2],
          look,
          'y'
        )
      );
    } else {
      const { at, size } = limbBox(a, b, r * 2);
      out.push(grownPart('box', at, size, look));
    }
  }
  return out;
}

/**
 * Recursive branching (§7.3 `branch`): the stem plus `count` children per node, tilted off the
 * parent by `angle`, pulled down by `droop`, shrunk by `decay`. At most 31 segments.
 */
export function branchTree(host: RecipePart, p: BranchParams): RecipePart[] {
  const look = lookOf(host, p);
  const rng = mulberry32(p.seed);
  const out: RecipePart[] = [];
  const grow = (at: Vec3, dir: Vec3, length: number, radius: number, level: number): void => {
    const nd = norm(dir);
    const tip: Vec3 = [at[0] + nd[0] * length, at[1] + nd[1] * length, at[2] + nd[2] * length];
    const seg = limbBox(at, tip, radius * 2);
    out.push(grownPart('box', seg.at, seg.size, look));
    if (level >= p.levels) return;
    const up: Vec3 = Math.abs(nd[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(nd, up));
    const v = cross(nd, u);
    for (let c = 0; c < p.count; c++) {
      const az = (c / p.count) * Math.PI * 2 + rng() * 0.6;
      const tilt = p.angle * (0.5 + rng() * 0.5);
      const s = Math.sin(tilt);
      const co = Math.cos(tilt);
      const child: Vec3 = [
        nd[0] * co + (u[0] * Math.cos(az) + v[0] * Math.sin(az)) * s,
        nd[1] * co + (u[1] * Math.cos(az) + v[1] * Math.sin(az)) * s - p.droop * 0.6,
        nd[2] * co + (u[2] * Math.cos(az) + v[2] * Math.sin(az)) * s,
      ];
      const t = 0.55 + rng() * 0.45;
      grow(
        [at[0] + (tip[0] - at[0]) * t, at[1] + (tip[1] - at[1]) * t, at[2] + (tip[2] - at[2]) * t],
        child,
        length * p.decay,
        radius * p.decay,
        level + 1
      );
    }
  };
  grow(p.at, p.dir, p.length, p.radius, 1);
  return out;
}

/**
 * Leaf cards in a volume (§7.3 `scatter`): thin boxes, seeded place, size and palette pick.
 * `flat` cards lie in the XZ plane, `upright` face the camera, `random` turns each card.
 */
export function scatterLeaves(host: RecipePart, p: ScatterParams): RecipePart[] {
  const rng = mulberry32(p.seed);
  const [cx, cy, cz] = p.volume.at;
  const [sx, sy, sz] = p.volume.size;
  const out: RecipePart[] = [];
  for (let i = 0; i < p.count; i++) {
    let x: number;
    let y: number;
    let z: number;
    if (p.volume.shape === 'box') {
      x = cx + (rng() * 2 - 1) * (sx / 2);
      y = cy + (rng() * 2 - 1) * (sy / 2);
      z = cz + (rng() * 2 - 1) * (sz / 2);
    } else {
      // Uniform in the ball: random direction, radius cubed by the seed.
      const th = rng() * Math.PI * 2;
      const ph = Math.acos(2 * rng() - 1);
      const rr = Math.cbrt(rng());
      x = cx + rr * Math.sin(ph) * Math.cos(th) * (sx / 2);
      y = cy + rr * Math.cos(ph) * (sy / 2);
      z = cz + rr * Math.sin(ph) * Math.sin(th) * (sz / 2);
    }
    const s = p.size * (0.7 + rng() * 0.6);
    const thin = Math.max(MIN_EXTENT, s * 0.15);
    const axis =
      p.orientation === 'flat' ? 1 : p.orientation === 'upright' ? 2 : Math.floor(rng() * 3);
    const size: Vec3 = [s, s, s];
    size[axis as 0 | 1 | 2] = thin;
    out.push(
      grownPart('box', [x, y, z], size, {
        ...lookOf(host, {}),
        color: p.colors[Math.floor(rng() * p.colors.length)]!,
      })
    );
  }
  return out;
}

/**
 * Hanging strands (§7.3 `drape`): three thin boxes per strand, swaying with the seed around the
 * hang point (willow fringes, vines, curtains).
 */
export function drapeStrands(host: RecipePart, p: DrapeParams): RecipePart[] {
  const look = lookOf(host, p);
  const rng = mulberry32(p.seed);
  const out: RecipePart[] = [];
  for (const point of p.points) {
    for (let s = 0; s < p.strands; s++) {
      const ox = (rng() * 2 - 1) * p.waviness * 0.3;
      const oz = (rng() * 2 - 1) * p.waviness * 0.3;
      const phase = rng() * Math.PI * 2;
      const segLen = p.length / 3;
      for (let k = 0; k < 3; k++) {
        const sway = Math.sin(phase + k * 1.2) * p.waviness * ((k + 1) / 3);
        out.push(
          grownPart(
            'box',
            [point[0] + ox + sway, point[1] - (k + 0.5) * segLen, point[2] + oz + sway * 0.6],
            [p.thickness, segLen * 1.15, p.thickness],
            look
          )
        );
      }
    }
  }
  return out;
}

/**
 * Lofted body (§7.3 `loft`, PQ-T51): the stations spread evenly along the host's extent on the
 * axis and each pair grows one segment with the averaged cross section (a 4-station car body =
 * nose, mid, tail steps). Width runs across the host on the horizontal cross axis, height rises
 * from the host's bottom — except on a vertical loft, where width × height sections stack
 * upward (bottles, fuselages standing). Round stations (radius ≥ 0.4 of the smaller side) grow
 * elliptical cylinders, the rest boxes; segments overlap 6 % to fuse. Deterministic: the seed
 * is carried, never read, like `sweep`.
 */
export function loftBody(host: RecipePart, p: LoftParams): RecipePart[] {
  const look = lookOf(host, p);
  const a = AXIS[p.axis];
  const n = p.stations.length;
  const lo = host.at[a] - host.size[a] / 2;
  const spacing = host.size[a] / (n - 1);
  // Cross axes: width across, height up from the host's bottom (centred on a vertical loft).
  const wAxis = (p.axis === 'x' ? 2 : 0) as 0 | 2;
  const hAxis = (p.axis === 'y' ? 2 : 1) as 1 | 2;
  const baseline = host.at[1] - host.size[1] / 2;
  const out: RecipePart[] = [];
  for (let i = 0; i < n - 1; i++) {
    const s0 = p.stations[i]!;
    const s1 = p.stations[i + 1]!;
    const w = (s0.width + s1.width) / 2;
    const h = (s0.height + s1.height) / 2;
    const r = (s0.radius + s1.radius) / 2;
    const at = [...host.at] as Vec3;
    at[a] = lo + spacing * (i + 0.5);
    at[wAxis] = host.at[wAxis];
    at[hAxis] = p.axis === 'y' ? host.at[hAxis] : baseline + h / 2;
    const size = [0, 0, 0] as Vec3;
    size[a] = spacing * 1.06;
    size[wAxis] = w;
    size[hAxis] = h;
    if (r >= 0.4 * Math.min(w, h)) {
      out.push(grownPart('cylinder', at, size, look, p.axis));
    } else {
      out.push(grownPart('box', at, size, look));
    }
  }
  return out;
}

/** Shade of a hollow pocket (a recess reads dark, never black). */
export const INSET_HOLLOW_SHADE = 0.55;

/** Scale a `#rrggbb` colour by `f`, channel by channel. */
function darken(hex: string, f: number): string {
  const hx = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  const ch = (i: number) => parseInt(hex.slice(i, i + 2), 16) * f;
  return `#${hx(ch(1))}${hx(ch(3))}${hx(ch(5))}`;
}

/**
 * Rectangular pocket on a host face (§7.3 `inset`, PQ-T51): one slab on the face at (u, v),
 * w × h shares of it (the `attach` / `cut` convention, clamped to fit). Hollows (depth < 0)
 * read as dark recesses — the explicit colour, else the host darkened; reliefs (depth > 0)
 * stand proud in the host's look. The slab fuses into the host, and a hollow stays 0.004 proud
 * so its colour reads without z-fighting. Additive: `expandGenerators` keeps the host, so a
 * wall renders with its pocket, not instead of it.
 */
export function insetPocket(host: RecipePart, p: InsetParams): RecipePart[] {
  const cw = Math.min(p.w, 1);
  const ch = Math.min(p.h, 1);
  const cu = Math.min(Math.max(p.u - cw / 2, 0), 1 - cw) + cw / 2;
  const cv = Math.min(Math.max(p.v - ch / 2, 0), 1 - ch) + ch / 2;
  const { at, ax, vAxis } = facePoint(host, p.face, cu, cv);
  const size = [0, 0, 0] as Vec3;
  size[ax.u] = cw * host.size[ax.u];
  size[vAxis] = ch * host.size[vAxis];
  const facePlane = host.at[ax.n] + (ax.sign * host.size[ax.n]) / 2;
  // Into the host (fuse) and out of it (proud): reliefs by depth, hollows to a dark skin.
  const c1 = facePlane - ax.sign * (p.depth >= 0 ? 0.01 : -p.depth);
  const c2 = facePlane + ax.sign * (p.depth >= 0 ? Math.max(p.depth, 0.004) : 0.004);
  at[ax.n] = (c1 + c2) / 2;
  size[ax.n] = Math.abs(c2 - c1);
  const look: HostLook = {
    ...lookOf(host, {
      color: p.color ?? (p.depth < 0 ? darken(host.color, INSET_HOLLOW_SHADE) : host.color),
      material: p.material,
    }),
    kind: p.kind ?? host.kind,
  };
  return [grownPart('box', at, size, look)];
}

/** One host's growth, clamped into its box (empty only for a degenerate host). */
export function growPart(host: RecipePart): RecipePart[] {
  const g = host.generator;
  if (!g) return [];
  const grown =
    g.op === 'sweep'
      ? sweepTube(host, g)
      : g.op === 'branch'
        ? branchTree(host, g)
        : g.op === 'scatter'
          ? scatterLeaves(host, g)
          : g.op === 'drape'
            ? drapeStrands(host, g)
            : g.op === 'loft'
              ? loftBody(host, g)
              : insetPocket(host, g);
  return grown.map((q) => clampInto(host, q));
}

/**
 * Generator parts → plain parts, with the recipe index each one grew from. Parts without a
 * generator pass through untouched. `details` on a replacing generator part are ignored (trim
 * belongs on plain hosts); a part that grows nothing keeps its own box, so the silhouette never
 * vanishes. `inset` is additive: the host keeps rendering (minus its consumed generator, so a
 * second expansion cannot double the pocket) with the slab beside it.
 */
export function expandGenerators(parts: ReadonlyArray<RecipePart>): {
  parts: RecipePart[];
  from: number[];
} {
  const out: RecipePart[] = [];
  const from: number[] = [];
  parts.forEach((p, k) => {
    if (!p.generator) {
      out.push(p);
      from.push(k);
      return;
    }
    const grown = growPart(p);
    if (!grown.length) {
      const { generator: _dropped, details: _trimmed, ...box } = p;
      out.push(box);
      from.push(k);
      return;
    }
    if (p.generator.op === 'inset') {
      const { generator: _consumed, ...kept } = p;
      out.push(kept);
      from.push(k);
    }
    for (const q of grown) {
      out.push(q);
      from.push(k);
    }
  });
  return { parts: out, from: from };
}
