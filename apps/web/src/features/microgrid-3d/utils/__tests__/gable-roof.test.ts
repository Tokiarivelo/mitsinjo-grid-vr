import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGableRoofGeometry } from '../gable-roof';

describe('createGableRoofGeometry', () => {
  it('generates a valid watertight gable roof with correct bounds', () => {
    const geo = createGableRoofGeometry(3, 2, 1, 0.3);

    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute('position').count).toBeGreaterThan(20);
    expect(geo.getAttribute('normal')).toBeDefined();
    expect(geo.getAttribute('uv')).toBeDefined();

    geo.computeBoundingBox();
    const bb = geo.boundingBox!;

    // Height peaks at 1
    expect(bb.max.y).toBeCloseTo(1, 2);
    expect(bb.min.y).toBeCloseTo(0, 2);

    // Width covers width + 2 * overhang = 3 + 0.6 = 3.6
    expect(bb.max.x - bb.min.x).toBeCloseTo(3.6, 2);

    // Depth covers depth + 2 * overhang = 2 + 0.6 = 2.6
    expect(bb.max.z - bb.min.z).toBeCloseTo(2.6, 2);
  });

  it('supports asymmetric solar saltbox roof where front slope is longer for PV coverage', () => {
    const geo = createGableRoofGeometry(4, 2.5, 1.2, 0.4, -0.2);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    expect(bb.max.y).toBeCloseTo(1.2, 2);
  });
});
