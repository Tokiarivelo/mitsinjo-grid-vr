import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { sameExcept, useStableExcept } from '../use-stable-except';

describe('useStableExcept', () => {
  it('keeps the first object while only the ignored field changes', () => {
    const parts = [1];
    const a = { parts, pieces: {} };
    const { result, rerender } = renderHook(({ v }) => useStableExcept(v, 'pieces'), {
      initialProps: { v: a },
    });
    rerender({ v: { parts, pieces: { roof: 1 } } });
    expect(result.current).toBe(a);
    const b = { parts: [2], pieces: {} };
    rerender({ v: b });
    expect(result.current).toBe(b);
  });

  it('compares field by field', () => {
    expect(sameExcept({ a: 1, b: 2 }, { a: 1, b: 3 }, 'b')).toBe(true);
    expect(sameExcept({ a: 1 }, { a: 2 }, 'b' as never)).toBe(false);
    expect(sameExcept(null, { a: 1 }, 'a')).toBe(false);
  });
});
