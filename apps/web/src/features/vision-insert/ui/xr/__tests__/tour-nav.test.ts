import { describe, expect, it } from 'vitest';
import { entryU, TOUR_ROOMS, TOUR_START, TOUR_START_U } from '../tour/tour-data';
import {
  captureViewAt,
  tourArrows,
  tourExpectedDetections,
  TOUR_ARROW_DISTANCE,
  walkTarget,
} from '../tour/tour-nav';
import { equirectUv, dirFromYawPitch } from '../tour/equirect';

describe('tour data (six real rooms)', () => {
  it('links every room both ways, and every image path is under /tour/', () => {
    for (const room of Object.values(TOUR_ROOMS)) {
      expect(room.src).toMatch(/^\/tour\/studio\/\w+\.jpg$/);
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

  it('walking forward picks the arrow ahead, none when no arrow is near the gaze', () => {
    const arrows = tourArrows(TOUR_ROOMS.loft, 0.8);
    const hall = arrows.find((a) => a.to === 'hall')!;
    expect(walkTarget(arrows, hall.yaw + 0.2)).toBe('hall');
    expect(walkTarget([hall], hall.yaw + Math.PI)).toBeNull();
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
