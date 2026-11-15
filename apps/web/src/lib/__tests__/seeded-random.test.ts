import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../seeded-random';

describe('mulberry32 (PQ-T50)', () => {
  it('same seed, same sequence; another seed, another sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seq = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(seq);
    expect(mulberry32(43)()).not.toBe(seq[0]);
    expect(seq.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
