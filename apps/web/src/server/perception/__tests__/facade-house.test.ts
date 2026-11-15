import { describe, expect, it } from 'vitest';
import { MAX_COMPONENTS, ObjectRecipeSchema, fitRecipe } from '@/lib/object-shape';
import { compileScript, recipeToScript } from '@/lib/shape-script';
import {
  DEFAULT_DEPTH_RATIO,
  DOOR_COLOR,
  depthRatio,
  facadeHouseRecipe,
  fuseDepth,
  gableShare,
  MIN_HIP_CLIP,
  measureElevation,
  paneGrid,
  doorGlazing,
  timberFrame,
  inferredTimber,
  separateRoofColor,
  ROOF_WALL_MIN_DE,
  ridgeShare,
  roofKind,
  sideConsistent,
  sideRoofHint,
  type Elevation,
  type ElevationMasks,
} from '../facade-house';
import { renderFlat } from '../flat-render';
import { deltaE2000, hexToLab } from '../color-measure';
import { THATCHED_FRONT } from '../__fixtures__/elevation';

/** Rectangle ring (image fractions). */
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  [x0, y0] as const,
  [x1, y0] as const,
  [x1, y1] as const,
  [x0, y1] as const,
];

/**
 * The user's rural house (2026-11-02), SAM boxes measured live on the 1920 × 1280 front elevation:
 * hipped roof (trapezoid), 2 chimneys, 7 windows, 1 door. Before: the photo roofline read the two
 * chimneys as gables (crenellated roof) and the photo box made a narrow tower.
 */
const RURAL_FRONT: ElevationMasks = {
  aspect: 1920 / 1280,
  house: { x: 0.162, y: 0.038, w: 0.676, h: 0.695 },
  roof: {
    box: { x: 0.162, y: 0.087, w: 0.676, h: 0.202 },
    // Trapezoid: slopes from the eaves to a ridge from x 0.29 to 0.71.
    rings: [
      [
        [0.162, 0.289],
        [0.29, 0.087],
        [0.71, 0.087],
        [0.838, 0.289],
      ],
    ],
  },
  wall: { x: 0.178, y: 0.302, w: 0.645, h: 0.409 },
  windows: [
    { x: 0.327, y: 0.523, w: 0.099, h: 0.139 },
    { x: 0.692, y: 0.523, w: 0.099, h: 0.139 },
    { x: 0.209, y: 0.523, w: 0.099, h: 0.139 },
    { x: 0.257, y: 0.322, w: 0.1, h: 0.139 },
    { x: 0.641, y: 0.322, w: 0.099, h: 0.138 },
    { x: 0.574, y: 0.523, w: 0.099, h: 0.139 },
    { x: 0.45, y: 0.323, w: 0.1, h: 0.138 },
  ],
  doors: [{ x: 0.476, y: 0.561, w: 0.049, h: 0.143 }],
  chimneys: [
    { x: 0.297, y: 0.037, w: 0.032, h: 0.072 },
    { x: 0.671, y: 0.037, w: 0.032, h: 0.072 },
  ],
};

/** Its side elevation drawn by Muse Image (live): triangle roof end, 2 windows, one chimney. */
const RURAL_SIDE: ElevationMasks = {
  aspect: 1920 / 1280,
  house: { x: 0.234, y: 0.048, w: 0.507, h: 0.873 },
  roof: {
    box: { x: 0.234, y: 0.088, w: 0.507, h: 0.275 },
    rings: [
      [
        [0.234, 0.363],
        [0.4875, 0.088],
        [0.741, 0.363],
      ],
    ],
  },
  wall: { x: 0.254, y: 0.36, w: 0.468, h: 0.529 },
  windows: [
    { x: 0.42, y: 0.642, w: 0.134, h: 0.186 },
    { x: 0.42, y: 0.384, w: 0.134, h: 0.184 },
  ],
  doors: [],
  chimneys: [{ x: 0.5, y: 0.04, w: 0.03, h: 0.07 }],
};

const COLORS = { main: '#d9c5b1', secondary: '#5a5e64', accent: '#2b2524' };

const front = () => measureElevation(RURAL_FRONT)!;
const side = () => measureElevation(RURAL_SIDE)!;

describe('ridgeShare', () => {
  it('reads the flat top of a trapezoid roof, chimney columns left out', () => {
    const r = ridgeShare(RURAL_FRONT.roof!.rings!, RURAL_FRONT.roof!.box, RURAL_FRONT.chimneys);
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThan(0.75);
  });

  it('a triangle is a peak, a rectangle all ridge', () => {
    const tri = [
      [
        [0, 1],
        [0.5, 0],
        [1, 1],
      ] as const,
    ];
    expect(ridgeShare(tri, { x: 0, y: 0, w: 1, h: 1 })).toBeLessThan(0.15);
    expect(ridgeShare([rect(0, 0, 1, 1)], { x: 0, y: 0, w: 1, h: 1 })).toBe(1);
  });
});

describe('measureElevation', () => {
  it('body = roof + walls, chimneys above it, eave at the roof foot', () => {
    const e = front();
    expect(e.top).toBeCloseTo(0.087, 6);
    expect(e.eave).toBeCloseTo(0.289, 6);
    expect(e.bottom).toBeCloseTo(0.733, 6);
    expect(e.wallLeft).toBeCloseTo(0.178, 6);
    expect(e.left).toBeCloseTo(0.162, 6);
    expect(e.windows).toHaveLength(7);
    expect(e.doors).toHaveLength(1);
    expect(e.chimneys).toHaveLength(2);
  });

  it('null without anything to stand on', () => {
    expect(measureElevation({ aspect: 1.5, windows: [], doors: [], chimneys: [] })).toBeNull();
  });

  it('a thin roof band is a flat top (shop, block)', () => {
    const e = measureElevation({
      aspect: 1,
      roof: { box: { x: 0.1, y: 0.1, w: 0.8, h: 0.02 } },
      wall: { x: 0.1, y: 0.12, w: 0.8, h: 0.78 },
      windows: [],
      doors: [],
      chimneys: [],
    })!;
    expect(e.eave).toBe(e.top);
    expect(roofKind(e, null).kind).toBe('flat');
  });
});

describe('roof kind and side checks', () => {
  it('trapezoid front → hipped roof with the measured ridge', () => {
    const k = roofKind(front(), side());
    expect(k.kind).toBe('hip');
    expect(k.ridge).toBeGreaterThan(0.5);
  });

  it('peaked front → gable on the street; peaked on both sides → pyramid', () => {
    const peak: Elevation = { ...front(), ridge: 0.05 };
    expect(roofKind(peak, null)).toEqual({ kind: 'gable', ridge: 0 });
    expect(roofKind(peak, { ...side(), ridge: 1 }).kind).toBe('gable');
    expect(roofKind(peak, { ...side(), ridge: 0.05 })).toEqual({ kind: 'hip', ridge: 0 });
  });

  // Live thatched front (2026-11-03): ridge 0.86, the ends stand vertical from the eave to ~2/3
  // of the roof height, then a small hip (a half-hip the builder used to flatten to a side gable).
  const HALF_HIP: Array<[number, number]> = [
    [0.2133, 0.1928],
    [0.309, 0.1981],
    [0.6902, 0.1981],
    [0.7848, 0.1923],
    [0.7883, 0.214],
    [0.8137, 0.2497],
    [0.8348, 0.2685],
    [0.85, 0.2913],
    [0.8773, 0.357],
    [0.8773, 0.3617],
    [0.868, 0.3757],
    [0.8688, 0.5551],
    [0.8648, 0.5856],
    [0.8621, 0.5897],
    [0.8504, 0.5932],
    [0.141, 0.592],
    [0.1352, 0.5856],
    [0.132, 0.5657],
    [0.1328, 0.3781],
    [0.1297, 0.3687],
    [0.1234, 0.3628],
    [0.1227, 0.3558],
    [0.15, 0.2913],
    [0.1676, 0.2649],
    [0.1871, 0.2485],
    [0.2094, 0.2186],
    [0.2125, 0.2116],
  ];
  const halfHip = (): Elevation => ({
    ...front(),
    left: 0.1227,
    right: 0.8773,
    top: 0.1923,
    eave: 0.5932,
    bottom: 0.8875,
    ridge: 0.86,
    chimneys: [],
    roofRings: [HALF_HIP],
  });

  it('half-hip (PG-T22): vertical ends read on the front outline → hip with its clip', () => {
    const share = gableShare(halfHip())!;
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.8);
    expect(roofKind(halfHip(), null)).toEqual({ kind: 'hip', ridge: 0.86, clip: share });
    const roof = facadeHouseRecipe({ front: halfHip(), side: null, colors: COLORS }).parts.find(
      (p) => p.kind === 'roof'
    )!;
    expect(roof.shape).toBe('hip');
    expect(roof.clip).toBeCloseTo(share, 6);
  });

  it('a full hip slopes to its corners: no clip (regression: the plain trapezoid stays a hip)', () => {
    expect(gableShare(front())!).toBeLessThan(MIN_HIP_CLIP);
    expect(roofKind(front(), side()).clip).toBeUndefined();
    expect(gableShare({ ...front(), roofRings: undefined })).toBeNull();
  });

  it('the side prompt asks for the roof end or its long slope', () => {
    expect(sideRoofHint(front())).toBe('end');
    expect(sideRoofHint({ ...front(), ridge: 0.05 })).toBe('slope');
  });

  it('a side drawn as a copy of a peaked front is rejected (live: the cottage)', () => {
    const peak: Elevation = { ...front(), ridge: 0.05 };
    expect(sideConsistent(peak, { ...peak })).toBe(false);
    expect(sideConsistent(front(), side())).toBe(true);
    // Storeys drawn at another height.
    expect(sideConsistent(front(), { ...side(), eave: side().top + 0.05 })).toBe(false);
  });
});

describe('depth', () => {
  it('side wall over front wall at the same body height', () => {
    expect(depthRatio(front(), side())).toBeCloseTo(0.57, 1);
    expect(depthRatio(front(), null)).toBeNull();
  });

  it('fuses with Spark: mean when they agree, Spark when the drawing is off', () => {
    expect(fuseDepth(0.62, 0.7)).toBeCloseTo(Math.sqrt(0.62 * 0.7), 6);
    // Live cottage: the side sheet drawn as wide as the front.
    expect(fuseDepth(0.97, 0.65)).toBe(0.65);
    expect(fuseDepth(null, 0.65)).toBe(0.65);
    expect(fuseDepth(0.5, undefined)).toBe(0.5);
    expect(fuseDepth(null, undefined)).toBe(DEFAULT_DEPTH_RATIO);
  });
});

describe('facadeHouseRecipe', () => {
  const recipe = () =>
    facadeHouseRecipe({
      front: front(),
      side: side(),
      colors: COLORS,
      materials: { main: 'plaster', secondary: 'slate', accent: 'glass' },
      sparkDepth: 0.7,
    });

  it('is a valid recipe within the part budget, priorities kept', () => {
    const r = recipe();
    expect(ObjectRecipeSchema.safeParse(fitRecipe(r, 0)).success).toBe(true);
    // PG-T10: components budget, no longer cut at 12 parts.
    expect(r.parts.length).toBeGreaterThan(12);
    expect(r.parts.length).toBeLessThanOrEqual(MAX_COMPONENTS);
    expect(r.parts[0]!.front).toBe(true);
    expect(r.parts[1]!.shape).toBe('hip');
    expect(r.parts.filter((p) => p.material === 'glass')).toHaveLength(9);
    expect(r.parts.filter((p) => p.material === 'brick')).toHaveLength(2);
  });

  it('keeps the facade proportions (before: a narrow tower from the photo box)', () => {
    const { w, h, d } = recipe().proportions;
    expect(w).toBe(1);
    // 9.6 m wide, 6.3 m to the ridge + chimneys.
    expect(w / h).toBeGreaterThan(1.3);
    expect(w / h).toBeLessThan(1.6);
    expect(d / w).toBeGreaterThan(0.5);
    expect(d / w).toBeLessThan(0.8);
  });

  it('the door is wood, never the roof (before: the door took the roof role)', () => {
    const door = recipe().parts.find((p) => p.material === 'wood')!;
    expect(door.color).toBe(DOOR_COLOR);
    expect(door.at[2]).toBeGreaterThan(0);
  });

  it('chimneys rise above the roof, walls stop at the eave', () => {
    const r = recipe();
    const roofTop = r.parts[1]!.at[1] + r.parts[1]!.size[1] / 2;
    for (const c of r.parts.filter((p) => p.material === 'brick'))
      expect(c.at[1] + c.size[1] / 2).toBeGreaterThan(roofTop);
    const walls = r.parts[0]!;
    expect(walls.at[1] + walls.size[1] / 2).toBeCloseTo(
      r.parts[1]!.at[1] - r.parts[1]!.size[1] / 2,
      6
    );
  });

  it('front view renders the trapezoid: wide at the eave, narrow at the ridge', () => {
    const fitted = fitRecipe(recipe(), 0);
    const n = 96;
    const flat = renderFlat(fitted, 1, n, n, { yaw: 0, pitch: 0 });
    const width = (row: number) => {
      let c = 0;
      for (let x = 0; x < n; x++) c += flat.mask.data[row * n + x]!;
      return c;
    };
    let first = 0;
    while (first < n && width(first) === 0) first++;
    const rows = Array.from({ length: n }, (_, y) => width(y));
    const widest = Math.max(...rows);
    // Below the chimneys, the roof's top rows are clearly narrower than the walls.
    expect(rows[Math.round(n * 0.25)]!).toBeLessThan(widest);
    expect(widest).toBeGreaterThan(0.8 * n);
  });

  it('side windows go to the right wall when the budget allows', () => {
    const r = facadeHouseRecipe({
      front: { ...front(), windows: front().windows.slice(0, 2) },
      side: side(),
      colors: COLORS,
    });
    const onRight = r.parts.filter((p) => p.status === 'inferred');
    expect(onRight).toHaveLength(2);
    for (const p of onRight) expect(p.at[0]).toBeGreaterThan(0);
  });

  it('without a side: Spark depth, chimneys on the ridge line', () => {
    const r = facadeHouseRecipe({ front: front(), side: null, colors: COLORS, sparkDepth: 0.5 });
    for (const c of r.parts.filter((p) => p.material === 'brick')) expect(c.at[2]).toBe(0);
    expect(r.proportions.d / r.proportions.w).toBeGreaterThan(0.45);
    expect(r.proportions.d / r.proportions.w).toBeLessThan(0.6);
  });
});

describe('facade house materials and base (PG-T5, PG-T3)', () => {
  const masks = {
    aspect: 1.5,
    house: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    roof: { box: { x: 0.1, y: 0.1, w: 0.8, h: 0.35 } },
    wall: { x: 0.12, y: 0.45, w: 0.76, h: 0.45 },
    windows: [{ x: 0.2, y: 0.55, w: 0.1, h: 0.15 }],
    doors: [{ x: 0.45, y: 0.6, w: 0.1, h: 0.3 }],
    chimneys: [{ x: 0.2, y: 0.05, w: 0.04, h: 0.15 }],
    plinths: [{ x: 0.12, y: 0.86, w: 0.76, h: 0.04 }],
    steps: [{ x: 0.43, y: 0.88, w: 0.14, h: 0.02 }],
  };
  const COL = { main: '#e6dccb', secondary: '#b8955a', accent: '#2b3440' };

  it('the drawing names each part: thatch roof over plaster walls, not one material for both', () => {
    const r = facadeHouseRecipe({
      front: measureElevation(masks)!,
      side: null,
      colors: COL,
      materials: { main: 'wood', secondary: 'wood' },
      partMaterials: { roof: 'thatch', walls: 'plaster', chimney: 'brick', plinth: 'stone' },
    });
    const of = (k: string) => r.parts.find((p) => p.kind === k);
    expect(of('roof')?.material).toBe('thatch');
    expect(of('wall')?.material).toBe('plaster');
    expect(of('chimney')?.material).toBe('brick');
    expect(of('door')?.material).toBe('wood');
    expect(of('window')?.material).toBe('glass');
  });

  it('falls back to the colour-role materials without a drawing reading', () => {
    const r = facadeHouseRecipe({
      front: measureElevation(masks)!,
      side: null,
      colors: COL,
      materials: { main: 'stone', secondary: 'slate' },
    });
    expect(r.parts.find((p) => p.kind === 'roof')?.material).toBe('slate');
    expect(r.parts.find((p) => p.kind === 'wall')?.material).toBe('stone');
  });

  it('adds the measured plinth (wider than the walls, on the ground) and the step', () => {
    const r = facadeHouseRecipe({ front: measureElevation(masks)!, side: null, colors: COL });
    const wall = r.parts.find((p) => p.kind === 'wall')!;
    const base = r.parts.find((p) => p.kind === 'plinth')!;
    expect(base.size[0]).toBeGreaterThan(wall.size[0]);
    expect(base.at[1] - base.size[1] / 2).toBeCloseTo(wall.at[1] - wall.size[1] / 2, 5);
    expect(base.material).toBe('stone');
    const step = r.parts.find((p) => p.kind === 'step')!;
    expect(step.at[2]).toBeGreaterThan(wall.size[2] / 2);
    expect(r.parts.length).toBeLessThanOrEqual(12);
  });
});

describe('paneGrid + double doors (PG-T8)', () => {
  const box = { x: 0.2, y: 0.5, w: 0.1, h: 0.2 };
  const pane = (c: number, r: number) => ({
    x: 0.2 + c * 0.05 + 0.005,
    y: 0.5 + r * 0.05 + 0.005,
    w: 0.04,
    h: 0.04,
  });

  it('reads the user window grid: 2 across × 4 down', () => {
    const panes = [0, 1].flatMap((c) => [0, 1, 2, 3].map((r) => pane(c, r)));
    expect(paneGrid(box, panes)).toEqual([2, 4]);
  });

  it('ignores panes of another window; null under 2 panes', () => {
    expect(paneGrid(box, [pane(0, 0), { x: 0.8, y: 0.5, w: 0.04, h: 0.04 }])).toBeNull();
  });

  it('a wide door is a pair of leaves, a narrow one a single leaf', () => {
    const masks = {
      aspect: 1.5,
      house: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      roof: { box: { x: 0.1, y: 0.1, w: 0.8, h: 0.35 } },
      wall: { x: 0.12, y: 0.45, w: 0.76, h: 0.45 },
      windows: [box],
      doors: [
        { x: 0.43, y: 0.6, w: 0.14, h: 0.3 },
        { x: 0.7, y: 0.65, w: 0.05, h: 0.25 },
      ],
      chimneys: [],
      panes: [0, 1].flatMap((c) => [0, 1, 2, 3].map((r) => pane(c, r))),
    };
    const r = facadeHouseRecipe({
      front: measureElevation(masks)!,
      side: null,
      colors: { main: '#e6dccb', secondary: '#b8955a', accent: '#2b3440' },
    });
    const doors = r.parts.filter((p) => p.kind === 'door');
    expect(doors.map((d) => d.leaves ?? 1)).toEqual([2, 1]);
    expect(r.parts.find((p) => p.kind === 'window')?.grid).toEqual([2, 4]);
  });
});

describe('roof / wall colour guard (PG-T9)', () => {
  it('user case: thatch roof and plaster walls of one photo colour → roof pulled toward straw', () => {
    const out = separateRoofColor(
      { color: '#8a5a3c', material: 'thatch' },
      { color: '#8c5c3e', material: 'plaster' }
    );
    expect(out.nudged).toBe(true);
    expect(deltaE2000(hexToLab(out.color), hexToLab('#8c5c3e'))).toBeGreaterThanOrEqual(
      ROOF_WALL_MIN_DE
    );
  });

  it('leaves distinct colours, same materials and unknown materials alone', () => {
    expect(
      separateRoofColor(
        { color: '#5f5a55', material: 'slate' },
        { color: '#e6dccb', material: 'plaster' }
      )
    ).toEqual({ color: '#5f5a55', nudged: false });
    expect(
      separateRoofColor(
        { color: '#8a5a3c', material: 'wood' },
        { color: '#8c5c3e', material: 'wood' }
      ).nudged
    ).toBe(false);
    expect(
      separateRoofColor({ color: '#8a5a3c' }, { color: '#8c5c3e', material: 'wood' }).nudged
    ).toBe(false);
  });

  it('the facade builder applies it to the roof part', () => {
    const masks = {
      aspect: 1.5,
      house: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      roof: { box: { x: 0.1, y: 0.1, w: 0.8, h: 0.35 } },
      wall: { x: 0.12, y: 0.45, w: 0.76, h: 0.45 },
      windows: [],
      doors: [],
      chimneys: [],
    };
    const r = facadeHouseRecipe({
      front: measureElevation(masks)!,
      side: null,
      colors: { main: '#8c5c3e', secondary: '#8a5a3c', accent: '#2b3440' },
      partMaterials: { roof: 'thatch', walls: 'plaster' },
    });
    const roof = r.parts.find((p) => p.kind === 'roof')!;
    const wall = r.parts.find((p) => p.kind === 'wall')!;
    expect(deltaE2000(hexToLab(roof.color), hexToLab(wall.color))).toBeGreaterThanOrEqual(
      ROOF_WALL_MIN_DE
    );
  });
});

describe('chimney and base colours (viewer review 2026-11-02)', () => {
  it('regression: white chimneys and a straw base on a white thatched house → brick and stone', () => {
    const masks = {
      aspect: 1.5,
      house: { x: 0.1, y: 0.05, w: 0.8, h: 0.85 },
      roof: { box: { x: 0.1, y: 0.1, w: 0.8, h: 0.35 } },
      wall: { x: 0.12, y: 0.45, w: 0.76, h: 0.45 },
      windows: [],
      doors: [],
      chimneys: [{ x: 0.2, y: 0.05, w: 0.04, h: 0.15 }],
      plinths: [{ x: 0.12, y: 0.86, w: 0.76, h: 0.04 }],
    };
    const colors = { main: '#e6dccb', secondary: '#c8a060', accent: '#2b3440' };
    const r = facadeHouseRecipe({
      front: measureElevation(masks)!,
      side: null,
      colors,
      partMaterials: { roof: 'thatch', walls: 'plaster', chimney: 'brick', plinth: 'stone' },
    });
    const de = (a: string, b: string) => deltaE2000(hexToLab(a), hexToLab(b));
    const chimney = r.parts.find((p) => p.kind === 'chimney')!;
    const base = r.parts.find((p) => p.kind === 'plinth')!;
    expect(de(chimney.color, colors.main)).toBeGreaterThanOrEqual(ROOF_WALL_MIN_DE);
    expect(de(base.color, colors.main)).toBeGreaterThanOrEqual(ROOF_WALL_MIN_DE);
    expect(de(base.color, colors.secondary)).toBeGreaterThanOrEqual(ROOF_WALL_MIN_DE);
  });
});

describe('timberFrame (PV-G)', () => {
  const e = {
    aspect: 1.5,
    wallLeft: 0.2,
    wallRight: 0.8,
    eave: 0.5,
    bottom: 0.8,
  };
  it('vertical beams → posts, horizontal → rails, as wall shares; close ones merged', () => {
    const t = timberFrame({
      ...e,
      beams: [
        { x: 0.195, y: 0.5, w: 0.01, h: 0.3 },
        { x: 0.497, y: 0.5, w: 0.01, h: 0.3 },
        { x: 0.5, y: 0.5, w: 0.01, h: 0.3 },
        { x: 0.2, y: 0.645, w: 0.6, h: 0.01 },
      ],
    })!;
    expect(t.posts).toHaveLength(2);
    expect(t.posts[0]).toBeCloseTo(0, 1);
    expect(t.posts[1]).toBeCloseTo(0.5, 1);
    expect(t.rails).toHaveLength(1);
    expect(t.rails[0]).toBeCloseTo(0.5, 1);
  });
  it('null under 2 beams', () => {
    expect(timberFrame({ ...e, beams: [{ x: 0.5, y: 0.5, w: 0.01, h: 0.3 }] })).toBeNull();
  });
  it('the thatched drawing gives a half-timbered wall', () => {
    const r = facadeHouseRecipe({
      front: measureElevation(THATCHED_FRONT.masks)!,
      side: null,
      colors: THATCHED_FRONT.colors,
    });
    const wall = r.parts.find((p) => p.kind === 'wall')!;
    expect(wall.timber?.posts.length).toBeGreaterThanOrEqual(6);
    expect(wall.timber?.rails).toHaveLength(2);
  });
});

describe('glazed door panes are not windows (live 2026-11-02)', () => {
  it('drops « windows » centred inside a door, keeps the real ones', () => {
    const e = measureElevation({
      aspect: 1.5,
      house: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      roof: { box: { x: 0.1, y: 0.1, w: 0.8, h: 0.35 } },
      wall: { x: 0.12, y: 0.45, w: 0.76, h: 0.45 },
      windows: [
        { x: 0.2, y: 0.55, w: 0.1, h: 0.15 },
        { x: 0.45, y: 0.62, w: 0.03, h: 0.05 },
        { x: 0.52, y: 0.62, w: 0.03, h: 0.05 },
      ],
      doors: [{ x: 0.43, y: 0.6, w: 0.14, h: 0.3 }],
      chimneys: [],
    })!;
    expect(e.windows).toHaveLength(1);
    expect(e.doors).toHaveLength(1);
  });
});

describe('Spark details where SAM finds none (live 2026-11-02: line drawing)', () => {
  const masks = {
    aspect: 1.5,
    house: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    roof: { box: { x: 0.1, y: 0.1, w: 0.8, h: 0.35 } },
    wall: { x: 0.12, y: 0.45, w: 0.76, h: 0.45 },
    windows: [
      { x: 0.2, y: 0.55, w: 0.1, h: 0.15 },
      { x: 0.7, y: 0.55, w: 0.1, h: 0.15 },
    ],
    doors: [{ x: 0.43, y: 0.6, w: 0.14, h: 0.3 }],
    chimneys: [],
  };
  const colors = { main: '#e6dccb', secondary: '#c8a060', accent: '#2b3440' };
  const build = (details?: Parameters<typeof facadeHouseRecipe>[0]['details']) =>
    facadeHouseRecipe({
      front: measureElevation(masks)!,
      side: null,
      colors,
      ...(details ? { details } : {}),
    });

  it('nothing read → no base, no step, no beams, default panes left to the viewer', () => {
    const r = build();
    expect(r.parts.some((p) => p.kind === 'plinth' || p.kind === 'step')).toBe(false);
    expect(r.parts.find((p) => p.kind === 'wall')?.timber).toBeUndefined();
    expect(r.parts.find((p) => p.kind === 'window')?.grid).toBeUndefined();
  });

  it('plinth → an inferred base band at the wall foot and a step at the door', () => {
    const r = build({ plinth: true });
    const base = r.parts.find((p) => p.kind === 'plinth')!;
    const step = r.parts.find((p) => p.kind === 'step')!;
    const door = r.parts.find((p) => p.kind === 'door')!;
    expect(base.status).toBe('inferred');
    expect(step.status).toBe('inferred');
    expect(Math.abs(step.at[0] - door.at[0])).toBeLessThan(1e-9);
    expect(step.size[0]).toBeGreaterThan(door.size[0]);
  });

  it('timberFrame → posts at the ends and beside each opening, rails at heads and sills', () => {
    const t = build({ timberFrame: true }).parts.find((p) => p.kind === 'wall')!.timber!;
    expect(t.posts[0]).toBe(0);
    expect(t.posts.at(-1)).toBe(1);
    expect(t.posts.length).toBe(2 + 2 * 3);
    expect(t.rails).toHaveLength(2);
    const e = measureElevation(masks)!;
    expect(inferredTimber(e)).toEqual(t);
  });

  it('panes from Spark when SAM read none', () => {
    expect(build({ panes: [4, 4] }).parts.find((p) => p.kind === 'window')?.grid).toEqual([4, 4]);
  });
});

describe('facade assemblies (PG-T10)', () => {
  const door = { x: 0.4, y: 0.5, w: 0.2, h: 0.4 };
  const pane = (c: number, r: number) => ({
    x: 0.42 + c * 0.09,
    y: 0.52 + r * 0.07,
    w: 0.07,
    h: 0.05,
  });

  it('doorGlazing: share from the top down to the lowest pane, and the pane grid', () => {
    const g = doorGlazing(door, [pane(0, 0), pane(1, 0), pane(0, 1), pane(1, 1)])!;
    expect(g.grid).toEqual([2, 2]);
    expect(g.glazed).toBeCloseTo((0.52 + 0.07 + 0.05 - 0.5) / 0.4, 6);
    expect(doorGlazing(door, [])).toBeNull();
    expect(doorGlazing(door, [{ x: 0.8, y: 0.1, w: 0.05, h: 0.05 }])).toBeNull();
    // One pane → one glass, glazed share at least the minimum.
    expect(doorGlazing(door, [pane(0, 0)])!.grid).toEqual([1, 1]);
  });

  it('a glazed double door (its panes seen as windows) keeps them as door glass, not windows', () => {
    const masks = {
      aspect: 1.5,
      house: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      roof: { box: { x: 0.1, y: 0.1, w: 0.8, h: 0.35 } },
      wall: { x: 0.12, y: 0.45, w: 0.76, h: 0.45 },
      windows: [
        { x: 0.2, y: 0.55, w: 0.1, h: 0.15 },
        { x: 0.44, y: 0.62, w: 0.05, h: 0.08 },
        { x: 0.51, y: 0.62, w: 0.05, h: 0.08 },
      ],
      doors: [{ x: 0.43, y: 0.6, w: 0.14, h: 0.3 }],
      chimneys: [{ x: 0.7, y: 0.05, w: 0.05, h: 0.2 }],
    };
    const r = facadeHouseRecipe({
      front: measureElevation(masks)!,
      side: null,
      colors: { main: '#e6dccb', secondary: '#b8955a', accent: '#2b3440' },
    });
    expect(r.parts.filter((p) => p.kind === 'window')).toHaveLength(1);
    const d = r.parts.find((p) => p.kind === 'door')!;
    expect(d.leaves).toBe(2);
    expect(d.glazed).toBeGreaterThan(0.15);
    expect(d.grid).toEqual([2, 1]);
    expect(d.lintel).toBe(true);
    expect(r.parts.find((p) => p.kind === 'window')!.sill).toBe(true);
    expect(r.parts.filter((p) => p.kind === 'chimney').every((p) => p.cap)).toBe(true);
  });

  it('no lintels when a timber frame draws the rails', () => {
    const r = facadeHouseRecipe({
      front: front(),
      side: null,
      colors: COLORS,
      details: { timberFrame: true },
    });
    if (r.parts[0]!.timber) expect(r.parts.some((p) => p.lintel)).toBe(false);
  });
});

describe('ShapeScript seed (PG-T14)', () => {
  it('the thatched house builder output round-trips through its script unchanged', () => {
    const g = THATCHED_FRONT;
    const built = fitRecipe(
      {
        ...facadeHouseRecipe({
          front: measureElevation(g.masks)!,
          side: null,
          colors: g.colors,
          ...(g.partMaterials ? { partMaterials: g.partMaterials } : {}),
        }),
        source: 'facade',
      },
      0
    );
    const script = recipeToScript(built);
    const out = compileScript(script);
    expect(out.dropped).toEqual([]);
    expect(out.adjusted).toEqual([]);
    expect(out.recipe).toEqual(built);
    // Openings belong to the wall, so later stage patches keep them inside it.
    expect(
      out.components.filter((c) => c.part.kind === 'window').every((c) => c.parent === 'wall')
    ).toBe(true);
  });
});

describe('several volumes (PQ-T62)', () => {
  it('before: a wide multi-roof house was measured as its largest roof only (the central tower)', async () => {
    const { measureElevation } = await import('../facade-house');
    const masks = {
      aspect: 1.55,
      // Largest roof and wall: the central volume only.
      roof: { box: { x: 0.27, y: 0.18, w: 0.33, h: 0.2 } },
      wall: { box: undefined } as never,
      windows: [
        { x: 0.14, y: 0.42, w: 0.1, h: 0.14 },
        { x: 0.34, y: 0.36, w: 0.15, h: 0.16 },
        { x: 0.58, y: 0.56, w: 0.11, h: 0.12 },
      ],
      doors: [{ x: 0.78, y: 0.62, w: 0.12, h: 0.18 }],
      chimneys: [],
      // Every house / roof / wall instance united: the whole building.
      extent: { x: 0.04, y: 0.18, w: 0.94, h: 0.63 },
      roofTop: 0.18,
    };
    const { wall: _w, ...clean } = masks;
    const e = measureElevation(clean)!;
    expect(e.left).toBeCloseTo(0.04, 2);
    expect(e.right).toBeCloseTo(0.98, 2);
    // Openings of the side volumes are no longer filtered out.
    expect(e.windows).toHaveLength(3);
    expect(e.doors).toHaveLength(1);
    // A single-volume house (extent ≈ its roof) keeps the roof edges.
    const single = measureElevation({ ...clean, extent: { x: 0.26, y: 0.18, w: 0.35, h: 0.63 } })!;
    expect(single.left).toBeCloseTo(0.27, 2);
  });
});

describe('side of a multi-volume house (PQ-T65)', () => {
  it('before: rejected for its eave share; now kept unless it copies the front', async () => {
    const { sideConsistent } = await import('../facade-house');
    const base = {
      aspect: 1.5,
      left: 0.05,
      right: 0.95,
      wallLeft: 0.05,
      wallRight: 0.95,
      top: 0.2,
      bottom: 0.8,
      ridge: null,
      doors: [],
      chimneys: [],
      plinth: null,
      steps: [],
      panes: [],
      beams: [],
    };
    const win = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ x: 0.1 + i * 0.1, y: 0.5, w: 0.05, h: 0.1 }));
    const front = { ...base, eave: 0.32, windows: win(3), multi: true };
    // Eave share 0.2 vs 0.6: far apart, and a narrower body — a real side.
    const side = {
      ...base,
      left: 0.2,
      right: 0.8,
      wallLeft: 0.2,
      wallRight: 0.8,
      eave: 0.56,
      windows: win(4),
    };
    expect(sideConsistent(front, side)).toBe(true);
    // Same body and the same windows: Muse Image redrew the front.
    expect(sideConsistent(front, { ...front })).toBe(false);
    // A single-volume house keeps the eave rule.
    expect(sideConsistent({ ...front, multi: false }, side)).toBe(false);
  });
});
