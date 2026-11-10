import { describe, expect, it } from 'vitest';
import type { ApplianceDetection } from '@/lib/vision';
import { expectedDetectionsFor, rememberExpectedDetections } from '../utils/expected-detections';

const fridge: ApplianceDetection = {
  id: 'loft-fridge',
  label: 'Fridge',
  category: 'fridge',
  box: { x: 0.5, y: 0.4, w: 0.1, h: 0.2 },
};

describe('expected detections registry (VS-T14)', () => {
  it('returns the ground truth of a remembered scan photo, nothing for others', () => {
    rememberExpectedDetections('data:a', [fridge]);
    expect(expectedDetectionsFor('data:a')).toEqual([fridge]);
    expect(expectedDetectionsFor('data:other')).toBeUndefined();
  });

  it('keeps only the last few scans', () => {
    for (let i = 0; i < 6; i++) rememberExpectedDetections(`data:${i}`, []);
    expect(expectedDetectionsFor('data:0')).toBeUndefined();
    expect(expectedDetectionsFor('data:5')).toEqual([]);
  });
});
