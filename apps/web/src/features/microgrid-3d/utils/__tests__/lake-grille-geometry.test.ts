import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createLakeGrilleGeometry } from '../lake-grille-geometry';
import { LAKE_CENTER, LAKE_RADIUS } from '../landscape';

describe('createLakeGrilleGeometry', () => {
  it('generates non-empty metal grille and lantern geometries', () => {
    const { metalGrille, lanterns } = createLakeGrilleGeometry(16);

    expect(metalGrille).toBeInstanceOf(THREE.BufferGeometry);
    expect(lanterns).toBeInstanceOf(THREE.BufferGeometry);

    expect(metalGrille.getAttribute('position').count).toBeGreaterThan(0);
    expect(lanterns.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('bounds of the lake grille span along the shoreline near the wind turbines', () => {
    const { metalGrille, lanterns } = createLakeGrilleGeometry(20);

    metalGrille.computeBoundingBox();
    const box = metalGrille.boundingBox!;

    // Lake center is (34, -70), radius 24.
    // The grille should be situated within the lake perimeter zone
    expect(box.max.x).toBeGreaterThan(LAKE_CENTER[0]);
    expect(box.min.x).toBeLessThan(LAKE_CENTER[0]);
    expect(box.max.z).toBeGreaterThan(LAKE_CENTER[1]);
    expect(box.min.z).toBeLessThan(LAKE_CENTER[1] + LAKE_RADIUS + 5);

    lanterns.computeBoundingBox();
    const lanternBox = lanterns.boundingBox!;
    // Lanterns sit above ground level
    expect(lanternBox.max.y).toBeGreaterThan(0.5);
  });
});
