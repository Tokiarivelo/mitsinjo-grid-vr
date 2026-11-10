import { describe, expect, it } from 'vitest';
import { photoWarning } from '../photo-warning';

describe('photoWarning (PQ-T7)', () => {
  it('warns for a small or blurred object, not for a good one', () => {
    expect(photoWarning({ widthPx: 90, heightPx: 120, sharpness: 'high' })).toBe('small');
    expect(photoWarning({ widthPx: 400, heightPx: 300, sharpness: 'low' })).toBe('blurred');
    expect(photoWarning({ widthPx: 400, heightPx: 300, sharpness: 'high' })).toBeNull();
    expect(photoWarning(undefined)).toBeNull();
  });
});
