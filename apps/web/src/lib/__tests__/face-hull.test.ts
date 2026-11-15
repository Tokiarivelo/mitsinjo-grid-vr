import { describe, expect, it } from 'vitest';
import { FACE_ATLAS_COLS, FACE_ATLAS_ROWS, atlasUv, faceSlot } from '../face-atlas';
import {
  HULL_SURFACES,
  dropGhosts,
  planContrast,
  roofRows,
  clipFootprint,
  eaveRow,
  hullMesh,
  hullRows,
  maskRuns,
  pitchRoof,
  roofSection,
  silhouetteHull,
  stackRows,
  type RowRect,
} from '../face-hull';

/** A mask from rows of text: `#` = object. */
const mask = (lines: string[]) => ({
  cols: lines[0]!.length,
  rows: lines.length,
  mask: Uint8Array.from(lines.join(''), (c) => (c === '#' ? 1 : 0)),
});

describe('face atlas', () => {
  it('keeps every view inside its own tile', () => {
    for (const view of ['front', 'right', 'back', 'left'] as const) {
      const slot = faceSlot(view);
      const [col, row] = [slot % FACE_ATLAS_COLS, Math.floor(slot / FACE_ATLAS_COLS)];
      for (const [s, t] of [
        [0, 0],
        [1, 1],
        [0.5, 0.5],
      ] as const) {
        const [u, v] = atlasUv(slot, s, t);
        expect(u).toBeGreaterThan(col / FACE_ATLAS_COLS);
        expect(u).toBeLessThan((col + 1) / FACE_ATLAS_COLS);
        // v runs up: the first tile row is the top of the image.
        expect(1 - v).toBeGreaterThan(row / FACE_ATLAS_ROWS);
        expect(1 - v).toBeLessThan((row + 1) / FACE_ATLAS_ROWS);
      }
    }
  });
});

describe('silhouette hull', () => {
  it('reads runs and drops strokes', () => {
    const m = mask(['.##..#.###']);
    expect(maskRuns(m.mask, m.cols, 0)).toEqual([
      [1, 3],
      [7, 10],
    ]);
  });

  it('turns a gable seen from the side into a narrowing stack', () => {
    // Front: a full rectangle. Side: a triangle on a wall.
    const front = mask(['######', '######', '######', '######']);
    const side = mask(['..##..', '.####.', '######', '######']);
    const hull = silhouetteHull(front, side);
    expect(hull.grid).toEqual([6, 4, 6]);
    expect(hull.boxes).toEqual([
      [0, 6, 0, 1, 2, 4],
      [0, 6, 1, 2, 1, 5],
      [0, 6, 2, 4, 0, 6],
    ]);
  });

  it('keeps legs apart: every front run crossed with every side run', () => {
    const front = mask(['######', '##..##']);
    const side = mask(['####', '#..#'].map((l) => l.replace(/#\.\.#/, '##..##').padEnd(6, '#')));
    const rows = hullRows(front, side);
    expect(rows[1]).toHaveLength(4);
  });

  it('cuts a block roof to the inferred hip and keeps what stands above it', () => {
    // 8 wide, 8 deep: rows 0–1 a chimney, rows 2–5 a block roof, rows 6–7 walls.
    const full: RowRect = [0, 8, 0, 8];
    const chimney: RowRect = [1, 3, 5, 7];
    const rows: RowRect[][] = [
      [chimney],
      [chimney],
      [full],
      [full],
      [full],
      [full],
      [full],
      [full],
    ];
    const cut = pitchRoof(rows, [{ shape: 'hip', box: [0, 8, 2, 6, 0, 8], ridge: 0.5 }]);
    // The roof narrows upward in depth, the walls are untouched.
    const depth = (y: number) => Math.max(...cut[y]!.map((r) => r[3] - r[2]));
    expect(depth(2)).toBeLessThan(depth(5));
    expect(cut[6]).toEqual([full]);
    // The chimney runs down through the roof rows.
    expect(cut[2]!.some((r) => r.join() === chimney.join())).toBe(true);
    expect(stackRows(cut, 8, 8).boxes.length).toBeGreaterThan(3);
  });

  it('leaves a roof that already narrows as drawn', () => {
    const rows: RowRect[][] = [
      [[0, 8, 3, 5]],
      [[0, 8, 2, 6]],
      [[0, 8, 1, 7]],
      [[0, 8, 0, 8]],
      [[0, 8, 0, 8]],
    ];
    expect(pitchRoof(rows, [{ shape: 'hip', box: [0, 8, 0, 4, 0, 8], ridge: 0.5 }])).toEqual(rows);
  });

  it('ends the roof at the eave of the silhouettes, not at the foot of its colour class', () => {
    // Brick walls under clay tiles read as one class: the hip is given the whole height.
    const full: RowRect = [0, 12, 0, 12];
    const rows: RowRect[][] = [
      [[5, 7, 5, 7]],
      [[4, 8, 4, 8]],
      [[3, 9, 3, 9]],
      [[2, 10, 2, 10]],
      [[1, 11, 1, 11]],
      [full],
      [full],
      [full],
      [full],
      [full],
    ];
    expect(eaveRow(rows, 0, 10)).toBe(5);
    // The walls stay straight: nothing under the eave is cut.
    const cut = pitchRoof(rows, [{ shape: 'hip', box: [0, 12, 0, 10, 0, 12], ridge: 0.5 }]);
    expect(cut.slice(5)).toEqual(rows.slice(5));
    // A block from its first row says nothing: the class decides.
    expect(eaveRow([[full], [full], [full]], 0, 3)).toBe(3);
  });

  it('cuts the rows to an L-shaped footprint and ignores a plan that covers too little', () => {
    const rows: RowRect[][] = [[[0, 6, 0, 6]]];
    // Row 0 = back. The back right quarter is empty.
    const plan = mask(['###...', '###...', '###...', '######', '######', '######']);
    const cut = clipFootprint(rows, plan)[0]!;
    const cells = cut.reduce((t, r) => t + (r[1] - r[0]) * (r[3] - r[2]), 0);
    expect(cells).toBe(27);
    expect(cut.some((r) => r[1] > 3 && r[2] < 3)).toBe(false);
    const speck = mask(['##....', '##....', '......', '......', '......', '......']);
    expect(clipFootprint(rows, speck)).toEqual(rows);
  });

  it('closes a gable toward its apex', () => {
    const gable = { shape: 'prism' as const, box: [0, 10, 0, 10, 0, 4] as const, apex: 0.5 };
    const low = roofSection(gable, 9)!;
    const high = roofSection(gable, 2)!;
    expect(low[1] - low[0]).toBeGreaterThan(high[1] - high[0]);
    expect(roofSection(gable, 10)).toBeNull();
  });
});

describe('hull mesh', () => {
  const hull = { grid: [4, 4, 4] as const, boxes: [[0, 4, 0, 4, 0, 4] as const] };

  it('is a closed box of 12 triangles inside the object box', () => {
    const m = hullMesh(hull, [1, 0.5, 0.25], ['front', 'right', 'back', 'left']);
    expect(m.position.length).toBe(12 * 3 * 3);
    expect(Math.max(...m.position)).toBeCloseTo(0.5);
    for (let i = 0; i < m.position.length; i += 3) {
      expect(Math.abs(m.position[i + 1]!)).toBeLessThanOrEqual(0.25 + 1e-6);
      expect(Math.abs(m.position[i + 2]!)).toBeLessThanOrEqual(0.125 + 1e-6);
    }
  });

  it('reads each wall on the drawing that faces it, the opposite one when it is missing', () => {
    const tileOf = (u: number) => Math.floor(u * FACE_ATLAS_COLS);
    const all = hullMesh(hull, [1, 1, 1], ['front', 'right', 'back', 'left']);
    const two = hullMesh(hull, [1, 1, 1], ['front', 'right']);
    // Walls come first: front, back, right, left, 6 vertices each.
    const wallTile = (m: typeof all, wall: number) => {
      const u = m.uv[wall * 12]!;
      const v = m.uv[wall * 12 + 1]!;
      return tileOf(u) + (1 - v > 1 / FACE_ATLAS_ROWS ? FACE_ATLAS_COLS : 0);
    };
    expect([0, 1, 2, 3].map((w) => wallTile(all, w))).toEqual(
      (['front', 'back', 'right', 'left'] as const).map(faceSlot)
    );
    expect(wallTile(two, 1)).toBe(faceSlot('front'));
    expect(wallTile(two, 3)).toBe(faceSlot('right'));
  });

  it('reads what faces the sky on the view from above when it is in the atlas', () => {
    const uvOfTop = (views: Parameters<typeof hullMesh>[2]) => {
      const m = hullMesh(hull, [1, 1, 1], views);
      const out: number[] = [];
      for (let i = 0; i < m.normal.length / 3; i++)
        if (m.normal[i * 3 + 1] === 1) out.push(m.uv[i * 2]!, m.uv[i * 2 + 1]!);
      return out;
    };
    const [u0, v0] = atlasUv(faceSlot('top'), 0, 0);
    const [u1, v1] = atlasUv(faceSlot('top'), 1, 1);
    const withTop = uvOfTop(['front', 'right', 'top']);
    for (let i = 0; i < withTop.length; i += 2) {
      expect(withTop[i]!).toBeGreaterThanOrEqual(Math.min(u0, u1) - 1e-6);
      expect(withTop[i]!).toBeLessThanOrEqual(Math.max(u0, u1) + 1e-6);
      expect(withTop[i + 1]!).toBeGreaterThanOrEqual(Math.min(v0, v1) - 1e-6);
      expect(withTop[i + 1]!).toBeLessThanOrEqual(Math.max(v0, v1) + 1e-6);
    }
    expect(uvOfTop(['front', 'right'])).not.toEqual(withTop);
  });

  it('covers only the step a smaller box leaves on a larger one', () => {
    const stepped = {
      grid: [4, 4, 4] as const,
      boxes: [[0, 4, 0, 2, 0, 2] as const, [0, 4, 2, 4, 0, 4] as const],
    };
    const m = hullMesh(stepped, [1, 1, 1], ['front']);
    // 2 boxes × 4 walls + top of the small one + the front step + 2 undersides... the small box's
    // underside and the covered half of the large top are not drawn.
    const quads = m.position.length / 18;
    expect(quads).toBe(8 + 1 + 1 + 1);
  });
});

describe('ghost crossings (PQ-T71)', () => {
  // Two chimneys on each elevation: four crossings above a 12 × 12 body, two of them real.
  const body: RowRect = [0, 12, 0, 12];
  const crossings: RowRect[] = [
    [1, 3, 1, 3],
    [1, 3, 8, 10],
    [8, 10, 1, 3],
    [8, 10, 8, 10],
  ];
  const rows: RowRect[][] = [crossings, crossings, [body], [body], [body]];
  // The plan: a plain roof with a chimney at the back left and one at the front right.
  const plan = (() => {
    const rgb = new Uint8Array(12 * 12 * 3).fill(150);
    for (const [x0, x1, z0, z1] of [crossings[0]!, crossings[3]!])
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) rgb.fill(30, (z * 12 + x) * 3, (z * 12 + x) * 3 + 3);
    return { rgb, cols: 12, rows: 12 };
  })();

  it('reads a chimney on the plan as a contrast with what surrounds it', () => {
    expect(planContrast(plan, crossings[0]!)).toBeGreaterThan(100);
    expect(planContrast(plan, crossings[1]!)).toBe(0);
  });

  it('keeps the crossings the plan shows and leaves the body alone', () => {
    const kept = dropGhosts(rows, (r) => planContrast(plan, r));
    expect(kept[0]).toEqual([crossings[0], crossings[3]]);
    expect(kept[2]).toEqual([body]);
  });

  it('never loses a run of an elevation: a blank plan keeps one crossing per run', () => {
    const kept = dropGhosts(rows, () => 0)[0]!;
    expect(new Set(kept.map((r) => r[0])).size).toBe(2);
    expect(new Set(kept.map((r) => r[2])).size).toBe(2);
  });

  it('leaves a single row of chimneys (one side run) as drawn', () => {
    const line: RowRect[] = [
      [1, 3, 4, 6],
      [8, 10, 4, 6],
    ];
    expect(dropGhosts([line, [body]], () => 0)[0]).toEqual(line);
  });
});

describe('hull surfaces (PQ-T71)', () => {
  // A pyramid roof of four one-row steps on a wall box four rows high.
  const hull = {
    grid: [8, 8, 8] as const,
    boxes: [
      [3, 5, 0, 1, 3, 5],
      [2, 6, 1, 2, 2, 6],
      [1, 7, 2, 3, 1, 7],
      [0, 8, 3, 8, 0, 8],
    ] as const,
  };

  it('tells the rows that slope from the rows of a wall', () => {
    expect([...roofRows(hull)]).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);
  });

  it('gives every triangle a surface: steps and tops to the roof, walls to their side', () => {
    const m = hullMesh(hull, [1, 1, 1], ['front', 'right', 'back', 'left']);
    expect(m.surface.length).toBe(m.position.length / 9);
    const names = new Set([...m.surface].map((i) => HULL_SURFACES[i]));
    expect(names).toEqual(new Set(HULL_SURFACES));
    for (let t = 0; t < m.surface.length; t++) {
      const [ny, y] = [m.normal[t * 9 + 1]!, m.position[t * 9 + 1]!];
      // What faces the sky is roof; a wall triangle never rises above the wall box.
      if (ny === 1) expect(HULL_SURFACES[m.surface[t]!]).toBe('roof');
      else if (HULL_SURFACES[m.surface[t]!] !== 'roof' && ny === 0)
        expect(y).toBeLessThanOrEqual(0.125 + 1e-6);
    }
  });
});
