import { beforeEach, describe, expect, it } from 'vitest';
import type { ObjectKit } from '@/lib/object-kit';
import { kitToRecipe } from '@/lib/object-kit';
import {
  getCachedKit,
  getCachedSam,
  kitCacheKey,
  resetShapeCache,
  samCacheKey,
  setCachedKit,
  setCachedSam,
  SHAPE_CACHE_KIT_MAX,
  SHAPE_CACHE_SAM_MAX,
} from '../shape-cache';

const CROP = 'data:image/jpeg;base64,AA';
const subject = (over: Record<string, unknown> = {}) => ({
  promptVersion: 1,
  label: 'Fridge',
  category: 'fridge',
  ...over,
});
const kit: ObjectKit = {
  archetype: 'cabinet',
  proportions: { w: 1, h: 1, d: 0.5 },
  colors: { main: '#eeeeee', secondary: '#dddddd', accent: '#333333' },
};

beforeEach(() => resetShapeCache());

describe('shape cache keys (PQ-T49 E12)', () => {
  it('same inputs, same key; anything that changes the question changes it', () => {
    const base = kitCacheKey(CROP, subject());
    expect(kitCacheKey(CROP, subject())).toBe(base);
    expect(kitCacheKey(CROP, subject({ promptVersion: 2 }))).not.toBe(base);
    expect(kitCacheKey(CROP, subject({ label: 'Machine' }))).not.toBe(base);
    expect(kitCacheKey(CROP, subject({ category: 'other' }))).not.toBe(base);
    expect(kitCacheKey(CROP, subject({ archetype: 'cabinet' }))).not.toBe(base);
    expect(kitCacheKey(CROP, subject({ facadeUrl: 'data:image/png;base64,BB' }))).not.toBe(base);
    expect(kitCacheKey('data:image/jpeg;base64,BB', subject())).not.toBe(base);
    expect(kitCacheKey(CROP, subject({ model: 'muse-spark-1.2' }))).not.toBe(base);
  });

  it('SAM key: the crop plus the concept word', () => {
    expect(samCacheKey(CROP, 'fridge')).toBe(samCacheKey(CROP, 'fridge'));
    expect(samCacheKey(CROP, 'door')).not.toBe(samCacheKey(CROP, 'fridge'));
    expect(samCacheKey('data:image/jpeg;base64,BB', 'fridge')).not.toBe(
      samCacheKey(CROP, 'fridge')
    );
  });
});

describe('shape cache store (PQ-T49 E12)', () => {
  it('remembers a kit answer and hands it out as the caller’s own', () => {
    expect(getCachedKit(kitCacheKey(CROP, subject()))).toBeUndefined();
    setCachedKit(kitCacheKey(CROP, subject()), 'muse-spark-1.3', {
      recipe: kitToRecipe(kit),
      kit,
    });
    const hit = getCachedKit(kitCacheKey(CROP, subject()))!;
    expect(hit.model).toBe('muse-spark-1.3');
    expect(hit.result.kit?.archetype).toBe('cabinet');
    // Mutating the handed-out object poisons nothing: the next read is intact.
    hit.result.kit!.archetype = 'vehicle';
    expect(getCachedKit(kitCacheKey(CROP, subject()))!.result.kit?.archetype).toBe('cabinet');
  });

  it('remembers a SAM answer, empty ones too', () => {
    const key = samCacheKey(CROP, 'fridge');
    setCachedSam(key, 'sam-3.1', {
      concept: 'fridge',
      imageWidth: 10,
      imageHeight: 10,
      instances: [],
      count: 0,
      boxCoverage: 0,
    });
    expect(getCachedSam(key)?.result.count).toBe(0);
  });

  it('evicts the oldest past the bound, and reset forgets everything', () => {
    for (let i = 0; i < SHAPE_CACHE_KIT_MAX + 1; i++)
      setCachedKit(`kit-${i}`, 'm', { recipe: null });
    expect(getCachedKit('kit-0')).toBeUndefined();
    expect(getCachedKit(`kit-${SHAPE_CACHE_KIT_MAX}`)?.model).toBe('m');
    for (let i = 0; i < SHAPE_CACHE_SAM_MAX + 1; i++)
      setCachedSam(`sam-${i}`, 'm', {
        concept: 'x',
        imageWidth: 1,
        imageHeight: 1,
        instances: [],
        count: 0,
        boxCoverage: 0,
      });
    expect(getCachedSam('sam-0')).toBeUndefined();
    resetShapeCache();
    expect(getCachedKit(`kit-${SHAPE_CACHE_KIT_MAX}`)).toBeUndefined();
    expect(getCachedSam(`sam-${SHAPE_CACHE_SAM_MAX}`)).toBeUndefined();
  });
});
