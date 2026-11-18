import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  clampToRadius,
  StudioLocomotion,
  teleportTarget,
  toWalkSpace,
  walkVelocity,
} from '../studio-locomotion';
import { TOUR_WALK_SPEED } from '../tour/tour-nav';

const settle = async (loco: StudioLocomotion) => {
  for (let i = 0; i < 50 && !loco.isReady(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(loco.isReady()).toBe(true);
};

describe('studio locomotion on IWSDK (IW-T2)', () => {
  it('pure helpers: radius clamp, head-relative velocity, walk space, arc target', () => {
    expect(clampToRadius([3, 4], 2.5)).toEqual([1.5, 2]);
    const inside: [number, number] = [0.5, 0.5];
    expect(clampToRadius(inside, 2)).toBe(inside);
    // Looking ahead (yaw 0 = -Z), stick forward: walk speed towards -Z.
    const [vx, vz] = walkVelocity({ forward: 1, strafe: 0 }, 0);
    expect(vx).toBeCloseTo(0);
    expect(vz).toBeCloseTo(-TOUR_WALK_SPEED);
    expect(toWalkSpace(new THREE.Vector3(1, 1.5, -1), [0.5, 2], new THREE.Vector3())).toEqual(
      new THREE.Vector3(1.5, 1.5, 1)
    );
    expect(teleportTarget(null, 2)).toBeNull();
    expect(teleportTarget(new THREE.Vector3(6, 0, 8), 2)).toEqual([1.2, 1.6]);
  });

  it('the left stick slides the viewer forward and never past the radius', async () => {
    const loco = new StudioLocomotion(1);
    await settle(loco);
    let g = loco.ground();
    for (let i = 0; i < 30; i++) g = loco.walk({ forward: 1, strafe: 0 }, 0, 1 / 60);
    expect(g[1]).toBeLessThan(-0.1); // moved towards -Z
    for (let i = 0; i < 400; i++) g = loco.walk({ forward: 1, strafe: 0 }, 0, 1 / 60);
    expect(Math.hypot(g[0], g[1])).toBeLessThanOrEqual(1 + 1e-6);
    loco.dispose();
  });

  it('the arc lands on the floor ahead and gives a teleport target; place() moves there', async () => {
    const loco = new StudioLocomotion(2.4);
    await settle(loco);
    const origin = new THREE.Vector3(0, 1.2, 0);
    const dir = new THREE.Vector3(0, 0.3, -1).normalize();
    const target = loco.aim(origin, dir);
    expect(target).not.toBeNull();
    expect(target![1]).toBeLessThan(-0.5);
    expect(loco.arc[0]!.distanceTo(origin)).toBeCloseTo(0);
    expect(loco.arc.at(-1)!.y).toBeCloseTo(0, 1);
    loco.place(target!);
    expect(loco.ground()[1]).toBeCloseTo(target![1]);
    // Far throw: the target is pulled back to the walk edge.
    const far = loco.aim(origin, new THREE.Vector3(0, 0.7, -1).normalize());
    expect(Math.hypot(far![0], far![1])).toBeCloseTo(2.4);
    loco.dispose();
  });
});
