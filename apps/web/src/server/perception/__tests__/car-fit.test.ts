import { describe, expect, it } from 'vitest';
import { CarPlanSchema, type CarPlan, type CarWheel } from '@/lib/car-plan';
import {
  applyCarReading,
  ARCH_CLEARANCE,
  fitCarBody,
  fitColors,
  fitProfile,
  fitSection,
  fitTaper,
  fitWindows,
} from '../car/car-fit';
import type { CarReading } from '../car/car-tools';
import type { GridView } from '../recon/views';
import { Canvas, COLORS } from './fixtures/draw-views';

/** The canvas as a grid view: drawn = not white. */
const grid = (c: Canvas): GridView => {
  const mask = new Uint8Array(c.cols * c.rows);
  for (let i = 0; i < mask.length; i++)
    mask[i] = c.rgb[i * 3]! + c.rgb[i * 3 + 1]! + c.rgb[i * 3 + 2]! < 740 ? 1 : 0;
  return { cols: c.cols, rows: c.rows, rgb: c.rgb, mask };
};

/** Side 300 × 100: body columns 10–289, rows 10–69; tyres of radius 22 on row 78 at 70 and 230. */
const side = () =>
  grid(
    new Canvas(300, 100)
      .rect(10, 10, 290, 70, COLORS.body)
      .rect(100, 15, 200, 35, COLORS.glass)
      .disc(70, 78, 22, COLORS.tyre)
      .disc(230, 78, 22, COLORS.tyre)
  );
const wheels: CarWheel[] = [
  { z: 70 / 300, y: 0.22, r: 0.22 },
  { z: 230 / 300, y: 0.22, r: 0.22 },
];
/** Front 100 × 60: body columns 10–89 rows 20–59, mirrors over the full width on rows 22–25. */
const front = () =>
  grid(
    new Canvas(100, 60)
      .rect(25, 0, 75, 20, COLORS.body)
      .rect(10, 20, 90, 60, COLORS.body)
      .rect(0, 22, 100, 26, COLORS.body)
  );
/** From above 80 × 100 (rows back → front): full width in the middle, narrower ends. */
const top = () =>
  grid(new Canvas(80, 100).rect(20, 0, 60, 10, COLORS.body).rect(0, 10, 80, 100, COLORS.body));

describe('fitProfile', () => {
  it('reads the top and the underside per station, the arches raised over the wheels', () => {
    const p = fitProfile(side(), wheels, 9)!;
    expect(p.z0).toBeCloseTo(10 / 300, 2);
    expect(p.z1).toBeCloseTo(290 / 300, 2);
    expect(p.top).toHaveLength(9);
    // The roof row 10 everywhere: 0.9 of the height.
    for (const t of p.top) expect(t).toBeCloseTo(0.9, 2);
    // Mid-car (station 4 = column 150): the sill, 0.30 above the ground.
    expect(p.bottom[4]).toBeCloseTo(0.3, 2);
    // Over the rear axle the arch clears the tyre.
    const z = p.z0 + ((p.z1 - p.z0) * 2) / 8;
    const dz = (z - wheels[0]!.z) * 3;
    const R = wheels[0]!.r * ARCH_CLEARANCE;
    if (Math.abs(dz) < R)
      expect(p.bottom[2]).toBeGreaterThanOrEqual(0.22 + Math.sqrt(R * R - dz * dz) - 0.002);
    for (let i = 0; i < 9; i++) expect(p.bottom[i]!).toBeLessThan(p.top[i]!);
  });

  it('is null on an empty side', () => {
    expect(fitProfile(grid(new Canvas(30, 10)), [])).toBeNull();
  });
});

describe('fitSection', () => {
  it('caps the upper half at the lower half: mirrors are not the body', () => {
    const half = fitSection(front(), 13)!;
    expect(half).toHaveLength(13);
    expect(Math.max(...half)).toBeCloseTo(0.4, 2);
    // The cabin (top rows) is narrower than the body.
    expect(half[12]!).toBeCloseTo(0.25, 2);
  });
});

describe('fitTaper', () => {
  it('reads the narrowing toward the back on the view from above', () => {
    const taper = fitTaper(top(), 0, 1, 11)!;
    expect(taper[0]).toBeCloseTo(0.5, 2);
    expect(taper[5]).toBe(1);
    expect(taper[10]).toBe(1);
  });
});

describe('fitCarBody', () => {
  it('needs a profile and a section', () => {
    expect(fitCarBody(side(), null, null, wheels)).toBeNull();
    const body = fitCarBody(side(), front(), top(), wheels)!;
    expect(CarPlanSchema.parse({ wheels, body }).body).toEqual(body);
    expect(body.taper).toBeDefined();
  });
});

const reading = (windows: CarReading['windows']): CarReading => ({
  kind: 'sedan',
  windows,
  details: [],
  finishes: [],
  body: { view: 'right', stations: {}, heights: { belt: 0.65 } },
});

describe('fitWindows', () => {
  it('turns drawing shares into the model frame, mirrored sides read backwards', () => {
    const body = fitCarBody(side(), front(), null, wheels)!;
    const out = fitWindows(
      reading([
        {
          view: 'right',
          kind: 'side',
          points: [
            [0.2, 0.05],
            [0.4, 0.05],
            [0.4, 0.3],
          ],
        },
        {
          view: 'top',
          kind: 'sunroof',
          points: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        },
      ]),
      { right: true },
      body
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.points[0]![0]).toBeCloseTo(0.8, 3);
    // y turns up and stays under the roof (0.9), never at 0.95.
    expect(out[0]!.points[0]![1]).toBeCloseTo(0.9, 2);
    expect(out[0]!.points[2]![1]).toBeCloseTo(0.7, 3);
  });
});

describe('fitColors and applyCarReading', () => {
  const plan: CarPlan = { wheels, body: fitCarBody(side(), front(), null, wheels)! };

  it('samples the paint under the belt, wheels and windows left out', () => {
    const c = fitColors(side(), plan, 0.6);
    expect(c.paint).toBe('#c82828');
    expect(c.glass).toBeUndefined();
  });

  it('adds the kind, the windows and the glass colour from the reading', () => {
    const out = applyCarReading(
      plan,
      reading([
        {
          view: 'right',
          kind: 'side',
          points: [
            [100 / 300, 16 / 100],
            [199 / 300, 16 / 100],
            [199 / 300, 34 / 100],
            [100 / 300, 34 / 100],
          ],
        },
      ]),
      side(),
      {}
    );
    expect(out.kind).toBe('sedan');
    expect(out.windows).toHaveLength(1);
    expect(out.look?.paint).toBe('#c82828');
    expect(out.look?.glass).toBe('#bee1e6');
    expect(CarPlanSchema.safeParse(out).success).toBe(true);
  });

  it('keeps the measured plan without a reading', () => {
    const out = applyCarReading(plan, null, side(), {});
    expect(out.kind).toBeUndefined();
    expect(out.windows).toBeUndefined();
    expect(out.look?.paint).toBe('#c82828');
  });
});
