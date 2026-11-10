import { describe, expect, it } from 'vitest';
import { entryU, TOUR_ROOMS, TOUR_START, TOUR_START_U } from '../tour/tour-data';
import {
  captureViewAt,
  tourArrows,
  tourExpectedDetections,
  TOUR_ARROW_DISTANCE,
  arrowAt,
  keyWalkAxes,
  stepWalk,
  stickWalkAxes,
  tourScale,
  TOUR_WALK_SPEED,
} from '../tour/tour-nav';
import { equirectUv, dirFromYawPitch } from '../tour/equirect';

describe('tour data (six real rooms)', () => {
  it('links every room both ways, and every image path is under /tour/', () => {
    for (const room of Object.values(TOUR_ROOMS)) {
      expect(room.src).toMatch(/^\/tour\/(studio|outdoor)\/\w+\.jpg$/);
      for (const link of room.links) {
        expect(TOUR_ROOMS[link.to].links.some((l) => l.to === room.id)).toBe(true);
      }
    }
  });

  it('arriving through a door faces away from it (the way back is behind)', () => {
    const bedroom = TOUR_ROOMS.bedroom;
    const back = bedroom.links.find((l) => l.to === 'loft')!.u;
    expect(Math.abs(((entryU(bedroom, 'loft') - back + 1) % 1) - 0.5)).toBeLessThan(1e-9);
    expect(entryU(TOUR_ROOMS[TOUR_START], null)).toBe(TOUR_START_U);
  });
});

describe('floor arrows and walking', () => {
  it('lays one arrow per link on the floor, in the doorway direction', () => {
    const uFront = 0.8;
    const arrows = tourArrows(TOUR_ROOMS.loft, uFront);
    expect(arrows.map((a) => a.to)).toEqual(['hall', 'bedroom']);
    for (const a of arrows) {
      expect(Math.hypot(a.position[0], a.position[2])).toBeCloseTo(TOUR_ARROW_DISTANCE, 2);
      expect(a.position[1]).toBeLessThan(0.1);
      const link = TOUR_ROOMS.loft.links.find((l) => l.to === a.to)!;
      expect(equirectUv(dirFromYawPitch(a.yaw, 0), uFront).u).toBeCloseTo(link.u, 6);
    }
  });

  it('walks along the head heading at walking speed, inside the walkable disc', () => {
    const fwd = stepWalk([0, 0], { forward: 1, strafe: 0 }, 0, 0.5, 3);
    expect(fwd[0]).toBeCloseTo(0, 6);
    expect(fwd[1]).toBeCloseTo(-TOUR_WALK_SPEED * 0.5, 6);
    // Facing +X (yaw π/2): forward goes +X, strafe right goes +Z.
    const right = stepWalk([0, 0], { forward: 0, strafe: 1 }, Math.PI / 2, 1, 3);
    expect(right[1]).toBeCloseTo(TOUR_WALK_SPEED, 6);
    // Diagonal is not faster; the disc edge stops the walk.
    const diag = stepWalk([0, 0], { forward: 1, strafe: 1 }, 0, 1, 9);
    expect(Math.hypot(diag[0], diag[1])).toBeCloseTo(TOUR_WALK_SPEED, 6);
    const edge = stepWalk([0, -1.9], { forward: 1, strafe: 0 }, 0, 1, 2);
    expect(Math.hypot(edge[0], edge[1])).toBeCloseTo(2, 6);
    expect(stepWalk([0.3, 0.2], { forward: 0, strafe: 0 }, 1, 1, 2)).toEqual([0.3, 0.2]);
  });

  it('reaches an arrow by walking onto it', () => {
    const arrows = tourArrows(TOUR_ROOMS.loft, 0.8);
    const hall = arrows.find((a) => a.to === 'hall')!;
    const onIt: [number, number] = [hall.position[0] * 0.9, hall.position[2] * 0.9];
    expect(arrowAt(arrows, onIt)?.to).toBe('hall');
    expect(arrowAt(arrows, [0, 0])).toBeNull();
  });

  it('outdoor places are wider than rooms: farther arrows, longer walks', () => {
    expect(tourScale(TOUR_ROOMS.loft).arrow).toBe(TOUR_ARROW_DISTANCE);
    expect(tourScale(TOUR_ROOMS.forest).walk).toBeGreaterThan(tourScale(TOUR_ROOMS.loft).walk);
    const arrows = tourArrows(TOUR_ROOMS.forest, 0);
    expect(Math.hypot(arrows[0]!.position[0], arrows[0]!.position[2])).toBeCloseTo(
      tourScale(TOUR_ROOMS.forest).arrow,
      2
    );
    // Every arrow can be reached inside the walkable disc.
    for (const r of [TOUR_ROOMS.loft, TOUR_ROOMS.forest]) {
      const sc = tourScale(r);
      expect(sc.arrow).toBeLessThan(sc.walk);
    }
  });

  it('reads keys (WASD, ZQSD, arrows) and the thumbstick as walk axes', () => {
    expect(keyWalkAxes(new Set(['z']))).toEqual({ forward: 1, strafe: 0 });
    expect(keyWalkAxes(new Set(['ArrowUp', 'w']))).toEqual({ forward: 1, strafe: 0 });
    expect(keyWalkAxes(new Set(['s', 'q']))).toEqual({ forward: -1, strafe: -1 });
    expect(keyWalkAxes(new Set(['D', 'x']))).toEqual({ forward: 0, strafe: 1 });
    expect(stickWalkAxes([0, 0, 0.5, -1])).toEqual({ forward: 1, strafe: 0.5 });
    expect(stickWalkAxes([0.05, 0.1])).toEqual({ forward: -0, strafe: 0 });
    expect(stickWalkAxes(undefined)).toEqual({ forward: 0, strafe: 0 });
  });
});

describe('ground truth in a scan photo', () => {
  it('finds the loft fridge when looking at it, with its labels and category', () => {
    const uFront = 0.5;
    const fridge = TOUR_ROOMS.loft.objects.find((o) => o.id === 'loft-fridge')!;
    const yaw = ((fridge.box.u0 + fridge.box.u1) / 2 - uFront) * Math.PI * 2;
    const seen = tourExpectedDetections(TOUR_ROOMS.loft, uFront, captureViewAt(yaw, 0));
    const hit = seen.find((d) => d.id === 'loft-fridge');
    expect(hit?.category).toBe('fridge');
    expect(hit?.labels?.fr).toBe('Réfrigérateur');
    expect(hit!.box.x + hit!.box.w / 2).toBeCloseTo(0.5, 1);
  });

  it('keeps scan photos level-ish (no floor-only or ceiling-only photo)', () => {
    expect(captureViewAt(0, -1.5).pitch).toBeGreaterThanOrEqual(-0.6);
    expect(captureViewAt(0, 1.5).pitch).toBeLessThanOrEqual(0.6);
  });
});

describe('outdoor walk (houses, trees, forest)', () => {
  it('leaves the studio through the hall window onto the terrace, and reaches the forest', () => {
    expect(TOUR_ROOMS.hall.links.some((l) => l.to === 'terrace')).toBe(true);
    const seen = new Set<string>(['terrace']);
    const queue = ['terrace'] as (keyof typeof TOUR_ROOMS)[];
    while (queue.length) {
      for (const l of TOUR_ROOMS[queue.shift()!].links) {
        if (!seen.has(l.to)) {
          seen.add(l.to);
          queue.push(l.to);
        }
      }
    }
    for (const id of ['street', 'house', 'garden', 'avenue', 'forest', 'woods']) {
      expect(seen.has(id)).toBe(true);
    }
  });

  it('reports houses, cars and trees as scenery (no load), solar panels and lamps as objects', () => {
    const uFront = 0.55;
    const street = tourExpectedDetections(TOUR_ROOMS.street, uFront, captureViewAt(0, -0.05));
    const car = street.find((d) => d.id === 'street-car-white');
    expect(car).toMatchObject({ kind: 'scenery', scenery: 'vehicle', category: 'other' });
    expect(street.find((d) => d.id === 'street-house-1')?.scenery).toBe('building');
    const terrace = tourExpectedDetections(TOUR_ROOMS.terrace, 0.2, captureViewAt(0, -0.2));
    const solar = terrace.find((d) => d.id === 'terrace-solar');
    expect(solar?.labels?.fr).toBe('Panneaux solaires');
    expect(solar?.kind).toBeUndefined();
  });
});
