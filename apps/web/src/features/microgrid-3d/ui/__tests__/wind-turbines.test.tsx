import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWindTurbineGeometry } from '../../utils/wind-turbine-geometry';

describe('createWindTurbineGeometry', () => {
  it('generates tower, nacelle, and rotor geometries with correct dimensions', () => {
    const { tower, nacelle, rotor } = createWindTurbineGeometry(8, 3.2);

    expect(tower).toBeInstanceOf(THREE.BufferGeometry);
    expect(nacelle).toBeInstanceOf(THREE.BufferGeometry);
    expect(rotor).toBeInstanceOf(THREE.BufferGeometry);

    tower.computeBoundingBox();
    nacelle.computeBoundingBox();
    rotor.computeBoundingBox();

    expect(tower.boundingBox!.max.y).toBeCloseTo(8, 1);
    expect(tower.boundingBox!.min.y).toBeCloseTo(0, 1);

    // Rotor radius covers ~3.2m
    const rotorSize = rotor.boundingBox!.getSize(new THREE.Vector3());
    expect(rotorSize.y).toBeGreaterThan(5.5);
  });
});
