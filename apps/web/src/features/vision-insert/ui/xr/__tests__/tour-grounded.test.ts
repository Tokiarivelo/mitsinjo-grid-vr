import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../tour/equirect';
import { groundedDistance, groundedPoint, photoRay, type PhotoGround } from '../tour/grounded';
import { captureViewAt, TOUR_EYE } from '../tour/tour-nav';
import { projectDetectionsTo3D } from '../spatial-projection';
import { surfaceFromView } from '../webcam-screen';
import { viewBasis } from '../tour/equirect';

const ground = (offset: Vec3 = [0, 0, 0]): PhotoGround => ({
  eye: TOUR_EYE,
  wall: 4,
  floor: 1.6,
  offset,
  step: 0,
});

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

describe('grounded 360° photo (walk-stable outlines)', () => {
  it('meets the wall straight ahead and the floor looking down', () => {
    expect(groundedDistance([0, 0, 0], [0, 0, -1], 4, 1.6)).toBeCloseTo(4);
    const down = norm([0, -1, -1]);
    const p = groundedPoint(down, 4, 1.6);
    expect(p[1]).toBeCloseTo(-1.6);
  });

  it('at the photo spot a ray keeps its direction', () => {
    const d = norm([0.3, -0.2, -1]);
    const r = photoRay(TOUR_EYE, d, ground());
    r.dir.forEach((c, i) => expect(c).toBeCloseTo(d[i]!));
  });

  it('after walking, aiming at a photo point still finds it (same point, same direction)', () => {
    // Photo point straight ahead on the wall, seen from the spot.
    const g = ground([0.8, 0, -0.5]); // viewer walked 0.8 m right, 0.5 m forward
    const local = groundedPoint([0, 0, -1], g.wall, g.floor);
    // That point in the world now (the photo moved against the walk).
    const world: Vec3 = [
      TOUR_EYE[0] + local[0] - g.offset[0],
      TOUR_EYE[1] + local[1] - g.offset[1],
      TOUR_EYE[2] + local[2] - g.offset[2],
    ];
    const head = TOUR_EYE;
    const aim = norm([world[0] - head[0], world[1] - head[1], world[2] - head[2]]);
    const r = photoRay(head, aim, g);
    expect(r.dir[0]).toBeCloseTo(0);
    expect(r.dir[2]).toBeCloseTo(-1);
    r.point.forEach((c, i) => expect(c).toBeCloseTo(world[i]!));
  });

  it('lays tour outlines on the grounded photo, not on a plane in front of the eye', () => {
    const view = captureViewAt(0, 0);
    const screen = surfaceFromView(TOUR_EYE, viewBasis(view), 3);
    const [t] = projectDetectionsTo3D(
      [{ id: 'd', label: 'Lamp', category: 'lamp', box: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 } }],
      { screen, eye: TOUR_EYE, ground: { wall: 4, floor: 1.6 } }
    );
    const c = t!.position;
    const dist = Math.hypot(c[0] - TOUR_EYE[0], c[1] - TOUR_EYE[1], c[2] - TOUR_EYE[2]);
    expect(dist).toBeGreaterThan(3.8);
    expect(dist).toBeLessThan(4);
  });

  it('scans the whole visible view (headset-wide, not a phone crop)', () => {
    const view = captureViewAt(0, 0);
    expect((view.hfov * 180) / Math.PI).toBeGreaterThanOrEqual(100);
    const vfov = 2 * Math.atan(Math.tan(view.hfov / 2) / view.aspect);
    expect((vfov * 180) / Math.PI).toBeGreaterThanOrEqual(85);
  });
});
