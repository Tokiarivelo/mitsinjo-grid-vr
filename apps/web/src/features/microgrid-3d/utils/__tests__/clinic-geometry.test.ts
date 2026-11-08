import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createClinicGeometry } from '../clinic-geometry';

describe('clinic-geometry', () => {
  it('creates non-empty buffer geometries for all material layers', () => {
    const geos = createClinicGeometry();

    expect(geos.whiteFascia).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.woodSlat).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.curtainGlass).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.charcoalTrim).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.roofTop).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.landscape).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.redCross).toBeInstanceOf(THREE.BufferGeometry);

    expect(geos.whiteFascia.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.woodSlat.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.curtainGlass.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.charcoalTrim.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.roofTop.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.landscape.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.redCross.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('bounds stay within clinic sector keep-out footprint', () => {
    const geos = createClinicGeometry();

    // Check overall bounding box across all geometries
    const box = new THREE.Box3();
    for (const geo of Object.values(geos)) {
      geo.computeBoundingBox();
      if (geo.boundingBox) {
        box.union(geo.boundingBox);
      }
    }

    // Footprint bounds
    expect(box.min.x).toBeGreaterThanOrEqual(-4.0);
    expect(box.max.x).toBeLessThanOrEqual(4.0);
    expect(box.min.z).toBeGreaterThanOrEqual(-3.5);
    expect(box.max.z).toBeLessThanOrEqual(3.5);

    // Height bounds: 3-storey building around ~4m height
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(box.max.y).toBeLessThanOrEqual(4.5);
  });
});
