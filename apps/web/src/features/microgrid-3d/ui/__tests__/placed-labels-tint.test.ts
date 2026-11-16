import { describe, expect, it } from 'vitest';
import { duskDarkness, TOKEN_HEX } from '../../utils/scene-palette';
import { drawnTint } from '../placed-drawn-model';
import { MARKER_TAGS_ALL_MAX, taggedMarkers } from '../appliance-markers';

describe('duskDarkness', () => {
  it('is 0 in daylight and 1 at night', () => {
    expect(duskDarkness(0.2)).toBe(0);
    expect(duskDarkness(1)).toBe(1);
    expect(duskDarkness(Number.NaN)).toBe(0);
  });
});

describe('drawnTint (VS-T35)', () => {
  it('keeps the drawing by day, greys it at night, reddens it on fire', () => {
    expect(drawnTint({ state: 'served', dim: 1 })).toBeNull();
    expect(drawnTint({ state: 'unserved', dim: 1 })).toBeNull();
    expect(drawnTint({ state: 'unserved', dim: 0.45 })).toBe(TOKEN_HEX.idle.toLowerCase());
    expect(drawnTint({ state: 'fire', dim: 1 })).toBe(TOKEN_HEX.criticalRed);
  });
});

describe('taggedMarkers (VS-T35)', () => {
  const marker = (i: number, sector: 'households' | 'school') => ({ id: `m${i}`, sector });
  const many = Array.from({ length: MARKER_TAGS_ALL_MAX + 3 }, (_, i) =>
    marker(i, i % 2 ? 'school' : 'households')
  );

  it('labels every marker up to the cap', () => {
    expect(taggedMarkers(many.slice(0, 3), null, () => false)).toHaveLength(3);
  });

  it('above it, still labels every object inserted with its model (regression: none labelled)', () => {
    const modeled = new Set(['m0', 'm1', 'm2']);
    expect(taggedMarkers(many, null, (id) => modeled.has(id)).map((m) => m.id)).toEqual([
      'm0',
      'm1',
      'm2',
    ]);
    const withSector = taggedMarkers(many, 'school', (id) => modeled.has(id));
    expect(withSector.every((m) => modeled.has(m.id) || m.sector === 'school')).toBe(true);
  });
});
