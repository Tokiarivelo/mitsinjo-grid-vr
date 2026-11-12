import type { SdfBlob } from './object-shape';
import { SDF_EDGE_TABLE, SDF_TRI_TABLE } from './sdf-tables';
import { sdfNormal, sdfUnion } from './sdf-field';

/**
 * Marching-cubes mesh of an `sdf` part (§8, PQ-T53). Pure TS, no three.js: the viewer wraps
 * the positions into a BufferGeometry. Same bytes on every platform (no `Math.random`).
 */

/** Target grid (§8: fixed resolution — the §12.10 gate measured 12³ too coarse, 32³ over budget). */
export const SDF_GRID = 24;
/**
 * Most triangles one SDF part may mesh to. Smooth bodies stay at 24³ under it (measured:
 * person-like 1492, bottle 1520, single ball 2648); adversarial unions degrade down the
 * ladder instead of blowing the object budget. The floor always fits: 8³ = 512 cells ×
 * ≤ 5 triangles per cell (16 table entries, −1 terminated) = 2560 < 3000, proven.
 */
export const SDF_PART_TRIANGLES_MAX = 3000;
/** Coarsening ladder (§8's "24³ ou une décimation", deterministic: same blobs, same mesh). */
const SDF_LADDER = [24, 16, 12, 8] as const;

export interface SdfMesh {
  /** Non-indexed triangle soup in unit space (the viewer's merge convention). */
  positions: Float32Array;
  /** Smooth outward normals from the field gradient (one per vertex). */
  normals: Float32Array;
  triangles: number;
  /** Grid the mesh was extracted at (24 unless the budget ladder stepped in). */
  grid: number;
}

/** Corner offsets in the tables' numbering (see `sdf-tables.ts`). */
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
] as const;
/** Bit each corner sets when its field is below the isolevel. */
const BITS = [1, 2, 8, 4, 16, 32, 128, 64];
/** Corner pairs each edge joins. */
const EDGES = [
  [0, 1],
  [1, 3],
  [2, 3],
  [0, 2],
  [4, 5],
  [5, 7],
  [6, 7],
  [4, 6],
  [0, 4],
  [1, 5],
  [3, 7],
  [2, 6],
] as const;

const emptyMesh = (grid: number): SdfMesh => ({
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  triangles: 0,
  grid,
});

/** Attach smooth gradient normals to meshed positions (once, for the kept mesh only). */
function withNormals(
  blobs: ReadonlyArray<SdfBlob>,
  positions: Float32Array,
  grid: number
): SdfMesh {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const [nx, ny, nz] = sdfNormal(blobs, [positions[i]!, positions[i + 1]!, positions[i + 2]!]);
    normals[i] = nx;
    normals[i + 1] = ny;
    normals[i + 2] = nz;
  }
  return { positions, normals, triangles: positions.length / 9, grid };
}

/** Positions at one grid (no budget check, no normals: the ladder counts first). */
function meshPositionsAt(blobs: ReadonlyArray<SdfBlob>, grid: number): Float32Array {
  if (!blobs.length) return new Float32Array(0);
  const n = grid + 1;
  const cell = 1 / grid;
  const field = new Float64Array(n * n * n);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        field[(z * n + y) * n + x] = sdfUnion(blobs, [
          -0.5 + x * cell,
          -0.5 + y * cell,
          -0.5 + z * cell,
        ]);
  const at = (x: number, y: number, z: number): number => field[(z * n + y) * n + x]!;
  const pos: number[] = [];
  const v = new Array<number>(8);
  const ev: Array<[number, number, number] | undefined> = new Array(12);
  for (let z = 0; z < grid; z++)
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) {
        let cube = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNERS[c]!;
          v[c] = at(x + o[0], y + o[1], z + o[2]);
          if (v[c]! < 0) cube |= BITS[c]!;
        }
        if (cube === 0 || cube === 255 || SDF_EDGE_TABLE[cube] === 0) continue;
        const bits = SDF_EDGE_TABLE[cube]!;
        for (let e = 0; e < 12; e++) {
          if (!(bits & (1 << e))) continue;
          const [c0, c1] = EDGES[e]!;
          const v0 = v[c0]!;
          const t = (0 - v0) / (v[c1]! - v0);
          const a = CORNERS[c0]!;
          const b = CORNERS[c1]!;
          ev[e] = [
            -0.5 + (x + a[0] + (b[0] - a[0]) * t) * cell,
            -0.5 + (y + a[1] + (b[1] - a[1]) * t) * cell,
            -0.5 + (z + a[2] + (b[2] - a[2]) * t) * cell,
          ];
        }
        const row = cube * 16;
        for (let i = 0; i < 16; i += 3) {
          const e0 = SDF_TRI_TABLE[row + i];
          if (e0 === -1 || e0 === undefined) break;
          const p0 = ev[e0]!;
          const p1 = ev[SDF_TRI_TABLE[row + i + 1]!]!;
          const p2 = ev[SDF_TRI_TABLE[row + i + 2]!]!;
          pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
        }
      }
  return new Float32Array(pos);
}

/**
 * Mesh of the union at the finest grid within the per-part budget (24³ for smooth bodies;
 * adversarial unions step down the ladder, 8³ always fits). Normals are computed once,
 * for the kept mesh: a discarded ladder step costs positions only. Deterministic.
 */
export function meshSdf(blobs: ReadonlyArray<SdfBlob>): SdfMesh {
  let kept: Float32Array = new Float32Array(0);
  let keptGrid = SDF_LADDER[SDF_LADDER.length - 1]!;
  for (const grid of SDF_LADDER) {
    const positions = meshPositionsAt(blobs, grid);
    if (positions.length === 0) continue;
    kept = positions;
    keptGrid = grid;
    if (positions.length / 9 <= SDF_PART_TRIANGLES_MAX) break;
  }
  if (kept.length === 0) return emptyMesh(keptGrid);
  return withNormals(blobs, kept, keptGrid);
}
