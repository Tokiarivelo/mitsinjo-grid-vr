import { describe, expect, it } from 'vitest';
import { CAR_SLOTS, type CarMesh, type CarSlot } from '@/lib/car-mesh';
import { rasterCar } from '../car/car-raster';

/** One triangle facing the front (z +), in the given slot. */
const facing = (slot: CarSlot): CarMesh => ({
  position: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
  normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uv: new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
  slot: Uint8Array.from([CAR_SLOTS.indexOf(slot)]),
});
const colors = Object.fromEntries(CAR_SLOTS.map((s) => [s, '#ff0000'])) as Record<CarSlot, string>;
const at = (rgb: Uint8Array, size: number, x: number, y: number) => [
  ...rgb.subarray((y * size + x) * 3, (y * size + x) * 3 + 3),
];

describe('rasterCar (offline picture of a car mesh, PQ-T78)', () => {
  it('draws the mesh on white paper in its slot colour, lit', () => {
    const size = 32;
    const rgb = rasterCar(facing('front'), { yaw: 0, pitch: 0, size, colors });
    expect(at(rgb, size, 0, 0)).toEqual([255, 255, 255]);
    const [r, g, b] = at(rgb, size, 16, 20);
    expect(r!).toBeGreaterThan(100);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('wears the atlas on drawn slots only, and nothing from behind', () => {
    const size = 32;
    const atlas = { rgb: Uint8Array.from([0, 0, 255]), width: 1, height: 1 };
    const worn = rasterCar(facing('front'), { yaw: 0, pitch: 0, size, colors, atlas });
    expect(at(worn, size, 16, 20)[2]!).toBeGreaterThan(100);
    const bare = rasterCar(facing('tyre'), {
      yaw: 0,
      pitch: 0,
      size,
      colors,
      atlas,
      drawn: new Set<CarSlot>(['front']),
    });
    expect(at(bare, size, 16, 20)[2]).toBe(0);
    // Deterministic.
    expect(rasterCar(facing('front'), { yaw: 1, pitch: 0.3, size, colors })).toEqual(
      rasterCar(facing('front'), { yaw: 1, pitch: 0.3, size, colors })
    );
  });
});
