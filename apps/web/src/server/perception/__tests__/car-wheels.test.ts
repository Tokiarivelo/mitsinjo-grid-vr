import { describe, expect, it } from 'vitest';
import { CarPlanSchema } from '@/lib/car-plan';
import {
  contactRuns,
  dropShadow,
  measureCar,
  readFrontTrack,
  readProfileWheels,
  trimmedCircle,
} from '../car/car-wheels';
import type { GridView } from '../recon/views';
import { Canvas, COLORS, type Rgb } from './fixtures/draw-views';

/** A Muse-like pale blue sheet. */
const PAPER: Rgb = [186, 215, 235];
const shade = (k: number): Rgb =>
  [PAPER[0] * k, PAPER[1] * k, PAPER[2] * k].map(Math.round) as never;
const RIM: Rgb = [200, 200, 205];

/** The canvas as a grid view: drawn = farther than 26 from the paper. */
const grid = (c: Canvas): GridView => {
  const mask = new Uint8Array(c.cols * c.rows);
  for (let i = 0; i < mask.length; i++)
    mask[i] =
      Math.hypot(
        c.rgb[i * 3]! - PAPER[0],
        c.rgb[i * 3 + 1]! - PAPER[1],
        c.rgb[i * 3 + 2]! - PAPER[2]
      ) > 26
        ? 1
        : 0;
  return { cols: c.cols, rows: c.rows, rgb: c.rgb, mask };
};

/**
 * A profile 300 × 100 cut to the car: body rows 10–70 (clearance 0.30), tyres of radius 22 centred
 * on row 78 at columns 70 and 230, touching the ground, with a light rim of radius 12.
 */
const profile = () =>
  new Canvas(300, 100)
    .rect(0, 0, 300, 100, PAPER)
    .rect(10, 10, 290, 70, COLORS.body)
    .disc(70, 78, 22, COLORS.tyre)
    .disc(230, 78, 22, COLORS.tyre)
    .disc(70, 78, 12, RIM)
    .disc(230, 78, 12, RIM);

describe('readProfileWheels (PQ-T76)', () => {
  it('fits each tyre on the lower arc of the silhouette: centre, radius, rim, clearance, colours', () => {
    const p = readProfileWheels(grid(profile()))!;
    expect(p.wheels).toHaveLength(2);
    for (const [w, z] of [
      [p.wheels[0]!, 70 / 300],
      [p.wheels[1]!, 230 / 300],
    ] as const) {
      expect(w.z).toBeCloseTo(z, 2);
      expect(w.y).toBeCloseTo(0.22, 1);
      expect(w.r).toBeCloseTo(0.22, 1);
      expect(w.rim).toBeGreaterThan(0.4);
      expect(w.rim).toBeLessThan(0.65);
    }
    expect(p.clearance).toBeCloseTo(0.3, 2);
    expect(p.look.tyre).toBe('#19191c');
    expect(p.look.rim).toBe('#c8c8cd');
  });

  it('takes the rubber from the darkest wheel: a skirted wheel in the paint colour is not a tyre (PQ-T78)', () => {
    const GREEN: Rgb = [150, 175, 130];
    // The rear wheel sits under a fender skirt drawn in the body's green; the front one is bare.
    const skirted = profile().disc(70, 78, 22, GREEN).disc(70, 78, 12, RIM);
    expect(readProfileWheels(grid(skirted))!.look.tyre).toBe('#19191c');
    // Both wheels pale: no rubber colour is kept (the default tyre colour stays).
    const pale = skirted.disc(230, 78, 22, GREEN).disc(230, 78, 12, RIM);
    expect(readProfileWheels(grid(pale))!.look.tyre).toBeUndefined();
  });

  it('keeps the circle round when a pipe sticks out beside one tyre', () => {
    const p = readProfileWheels(grid(profile().rect(255, 88, 290, 93, COLORS.tyre)))!;
    expect(p.wheels[1]!.r).toBeCloseTo(0.22, 1);
  });

  it('reads no wheel on a box that sits flat on the ground', () => {
    const box = new Canvas(200, 80).rect(0, 0, 200, 80, PAPER).rect(10, 10, 190, 80, COLORS.wall);
    expect(readProfileWheels(grid(box))).toBeNull();
  });
});

describe('dropShadow (PQ-T76)', () => {
  /** The profile with Muse's ground shadow: soft under the body, dark and blue under the tyres. */
  const shadowed = () =>
    profile()
      .rect(15, 94, 285, 100, shade(0.68))
      .rect(40, 97, 100, 100, shade(0.33))
      .rect(200, 97, 260, 100, shade(0.33))
      .disc(70, 78, 22, COLORS.tyre)
      .disc(230, 78, 22, COLORS.tyre)
      .disc(70, 78, 12, RIM)
      .disc(230, 78, 12, RIM);

  it('a ground shadow merges the wheels into one contact; dropped, the wheels come back', () => {
    const raw = grid(shadowed());
    expect(contactRuns(raw)).toHaveLength(1);
    const p = readProfileWheels(dropShadow(raw, PAPER))!;
    expect(p.wheels).toHaveLength(2);
    expect(p.wheels[0]!.r).toBeCloseTo(0.22, 1);
  });

  it('never drops a neutral dark-grey tyre, nor anything above the ground band', () => {
    const c = new Canvas(10, 10).rect(0, 0, 10, 10, PAPER).rect(0, 0, 10, 10, [60, 60, 60]);
    expect(dropShadow(grid(c), PAPER).mask.every((m) => m === 1)).toBe(true);
    const high = new Canvas(10, 10).rect(0, 0, 10, 10, shade(0.68));
    const out = dropShadow(grid(high), PAPER);
    expect(out.mask[0]).toBe(1);
    expect(out.mask[99]).toBe(0);
  });
});

describe('readFrontTrack and measureCar (PQ-T76)', () => {
  const front = () =>
    new Canvas(200, 100)
      .rect(0, 0, 200, 100, PAPER)
      .rect(20, 0, 180, 80, COLORS.body)
      .rect(25, 60, 45, 100, COLORS.tyre)
      .rect(155, 60, 175, 100, COLORS.tyre);

  it('reads the outer edges of the two tyres and a tyre width on the front', () => {
    expect(readFrontTrack(grid(front()))).toEqual({ x0: 0.125, x1: 0.875, tyre: 0.1 });
  });

  it('builds a valid car plan, null without a wheel', () => {
    const plan = measureCar(grid(profile()), grid(front()))!;
    expect(CarPlanSchema.parse(plan)).toEqual(plan);
    expect(plan.track?.x0).toBe(0.125);
    expect(CarPlanSchema.parse({ wheels: [] })).toEqual({ wheels: [] });
    const flat = new Canvas(50, 20).rect(0, 0, 50, 20, PAPER).rect(0, 2, 50, 20, COLORS.wall);
    expect(measureCar(grid(flat), null)).toBeNull();
  });
});

describe('trimmedCircle', () => {
  it('refits without the points far off the arc', () => {
    const pts: Array<[number, number]> = [];
    for (let a = 0.2; a < Math.PI - 0.2; a += 0.1)
      pts.push([50 + 20 * Math.cos(a), 50 + 20 * Math.sin(a)]);
    pts.push([75, 75], [76, 76]);
    const fit = trimmedCircle(pts)!;
    expect(fit.r).toBeCloseTo(20, 0);
    expect(trimmedCircle(pts.slice(0, 3))).toBeNull();
  });
});
