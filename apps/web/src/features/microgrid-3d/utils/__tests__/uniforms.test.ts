import { describe, expect, it } from 'vitest';
import { setUniformValue } from '../uniforms';

describe('setUniformValue', () => {
  it('sets the value of a uniform, ignores a missing one', () => {
    const u = { value: 0 };
    setUniformValue(u, 0.7);
    expect(u.value).toBe(0.7);
    expect(() => setUniformValue(undefined, 1)).not.toThrow();
  });
});
