import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PROCEDURAL_PALM_VARIANTS, createProceduralPalm } from '../procedural-palm';

describe('createProceduralPalm', () => {
  it.each(PROCEDURAL_PALM_VARIANTS)('builds valid foliage and trunk for variant %s', (variant) => {
    const { foliage, trunk } = createProceduralPalm(variant);

    expect(foliage).toBeInstanceOf(THREE.BufferGeometry);
    expect(trunk).toBeInstanceOf(THREE.BufferGeometry);

    expect(foliage.getAttribute('position').count).toBeGreaterThan(100);
    expect(trunk.getAttribute('position').count).toBeGreaterThan(50);

    expect(foliage.getAttribute('normal')).toBeDefined();
    expect(trunk.getAttribute('normal')).toBeDefined();

    foliage.computeBoundingBox();
    trunk.computeBoundingBox();

    expect(foliage.boundingBox).toBeDefined();
    expect(trunk.boundingBox).toBeDefined();

    // Trunk base sits on ground level y ~ 0
    expect(trunk.boundingBox!.min.y).toBeCloseTo(0, 1);
    // Tree height is positive and upright
    expect(trunk.boundingBox!.max.y).toBeGreaterThan(1.2);
    expect(foliage.boundingBox!.max.y).toBeGreaterThan(trunk.boundingBox!.max.y * 0.7);
  });
});
