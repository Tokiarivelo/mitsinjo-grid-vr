import 'server-only';
import http from 'node:http';
import https from 'node:https';

/**
 * A POST without Node fetch's 300 s limits (PQ-T72). Fetch (undici) drops a response whose headers
 * or next body chunk take more than 300 s (`UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`); a
 * long reasoning call (the house specialist thinks for minutes, silent even when streamed) hits
 * both. `node:https` has no such timer: the call lasts until it answers or `signal` aborts.
 * Returns a web `Response` so callers read it as a fetch response.
 */
export function longFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
): Promise<Response> {
  const { method, headers, body, signal } = init;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const target = new URL(url);
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.request(
      target,
      { method, headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const out = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value != null) out.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage ?? '',
              headers: out,
            })
          );
        });
      }
    );
    req.on('error', reject);
    signal?.addEventListener(
      'abort',
      () => req.destroy(signal.reason instanceof Error ? signal.reason : new Error('aborted')),
      { once: true }
    );
    req.end(body);
  });
}
