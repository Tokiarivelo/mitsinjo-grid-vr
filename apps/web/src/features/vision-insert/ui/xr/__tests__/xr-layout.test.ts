import { describe, expect, it } from 'vitest';
import {
  AIR_BOB,
  AIR_CARD,
  AIR_CRYSTAL_Y,
  AIR_RINGS_RADIUS,
  anchorAhead,
  faceOrigin,
  MENU_CLOSE_OFFSET,
  MENU_CLOSE_SIZE,
  MENU_SCAN_OFFSET,
  miniatureSlot,
  CAROUSEL_RADIUS,
  deskPivot,
  deskTurnAngle,
  deskYaw,
  EXTRACT_DISTANCE,
  LAB_TO_VIEWS,
  EXTRACT_DROP,
  slidePose,
} from '../xr-layout';

describe('anchorAhead (VS-T19)', () => {
  it('sits ahead along the horizontal heading, below the eyes, level', () => {
    const a = anchorAhead([0, 1.6, 0], [0, -0.5, -1]);
    expect(a.yaw).toBeCloseTo(0);
    expect(a.position).toEqual([0, Number((1.6 - EXTRACT_DROP).toFixed(3)), -EXTRACT_DISTANCE]);
  });
  it('follows a turned head (right = +X)', () => {
    const a = anchorAhead([1, 1.6, 2], [1, 0, 0]);
    expect(a.yaw).toBeCloseTo(Math.PI / 2);
    expect(a.position[0]).toBeCloseTo(1 + EXTRACT_DISTANCE);
    expect(a.position[2]).toBeCloseTo(2);
  });
  it('keeps the last heading looking straight down (no NaN)', () => {
    expect(anchorAhead([0, 1.6, 0], [0, -1, 0]).yaw).toBe(0);
  });
});

describe('slidePose (VS-T20)', () => {
  it('puts the focused slide straight ahead, the others on the arc round the eye', () => {
    expect(slidePose(0)).toEqual({
      position: [0, 0, Number((EXTRACT_DISTANCE - CAROUSEL_RADIUS).toFixed(3))],
      yaw: -0,
      focus: 1,
    });
    const right = slidePose(1);
    expect(right.position[0]).toBeGreaterThan(0);
    expect(right.focus).toBe(0);
    // Every slide is the same distance from the eye (at +EXTRACT_DISTANCE in panel space).
    for (const rel of [-2, -0.5, 0, 1.3]) {
      const p = slidePose(rel).position;
      expect(Math.hypot(p[0], p[2] - EXTRACT_DISTANCE)).toBeCloseTo(CAROUSEL_RADIUS, 2);
    }
  });
});

describe('studio desks turntable (VS-T31)', () => {
  it('turns right to left toward the 3D lab, back the other way', () => {
    expect(deskTurnAngle('3d', 0)).toBe(0);
    expect(deskTurnAngle('3d', 1)).toBeCloseTo(Math.PI);
    expect(deskTurnAngle('3d', 0.5)).toBeCloseTo(Math.PI / 2);
    expect(deskTurnAngle('2d', 0)).toBeCloseTo(Math.PI);
    expect(deskTurnAngle('2d', 1)).toBe(0);
    // Eased: slow start, never past the ends.
    expect(deskTurnAngle('3d', 0.1)).toBeLessThan(Math.PI * 0.1);
    expect(deskTurnAngle('3d', 2)).toBeCloseTo(Math.PI);
  });
  it('keeps the desks back to back: the 3D desk comes in from the right', () => {
    expect(deskYaw('2d', 0)).toBe(0);
    expect(deskYaw('3d', Math.PI)).toBe(0);
    // Half way: 2D desk on the left (+yaw, counter-clockwise), 3D desk on the right.
    expect(deskYaw('2d', Math.PI / 2)).toBeGreaterThan(0);
    expect(deskYaw('3d', Math.PI / 2)).toBeLessThan(0);
  });
  it('centres the turntable on the viewer who set the anchor', () => {
    const eye: [number, number, number] = [1, 1.6, 2];
    const a = anchorAhead(eye, [1, 0, 0]);
    const p = deskPivot(a);
    expect(p[0]).toBeCloseTo(1);
    expect(p[2]).toBeCloseTo(2);
    expect(p[1]).toBe(a.position[1]);
  });
  it('turns the « 2D lab » button toward the viewer, on the far left', () => {
    const [x, , z] = LAB_TO_VIEWS.position;
    expect(x).toBeLessThan(-0.9);
    // Facing the eye at (0, 0, EXTRACT_DISTANCE) in panel space.
    expect(Math.atan2(-x, EXTRACT_DISTANCE - z)).toBeCloseTo(LAB_TO_VIEWS.yaw, 2);
    expect(Math.hypot(x, EXTRACT_DISTANCE - z)).toBeCloseTo(LAB_TO_VIEWS.distance, 1);
  });
});

describe('wrist menu layout (VS-T32)', () => {
  it('keeps the crystal and its rings above the scan card (they hid its title)', () => {
    // The whole button bobs together: the rings' lowest point stays above the card's top edge.
    expect(AIR_CRYSTAL_Y - AIR_RINGS_RADIUS).toBeGreaterThan(AIR_CARD.height / 2);
  });
  it('puts « Close » above the card top right, clear of the bobbing card and the rings', () => {
    const [x, y] = MENU_CLOSE_OFFSET;
    const cardTop = MENU_SCAN_OFFSET[1] + AIR_CARD.height / 2 + AIR_BOB;
    expect(y - MENU_CLOSE_SIZE.height / 2).toBeGreaterThan(cardTop);
    expect(x - MENU_CLOSE_SIZE.width / 2).toBeGreaterThan(AIR_RINGS_RADIUS);
    expect(x + MENU_CLOSE_SIZE.width / 2).toBeLessThanOrEqual(AIR_CARD.width / 2);
  });
});

describe('faceOrigin (VS-T32)', () => {
  it('turns a miniature card toward the viewer at the origin', () => {
    for (const i of [0, 1, 2, 3]) {
      const slot = miniatureSlot(i);
      const yaw = faceOrigin(slot);
      // Front normal (sin yaw, 0, cos yaw) points from the slot back to the origin.
      const len = Math.hypot(slot[0], slot[2]);
      expect(Math.sin(yaw)).toBeCloseTo(-slot[0] / len, 2);
      expect(Math.cos(yaw)).toBeCloseTo(-slot[2] / len, 2);
    }
  });
});
