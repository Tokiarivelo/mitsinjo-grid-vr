import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSchoolGeometry } from '../school-geometry';

describe('school-geometry', () => {
  it('creates non-empty buffer geometries for all school material layers', () => {
    const geos = createSchoolGeometry();

    expect(geos.yellowWalls).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.blueWalls).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.redTrim).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.woodTrim).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.roofs).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.glass).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.playground).toBeInstanceOf(THREE.BufferGeometry);
    expect(geos.brassBell).toBeInstanceOf(THREE.BufferGeometry);

    expect(geos.yellowWalls.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.blueWalls.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.redTrim.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.woodTrim.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.roofs.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.glass.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.playground.getAttribute('position').count).toBeGreaterThan(0);
    expect(geos.brassBell.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('bounds stay within school keep-out zone footprint', () => {
    const geos = createSchoolGeometry();
    const box = new THREE.Box3();
    for (const geo of Object.values(geos)) {
      geo.computeBoundingBox();
      if (geo.boundingBox) {
        box.union(geo.boundingBox);
      }
    }

    // Footprint bounds within keep-out (radius 5m)
    expect(box.min.x).toBeGreaterThanOrEqual(-4.9);
    expect(box.max.x).toBeLessThanOrEqual(4.9);
    expect(box.min.z).toBeGreaterThanOrEqual(-3.5);
    expect(box.max.z).toBeLessThanOrEqual(4.9);

    // Height bounds with bell tower
    expect(box.min.y).toBeGreaterThanOrEqual(-0.05);
    expect(box.max.y).toBeLessThanOrEqual(5.2);
  });
});
