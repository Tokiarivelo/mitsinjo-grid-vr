// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ObjectRecipe } from '@/lib/object-shape';
import {
  anatomyState,
  confidence,
  ledByMeasurement,
  mixColor,
  mixNumber,
  mixRecipe,
  modelDoubts,
  pickCount,
  presentAnatomy,
} from '../fusion';

describe('confidence (PF-T7)', () => {
  it('grows with what the measure saw, stays in [0, 1]', () => {
    expect(confidence.colors(10)).toBe(0);
    expect(confidence.colors(64)).toBe(0.5);
    expect(confidence.colors(5000)).toBe(1);
    expect(confidence.repetition(0.2)).toBe(0);
    expect(confidence.repetition(0.41)).toBe(0.6);
    expect(confidence.repetition(0.9)).toBe(1);
    expect(confidence.perspective(5)).toBe(0);
    expect(confidence.perspective(8)).toBe(0.5);
    expect(confidence.perspective(40)).toBe(1);
    expect(confidence.fit(0.3)).toBe(0);
    expect(confidence.fit(0.6)).toBe(0.5);
    expect(confidence.fit(0.95)).toBe(1);
  });

  it('box-only colours (no outline) never fully replace the prior (green Mini)', () => {
    expect(confidence.colors(10, false)).toBe(0);
    expect(confidence.colors(64, false)).toBe(0.3);
    expect(confidence.colors(5000, false)).toBe(0.3);
    expect(confidence.colors(5000, true)).toBe(1);
    expect(confidence.colors(5000)).toBe(1);
  });
});

describe('mix', () => {
  it('numbers and counts: prior at 0, measurement at 1', () => {
    expect(mixNumber(10, 0, 0)).toBe(0);
    expect(mixNumber(10, 0, 0.25)).toBe(2.5);
    expect(mixNumber(10, 0, 3)).toBe(10);
    expect(pickCount(6, 1, 0.6)).toBe(6);
    expect(pickCount(6, 1, 0.4)).toBe(1);
    expect(pickCount(6, undefined, 0)).toBe(6);
  });

  it('colours mix in linear light: ends exact, half of black/white brighter than sRGB #808080', () => {
    expect(mixColor('#c9a36a', '#000000', 1)).toBe('#c9a36a');
    expect(mixColor('#c9a36a', '#123456', 0)).toBe('#123456');
    expect(parseInt(mixColor('#ffffff', '#000000', 0.5).slice(1, 3), 16)).toBeGreaterThan(0x80);
  });

  it('recipe: a poor fit keeps the start, a good one wins', () => {
    const part = {
      shape: 'box' as const,
      at: [0, 0, 0] as [number, number, number],
      size: [1, 1, 1] as [number, number, number],
      color: '#cccccc',
    };
    const start: ObjectRecipe = { proportions: { w: 1, h: 0.5, d: 0.5 }, parts: [part] };
    const fitted: ObjectRecipe = {
      proportions: { w: 1, h: 0.8, d: 0.4 },
      parts: [{ ...part, color: '#000000' }],
      yaw: 0.4,
    };
    expect(mixRecipe(fitted, start, 0)).toEqual(start);
    expect(mixRecipe(fitted, start, 1)).toEqual(fitted);
    const half = mixRecipe(fitted, start, 0.5);
    expect(half.proportions.h).toBeCloseTo(0.65, 6);
    expect(half.yaw).toBeCloseTo(0.2, 6);
  });
});

describe('fields the model doubts are led by the measurement (PQ-T12)', () => {
  it('doubts a group listed as unsure or under confidence ½, never on a first-prompt kit', () => {
    expect(modelDoubts(undefined, 'colors')).toBe(false);
    expect(modelDoubts({}, 'colors')).toBe(false);
    expect(modelDoubts({ evidence: { unsure: ['colors.main'] } }, 'colors')).toBe(true);
    expect(modelDoubts({ evidence: { unsure: ['details.windows'] } }, 'counts')).toBe(true);
    expect(modelDoubts({ evidence: { unsure: ['colors'] } }, 'proportions')).toBe(false);
    // Plain words instead of the field path (PR #12 review): « depth », « color », « wheels ».
    expect(modelDoubts({ evidence: { unsure: ['depth'] } }, 'proportions')).toBe(true);
    expect(modelDoubts({ evidence: { unsure: ['color of the roof'] } }, 'colors')).toBe(true);
    expect(modelDoubts({ evidence: { unsure: ['wheels'] } }, 'counts')).toBe(true);
    expect(modelDoubts({ evidence: { unsure: ['wheels'] } }, 'colors')).toBe(false);
    expect(modelDoubts({ confidence: { proportions: 0.4 } }, 'proportions')).toBe(true);
    expect(modelDoubts({ confidence: { proportions: 0.8 } }, 'proportions')).toBe(false);
  });

  it('an unsure field moves half-way to full trust in the measurement; nothing measured stays 0', () => {
    expect(ledByMeasurement(0.5, true)).toBe(0.75);
    expect(ledByMeasurement(0.5, false)).toBe(0.5);
    expect(ledByMeasurement(0, true)).toBe(0);
    // The mixed colour is then closer to the measurement than before.
    const plain = mixColor('#ff0000', '#0000ff', 0.5);
    const led = mixColor('#ff0000', '#0000ff', ledByMeasurement(0.5, true));
    expect(parseInt(led.slice(1, 3), 16)).toBeGreaterThan(parseInt(plain.slice(1, 3), 16));
  });
});

describe('closed inventory as evidence (PQ-T46)', () => {
  const kit = {
    anatomy: [
      { part: 'rear window', state: 'present' as const },
      { part: 'plate', state: 'hidden' as const },
    ],
  };

  it('reads the state of one closed-list part, case-insensitively', () => {
    expect(anatomyState(kit, 'rear window')).toBe('present');
    expect(anatomyState(kit, 'Rear  Window')).toBe('present');
    expect(anatomyState(kit, 'plate')).toBe('hidden');
    expect(anatomyState(kit, 'grille')).toBeUndefined();
    expect(anatomyState(undefined, 'wheel')).toBeUndefined();
    expect(anatomyState({}, 'wheel')).toBeUndefined();
  });

  it('lists the seen parts for notBuilt and coverage', () => {
    expect(presentAnatomy(kit)).toEqual(['rear window']);
    expect(presentAnatomy(undefined)).toEqual([]);
    expect(presentAnatomy({})).toEqual([]);
  });
});
