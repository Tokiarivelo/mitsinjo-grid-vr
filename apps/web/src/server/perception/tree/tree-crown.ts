/** An ellipsoid in cells: centre (x across the front, y row from the top, z across the side) and radii. */
export interface Lobe {
  c: [number, number, number];
  r: [number, number, number];
}

/** Runs of set cells on the rows `rows` of a mask, gaps narrower than `gap` bridged: `[first, last]` columns. */
export function runsOf(
  mask: Uint8Array,
  cols: number,
  rows: readonly number[],
  gap: number
): Array<[number, number]> {
  const set = new Uint8Array(cols);
  for (const y of rows) for (let x = 0; x < cols; x++) if (mask[y * cols + x]) set[x] = 1;
  const runs: Array<[number, number]> = [];
  let start = -1;
  let last = -1;
  for (let x = 0; x < cols; x++) {
    if (!set[x]) continue;
    if (start < 0) start = x;
    else if (x - last - 1 > gap) {
      runs.push([start, last]);
      start = x;
    }
    last = x;
  }
  if (start >= 0) runs.push([start, last]);
  return runs;
}

/**
 * The crown of a tree as clumps (PQ-T79). The two silhouettes (front, side) bound a volume; spheres
 * are packed greedily into it, the largest that still fit first, so the union is a lumpy mass of
 * foliage that follows both outlines instead of a smooth barrel or a stack of saucers. Pure and
 * deterministic: no randomness, ties go to the lowest voxel.
 */

/** Voxels along the longest side of the crown. */
export const CROWN_VOXELS = 44;
/** Most clumps (the recipe puts 12 in a part). */
export const CLUMPS_MAX = 24;
/** A clump is not smaller than this share of the crown's longest side. */
export const CLUMP_MIN = 0.07;
/** A clump is not larger than this share of it. */
export const CLUMP_MAX = 0.22;
/** A clump is this much larger than the room around its centre: lumps overlap and reach the outline. */
export const CLUMP_GROW = 1.12;
/** Share of the volume left uncovered when the packing stops. */
export const UNCOVERED_STOP = 0.02;

export interface CrownMasks {
  /** Front silhouette (columns x, `rows` rows), 1 = crown. */
  front: Uint8Array;
  /** Side silhouette (columns z). */
  side: Uint8Array;
  W: number;
  D: number;
  rows: number;
}

/** Chamfer distance (voxels) to the nearest empty voxel, 3-3-3 weights; empty voxels are 0. */
export function clearance(occ: Uint8Array, [nx, ny, nz]: [number, number, number]): Float32Array {
  const d = new Float32Array(occ.length);
  const BIG = 1e6;
  for (let i = 0; i < d.length; i++) d[i] = occ[i] ? BIG : 0;
  const at = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
  const relax = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => {
    const [px, py, pz] = [x + dx, y + dy, z + dz];
    // Outside the grid is empty: the clearance of an edge voxel is one step.
    const other =
      px < 0 || py < 0 || pz < 0 || px >= nx || py >= ny || pz >= nz ? 0 : d[at(px, py, pz)]!;
    const v = other + Math.hypot(dx, dy, dz);
    if (v < d[at(x, y, z)]!) d[at(x, y, z)] = v;
  };
  const forward: Array<[number, number, number]> = [];
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dz < 0 || (dz === 0 && dy < 0) || (dz === 0 && dy === 0 && dx < 0))
          forward.push([dx, dy, dz]);
      }
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        if (occ[at(x, y, z)]) for (const [a, b, c] of forward) relax(x, y, z, a, b, c);
  for (let z = nz - 1; z >= 0; z--)
    for (let y = ny - 1; y >= 0; y--)
      for (let x = nx - 1; x >= 0; x--)
        if (occ[at(x, y, z)]) for (const [a, b, c] of forward) relax(x, y, z, -a, -b, -c);
  return d;
}

/**
 * Packs the crown volume of `top`..`base` (rows of the masks) with spheres, in cells. The volume is
 * the front outline times the side outline, each row cut to an ellipse (a crown is round seen from
 * above, not a box).
 */
export function packCrown(m: CrownMasks, top: number, base: number, gap: number): Lobe[] {
  const height = base - top + 1;
  // Per row: the front runs and the side span, to cut ellipses.
  const rowRuns: Array<Array<[number, number]>> = [];
  const rowSide: Array<[number, number] | null> = [];
  for (let y = 0; y < m.rows; y++) {
    rowRuns.push(runsOf(m.front, m.W, [y], gap));
    const s = runsOf(m.side, m.D, [y], gap);
    rowSide.push(s.length ? [s[0]![0], s[s.length - 1]![1] + 1] : null);
  }
  const longest = Math.max(m.W, m.D, height);
  const v = longest / CROWN_VOXELS;
  const dims: [number, number, number] = [
    Math.max(1, Math.ceil(m.W / v)),
    Math.max(1, Math.ceil(height / v)),
    Math.max(1, Math.ceil(m.D / v)),
  ];
  const [nx, ny, nz] = dims;
  const occ = new Uint8Array(nx * ny * nz);
  let total = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      const y = Math.min(m.rows - 1, Math.floor(top + (j + 0.5) * v));
      const runs = rowRuns[y]!;
      const side = rowSide[y];
      if (!runs.length || !side) continue;
      const z = (k + 0.5) * v;
      if (z < side[0] || z > side[1]) continue;
      const zc = (side[0] + side[1]) / 2;
      const rz = Math.max(0.5, (side[1] - side[0]) / 2);
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * v;
        const run = runs.find(([a, c]) => x >= a && x <= c + 1);
        if (!run) continue;
        const xc = (run[0] + run[1] + 1) / 2;
        const rx = Math.max(0.5, (run[1] + 1 - run[0]) / 2);
        // Ellipse of the row; the squared radius is a little generous so thin crowns stay whole.
        if (((x - xc) / rx) ** 2 + ((z - zc) / rz) ** 2 > 1.15) continue;
        occ[(k * ny + j) * nx + i] = 1;
        total++;
      }
    }
  if (!total) return [];
  const room = clearance(occ, dims);
  const covered = new Uint8Array(occ.length);
  let left = total;
  const lobes: Lobe[] = [];
  const maxR = CLUMP_MAX * longest;
  const minR = CLUMP_MIN * longest;
  while (lobes.length < CLUMPS_MAX && left > UNCOVERED_STOP * total) {
    let best = -1;
    let bestRoom = 0;
    for (let i = 0; i < occ.length; i++)
      if (occ[i] && !covered[i] && room[i]! > bestRoom) [best, bestRoom] = [i, room[i]!];
    if (best < 0) break;
    const r = Math.min(maxR, Math.max(minR, bestRoom * v * CLUMP_GROW));
    const [ci, cj, ck] = [best % nx, Math.floor(best / nx) % ny, Math.floor(best / (nx * ny))];
    lobes.push({
      c: [(ci + 0.5) * v, top + (cj + 0.5) * v, (ck + 0.5) * v],
      r: [r, r, r],
    });
    // Cover what the clump holds (a sphere a little smaller than itself, so neighbours still fill the creases).
    const cover = (r * 0.8) / v;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const idx = (k * ny + j) * nx + i;
          if (!occ[idx] || covered[idx]) continue;
          if (Math.hypot(i - ci, j - cj, k - ck) <= cover) {
            covered[idx] = 1;
            left--;
          }
        }
    // The centre itself stays covered even when the clump is tiny.
    if (!covered[best]) {
      covered[best] = 1;
      left--;
    }
  }
  return lobes.sort((a, b) => a.c[1] - b.c[1] || a.c[0] - b.c[0] || a.c[2] - b.c[2]);
}
