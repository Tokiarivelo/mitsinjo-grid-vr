import { describe, expect, it } from 'vitest';
import type { GridView } from '../recon/views';
import {
  cleanSwatch,
  DECK_MAX,
  dominantColor,
  fitHouse,
  housePatches,
  pickPatch,
  footprintAnnexes,
  outlineHeights,
  ownerOf,
  profileSteps,
  shedFallOf,
  snapOpening,
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
