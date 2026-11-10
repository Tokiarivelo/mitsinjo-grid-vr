// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { PartMask } from '@/lib/object-shape';
import { masksOnObject, type MaskMapGeom } from '../mask-geometry';

/** Photo 100 × 100, crop = whole photo, so crop fractions = photo fractions. */
const geom: MaskMapGeom = {
  photoW: 100,
  photoH: 100,
  box: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
  crop: { left: 0, top: 0, width: 100, height: 100, outWidth: 100, outHeight: 100 },
};
/** The object's outline: the left half of the photo. */
const rings = [
  [
    [0.1, 0.2],
    [0.6, 0.2],
    [0.6, 0.7],
    [0.1, 0.7],
  ] as const,
];
const mask = (concept: string, x: number, y: number): PartMask => ({
  concept,
  box: { x, y, w: 0.04, h: 0.04 },
});

describe('masksOnObject (PQ-T37)', () => {
  it("keeps the masks centred on the object, drops a neighbour's windows (car-side capture)", () => {
    const own = mask('window', 0.3, 0.4);
    const neighbour = mask('window', 0.8, 0.4);
    const building = mask('window', 0.9, 0.05);
    expect(masksOnObject([own, neighbour, building], rings, geom)).toEqual([own]);
  });

  it('keeps every mask without an outline', () => {
    const all = [mask('wheel', 0.3, 0.6), mask('window', 0.9, 0.1)];
    expect(masksOnObject(all, [], geom)).toEqual(all);
  });
});
