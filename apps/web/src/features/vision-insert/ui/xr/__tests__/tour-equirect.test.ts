import { describe, expect, it } from 'vitest';
import {
  dirFromYawPitch,
  equirectUv,
  equirectYawPitch,
  projectDir,
  projectPanoBox,
  renderView,
  uFrontFacing,
  unprojectUv,
  viewBasis,
  type CaptureView,
} from '../tour/equirect';

const VIEW: CaptureView = { yaw: 0.4, pitch: -0.1, hfov: (80 * Math.PI) / 180, aspect: 16 / 9 };

describe('equirect mapping (360° tour, VS-T14)', () => {
  it('shows uFront straight ahead; turning right moves right in the photo', () => {
    expect(equirectUv(dirFromYawPitch(0, 0), 0.3).u).toBeCloseTo(0.3);
    expect(equirectUv(dirFromYawPitch(0.5, 0), 0.3).u).toBeGreaterThan(0.3);
    expect(equirectUv(dirFromYawPitch(0, 0.5), 0.3).v).toBeLessThan(0.5); // up = top
  });

  it('inverts: image point → heading → image point (across the seam too)', () => {
    for (const [u, v] of [
      [0.1, 0.4],
      [0.97, 0.6],
      [0.5, 0.2],
    ] as const) {
      const { yaw, pitch } = equirectYawPitch(u, v, 0.9);
      const back = equirectUv(dirFromYawPitch(yaw, pitch), 0.9);
      expect(back.u).toBeCloseTo(u, 6);
      expect(back.v).toBeCloseTo(v, 6);
    }
  });

  it('uFrontFacing puts a chosen image column in front of a viewer facing any way', () => {
    const uFront = uFrontFacing(0.85, 1.2);
    expect(equirectUv(dirFromYawPitch(1.2, 0), uFront).u).toBeCloseTo(0.85, 6);
  });
});

describe('capture view (scan photo)', () => {
  it('projects its own pixel directions back to the same pixel', () => {
    const b = viewBasis(VIEW);
    const p = projectDir(unprojectUv(0.2, 0.7, b), b)!;
    expect(p.u).toBeCloseTo(0.2, 6);
    expect(p.v).toBeCloseTo(0.7, 6);
    expect(projectDir(dirFromYawPitch(VIEW.yaw + Math.PI, 0), b)).toBeNull(); // behind
  });

  it('renders the panorama column in front at the photo centre', () => {
    // 8×4 panorama: one red column at u = 0.5–0.625, rest black.
    const src = { width: 8, height: 4, data: new Uint8ClampedArray(8 * 4 * 4) };
    for (let y = 0; y < 4; y++) src.data[(y * 8 + 4) * 4] = 255;
    const out = { width: 9, height: 5, data: new Uint8ClampedArray(9 * 5 * 4) };
    renderView(src, out, { yaw: 0, pitch: 0, hfov: 0.2, aspect: 9 / 5 }, 0.5625);
    const centre = (2 * 9 + 4) * 4;
    expect(out.data[centre]).toBeGreaterThan(200);
    expect(out.data[centre + 3]).toBe(255);
  });
});

describe('projectPanoBox (ground truth in the scan photo)', () => {
  it('maps a box in front into the photo, and drops boxes out of frame', () => {
    const uFront = 0.5;
    const box = { u0: 0.49, v0: 0.45, u1: 0.51, v1: 0.55 };
    const r = projectPanoBox(box, uFront, { ...VIEW, yaw: 0, pitch: 0 })!;
    expect(r.x + r.w / 2).toBeCloseTo(0.5, 2);
    expect(r.y + r.h / 2).toBeCloseTo(0.5, 2);
    expect(projectPanoBox({ u0: 0.0, v0: 0.45, u1: 0.02, v1: 0.55 }, uFront, VIEW)).toBeNull();
  });

  it('handles a box across the image seam (u1 < u0)', () => {
    const r = projectPanoBox({ u0: 0.99, v0: 0.45, u1: 0.01, v1: 0.55 }, 0, {
      ...VIEW,
      yaw: 0,
      pitch: 0,
    });
    expect(r).not.toBeNull();
    expect(r!.x + r!.w / 2).toBeCloseTo(0.5, 2);
  });
});
