import { describe, expect, it } from 'vitest';
import type { GridView } from '../recon/views';
import {
  cleanSwatch,
  DECK_MAX,
  dominantColor,
  fitHouse,
  fitPiers,
  measuredBase,
  sampleColor,
  housePatches,
  lowerFinishes,
  pickPatch,
  ANNEX_PITCH,
  footprintAnnexes,
  gableEnds,
  growToFootprint,
  outlineHeights,
  ownerOf,
  profileSteps,
  shedFallOf,
  snapOpening,
  swatchOblique,
} from '../house/house-fit';
import { buildHouseQuestion, parseHouseReading, type HouseReading } from '../house/house-prompt';
import type { HouseVolume } from '@/lib/house-plan';

const BRICK = [160, 70, 50] as const;
const GLASS = [60, 80, 100] as const;
const ROOF = [90, 90, 95] as const;

/**
 * Front elevation on a 100 × 100 grid: a body over the full width, walls up to row 40 (eave at
 * 0.6), a roof above narrowing to the ridge at the top; one window at columns 60–79, rows 55–74.
 */
function frontView(): GridView {
  const [cols, rows] = [100, 100];
  const rgb = new Uint8Array(cols * rows * 3);
  const mask = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const inRoof = y < 40 && Math.abs(x - 50) <= 10 + (y * 40) / 40;
      if (y >= 40 || inRoof) mask[i] = 1;
      const c = y < 40 ? ROOF : x >= 60 && x < 80 && y >= 55 && y < 75 ? GLASS : BRICK;
      rgb.set(c, i * 3);
    }
  return { cols, rows, rgb, mask };
}

const reading = (over: Partial<HouseReading> = {}): HouseReading => ({
  volumes: [
    { kind: 'body', plan: [0.02, 0.97, 0, 1], eave: 0.4, ridge: 0.05, roof: 'hip', ridgeAxis: 'x' },
    {
      kind: 'veranda',
      plan: [0, 0.4, 0.8, 1],
      eave: 0.4,
      ridge: 0.4,
      roof: 'none',
      ridgeAxis: 'x',
      open: ['front'],
      floor: 0.95,
    },
  ],
  // The window given a little off (as a model measures it), on the front drawing.
  openings: [{ view: 'front', kind: 'window', box: [0.57, 0.52, 0.82, 0.77], panes: [2, 2] }],
  chimneys: [{ plan: [0.7, 0.75, 0.4, 0.45], top: 0 }],
  walls: { material: 'brick', color: '#a04632' },
  roof: { material: 'slate', color: '#5a5a60' },
  trim: '#ffffff',
  glass: null,
  door: null,
  base: null,
  ...over,
});

describe('house fit', () => {
  it('reads the outline heights and their steps', () => {
    const h = outlineHeights(frontView());
    expect(h[0]).toBeCloseTo(0.6, 5);
    expect(h[50]).toBeCloseTo(1, 5);
    expect(profileSteps([0.5, 0.5, 0.9, 0.9])).toEqual([0, 1, 0.5]);
  });

  it('reads which way a shed roof falls on the outlines', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 0.5 + i / 100);
    const level = Array.from({ length: 30 }, () => 0.6);
    expect(shedFallOf([0, 1, 0, 1], rising, level)).toBe('left');
    expect(shedFallOf([0, 1, 0, 1], [...rising].reverse(), level)).toBe('right');
    // Side columns run back → front: higher at the front = falls toward the back.
    expect(shedFallOf([0, 1, 0, 1], level, rising)).toBe('back');
    expect(shedFallOf([0, 1, 0, 1], level, level)).toBeNull();
    // The front wins when both slope: a side outline often shows another block.
    expect(shedFallOf([0, 1, 0, 1], rising, rising)).toBe('left');
  });

  it('snaps an opening on its frame in the drawing', () => {
    const [c0, c1, r0, r1] = snapOpening(frontView(), [57, 82, 52, 77]);
    expect([c0, c1, r0, r1]).toEqual([60, 80, 55, 75]);
  });

  it('keeps the given box when the drawing shows nothing there', () => {
    expect(snapOpening(frontView(), [10, 20, 60, 70])).toEqual([10, 20, 60, 70]);
  });

  it('gives an opening to the outermost solid block that holds it', () => {
    const body: HouseVolume = {
      kind: 'body',
      plan: [0, 1, 0, 0.8],
      eave: 0.6,
      ridge: 1,
      roof: 'hip',
      ridgeAxis: 'x',
    };
    const wing: HouseVolume = { ...body, kind: 'wing', plan: [0.6, 1, 0.5, 1], eave: 0.5 };
    const veranda: HouseVolume = {
      ...body,
      kind: 'veranda',
      plan: [0, 0.5, 0.8, 1],
      open: ['front'],
    };
    expect(ownerOf([body, wing, veranda], 'front', 0.8, 0.3)).toBe(1);
    // Behind the veranda: the body's wall.
    expect(ownerOf([body, wing, veranda], 'front', 0.2, 0.3)).toBe(0);
    expect(ownerOf([body, wing, veranda], 'right', 0.9, 0.3)).toBe(1);
  });

  it('fits a reading into a valid plan in the model frame', () => {
    const plan = fitHouse({ reading: reading(), views: { front: frontView() }, mirrored: {} });
    expect(plan).not.toBeNull();
    const [body, veranda] = plan!.volumes;
    // Outer edges on the box, heights from the ground.
    expect(body!.plan[0]).toBe(0);
    expect(body!.plan[1]).toBe(1);
    expect(body!.eave).toBeCloseTo(0.6, 3);
    expect(body!.ridge).toBeCloseTo(1, 2);
    expect(veranda!.open).toEqual(['front']);
    expect(veranda!.floor).toBeCloseTo(0.05, 3);
    // The window snapped and owned by the body (the veranda does not reach x 0.6).
    const [w] = plan!.openings;
    expect(w).toMatchObject({ volume: 0, wall: 'front', kind: 'window', panes: [2, 2] });
    expect(w!.along[0]).toBeCloseTo(0.6, 3);
    expect(w!.rise[1]).toBeCloseTo(0.45, 3);
    expect(plan!.chimneys[0]!.top).toBe(1);
    // Colours measured on the drawing, materials from the reading.
    expect(plan!.look.wall).toEqual({ material: 'brick', color: '#a04632' });
    expect(plan!.look.glass).toBe('#3c5064');
  });

  it('reads a mirrored side drawing backwards', () => {
    const plan = fitHouse({
      reading: reading({
        openings: [{ view: 'right', kind: 'door', box: [0.1, 0.5, 0.2, 0.95] }],
      }),
      views: {},
      mirrored: { right: true },
    });
    const [door] = plan!.openings;
    expect(door!.along[0]).toBeCloseTo(0.8, 3);
    expect(door!.along[1]).toBeCloseTo(0.9, 3);
  });

  it('fills the footprint the reading left out with an annex at the lowest block height', () => {
    // View from above: an L, the back-right quarter drawn too.
    const [cols, rows] = [100, 100];
    const mask = new Uint8Array(cols * rows).fill(1);
    for (let r = 0; r < 30; r++) for (let c = 60; c < 100; c++) mask[r * cols + c] = 0;
    const top: GridView = { cols, rows, rgb: new Uint8Array(cols * rows * 3), mask };
    const body: HouseVolume = {
      kind: 'body',
      plan: [0, 0.6, 0, 0.6],
      eave: 0.8,
      ridge: 1,
      roof: 'hip',
      ridgeAxis: 'x',
    };
    const wing: HouseVolume = {
      ...body,
      kind: 'wing',
      plan: [0, 1, 0.6, 1],
      eave: 0.5,
      ridge: 0.7,
    };
    const [annex, ...more] = footprintAnnexes([body, wing], top, [], [0.3]);
    expect(more).toEqual([]);
    expect(annex).toMatchObject({ kind: 'annex', plan: [0.6, 1, 0.3, 0.6], eave: 0.5, ridge: 0.7 });
    // A thin strip (a roof overhang past the body) is no annex.
    expect(footprintAnnexes([{ ...body, plan: [0, 0.94, 0, 1] }], top)).toEqual([]);
    // Nothing to add when the blocks cover the drawn roof.
    expect(footprintAnnexes([{ ...body, plan: [0, 1, 0, 1] }], top)).toEqual([]);
  });

  it('keeps a veranda deck low', () => {
    const r = reading();
    const plan = fitHouse({
      reading: { ...r, volumes: [r.volumes[0]!, { ...r.volumes[1]!, floor: 0.5 }] },
      views: {},
      mirrored: {},
    });
    expect(plan!.volumes[1]!.floor).toBe(DECK_MAX);
  });

  it('gives no plan without a solid block', () => {
    const r = reading();
    expect(
      fitHouse({ reading: { ...r, volumes: [r.volumes[1]!] }, views: {}, mirrored: {} })
    ).toBeNull();
  });
});

describe('house swatches', () => {
  it('picks the cleanest square of the wall, away from the window', () => {
    const v = frontView();
    const wall = (s: number, y: number) => y < 0.6 && s > 0.02 && s < 0.98;
    expect(dominantColor(v, wall)).toEqual([...BRICK]);
    const found = pickPatch(v, BRICK, wall, 0.1)!;
    const [s0, s1, y0, y1] = found.box;
    expect(found.score).toBe(0);
    // Not on the window (columns 0.6–0.8, rows 0.25–0.45 from the ground).
    expect(s1 <= 0.6 || s0 >= 0.8 || y1 <= 0.25 || y0 >= 0.45).toBe(true);
    expect(pickPatch(v, BRICK, () => false, 0.1)).toBeNull();
  });

  it('places the wall swatch on a closed block and the roof one on the view from above', () => {
    const plan = fitHouse({ reading: reading(), views: { front: frontView() }, mirrored: {} })!;
    const top: GridView = {
      cols: 50,
      rows: 50,
      rgb: new Uint8Array(50 * 50 * 3).fill(90),
      mask: new Uint8Array(50 * 50).fill(1),
    };
    const p = housePatches(plan, { front: frontView() }, top);
    expect(p.wall!.view).toBe('front');
    expect(p.roof!.view).toBe('top');
    // Not in front of the veranda (x < 0.4 up to its eave).
    expect(p.wall!.box[0] >= 0.4 || p.wall!.box[2] >= plan.volumes[1]!.eave).toBe(true);
  });

  it('cleans boards along their grain: a post and a beam are gone', () => {
    const [w, h] = [20, 20];
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // Orange boards with a dark groove every 5 rows, a dark post at x 3, a beam rows 0–3.
        const groove = y % 5 === 4;
        const c = x === 3 || y < 4 ? [60, 50, 40] : groove ? [90, 50, 30] : [150, 85, 50];
        rgb.set(c, (y * w + x) * 3);
      }
    const out = cleanSwatch(rgb, w, h);
    const at = (x: number, y: number) =>
      Array.from(out.slice((y * w + x) * 3, (y * w + x) * 3 + 3));
    expect(at(3, 6)).toEqual([150, 85, 50]); // the post: the board's colour
    expect(at(10, 1)).not.toEqual([60, 50, 40]); // the beam: board lines instead
    expect(at(10, 9)).toEqual([90, 50, 30]); // a groove stays
  });

  it('keeps a pattern without a direction as cut', () => {
    const rgb = new Uint8Array(8 * 8 * 3).map((_, i) => ((i * 37) % 200) + 20);
    expect(Array.from(cleanSwatch(rgb, 8, 8))).toEqual(Array.from(rgb));
  });
});

describe('house reading', () => {
  it('parses a fenced answer and drops the bad entries one by one', () => {
    const r = parseHouseReading(
      '```json\n' +
        JSON.stringify({
          volumes: [
            { kind: 'body', plan: [0, 1, 0, 1], eave: 0.4, ridge: 0, roof: 'hip', ridgeAxis: 'x' },
            { kind: 'body', plan: [0, 1], eave: 0.4 },
          ],
          openings: [
            { view: 'front', kind: 'skylight', box: [0.1, 0.5, 0.2, 0.7] },
            { view: 'roof', kind: 'window', box: [0.1, 0.5, 0.2, 0.7] },
          ],
          walls: { material: 'brick', color: '#A04632' },
          roof: { material: 'marble', color: '#555555' },
          trim: 'white',
        }) +
        '\n```'
    );
    expect(r!.volumes).toHaveLength(1);
    // An unknown kind falls back to a window; an unknown view drops the opening.
    expect(r!.openings).toEqual([{ view: 'front', kind: 'window', box: [0.1, 0.5, 0.2, 0.7] }]);
    expect(r!.walls).toEqual({ material: 'brick', color: '#a04632' });
    expect(r!.roof).toBeNull();
    expect(r!.trim).toBeNull();
  });

  it('is null for an answer with no volume', () => {
    expect(parseHouseReading('{"volumes":[],"openings":[]}')).toBeNull();
    expect(parseHouseReading('not json')).toBeNull();
  });

  it('names every image of the question in order', () => {
    const q = buildHouseQuestion('house', ['front', 'right', 'top']);
    expect(q).toContain('image 1 = the FRONT elevation');
    expect(q).toContain('image 2 = the RIGHT side elevation');
    expect(q).toContain('image 3 = the VIEW FROM ABOVE');
  });
});

describe('house fit PQ-T73 parts', () => {
  const views = { front: frontView() };
  const mirrored = {};

  it('keeps a balcony at its storey while a deck stays low', () => {
    const plan = fitHouse({
      reading: reading({
        volumes: [
          ...reading().volumes,
          {
            kind: 'balcony',
            plan: [0.5, 0.9, 0.85, 1],
            eave: 0.45,
            ridge: 0.45,
            roof: 'none',
            ridgeAxis: 'x',
            open: ['front'],
            floor: 0.5,
          },
        ],
      }),
      views,
      mirrored,
    })!;
    expect(plan.volumes.find((v) => v.kind === 'balcony')!.floor).toBeCloseTo(0.5, 3);
    expect(plan.volumes.find((v) => v.kind === 'veranda')!.floor!).toBeLessThanOrEqual(DECK_MAX);
  });

  it('dresses the largest block in the main finishes, whatever the reading says', () => {
    const base = reading();
    const plan = fitHouse({
      reading: {
        ...base,
        volumes: [
          { ...base.volumes[0]!, wallFinish: 'wall2', roofFinish: 'roof2' },
          base.volumes[1]!,
        ],
      },
      views,
      mirrored,
    })!;
    expect(plan.volumes[0]!.wallFinish).toBeUndefined();
    expect(plan.volumes[0]!.roofFinish).toBeUndefined();
  });

  it('stands a balcony read without its floor on the veranda under it', () => {
    const base = reading();
    const plan = fitHouse({
      reading: {
        ...base,
        volumes: [
          base.volumes[0]!,
          { ...base.volumes[1]!, eave: 0.6 },
          { ...base.volumes[1]!, kind: 'balcony', eave: 0.5, floor: undefined },
        ],
      },
      views,
      mirrored,
    })!;
    expect(plan.volumes[2]!.floor).toBeCloseTo(0.4, 3);
  });

  it('keeps finishes, arcades, trusses and heads, and drops a pier read twice', () => {
    const base = reading();
    const plan = fitHouse({
      reading: {
        ...base,
        volumes: [
          base.volumes[0]!,
          { ...base.volumes[1]!, arcade: 'segment' },
          {
            kind: 'wing',
            plan: [0.6, 0.97, 0.1, 0.4],
            eave: 0.5,
            ridge: 0.3,
            roof: 'shed',
            ridgeAxis: 'x',
            roofFinish: 'roof2',
            wallFinish: 'stone',
          },
        ],
        openings: [{ ...base.openings[0]!, head: 'arch' }],
        piers: [
          { plan: [0.0, 0.04, 0.95, 1], top: 0.45, band: 0.8 },
          { plan: [0.005, 0.04, 0.955, 1], top: 0.45 },
          { plan: [0.5, 0.501, 0.95, 1], top: 0.45 },
        ],
        type: 'villa',
      },
      views,
      mirrored,
    })!;
    expect(plan.volumes[2]).toMatchObject({ roofFinish: 'roof2', wallFinish: 'stone' });
    expect(plan.volumes[1]!.arcade).toBe('segment');
    expect(plan.openings[0]!.head).toBe('arch');
    expect(plan.piers).toEqual([{ plan: [0, 0.04, 0.95, 1], top: 0.55, band: 0.2 }]);
    expect(plan.type).toBe('villa');
  });

  it('builds the PQ-T72 plan when the reading has none of the new parts', () => {
    const plan = fitHouse({ reading: reading(), views, mirrored })!;
    expect(plan.piers).toBeUndefined();
    expect(plan.type).toBeUndefined();
    expect(plan.look.stone).toBeUndefined();
    expect(plan.volumes.some((v) => v.wallFinish || v.roofFinish || v.arcade || v.truss)).toBe(
      false
    );
  });

  it('measures each finish in its sample box, not over the whole facade', () => {
    const plan = fitHouse({
      reading: reading({
        finishes: [
          // On the brick only, and on the window (its own colour: a second cladding here).
          { finish: 'wall', material: 'brick', view: 'front', box: [0.05, 0.8, 0.5, 0.95] },
          { finish: 'wall2', material: 'metal', view: 'front', box: [0.62, 0.57, 0.78, 0.73] },
          { finish: 'stone', material: 'stone', color: '#887766' },
        ],
      }),
      views,
      mirrored,
    })!;
    expect(plan.look.wall.color).toBe('#a04632');
    expect(plan.look.wall2).toEqual({ material: 'metal', color: '#3c5064' });
    // No box: the colour the specialist gave.
    expect(plan.look.stone).toEqual({ material: 'stone', color: '#887766' });
  });

  it('reads a sample box backwards on a mirrored drawing', () => {
    const g = frontView();
    // Columns 60–79 hold the window: mirrored, the drawing has it at 0.2–0.4.
    expect(sampleColor(g, [0.22, 0.57, 0.38, 0.73], true)).toEqual([...GLASS]);
    expect(sampleColor(g, [0.22, 0.57, 0.38, 0.73], false)).toEqual([...BRICK]);
    expect(sampleColor(g, [0.5, 0.5, 0.501, 0.501], false)).toBeNull();
  });

  it("cuts each sampled finish's swatch inside its box", () => {
    const plan = fitHouse({ reading: reading(), views, mirrored })!;
    const patches = housePatches(plan, views, null, [
      { finish: 'wall2', material: 'metal', view: 'front', box: [0.6, 0.55, 0.8, 0.75] },
    ]);
    const [s0, s1, y0, y1] = patches.wall2!.box;
    expect(s0).toBeGreaterThanOrEqual(0.6);
    expect(s1).toBeLessThanOrEqual(0.8);
    expect(y0).toBeGreaterThanOrEqual(0.25);
    expect(y1).toBeLessThanOrEqual(0.45);
    expect(patches.wall).toBeDefined();
  });

  it('cuts no wall swatch for figured walls: they keep their drawing (PQ-T74)', () => {
    const plan = fitHouse({ reading: reading(), views, mirrored })!;
    const box = [0.1, 0.65, 0.3, 0.85];
    const wall = { finish: 'wall' as const, material: 'plaster' as const, view: 'front' as const };
    expect(housePatches(plan, views, null, [{ ...wall, box }]).wall).toBeDefined();
    expect(housePatches(plan, views, null, [{ ...wall, box, figured: true }]).wall).toBeUndefined();
  });

  it('keeps only real piers: too thin or under the ground line are dropped', () => {
    expect(
      fitPiers([
        { plan: [0.1, 0.105, 0.9, 1], top: 0.5 },
        { plan: [0.2, 0.25, 0.9, 1], top: 0.99 },
        // A post base (3 % high), not a pier.
        { plan: [0.4, 0.45, 0.9, 1], top: 0.97 },
        { plan: [0.3, 0.35, 1, 0.9], top: 0.5 },
      ])
    ).toEqual([{ plan: [0.3, 0.35, 0.9, 1], top: 0.5 }]);
  });

  it('measures the base at the foot of the front walls when the reading gives none (PQ-T74)', () => {
    // A red plinth over the lowest 3 rows, a door standing in it.
    const view = frontView();
    for (let y = 97; y < 100; y++)
      for (let x = 0; x < 100; x++)
        view.rgb.set(x >= 10 && x < 20 ? [20, 20, 20] : [150, 30, 30], (y * 100 + x) * 3);
    const door = [{ view: 'front' as const, kind: 'door' as const, box: [0.1, 0.7, 0.2, 1] }];
    const plan = fitHouse({
      reading: reading({ openings: door }),
      views: { front: view },
      mirrored: {},
    })!;
    expect(plan.look.base).toBe('#961e1e');
    // A base the reading gives is kept as read.
    const given = fitHouse({
      reading: reading({ openings: door, base: '#112233' }),
      views: { front: view },
      mirrored: {},
    })!;
    expect(given.look.base).toBe('#112233');
    expect(measuredBase(undefined, plan.volumes, [])).toBeNull();
  });

  it('grows a block over the strip of footprint along it instead of adding an annex (PQ-T74)', () => {
    // View from above drawn everywhere; the body read stops short of the front (z 0.86).
    const [cols, rows] = [100, 100];
    const top: GridView = {
      cols,
      rows,
      rgb: new Uint8Array(cols * rows * 3),
      mask: new Uint8Array(cols * rows).fill(1),
    };
    const body: HouseVolume = {
      kind: 'body',
      plan: [0, 1, 0, 0.86],
      eave: 0.5,
      ridge: 1,
      roof: 'hip',
      ridgeAxis: 'x',
    };
    const grown = growToFootprint([body], top);
    expect(grown[0]!.plan).toEqual([0, 1, 0, 1]);
    expect(footprintAnnexes(grown, top)).toEqual([]);
    // A deep part left out is another block, not the same one deeper.
    const short = { ...body, plan: [0, 1, 0, 0.7] as HouseVolume['plan'] };
    expect(growToFootprint([short], top)[0]!.plan).toEqual(short.plan);
    // A strip along a small share of the block's side stays an annex.
    const mask = new Uint8Array(cols * rows).fill(1);
    for (let r = 86; r < 100; r++) for (let c = 40; c < 100; c++) mask[r * cols + c] = 0;
    expect(growToFootprint([body], { ...top, mask })[0]!.plan).toEqual(body.plan);
  });

  it('keeps the roof of a narrow annex no steeper than ANNEX_PITCH (PQ-T74)', () => {
    const [cols, rows] = [100, 100];
    const mask = new Uint8Array(cols * rows).fill(1);
    const top: GridView = { cols, rows, rgb: new Uint8Array(cols * rows * 3), mask };
    const body: HouseVolume = {
      kind: 'body',
      plan: [0, 1, 0.2, 1],
      eave: 0.4,
      ridge: 0.9,
      roof: 'hip',
      ridgeAxis: 'x',
    };
    // A small back wing 0.2 wide and deep, the house half as high as wide.
    for (let r = 0; r < 20; r++) for (let c = 0; c < 80; c++) mask[r * cols + c] = 0;
    const [annex] = footprintAnnexes([body], top, [0.8], [], 0.5);
    expect(annex!.plan).toEqual([0.8, 1, 0, 0.2]);
    expect(annex!.ridge).toBeCloseTo(0.4 + (ANNEX_PITCH * 0.1) / 0.5, 3);
    // Without the house's height (no front drawing), the block's ridge as before.
    expect(footprintAnnexes([body], top, [0.8])[0]!.ridge).toBe(0.9);
  });

  it('gives the chimneys the masonry finish when one is read (PQ-T74)', () => {
    const view = frontView();
    const plain = fitHouse({ reading: reading(), views: { front: view }, mirrored: {} })!;
    expect(plain.chimneys[0]).not.toHaveProperty('finish');
    const brick = fitHouse({
      reading: reading({ finishes: [{ finish: 'stone', material: 'brick', color: '#7b4a3b' }] }),
      views: { front: view },
      mirrored: {},
    })!;
    expect(brick.chimneys[0]!.finish).toBe('stone');
  });

  it('tells a swatch whose pattern runs oblique (PQ-T74)', () => {
    const [w, h] = [64, 64];
    const stripes = (f: (x: number, y: number) => number) => {
      const rgb = new Uint8Array(w * h * 3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          rgb.fill(
            Math.round(128 + 100 * Math.sin(f(x, y) / 2)),
            (y * w + x) * 3,
            (y * w + x) * 3 + 3
          );
      return rgb;
    };
    // Courses level or boards upright repeat cleanly; rows at 35° do not.
    expect(
      swatchOblique(
        stripes((_, y) => y),
        w,
        h
      )
    ).toBe(false);
    expect(
      swatchOblique(
        stripes((x) => x),
        w,
        h
      )
    ).toBe(false);
    const a = (35 * Math.PI) / 180;
    expect(
      swatchOblique(
        stripes((x, y) => x * Math.sin(a) + y * Math.cos(a)),
        w,
        h
      )
    ).toBe(true);
    // No direction at all (plain plaster): kept.
    expect(swatchOblique(new Uint8Array(w * h * 3).fill(200), w, h)).toBe(false);
    let seed = 7;
    const noise = new Uint8Array(w * h * 3).map(
      () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24
    );
    expect(swatchOblique(noise, w, h)).toBe(false);
  });

  it('gives a block the cladding of its lower storey when it is drawn another one (PQ-T74)', () => {
    // Front: dark boards above the floor band (y 0.3), cream plaster under it.
    const view = frontView();
    for (let y = 70; y < 100; y++)
      for (let x = 0; x < 100; x++) view.rgb.set([230, 215, 180], (y * 100 + x) * 3);
    const body: HouseVolume = {
      kind: 'body',
      plan: [0, 1, 0, 1],
      eave: 0.6,
      ridge: 1,
      roof: 'hip',
      ridgeAxis: 'x',
      bands: [0.3],
    };
    const look = {
      wall: { material: 'brick' as const, color: '#a04632' },
      roof: { material: 'slate' as const, color: '#5a5a60' },
      trim: '#ffffff',
      glass: '#4d6475',
      door: '#5a3d2b',
      base: '#8f8a80',
      wall2: { material: 'plaster' as const, color: '#e7d8b4' },
    };
    expect(lowerFinishes([body], look, { front: view })[0]!.lower).toEqual({
      finish: 'wall2',
      top: 0.3,
    });
    // No second cladding read, no floor band, or one cladding all the way down: unchanged.
    expect(lowerFinishes([body], { ...look, wall2: undefined }, { front: view })[0]).toBe(body);
    const noBand = { ...body, bands: undefined };
    expect(lowerFinishes([noBand], look, { front: view })[0]).toBe(noBand);
    expect(lowerFinishes([body], look, { front: frontView() })[0]).toBe(body);
    // Figured walls, or a lower storey of many colours (timbers over infill): no plain cladding.
    expect(lowerFinishes([body], look, { front: view }, true)[0]).toBe(body);
    const framed = frontView();
    for (let y = 70; y < 100; y++)
      for (let x = 0; x < 100; x++)
        framed.rgb.set(
          [
            [230, 215, 180],
            [120, 30, 30],
            [250, 250, 250],
          ][(x + y) % 3]!,
          (y * 100 + x) * 3
        );
    expect(lowerFinishes([body], look, { front: framed })[0]).toBe(body);
    // A gable end (A-frame: no eave wall) is read up to its ridge.
    const aframe: HouseVolume = { ...body, eave: 0, roof: 'gable', ridgeAxis: 'z' };
    expect(lowerFinishes([aframe], look, { front: view })[0]!.lower?.finish).toBe('wall2');
    // A block standing in front hides the lower storey: nothing is read through it.
    const porch: HouseVolume = { ...body, kind: 'annex', plan: [0, 1, 1, 1], eave: 0.3, bands: [] };
    const hidden = lowerFinishes([{ ...body, plan: [0, 1, 0, 0.9] }, porch], look, { front: view });
    expect(hidden[0]!.lower).toBeUndefined();
  });

  it('turns a hip into a gable where windows are drawn in a peaked gable end (PQ-T75)', () => {
    const body: HouseVolume = {
      kind: 'body',
      plan: [0, 1, 0, 1],
      eave: 0.5,
      ridge: 1,
      roof: 'hip',
      ridgeAxis: 'x',
    };
    // Outline rising to a peak in the middle (a gable end), or level (the long side of a roof).
    const peak = Array.from({ length: 100 }, (_, i) => 0.5 + 0.5 * (1 - Math.abs(i - 49.5) / 50));
    const level = Array.from({ length: 100 }, () => 1);
    const win = (wall: 'front' | 'back' | 'right', y0: number) => ({
      wall,
      box: [0.45, 0.55, y0, y0 + 0.1],
    });
    const gable = [win('front', 0.6), win('back', 0.6)];
    expect(gableEnds([body], gable, peak, level)[0]).toMatchObject({
      roof: 'gable',
      ridgeAxis: 'z',
    });
    // Windows above the eave under a level outline (dormers on the long slope): still a hip.
    expect(gableEnds([body], gable, level, peak)[0]).toBe(body);
    // One window only, or windows under the eave: still a hip.
    expect(gableEnds([body], [win('front', 0.6)], peak, level)[0]).toBe(body);
    expect(gableEnds([body], [win('front', 0.2), win('back', 0.2)], peak, level)[0]).toBe(body);
    // On the side walls: the ridge runs along x.
    const sides = [win('right', 0.6), win('right', 0.75)];
    expect(gableEnds([body], sides, level, peak)[0]).toMatchObject({
      roof: 'gable',
      ridgeAxis: 'x',
    });
  });
});
