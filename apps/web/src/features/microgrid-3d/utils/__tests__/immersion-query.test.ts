import { describe, expect, it } from 'vitest';
import {
  immersionHref,
  labOfStage,
  readImmersionQuery,
  withImmersionQuery,
} from '../immersion-query';

describe('immersion query', () => {
  it('links to a page in immersion', () => {
    expect(immersionHref('/simulation')).toBe('/simulation?immersion=vr');
    expect(immersionHref('/village', { immersion: true, lab: '3d' })).toBe(
      '/village?immersion=vr&lab=3d'
    );
  });

  it('sets and removes the params, keeping the others', () => {
    expect(withImmersionQuery('?perf=1', { immersion: true, lab: '2d' })).toBe(
      '?perf=1&immersion=vr&lab=2d'
    );
    expect(withImmersionQuery('?perf=1&immersion=vr&lab=2d', { immersion: false })).toBe('?perf=1');
    expect(withImmersionQuery('?immersion=vr&lab=2d', { immersion: false })).toBe('');
    // No lab without immersion.
    expect(withImmersionQuery('', { immersion: false, lab: '3d' })).toBe('');
  });

  it('reads the immersion back, ignoring a stray or unknown lab', () => {
    expect(readImmersionQuery('?immersion=vr&lab=3d')).toEqual({ immersion: true, lab: '3d' });
    expect(readImmersionQuery('?immersion=vr&lab=x')).toEqual({ immersion: true, lab: null });
    expect(readImmersionQuery('?lab=2d')).toEqual({ immersion: false, lab: null });
    expect(readImmersionQuery('')).toEqual({ immersion: false, lab: null });
  });

  it('maps the studio stage to its desk', () => {
    expect(labOfStage('views')).toBe('2d');
    expect(labOfStage('build')).toBe('3d');
    expect(labOfStage('lab')).toBe('3d');
    expect(labOfStage('confirm')).toBeNull();
    expect(labOfStage(undefined)).toBeNull();
  });
});
