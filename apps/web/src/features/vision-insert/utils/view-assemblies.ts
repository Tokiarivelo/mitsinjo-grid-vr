import { ringRange, spanAt } from '@/lib/hull';
import { MIN_EXTENT, type DetailKind, type RecipePart } from '@/lib/object-shape';
import type { AssemblyDetail } from './openings';

/**
 * Assemblies of objects built from their 2D view (PG-T21), expanded by the 3D view only (the
 * flat render scores the plain part): a metal rim on each wheel's outer face, thin grid lines
 * on a solar cell patch. Pure.
 */

/** Rim diameter as a share of the tyre's, and its thickness as a share of the tyre width. */
export const RIM_DIAMETER = 0.62;
export const RIM_THICK = 0.35;
/** Rim colour (model colour, not a UI token). */
export const RIM_COLOR = '#c8cdd2';
/** Cell line half-width and lift off the patch, unit space. */
export const CELL_LINE = 0.004;
const CELL_LIFT = 0.003;
export const CELL_LINE_COLOR = '#b9c3cf';

/** The wheel with its rim disc (axis x: outer face toward its own side; axis z: both faces). */
function withRim(p: RecipePart): RecipePart[] {
  if (p.kind !== 'wheel' || !(p.rim || p.details?.includes('rim')) || p.shape !== 'cylinder')
    return [p];
  if (p.axis !== 'x' && p.axis !== 'z') return [p];
  const axis: 0 | 2 = p.axis === 'x' ? 0 : 2;
  const across = p.size[axis]!;
  const t = across * RIM_THICK;
  const sides = axis === 0 ? [Math.sign(p.at[0]) || 1] : [1, -1];
  const rims = sides.map((s): RecipePart => {
    const at: [number, number, number] = [...p.at];
    // Flush with the tyre's face, a hair proud so it never z-fights.
    at[axis] = p.at[axis]! + s * (across / 2 - t / 2 + across * 0.02);
    const size: [number, number, number] = [
      p.size[0] * RIM_DIAMETER,
      p.size[1] * RIM_DIAMETER,
      p.size[2] * RIM_DIAMETER,
    ];
    size[axis] = t;
    return {
      shape: 'cylinder',
      axis: p.axis,
      at,
      size,
      color: RIM_COLOR,
      material: 'metal',
      kind: 'wheel',
      ...(p.status ? { status: p.status } : {}),
    };
  });
  return [p, ...rims];
}

/** The cell patch with its grid lines: columns follow the patch's tilt, rows sit on its face. */
function withCellGrid(p: RecipePart): RecipePart[] {
  if (p.kind !== 'cell' || !p.grid || p.shape !== 'hull' || !p.points || !p.section) return [p];
  const [cols, rows] = p.grid;
  const [x0, x1] = ringRange(p.points, 0);
  const [y0, y1] = ringRange(p.points, 1);
  const section = p.section;
  const look = {
    color: CELL_LINE_COLOR,
    material: 'metal' as const,
    kind: 'cell' as const,
    ...(p.status ? { status: p.status } : {}),
  };
  const lines: RecipePart[] = [];
  for (let i = 1; i < cols; i++) {
    const x = x0 + ((x1 - x0) * i) / cols;
    lines.push({
      shape: 'hull',
      at: [0, 0, 0],
      size: [1, 1, 1],
      // Inset from the patch ends so a line never pokes past the panel's edge.
      points: [
        [x - CELL_LINE, y0 + 2 * CELL_LINE],
        [x + CELL_LINE, y0 + 2 * CELL_LINE],
        [x + CELL_LINE, y1 - 2 * CELL_LINE],
        [x - CELL_LINE, y1 - 2 * CELL_LINE],
      ],
      section: section.map(([z, y]) => [z + CELL_LIFT, y] as [number, number]),
      ...look,
    });
  }
  for (let j = 1; j < rows; j++) {
    const y = y0 + ((y1 - y0) * j) / rows;
    const z = (spanAt(section, y) ?? ringRange(section, 0))[1];
    lines.push({
      shape: 'box',
      at: [(x0 + x1) / 2, y, z + CELL_LIFT],
      size: [x1 - x0, 2 * CELL_LINE, 2 * CELL_LIFT],
      ...look,
    });
  }
  return [p, ...lines];
}

/** Detail colours (model colours, not UI tokens). */
export const DETAIL_METAL = '#c8cdd2';
export const DETAIL_DARK = '#16181b';
/** How far a detail sticks out of its host's face (share of the object, a hair proud of z-fights). */
const PROUD = 0.012;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** Bounds of a part, recipe fractions: box-like parts by `at` ± `size` / 2, hulls by their rings. */
function boundsOf(p: RecipePart): Box {
  if (p.shape === 'hull' && p.points && p.section) {
    const [x0, x1] = ringRange(p.points, 0);
    const [y0, y1] = ringRange(p.points, 1);
    const [z0, z1] = ringRange(p.section, 0);
    const [sx, sy, sz] = p.size;
    return {
      x0: p.at[0] + x0 * sx,
      x1: p.at[0] + x1 * sx,
      y0: p.at[1] + y0 * sy,
      y1: p.at[1] + y1 * sy,
      z0: p.at[2] + z0 * sz,
      z1: p.at[2] + z1 * sz,
    };
  }
  const [hx, hy, hz] = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
  return {
    x0: p.at[0] - hx,
    x1: p.at[0] + hx,
    y0: p.at[1] - hy,
    y1: p.at[1] + hy,
    z0: p.at[2] - hz,
    z1: p.at[2] + hz,
  };
}

const ext = (v: number) => Math.max(MIN_EXTENT, v);

function plate(
  host: RecipePart,
  at: [number, number, number],
  size: [number, number, number],
  color: string,
  shape: 'box' | 'cylinder' = 'box'
): RecipePart {
  return {
    shape,
    at,
    size: [ext(size[0]), ext(size[1]), ext(size[2])],
    color,
    material: color === DETAIL_METAL ? 'metal' : 'plastic',
    ...(host.status ? { status: host.status } : {}),
  };
}

/** One detail of a host part: the plain parts it expands to (none when the host cannot carry it). */
function detailParts(p: RecipePart, kind: DetailKind): RecipePart[] {
  if (kind === 'rim') return [];
  if (kind === 'arch') return withArch(p);
  const b = boundsOf(p);
  const [w, h, d] = [b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0];
  const [cx, cy] = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const front = b.z1 + PROUD / 2;
  switch (kind) {
    case 'handle':
      // Vertical bar near the right edge of the front face, a little above the middle.
      return [
        plate(p, [b.x0 + w * 0.86, cy + h * 0.1, front], [w * 0.04, h * 0.25, PROUD], DETAIL_METAL),
      ];
    case 'seam':
      // A tall host (cabinet) shows a door line across; a long one (vehicle) a vertical shut line.
      return [
        h >= w
          ? plate(p, [cx, cy + h * 0.2, front], [w * 0.98, h * 0.012, PROUD / 2], DETAIL_DARK)
          : plate(p, [cx + w * 0.1, cy, front], [w * 0.008, h * 0.7, PROUD / 2], DETAIL_DARK),
      ];
    case 'vent':
      return [
        plate(p, [b.x0 + w * 0.2, b.y1 - h * 0.12, front], [w * 0.2, h * 0.06, PROUD], DETAIL_DARK),
      ];
    case 'gutter':
      // Along the eave of a roof, front and back.
      return [b.z1 + PROUD / 2, b.z0 - PROUD / 2].map((z) =>
        plate(p, [cx, b.y0 + h * 0.03, z], [w, Math.max(MIN_EXTENT, h * 0.06), PROUD], DETAIL_METAL)
      );
    case 'mirror': {
      // A pair on the lateral faces, forward of the middle; the lateral axis is the shorter one.
      const lateralX = w <= d;
      const side = lateralX ? w : d;
      const along = lateralX ? d : w;
      const s = Math.max(MIN_EXTENT, Math.min(0.05, side * 0.12));
      return [1, -1].map((sg) => {
        const out = (lateralX ? (sg > 0 ? b.x1 : b.x0) : sg > 0 ? b.z1 : b.z0) + (sg * s) / 2;
        const fwd = (lateralX ? b.z0 : b.x0) + along * 0.72;
        const at: [number, number, number] = lateralX
          ? [out, b.y0 + h * 0.62, fwd]
          : [fwd, b.y0 + h * 0.62, out];
        return plate(p, at, [s, s, s], DETAIL_DARK);
      });
    }
    case 'foot': {
      // Four short posts under the corners (cylinders along y), below the host's bottom face.
      const f = Math.max(MIN_EXTENT, Math.min(0.05, Math.min(w, d) * 0.12));
      return [0.38, -0.38].flatMap((fx) =>
        [0.38, -0.38].map((fz) =>
          plate(
            p,
            [cx + w * fx, b.y0 - f * 0.4, (b.z0 + b.z1) / 2 + d * fz],
            [f, f * 0.8, f],
            DETAIL_DARK,
            'cylinder'
          )
        )
      );
    }
  }
}

/**
 * Wheel arch: a dark disc a fifth larger than the tyre, just behind its outer face, raised so its lowest
 * point is the tyre's (an arch opens downward: it never dips under the ground the wheel stands on).
 */
function withArch(p: RecipePart): RecipePart[] {
  if (p.kind !== 'wheel' || p.shape !== 'cylinder') return [];
  if (p.axis !== 'x' && p.axis !== 'z') return [];
  const axis: 0 | 2 = p.axis === 'x' ? 0 : 2;
  const across = p.size[axis]!;
  const t = ext(across * 0.5);
  const sides = axis === 0 ? [Math.sign(p.at[0]) || 1] : [1, -1];
  return sides.map((s) => {
    const at: [number, number, number] = [...p.at];
    at[axis] = p.at[axis]! + s * (across / 2 - t / 2 - across * 0.05);
    at[1] = p.at[1] + p.size[1] * 0.1;
    const size: [number, number, number] = [p.size[0] * 1.2, p.size[1] * 1.2, p.size[2] * 1.2];
    size[axis] = t;
    return { ...plate(p, at, size, DETAIL_DARK, 'cylinder'), axis: p.axis };
  });
}

/** The detail parts of one host (every kind it lists, no duplicates). */
export function detailPartsOf(p: RecipePart): RecipePart[] {
  const kinds = [...new Set(p.details ?? [])];
  return kinds.flatMap((k) => detailParts(p, k));
}

/** Details that change the outline (`mirror`, `foot`, `gutter`, `arch`): the silhouette fit counts them. */
export function outlineDetails(parts: ReadonlyArray<RecipePart>): RecipePart[] {
  return parts.flatMap((p) =>
    [...new Set(p.details ?? [])]
      .filter((k) => k === 'mirror' || k === 'foot' || k === 'gutter' || k === 'arch')
      .flatMap((k) => detailParts(p, k))
  );
}

/**
 * Wheels with rims (every detail), solar cells with grid lines and the details of PQ-T20 (full detail
 * only: past the triangle budget the viewer rebuilds at `low`, which drops them first).
 */
export function expandViewAssemblies(
  parts: ReadonlyArray<RecipePart>,
  detail: AssemblyDetail = 'full'
): RecipePart[] {
  return parts.flatMap((p) =>
    withRim(p).flatMap((q) =>
      detail === 'full' ? [...withCellGrid(q), ...(q === p ? detailPartsOf(q) : [])] : [q]
    )
  );
}
