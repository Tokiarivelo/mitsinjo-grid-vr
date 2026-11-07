import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CANOPY_VARIANTS, createCanopyTree } from '../canopy-tree';

describe('createCanopyTree', () => {
  it.each(CANOPY_VARIANTS)('builds valid foliage and trunk for variant %s', (variant) => {
    const { foliage, trunk } = createCanopyTree(variant, 1);

    expect(foliage).toBeInstanceOf(THREE.BufferGeometry);
    expect(trunk).toBeInstanceOf(THREE.BufferGeometry);

    expect(foliage.getAttribute('position').count).toBeGreaterThan(50);
    expect(trunk.getAttribute('position').count).toBeGreaterThan(10);

    expect(foliage.getAttribute('normal')).toBeDefined();
    expect(trunk.getAttribute('normal')).toBeDefined();
    expect(foliage.getAttribute('color')).toBeDefined();

    foliage.computeBoundingBox();
    trunk.computeBoundingBox();

    expect(foliage.boundingBox).toBeDefined();
    expect(trunk.boundingBox).toBeDefined();

    expect(trunk.boundingBox!.min.y).toBeCloseTo(0, 1);
    expect(foliage.boundingBox!.max.y).toBeGreaterThan(0.5);
  });
});
