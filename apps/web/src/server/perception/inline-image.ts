import 'server-only';

/**
 * Meta's media fetcher refuses some hosts (e.g. the R2 `pub-….r2.dev` bucket URL →
 * `media_url_not_fetchable`). We download hosted images ourselves and send them inline.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_CACHED = 32;
const cache = new Map<string, Promise<string>>();

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

async function download(url: string, fetcher: Fetcher): Promise<string> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return url;
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const mime = type.startsWith('image/') ? type : 'image/png';
    const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    return `data:${mime};base64,${base64}`;
  } catch {
    // Fall back to the link: Meta may still fetch it, and the caller already handles a 400.
    return url;
  }
}

/**
 * An image URL as Meta should receive it: `data:` and non-http(s) URLs unchanged, an http(s) link
 * downloaded and inlined as a `data:` URL (the link itself when the download fails). Cached by URL.
 */
export function inlineImageUrl(url: string, fetcher: Fetcher = fetch): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return Promise.resolve(url);
  const hit = cache.get(url);
  if (hit) return hit;
  const pending = download(url, fetcher).then((out) => {
    if (out === url) cache.delete(url);
    return out;
  });
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(url, pending);
  return pending;
}

/** Test hook: forget cached downloads. */
export function clearInlineImageCache(): void {
  cache.clear();
}
