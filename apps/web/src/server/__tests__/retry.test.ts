import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { SERVER_RETRIES, withRetry } from '../retry';

describe('withRetry', () => {
  it('returns the first success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withRetry(fn, { baseMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries 3 times by default, then throws the last error', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      throw new Error(`fail ${n}`);
    });
    await expect(withRetry(fn, { baseMs: 0 })).rejects.toThrow('fail 4');
    expect(fn).toHaveBeenCalledTimes(SERVER_RETRIES + 1);
  });

  it('succeeds on a later try', async () => {
    let n = 0;
    const fn = async () => {
      n += 1;
      if (n < 3) throw new Error('flaky');
      return n;
    };
    await expect(withRetry(fn, { baseMs: 0 })).resolves.toBe(3);
  });

  it('does not retry a non-retryable error or an abort', async () => {
    const plain = vi.fn(async () => {
      throw new Error('bad request');
    });
    await expect(withRetry(plain, { baseMs: 0, retryable: () => false })).rejects.toThrow();
    expect(plain).toHaveBeenCalledTimes(1);

    const abort = vi.fn(async () => {
      throw new DOMException('gone', 'AbortError');
    });
    await expect(withRetry(abort, { baseMs: 0 })).rejects.toThrow('gone');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('stops when the signal aborts', async () => {
    const ctrl = new AbortController();
    const fn = vi.fn(async () => {
      ctrl.abort();
      throw new Error('fail');
    });
    await expect(withRetry(fn, { baseMs: 0, signal: ctrl.signal })).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
