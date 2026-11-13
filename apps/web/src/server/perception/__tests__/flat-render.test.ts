// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { frameColor } from '@/features/vision-insert/utils/openings';
import { cpuMs } from '@/test/cpu-time';
import { kitToRecipe } from '@/lib/object-kit';
import { type ObjectRecipe, type RecipePart } from '@/lib/object-shape';
import { hexToRgb } from '../color-measure';
import { FLAT_AMBIENT, FLAT_LIGHT, renderFlat, THREE_QUARTER } from '../flat-render';
import { SDF_BALL, SDF_PERSON, sdfPart } from '@/test/sdf-blobs';
import { iou, renderRecipe } from '../silhouette-fit';
import { GOLDEN_SHAPES } from '../__fixtures__/shape';

const part = (over: Partial<RecipePart>): RecipePart => ({
  shape: 'box',
  at: [0, 0, 0],
  size: [1, 1, 1],
  color: '#c08040',
  ...over,
});
const recipe = (parts: RecipePart[], yaw?: number): ObjectRecipe => ({
  proportions: { w: 1, h: 1, d: 1 },
  parts,
  yaw,
});
const pixel = (r: ReturnType<typeof renderFlat>, c: number, row: number, cols: number) => {
  const i = (row * cols + c) * 3;
  return [r.rgb[i]!, r.rgb[i + 1]!, r.rgb[i + 2]!];
};

/** Render budget per object, in CPU time (`cpuMs`: the other test files of the full suite do not count). */
const RENDER_BUDGET_MS = process.env.SHAPE_BUDGET_STRICT ? 100 : 500;

describe('renderFlat (PR-0.1)', () => {
  it('a box head-on renders its colour, shaded by its front face', () => {
    const r = renderFlat(recipe([part({})]), 1, 32, 32);
    const shade = FLAT_AMBIENT + (1 - FLAT_AMBIENT) * FLAT_LIGHT[2];
    expect(pixel(r, 16, 16, 32)).toEqual([0xc0, 0x80, 0x40].map((v) => Math.round(v * shade)));
    expect(r.mask.data.every((v) => v === 1)).toBe(true);
    expect(r.part[0]).toBe(0);
  });

  it('leaves the background empty around a smaller part', () => {
    const r = renderFlat(recipe([part({ size: [0.5, 0.5, 0.5] })]), 1, 32, 32);
    expect(r.mask.data[0]).toBe(0);
    expect(r.part[0]).toBe(-1);
    expect(pixel(r, 0, 0, 32)).toEqual([0, 0, 0]);
    expect(r.mask.data.reduce((s, v) => s + v, 0)).toBe(16 * 16);
  });

  it('the nearest part wins whatever the part order (z-buffer)', () => {
    const back = part({ size: [1, 1, 0.4], at: [0, 0, -0.3], color: '#ff0000' });
    const front = part({ size: [0.4, 0.4, 0.2], at: [0, 0, 0.3], color: '#0000ff' });
    for (const parts of [
      [back, front],
      [front, back],
    ]) {
      const r = renderFlat(recipe(parts), 1, 20, 20);
      const blue = pixel(r, 10, 10, 20);
      expect(blue[2]).toBeGreaterThan(0);
      expect(blue[0]).toBe(0);
    }
  });

  it('a turned box shows two faces with different light', () => {
    const r = renderFlat(recipe([part({})], 0.5), 1.4, 64, 32);
    const left = pixel(r, 20, 16, 64);
    const right = pixel(r, 44, 16, 64);
    expect(left[0]).not.toBe(right[0]);
  });

  it('round parts: a sphere is lit at its upper left, a cone narrows to its apex', () => {
    const s = renderFlat(recipe([part({ shape: 'sphere' })]), 1, 40, 40);
    expect(pixel(s, 14, 12, 40)[0]).toBeGreaterThan(pixel(s, 28, 30, 40)[0]!);
    expect(s.mask.data[0]).toBe(0); // corner outside the disc
    const c = renderFlat(recipe([part({ shape: 'cone' })]), 1, 40, 40);
    const rowWidth = (row: number) =>
      c.mask.data.slice(row * 40, row * 40 + 40).reduce((a, v) => a + v, 0);
    expect(rowWidth(36)).toBeGreaterThan(rowWidth(4));
  });

  it('a lying cylinder (axis x) is wider than tall', () => {
    const r = renderFlat(
      recipe([part({ shape: 'cylinder', axis: 'x', size: [1, 0.4, 0.4] })]),
      1,
      40,
      40
    );
    const cols = new Set<number>();
    const rows = new Set<number>();
    r.mask.data.forEach((v, i) => {
      if (v) {
        cols.add(i % 40);
        rows.add(Math.floor(i / 40));
      }
    });
    expect(cols.size).toBeGreaterThan(rows.size * 2);
  });

  it('a part flush with the body front shows whole (before: comb of body pixels on the car wheels)', () => {
    const body = part({ size: [1, 0.5, 1], at: [0, 0, 0] });
    const wheel = part({
      shape: 'cylinder',
      axis: 'z',
      size: [0.18, 0.34, 1],
      at: [-0.3, -0.25, 0],
    });
    const rec = { ...recipe([body, wheel], 0.0996), proportions: { w: 0.72, h: 0.33, d: 1 } };
    const flat = renderFlat(rec, 0.72 / 0.33, 128, 59);
    // Where the wheel overlaps the body, every pixel of a row's wheel span is the wheel.
    let rowsChecked = 0;
    for (let r = 0; r < 59; r++) {
      const row = Array.from(flat.part.slice(r * 128, r * 128 + 128));
      const first = row.indexOf(1);
      const last = row.lastIndexOf(1);
      if (first < 0 || !row.includes(0)) continue;
      rowsChecked++;
      expect(
        row.slice(first, last + 1).every((k) => k === 1),
        `row ${r}`
      ).toBe(true);
    }
    expect(rowsChecked).toBeGreaterThan(3);
  });

  it('matches the fit silhouette on the golden set, within budget', () => {
    for (const c of GOLDEN_SHAPES) {
      const rec = kitToRecipe(c.prior);
      const aspect = rec.proportions.w / rec.proportions.h;
      const t0 = cpuMs();
      const flat = renderFlat(rec, aspect, 128, Math.round(128 / aspect));
      const ms = cpuMs() - t0;
      const sil = renderRecipe(rec, aspect, 128, Math.round(128 / aspect));
      expect(iou(flat.mask, sil), c.name).toBeGreaterThan(0.95);
      expect(ms, c.name).toBeLessThan(RENDER_BUDGET_MS);
    }
  });
});

describe('hip roof (2D facade house)', () => {
  it('matches the fit silhouette head-on and turned, ridge 0 / 0.5 / 1', () => {
    for (const ridge of [0, 0.5, 1])
      for (const yaw of [0, 0.5]) {
        const rec = recipe([part({ shape: 'hip', ridge })], yaw);
        const flat = renderFlat(rec, 1, 96, 96);
        const sil = renderRecipe(rec, 1, 96, 96);
        expect(iou(flat.mask, sil), `ridge ${ridge} yaw ${yaw}`).toBeGreaterThan(0.95);
      }
  });

  it('half-hip (PG-T22): matches the fit silhouette; head-on the sides stand vertical up to the clip', () => {
    for (const yaw of [0, 0.5]) {
      const rec = recipe([part({ shape: 'hip', ridge: 0.6, clip: 0.5 })], yaw);
      expect(iou(renderFlat(rec, 1, 96, 96).mask, renderRecipe(rec, 1, 96, 96))).toBeGreaterThan(
        0.95
      );
    }
    const n = 100;
    const flat = renderFlat(recipe([part({ shape: 'hip', ridge: 0.6, clip: 0.5 })]), 1, n, n);
    const width = (row: number) => {
      let c = 0;
      for (let x = 0; x < n; x++) c += flat.mask.data[row * n + x]!;
      return c;
    };
    // Rows from the top: the hip above mid-height narrows, the gable below is full width.
    expect(width(Math.round(0.6 * n))).toBeGreaterThan(0.95 * n);
    expect(width(Math.round(0.3 * n))).toBeLessThan(0.95 * n);
    expect(width(Math.round(0.3 * n))).toBeGreaterThan(0.6 * n);
  });

  it('head-on it is a trapezoid: the top row as wide as the ridge', () => {
    const n = 100;
    const flat = renderFlat(recipe([part({ shape: 'hip', ridge: 0.5 })]), 1, n, n);
    const width = (row: number) => {
      let c = 0;
      for (let x = 0; x < n; x++) c += flat.mask.data[row * n + x]!;
      return c;
    };
    expect(width(n - 1)).toBeGreaterThan(0.95 * n);
    expect(width(2)).toBeGreaterThan(0.4 * n);
    expect(width(2)).toBeLessThan(0.6 * n);
  });
});

describe('extrude profile (PR-2.1)', () => {
  // Non-convex L: full-width bottom bar, left column up, empty top-right notch.
  const ell: [number, number][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0],
    [0, 0],
    [0, 0.5],
    [-0.5, 0.5],
  ];
  const lPart = (points: [number, number][]): RecipePart => part({ shape: 'extrude', points });
  const filled = (r: ReturnType<typeof renderFlat>) => r.mask.data.reduce((s, v) => s + v, 0);

  it('head-on renders the ring: bar + column, notch empty', () => {
    const r = renderFlat(recipe([lPart(ell)]), 1, 32, 32);
    // 16 full rows + 16 half rows on pixel centres.
    expect(filled(r)).toBe(16 * 32 + 16 * 16);
    expect(r.mask.data[8 * 32 + 24]).toBe(0);
    expect(r.mask.data[24 * 32 + 8]).toBe(1);
  });

  it('a square ring matches the box silhouette (flat renderer ignores the bevel)', () => {
    const square: [number, number][] = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ];
    const e = renderFlat(recipe([lPart(square)]), 1, 32, 32);
    const b = renderFlat(recipe([part({})]), 1, 32, 32);
    expect([...e.mask.data]).toEqual([...b.mask.data]);
  });

  it('either winding renders the same mask', () => {
    const a = renderFlat(recipe([lPart(ell)]), 1, 32, 32);
    const b = renderFlat(recipe([lPart([...ell].reverse())]), 1, 32, 32);
    expect([...a.mask.data]).toEqual([...b.mask.data]);
  });

  it('from ¾ the profile stays inside the box silhouette, notch visible', () => {
    for (const view of [undefined, THREE_QUARTER]) {
      const e = renderFlat(recipe([lPart(ell)]), 1, 48, 48, view);
      const b = renderFlat(recipe([part({})]), 1, 48, 48, view);
      expect(filled(e)).toBeGreaterThan(0);
      expect(filled(e)).toBeLessThan(filled(b));
      e.mask.data.forEach((v, i) => {
        if (v) expect(b.mask.data[i]).toBe(1);
      });
    }
  });
});

describe('lathe body (PR-2.3)', () => {
  const lathe = (profile: [number, number][]): RecipePart => part({ shape: 'lathe', profile });

  it('a tube profile matches the cylinder pixel for pixel', () => {
    const tube: [number, number][] = [
      [0.5, -0.5],
      [0.5, 0.5],
    ];
    for (const view of [undefined, THREE_QUARTER]) {
      const l = renderFlat(recipe([lathe(tube)]), 1, 40, 40, view);
      const c = renderFlat(recipe([part({ shape: 'cylinder' })]), 1, 40, 40, view);
      expect([...l.mask.data]).toEqual([...c.mask.data]);
      expect([...l.rgb]).toEqual([...c.rgb]);
    }
  });

  it('a cone profile matches the cone pixel for pixel', () => {
    const tip: [number, number][] = [
      [0.5, -0.5],
      [0, 0.5],
    ];
    const l = renderFlat(recipe([lathe(tip)]), 1, 40, 40);
    const c = renderFlat(recipe([part({ shape: 'cone' })]), 1, 40, 40);
    expect([...l.mask.data]).toEqual([...c.mask.data]);
    expect([...l.rgb]).toEqual([...c.rgb]);
  });

  it('a bowl stays inside the tube silhouette', () => {
    const bowl: [number, number][] = [
      [0, -0.5],
      [0.4, -0.5],
      [0.5, -0.2],
      [0.5, 0.5],
      [0, 0.5],
    ];
    const tube: [number, number][] = [
      [0.5, -0.5],
      [0.5, 0.5],
    ];
    const b = renderFlat(recipe([lathe(bowl)]), 1, 40, 40);
    const t = renderFlat(recipe([lathe(tube)]), 1, 40, 40);
    const filled = (r: ReturnType<typeof renderFlat>) => r.mask.data.reduce((s, v) => s + v, 0);
    expect(filled(b)).toBeGreaterThan(0);
    expect(filled(b)).toBeLessThan(filled(t));
    b.mask.data.forEach((v, i) => {
      if (v) expect(t.mask.data[i]).toBe(1);
    });
  });
});

describe('sdf union (PQ-T53 §8)', () => {
  const filled = (r: ReturnType<typeof renderFlat>) => r.mask.data.reduce((s, v) => s + v, 0);

  it('a ball renders its colour, lit, naming its part', () => {
    const r = renderFlat(recipe([sdfPart(SDF_BALL)]), 1, 40, 40);
    expect(filled(r)).toBeGreaterThan(0);
    expect(r.mask.data[0]).toBe(0); // corner outside the disc
    const c = pixel(r, 20, 20, 40);
    expect(c[0]).toBeGreaterThan(0);
    expect(r.part[20 * 40 + 20]).toBe(0);
  });

  it('the ball mask is symmetric: mirrored halves match (shading follows the light)', () => {
    const r = renderFlat(recipe([sdfPart(SDF_BALL)]), 1, 40, 40);
    for (let row = 0; row < 40; row++)
      for (let c = 0; c < 20; c++)
        expect(r.mask.data[row * 40 + c]).toBe(r.mask.data[row * 40 + 39 - c]);
    // Lit upper-left like the analytic sphere: brighter there than lower-right.
    expect(pixel(r, 14, 12, 40)[0]).toBeGreaterThan(pixel(r, 28, 30, 40)[0]!);
  });

  it('a fused pair fills its neck: more pixels than the hard pair', () => {
    const pair = (k: number) =>
      sdfPart([
        { kind: 'sphere', c: [-0.2, 0, 0], r: 0.2 },
        { kind: 'sphere', c: [0.2, 0, 0], r: 0.2, k },
      ]);
    const hard = renderFlat(recipe([pair(0)]), 1, 64, 64);
    const soft = renderFlat(recipe([pair(0.1)]), 1, 64, 64);
    expect(filled(hard)).toBeGreaterThan(0);
    expect(filled(soft)).toBeGreaterThan(filled(hard));
  });

  it('judge and fit read one surface: flat mask matches the fit hull (IoU)', () => {
    const flat = renderFlat(recipe([sdfPart(SDF_BALL)]), 1, 64, 64);
    const hull = renderRecipe(recipe([sdfPart(SDF_BALL)]), 1, 64, 64);
    expect(iou(flat.mask, hull)).toBeGreaterThan(0.95);
  });

  it('a person-like union renders connected pixels for its part', () => {
    const r = renderFlat(recipe([sdfPart(SDF_PERSON)]), 1, 64, 64);
    expect(filled(r)).toBeGreaterThan(100);
    let named = 0;
    r.part.forEach((v) => {
      if (v === 0) named++;
    });
    expect(named).toBe(filled(r));
  });
});

describe('ray entry through a ring edge (PV-H regression)', () => {
  const square: [number, number][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const filled = (r: ReturnType<typeof renderFlat>) => r.mask.data.reduce((s, v) => s + v, 0);

  it('an extrusion seen from the side is drawn (it rendered empty before)', () => {
    const side = renderFlat(recipe([part({ shape: 'extrude', points: square })]), 1, 20, 20, {
      yaw: -Math.PI / 2,
      pitch: 0,
    });
    expect(filled(side)).toBeGreaterThan(0.6 * 400);
  });

  it('a hull of two squares draws like a box from the front and the side', () => {
    const hull = part({ shape: 'hull', points: square, section: square });
    for (const yaw of [0, -Math.PI / 2]) {
      const view = { yaw, pitch: 0 };
      const h = renderFlat(recipe([hull]), 1, 20, 20, view);
      const b = renderFlat(recipe([part({})]), 1, 20, 20, view);
      expect(iou(h.mask, b.mask)).toBeGreaterThan(0.95);
    }
  });
});

describe('assembly details (PQ-T3): the judge sees what the viewer shows', () => {
  const WALL = part({
    at: [0, 0, 0],
    size: [1, 1, 0.4],
    color: '#e6dccb',
    material: 'plaster',
    kind: 'wall',
  });
  const GLASS = '#8fa3b5';
  const window = part({
    at: [0, 0.1, 0.2 + 0.01],
    size: [0.4, 0.4, 0.02],
    color: GLASS,
    material: 'glass',
    kind: 'window',
    grid: [1, 1],
    sill: false,
  });
  const N = 96;
  const hexAt = (r: ReturnType<typeof renderFlat>, c: number, row: number) =>
    pixel(r, c, row, N).map((v) => v.toString(16).padStart(2, '0'));

  it('a framed window renders frame pixels around glass pixels, all counted for the window', () => {
    const r = renderFlat(recipe([WALL, window]), 1, N, N);
    const frame = hexToRgb(frameColor(WALL.color));
    const glass = hexToRgb(GLASS);
    const kindOf = (c: number, row: number) => {
      const [R, G, B] = pixel(r, c, row, N);
      // Shaded colours keep the channel ratios: compare normalised.
      const near = (t: [number, number, number]) =>
        Math.abs(R! * t[1] - G! * t[0]) + Math.abs(G! * t[2] - B! * t[1]) < 0.06 * 255 * 255;
      return near(glass) ? 'glass' : near(frame) ? 'frame' : 'other';
    };
    // Window spans x 0.3–0.7, y (top) 0.2–0.6 of the grid.
    const midRow = Math.round(0.4 * N);
    const midCol = Math.round(0.5 * N);
    expect(kindOf(midCol, midRow), hexAt(r, midCol, midRow).join('')).toBe('glass');
    expect(kindOf(Math.round(0.305 * N), midRow)).toBe('frame'); // left stile
    expect(kindOf(Math.floor(0.69 * N), midRow)).toBe('frame'); // right stile
    expect(kindOf(midCol, Math.round(0.205 * N))).toBe('frame'); // head
    expect(kindOf(midCol, Math.round(0.595 * N))).toBe('frame'); // bottom rail
    // Glass and frame both count for the window part (index 1), the wall around stays part 0.
    expect(r.part[midRow * N + Math.round(0.305 * N)]).toBe(1);
    expect(r.part[midRow * N + midCol]).toBe(1);
    expect(r.part[midRow * N + Math.round(0.1 * N)]).toBe(0);
    expect(r.colors).toEqual([WALL.color, GLASS]);
  });

  it('a chimney cap is drawn but never rescales a framed view', () => {
    const chimney = part({ at: [0.3, 0.6, 0], size: [0.1, 0.2, 0.1], kind: 'chimney' });
    const plain = renderFlat(recipe([WALL, chimney]), 1, N, N, THREE_QUARTER);
    const capped = renderFlat(recipe([WALL, { ...chimney, cap: true }]), 1, N, N, THREE_QUARTER);
    const wallPixels = (r: ReturnType<typeof renderFlat>) => r.part.filter((k) => k === 0).length;
    expect(wallPixels(capped)).toBe(wallPixels(plain));
    expect(capped.part.filter((k) => k === 1).length).toBeGreaterThan(
      plain.part.filter((k) => k === 1).length
    );
  });

  it('a handle detail is drawn on the front face (PQ-T20)', () => {
    const body = part({ size: [0.6, 1, 0.5], front: true, kind: 'body' });
    const plain = renderFlat(recipe([body]), 1, N, N);
    const detailed = renderFlat(recipe([{ ...body, details: ['handle'] }]), 1, N, N);
    const diff = detailed.rgb.reduce((n, v, i) => n + (v !== plain.rgb[i] ? 1 : 0), 0);
    expect(diff).toBeGreaterThan(0);
    // The silhouette is the same: a handle is flush with the face, not beyond the body.
    expect(detailed.mask.data.reduce((a, b) => a + b, 0)).toBe(
      plain.mask.data.reduce((a, b) => a + b, 0)
    );
  });

  it('the §7.2 details render like the viewer expands them (PQ-T48)', () => {
    const body = part({ size: [0.5, 0.6, 0.4], front: true, kind: 'body' });
    const mask = (r: ReturnType<typeof renderFlat>) => r.mask.data.reduce((a, b) => a + b, 0);
    const diffOf = (a: ReturnType<typeof renderFlat>, b: ReturnType<typeof renderFlat>) =>
      a.rgb.reduce((n, v, i) => n + (v !== b.rgb[i] ? 1 : 0), 0);
    const plain = renderFlat(recipe([body]), 1, N, N);
    // Flush glass and bars draw pixels but keep the silhouette.
    const flush = renderFlat(
      recipe([{ ...body, details: ['windscreen', 'grille', 'bumper'] }]),
      1,
      N,
      N
    );
    expect(diffOf(flush, plain)).toBeGreaterThan(0);
    expect(mask(flush)).toBe(mask(plain));
    // A step stands below the host's foot: the silhouette grows.
    const stepped = renderFlat(recipe([{ ...body, details: ['step'] }]), 1, N, N);
    expect(diffOf(stepped, plain)).toBeGreaterThan(0);
    expect(mask(stepped)).toBeGreaterThan(mask(plain));
  });

  it('grown generators render in the judge like the viewer expands them (PQ-T50)', () => {
    const crown = part({
      size: [0.9, 0.6, 0.9],
      front: true,
      kind: 'crown',
      color: '#3e7a34',
      generator: {
        op: 'scatter',
        seed: 42,
        volume: { shape: 'ellipsoid', at: [0, 0, 0], size: [0.85, 0.55, 0.85] },
        count: 48,
        size: 0.085,
        orientation: 'random',
        colors: ['#3e7a34'],
      },
    });
    const solid = renderFlat(recipe([{ ...crown, generator: undefined }]), 1, N, N);
    const grown = renderFlat(recipe([crown]), 1, N, N);
    const pixels = (r: ReturnType<typeof renderFlat>) => r.mask.data.reduce((a, b) => a + b, 0);
    // The judge sees the leaves, not the host box: different pixels, still a visible crown.
    expect(grown.rgb.reduce((n, v, i) => n + (v !== solid.rgb[i] ? 1 : 0), 0)).toBeGreaterThan(0);
    expect(pixels(grown)).toBeGreaterThan(0);
  });

  it('a loft replaces its host and an inset darkens its face in the judge (PQ-T51)', () => {
    const hull = part({
      size: [1, 0.48, 0.9],
      front: true,
      kind: 'body',
      color: '#b03a2e',
      generator: {
        op: 'loft',
        seed: 3,
        axis: 'x',
        stations: [
          { width: 0.7, height: 0.3, radius: 0 },
          { width: 0.9, height: 0.48, radius: 0 },
          { width: 0.8, height: 0.4, radius: 0 },
        ],
      },
    });
    const solid = renderFlat(recipe([{ ...hull, generator: undefined }]), 1, N, N);
    const grown = renderFlat(recipe([hull]), 1, N, N);
    const diff = (a: ReturnType<typeof renderFlat>, b: ReturnType<typeof renderFlat>) =>
      a.rgb.reduce((n, v, i) => n + (v !== b.rgb[i] ? 1 : 0), 0);
    // Stepped nose and tail: the silhouette changes, the body stays visible.
    expect(diff(grown, solid)).toBeGreaterThan(0);
    expect(grown.mask.data.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const pocketed = renderFlat(
      recipe([
        {
          ...hull,
          generator: {
            op: 'inset',
            seed: 11,
            face: 'front',
            u: 0.5,
            v: 0.5,
            w: 0.4,
            h: 0.4,
            depth: -0.05,
          },
        },
      ]),
      1,
      N,
      N
    );
    // A hollow on the front face: the wall keeps its silhouette, its face darkens.
    expect(diff(pocketed, solid)).toBeGreaterThan(0);
    expect(pocketed.mask.data.reduce((a, b) => a + b, 0)).toBe(
      solid.mask.data.reduce((a, b) => a + b, 0)
    );
  });

  it('wall tints colour faces by normal (PQ-T44)', () => {
    const wall = part({
      shape: 'box',
      at: [0, 0, 0],
      size: [1, 1, 1],
      color: '#808080',
      kind: 'wall',
    });
    const plain = renderFlat(recipe([wall]), 1, 32, 32);
    const tinted = renderFlat({ ...recipe([wall]), wallTints: { front: '#ff0000' } }, 1, 32, 32);
    const p0 = pixel(plain, 16, 16, 32);
    const p1 = pixel(tinted, 16, 16, 32);
    expect(p1[0]!).toBeGreaterThan(p1[1]!);
    expect(p1).not.toEqual(p0);
  });
});
