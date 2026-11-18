import 'server-only';

/** Retries after the first failed try before a server call reports its error (user 2026-11-18). */
export const SERVER_RETRIES = 3;
/** Wait before retry n (1-based): `RETRY_BASE_MS * 2^(n-1)` → 1 s, 2 s, 4 s. */
export const RETRY_BASE_MS = 1_000;

export interface RetryOptions {
  /** Retries after the first try (default `SERVER_RETRIES`). */
  retries?: number;
  /** Stops at once (no more tries, no wait) when it aborts. */
  signal?: AbortSignal;
  /** Errors worth another try; default: any error except an abort. */
  retryable?: (err: unknown) => boolean;
  /** Log tag; each retry is logged as a warning. */
  label?: string;
  /** First backoff (ms); 0 in tests. */
  baseMs?: number;
}

const isAbort = (err: unknown) =>
  (err instanceof Error || err instanceof DOMException) &&
  (err.name === 'AbortError' || err.name === 'TimeoutError');

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Runs `fn` and, on a retryable error, tries again up to `retries` times with exponential backoff.
 * The last error is thrown when every try failed, the error is not retryable, or `signal` aborted.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  {
    retries = SERVER_RETRIES,
    signal,
    retryable = (err) => !isAbort(err),
    label = 'retry',
    baseMs = RETRY_BASE_MS,
  }: RetryOptions = {}
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || signal?.aborted || !retryable(err)) throw err;
      console.warn(
        `[${label}] try ${attempt + 1} failed, retry ${attempt + 1}/${retries}:`,
        err instanceof Error ? err.message : err
      );
      await wait(baseMs * 2 ** attempt, signal);
      if (signal?.aborted) throw err;
    }
  }
}
