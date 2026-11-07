import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PROCEDURAL_SHRUB_VARIANTS, createProceduralShrub } from '../procedural-shrub';

describe('createProceduralShrub', () => {
  it.each(PROCEDURAL_SHRUB_VARIANTS)('builds valid foliage and stem for variant %s', (variant) => {
    const { foliage, stem } = createProceduralShrub(variant);

    expect(foliage).toBeInstanceOf(THREE.BufferGeometry);
    expect(stem).toBeInstanceOf(THREE.BufferGeometry);

    expect(foliage.getAttribute('position').count).toBeGreaterThan(40);
    expect(stem.getAttribute('position').count).toBeGreaterThan(10);

    expect(foliage.getAttribute('normal')).toBeDefined();
    expect(stem.getAttribute('normal')).toBeDefined();

    foliage.computeBoundingBox();
    stem.computeBoundingBox();

    expect(foliage.boundingBox).toBeDefined();
    expect(stem.boundingBox).toBeDefined();

    // Stem base sits at or near ground level y ~ 0
    expect(stem.boundingBox!.min.y).toBeCloseTo(0, 1);
    // Plant height is positive
    expect(foliage.boundingBox!.max.y).toBeGreaterThan(0.2);
  });
});
