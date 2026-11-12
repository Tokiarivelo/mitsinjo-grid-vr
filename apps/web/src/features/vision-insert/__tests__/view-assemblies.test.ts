import { describe, expect, it } from 'vitest';
import type { RecipePart } from '@/lib/object-shape';
import { DETAIL_KINDS } from '@/lib/object-shape';
import {
  DETAIL_DARK,
  DETAIL_METAL,
  CELL_LINE_COLOR,
  detailPartsOf,
  outlineDetails,
  RIM_COLOR,
  RIM_DIAMETER,
  expandViewAssemblies,
} from '../utils/view-assemblies';

const wheel: RecipePart = {
  shape: 'cylinder',
  axis: 'x',
  at: [0.4, -0.35, 0.3],
  size: [0.1, 0.3, 0.3],
  color: '#1d1d1f',
  material: 'rubber',
  kind: 'wheel',
  rim: true,
};
const cells: RecipePart = {
  shape: 'hull',
  at: [0, 0, 0],
  size: [1, 1, 1],
  points: [
    [-0.4, -0.2],
    [0.4, -0.2],
    [0.4, 0.3],
    [-0.4, 0.3],
  ],
  // Tilted face: z falls as y rises.
  section: [
    [0.1, -0.2],
    [0.11, -0.2],
    [0.01, 0.3],
    [0, 0.3],
  ],
  color: '#1f3550',
  material: 'glass',
  kind: 'cell',
  grid: [4, 2],
};

describe('view assemblies (PG-T21)', () => {
  it('puts a metal rim on the outer face of a wheel', () => {
    const [tyre, rim, ...rest] = expandViewAssemblies([wheel]);
    expect(tyre).toBe(wheel);
    expect(rest).toHaveLength(0);
    expect(rim!.color).toBe(RIM_COLOR);
    expect(rim!.material).toBe('metal');
    expect(rim!.size[1]).toBeCloseTo(0.3 * RIM_DIAMETER, 9);
    // Outer side (+x for a right wheel), within the tyre's outer half.
    expect(rim!.at[0]).toBeGreaterThan(wheel.at[0]);
    expect(rim!.at[0] + rim!.size[0] / 2).toBeLessThanOrEqual(wheel.at[0] + 0.06);
    const left = expandViewAssemblies([{ ...wheel, at: [-0.4, -0.35, 0.3] }])[1]!;
    expect(left.at[0]).toBeLessThan(-0.4);
  });

  it('a wheel without `rim`, or an axis-y cylinder, stays as it is', () => {
    expect(expandViewAssemblies([{ ...wheel, rim: undefined }])).toHaveLength(1);
    expect(expandViewAssemblies([{ ...wheel, axis: undefined }])).toHaveLength(1);
  });

  it('draws cols − 1 + rows − 1 cell lines, columns following the tilt, at full detail only', () => {
    const out = expandViewAssemblies([cells]);
    expect(out).toHaveLength(1 + 3 + 1);
    const lines = out.slice(1);
    expect(lines.every((l) => l.color === CELL_LINE_COLOR)).toBe(true);
    const columns = lines.filter((l) => l.shape === 'hull');
    expect(columns).toHaveLength(3);
    // Same tilt as the patch, lifted off it.
    expect(columns[0]!.section![0]![0]).toBeGreaterThan(cells.section![0]![0]);
    const row = lines.find((l) => l.shape === 'box')!;
    expect(row.at[1]).toBeCloseTo(0.05, 9);
    expect(row.at[2]).toBeGreaterThan(0.05);
    expect(expandViewAssemblies([cells], 'low')).toHaveLength(1);
  });
});

const body: RecipePart = {
  shape: 'box',
  at: [0, 0, 0],
  size: [0.5, 1, 0.5],
  color: '#ffffff',
  front: true,
  kind: 'body',
};
const car: RecipePart = {
  shape: 'box',
  at: [0, 0, 0],
  size: [0.4, 0.3, 1],
  color: '#aa2222',
  kind: 'body',
};

describe('detail kinds (PQ-T20)', () => {
  const front = (p: RecipePart) => p.at[2] - p.size[2] / 2;

  it('a fridge body with handle and seam gets a metal bar and a dark door line on its front face', () => {
    const out = expandViewAssemblies([{ ...body, details: ['handle', 'seam'] }]);
    expect(out).toHaveLength(3);
    const [, handle, seam] = out;
    expect(handle!.color).toBe(DETAIL_METAL);
    expect(handle!.size[1]).toBeGreaterThan(handle!.size[0]);
    expect(handle!.at[2]).toBeGreaterThan(0.25);
    expect(seam!.color).toBe(DETAIL_DARK);
    // A tall host: the door line runs across.
    expect(seam!.size[0]).toBeGreaterThan(seam!.size[1] * 10);
    expect(front(seam!)).toBeLessThan(0.26);
  });

  it('a car body with mirrors gets one on each side, forward of the middle', () => {
    const out = detailPartsOf({ ...car, details: ['mirror'] });
    expect(out).toHaveLength(2);
    expect(out.map((m) => Math.sign(m.at[0])).sort()).toEqual([-1, 1]);
    expect(out.every((m) => m.at[2] > 0)).toBe(true);
    expect(out.every((m) => Math.abs(m.at[0]) > 0.2)).toBe(true);
  });

  it('a wheel arch is a dark disc behind the tyre, a rim as a detail equals `rim: true`', () => {
    const arch = detailPartsOf({ ...wheel, rim: undefined, details: ['arch'] });
    expect(arch).toHaveLength(1);
    expect(arch[0]!.color).toBe(DETAIL_DARK);
    expect(arch[0]!.size[1]).toBeGreaterThan(wheel.size[1]);
    expect(arch[0]!.axis).toBe('x');
    // Larger than the tyre, yet never lower: its bottom is the tyre's (before: it dipped under the ground).
    expect(arch[0]!.at[1] - arch[0]!.size[1] / 2).toBeCloseTo(wheel.at[1] - wheel.size[1] / 2, 6);
    const viaDetail = expandViewAssemblies([{ ...wheel, rim: undefined, details: ['rim'] }]);
    const viaFlag = expandViewAssemblies([wheel]);
    expect(viaDetail.map((p) => p.color)).toEqual(viaFlag.map((p) => p.color));
  });

  it('feet go under the body, a gutter along both eaves, a vent on the front', () => {
    const feet = detailPartsOf({ ...body, details: ['foot'] });
    expect(feet).toHaveLength(4);
    expect(feet.every((f) => f.at[1] < -0.5)).toBe(true);
    const roof: RecipePart = { ...body, shape: 'prism', kind: 'roof', details: ['gutter'] };
    expect(detailPartsOf(roof)).toHaveLength(2);
    expect(detailPartsOf({ ...body, details: ['vent'] })).toHaveLength(1);
  });

  it('details are dropped at low detail, and a kind on a part that cannot carry it adds nothing', () => {
    const all = { ...body, details: [...DETAIL_KINDS] };
    expect(expandViewAssemblies([all], 'low')).toHaveLength(1);
    expect(detailPartsOf({ ...body, details: ['arch', 'rim'] })).toHaveLength(0);
  });

  it('only the details that change the outline count for the silhouette fit', () => {
    const out = outlineDetails([{ ...car, details: ['handle', 'mirror', 'foot'] }]);
    expect(out).toHaveLength(2 + 4);
  });
});

describe('detail kinds (PQ-T48 §7.2)', () => {
  const roof: RecipePart = { ...body, shape: 'prism', kind: 'roof' };

  it('a hull with glass, grille, bumpers and door lines gets all seven, placed by face', () => {
    const out = detailPartsOf({
      ...car,
      details: ['windscreen', 'rear_window', 'grille', 'bumper', 'door_line'],
    });
    expect(out).toHaveLength(1 + 1 + 1 + 2 + 2);
    expect(out.every((q) => q.color === DETAIL_DARK)).toBe(true);
    const [screen, rear, grille, bumpF, bumpB, lineL, lineR] = out;
    expect(screen!.at[1]).toBeGreaterThan(0);
    expect(screen!.at[2]).toBeGreaterThan(0.5);
    expect(rear!.at[2]).toBeLessThan(-0.5);
    expect(grille!.at[1]).toBeLessThan(0);
    expect(Math.sign(bumpF!.at[2])).toBe(1);
    expect(Math.sign(bumpB!.at[2])).toBe(-1);
    expect(bumpF!.at[1]).toBeLessThan(0);
    for (const line of [lineL!, lineR!]) {
      expect(line.size[1]).toBeGreaterThan(line.size[0] * 10);
      expect(line.at[2]).toBeGreaterThan(0.5);
    }
    expect(lineL!.at[0]).toBeLessThan(lineR!.at[0]);
  });

  it('a roof with fascia and ridge cap gets light eave boards and a dark cap on top', () => {
    const out = detailPartsOf({ ...roof, details: ['fascia', 'ridge_cap'] });
    expect(out).toHaveLength(3);
    const [fore, aft, cap] = out;
    expect(fore!.color).toBe(DETAIL_METAL);
    expect(aft!.color).toBe(DETAIL_METAL);
    expect(fore!.at[1]).toBeLessThan(0);
    expect(Math.sign(fore!.at[2])).toBe(1);
    expect(Math.sign(aft!.at[2])).toBe(-1);
    expect(cap!.at[1]).toBeCloseTo(0.49, 9);
    expect(cap!.at[1] + cap!.size[1] / 2).toBeGreaterThan(0.5);
  });

  it('a body with a reveal gets a shadow gap inside its front edges, a step a slab forward', () => {
    const gap = detailPartsOf({ ...body, details: ['reveal'] });
    expect(gap).toHaveLength(4);
    expect(gap.every((q) => q.color === DETAIL_DARK)).toBe(true);
    expect(gap.every((q) => q.at[2] > 0.25 && q.at[2] < 0.27)).toBe(true);
    expect(gap.every((q) => Math.abs(q.at[0]) < 0.25 && Math.abs(q.at[1]) < 0.5)).toBe(true);
    const [step] = detailPartsOf({ ...body, details: ['step'] });
    expect(step!.color).toBe(DETAIL_METAL);
    expect(step!.at[2]).toBeGreaterThan(0.25);
    expect(step!.at[1]).toBeCloseTo(-0.5, 9);
  });

  it('wheel_arch is arch under its §7.2 name: same disc, same guard', () => {
    const host = { ...wheel, rim: undefined };
    expect(detailPartsOf({ ...host, details: ['wheel_arch'] })).toEqual(
      detailPartsOf({ ...host, details: ['arch'] })
    );
    expect(detailPartsOf({ ...car, details: ['wheel_arch'] })).toHaveLength(0);
  });

  it('proud details count for the outline, flush glass and shut lines do not', () => {
    expect(
      outlineDetails([
        { ...car, details: ['windscreen', 'rear_window', 'grille', 'door_line', 'reveal'] },
      ])
    ).toHaveLength(0);
    expect(outlineDetails([{ ...car, details: ['bumper', 'step'] }])).toHaveLength(2 + 1);
    expect(outlineDetails([{ ...roof, details: ['fascia', 'ridge_cap'] }])).toHaveLength(2 + 1);
    expect(outlineDetails([{ ...wheel, rim: undefined, details: ['wheel_arch'] }])).toHaveLength(1);
  });
});
