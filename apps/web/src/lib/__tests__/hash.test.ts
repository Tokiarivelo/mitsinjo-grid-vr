import { describe, expect, it } from 'vitest';
import { fnv1a32 } from '../hash';

describe('fnv1a32', () => {
  it('is deterministic and distinguishes inputs', () => {
    expect(fnv1a32('house:front')).toBe(fnv1a32('house:front'));
    expect(fnv1a32('house:front')).not.toBe(fnv1a32('house:side'));
  });

  it('stays a uint32', () => {
    for (const s of ['', 'a', 'brick wall #c8aa78']) {
      const h = fnv1a32(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
