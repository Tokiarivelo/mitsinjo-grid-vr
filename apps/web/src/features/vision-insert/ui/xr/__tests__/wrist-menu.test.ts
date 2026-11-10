import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createMenuPose,
  menuPointToWorld,
  menuSpawnScale,
  placeWristButton,
  WRIST_OFFSET_CAMERA,
  WRIST_OFFSET_GRIP,
  WRIST_OFFSET_HAND,
  createWristMenu,
  FOLLOW_ANGLE,
  MENU_DISTANCE,
  MENU_DROP,
  updateLazyFollow,
  yawOfDirection,
} from '../wrist-menu';

describe('wrist menu state', () => {
  it('starts closed with no button placed', () => {
    const toggle = vi.fn();
    const menu = createWristMenu(toggle);
    expect(menu.open).toBe(false);
    expect(menu.buttonVisible).toBe(false);
    expect(menu.wearer).toBeNull();
    menu.toggle();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe('yawOfDirection', () => {
  it('is 0 forward (-Z) and positive to the right (+X)', () => {
    expect(yawOfDirection(0, -1)).toBeCloseTo(0);
    expect(yawOfDirection(1, 0)).toBeCloseTo(Math.PI / 2);
  });
});

describe('updateLazyFollow', () => {
  it('opens in front of the viewer, below the eyes, facing them', () => {
    const pose = updateLazyFollow(createMenuPose(), 0, 1.6, 0, 0, 0.016, true);
    expect(pose.x).toBeCloseTo(0);
    expect(pose.z).toBeCloseTo(-MENU_DISTANCE);
    expect(pose.y).toBeCloseTo(1.6 - MENU_DROP);
    expect(pose.yaw).toBeCloseTo(0);
  });

  it('stays still for small head turns (no head-locked jitter)', () => {
    const pose = updateLazyFollow(createMenuPose(), 0, 1.6, 0, 0, 0.016, true);
    for (let i = 0; i < 60; i++) updateLazyFollow(pose, 0.05, 1.62, 0, FOLLOW_ANGLE * 0.8, 0.016);
    expect(pose.x).toBeCloseTo(0);
    expect(pose.z).toBeCloseTo(-MENU_DISTANCE);
  });

  it('follows the viewer when they turn away, easing there', () => {
    const pose = updateLazyFollow(createMenuPose(), 0, 1.6, 0, 0, 0.016, true);
    updateLazyFollow(pose, 0, 1.6, 0, Math.PI / 2, 0.016);
    expect(pose.goalX).toBeCloseTo(MENU_DISTANCE);
    expect(pose.x).toBeGreaterThan(0);
    expect(pose.x).toBeLessThan(MENU_DISTANCE); // eased, not snapped
    for (let i = 0; i < 120; i++) updateLazyFollow(pose, 0, 1.6, 0, Math.PI / 2, 0.016);
    expect(pose.x).toBeCloseTo(MENU_DISTANCE, 2);
    expect(pose.yaw).toBeCloseTo(Math.PI / 2, 2);
  });

  it('follows the viewer when they walk away', () => {
    const pose = updateLazyFollow(createMenuPose(), 0, 1.6, 0, 0, 0.016, true);
    for (let i = 0; i < 120; i++) updateLazyFollow(pose, 0, 1.6, -1, 0, 0.016);
    expect(pose.z).toBeCloseTo(-1 - MENU_DISTANCE, 2);
  });
});

describe('placeWristButton', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 0);
  const tracked = (x: number, y: number, z: number) => {
    const o = new THREE.Group();
    o.position.set(x, y, z);
    return o;
  };

  it('desktop / not presenting: bottom-left of the camera view, worn by no input', () => {
    const out = new THREE.Vector3();
    expect(placeWristButton(undefined, [null, null], camera, out)).toBeNull();
    expect(out.x).toBeCloseTo(WRIST_OFFSET_CAMERA[0]);
    expect(out.y).toBeCloseTo(1.6 + WRIST_OFFSET_CAMERA[1]);
    expect(out.z).toBeCloseTo(WRIST_OFFSET_CAMERA[2]);
  });

  it('hand tracking: on the left wrist joint', () => {
    const hand = Object.assign(new THREE.Group(), { joints: { wrist: tracked(-0.2, 1.1, -0.3) } });
    const out = new THREE.Vector3();
    const xr = {
      isPresenting: true,
      getHand: () => hand,
      getControllerGrip: () => tracked(0, 0, 0),
    };
    expect(placeWristButton(xr, ['right', 'left'], camera, out)).toBe(1);
    expect(out.x).toBeCloseTo(-0.2 + WRIST_OFFSET_HAND[0]);
    expect(out.y).toBeCloseTo(1.1 + WRIST_OFFSET_HAND[1]);
  });

  it('controllers: on the left grip when the hand is not tracked', () => {
    const hand = Object.assign(new THREE.Group(), { joints: {} });
    hand.visible = false;
    const out = new THREE.Vector3();
    const xr = {
      isPresenting: true,
      getHand: () => hand,
      getControllerGrip: () => tracked(-0.2, 1.0, -0.3),
    };
    expect(placeWristButton(xr, ['left', 'right'], camera, out)).toBe(0);
    expect(out.z).toBeCloseTo(-0.3 + WRIST_OFFSET_GRIP[2]);
  });
});

describe('menuPointToWorld / menuSpawnScale', () => {
  it('maps a menu offset to the world, turning with the menu', () => {
    const pose = updateLazyFollow(createMenuPose(), 0, 1.6, 0, Math.PI / 2, 0.016, true);
    const out = menuPointToWorld(pose, 1, [0, 0, 0.1], new THREE.Vector3());
    // Facing the viewer: local +Z points back to them (-X when the menu is to their right).
    expect(out.x).toBeCloseTo(MENU_DISTANCE - 0.1);
    expect(out.y).toBeCloseTo(1.6 - MENU_DROP);
  });

  it('scales in from 60 % to 100 %', () => {
    expect(menuSpawnScale(0)).toBeCloseTo(0.6);
    expect(menuSpawnScale(1)).toBe(1);
  });
});
