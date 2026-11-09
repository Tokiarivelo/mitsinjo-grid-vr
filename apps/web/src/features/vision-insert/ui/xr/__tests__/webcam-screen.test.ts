import { describe, expect, it } from 'vitest';
import { pickTargetAtUv, screenHitFromRay, screenPoint, WEBCAM_SCREEN } from '../webcam-screen';

const EYE = { x: 0, y: 1.6, z: 0 };

function rayTo(point: [number, number, number]) {
  const d = { x: point[0] - EYE.x, y: point[1] - EYE.y, z: point[2] - EYE.z };
  const len = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / len, y: d.y / len, z: d.z / len };
}

describe('webcam screen geometry', () => {
  it('puts the image centre straight ahead and the bottom edge on the floor', () => {
    const [x, y, z] = screenPoint(0.5, 0.5);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(WEBCAM_SCREEN.centerY, 6);
    expect(z).toBeCloseTo(-WEBCAM_SCREEN.distance, 6);
    expect(screenPoint(0.5, 1)[1]).toBeCloseTo(0, 6);
  });

  it('reads the video left-to-right and top-to-bottom', () => {
    expect(screenPoint(0.1, 0.5)[0]).toBeLessThan(0);
    expect(screenPoint(0.9, 0.5)[0]).toBeGreaterThan(0);
    expect(screenPoint(0.5, 0.1)[1]).toBeGreaterThan(screenPoint(0.5, 0.9)[1]);
  });

  it.each([
    [0.2137, 0.5506],
    [0.787, 0.631],
    [0.5, 0.05],
    [0.02, 0.98],
  ])('maps a ray at image point (%f, %f) back to that point', (u, v) => {
    const hit = screenHitFromRay(EYE, rayTo(screenPoint(u, v)));
    expect(hit).not.toBeNull();
    expect(hit!.u).toBeCloseTo(u, 4);
    expect(hit!.v).toBeCloseTo(v, 4);
    expect(hit!.distance).toBeGreaterThan(0);
  });

  it('returns null for rays that miss the screen', () => {
    expect(screenHitFromRay(EYE, { x: 0, y: 0, z: 1 })).toBeNull(); // behind
    expect(screenHitFromRay(EYE, { x: 0, y: 1, z: 0 })).toBeNull(); // straight up
    expect(screenHitFromRay(EYE, { x: 0, y: 0.95, z: -0.3 })).toBeNull(); // above the top edge
  });
});

describe('pickTargetAtUv', () => {
  const table = { id: 'table', detection: { box: { x: 0.4, y: 0.5, w: 0.3, h: 0.25 } } };
  const socket = { id: 'socket', detection: { box: { x: 0.45, y: 0.6, w: 0.05, h: 0.06 } } };

  it('picks the smallest box containing the point', () => {
    expect(pickTargetAtUv([table, socket], 0.47, 0.63)?.id).toBe('socket');
    expect(pickTargetAtUv([table, socket], 0.6, 0.55)?.id).toBe('table');
  });

  it('forgives a near miss within the padding, and returns null beyond it', () => {
    expect(pickTargetAtUv([socket], 0.505, 0.63)?.id).toBe('socket');
    expect(pickTargetAtUv([socket], 0.6, 0.63)).toBeNull();
  });
});
