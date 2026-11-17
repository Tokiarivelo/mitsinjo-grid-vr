import { describe, expect, it } from 'vitest';
import { atlasUv, faceSlot } from '../face-atlas';
import {
  SKIN_CAP_INSET,
  skinSample,
  skinUvs,
  toCamera,
  topReach,
  type SkinBox,
} from '../face-skin';

const BOX: SkinBox = [-0.5, -0.5, -0.25, 0.5, 0.5, 0.25];

describe('face skin (VS-T43)', () => {
  it('reads the front tile on a surface the camera sees, framed on the box', () => {
    expect(skinSample([-0.5, 0.5, 0.25], [0, 0, 1], BOX)).toEqual({ tile: 'front', s: 0, t: 0 });
    const mid = skinSample([0, 0, 0.25], [0, 0, 1], BOX);
    expect(mid.s).toBeCloseTo(0.5);
    expect(mid.t).toBeCloseTo(0.5);
  });

  it('reads the side tiles across the depth (back first) and the back tile across the width', () => {
    const right = skinSample([0.5, 0, 0.25], [1, 0, 0], BOX);
    expect(right.tile).toBe('right');
    expect(right.s).toBeCloseTo(1);
    expect(skinSample([-0.5, 0, -0.25], [-1, 0, 0], BOX)).toMatchObject({ tile: 'left', s: 0 });
    expect(skinSample([0.5, 0, -0.25], [0, 0, -1], BOX)).toMatchObject({ tile: 'back', s: 1 });
  });

  it('reads a top on the front, from its front edge up to topReach at its back', () => {
    const front = skinSample([0, 0.5, 0.25], [0, 1, 0], BOX);
    expect(front.tile).toBe('front');
    expect(front.t).toBeCloseTo(SKIN_CAP_INSET);
    const back = skinSample([0, 0, -0.25], [0, 1, 0], BOX);
    expect(back.t).toBeCloseTo(0.5 + SKIN_CAP_INSET - topReach(BOX));
  });

  it('turns into the camera frame of the photo: a side turned to the camera reads the front', () => {
    // Model turned 60°: its right side faces the camera more than its front does.
    const view = { yaw: -Math.PI / 3, pitch: 0 };
    expect(toCamera([1, 0, 0], view)[2]).toBeCloseTo(Math.sin(Math.PI / 3));
    expect(skinSample([0.5, 0, 0], [1, 0, 0], BOX, view).tile).toBe('front');
  });

  it('gives a triangle one tile and each vertex its own atlas uv', () => {
    const position = [-0.5, -0.5, 0.25, 0.5, -0.5, 0.25, 0.5, 0.5, 0.25];
    const normal = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    const uv = skinUvs(position, normal, BOX);
    expect([...uv.slice(0, 2)]).toEqual(atlasUv(faceSlot('front'), 0, 1).map(Math.fround));
    expect([...uv.slice(4, 6)]).toEqual(atlasUv(faceSlot('front'), 1, 0).map(Math.fround));
  });
});
