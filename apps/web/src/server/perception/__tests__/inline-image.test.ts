import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { clearInlineImageCache, inlineImageUrl } from '../inline-image';

const R2 = 'https://pub-abc.r2.dev/vision/facades/det-1.png';
const png = (type = 'image/png') =>
  new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': type } });

describe('inlineImageUrl', () => {
  beforeEach(() => clearInlineImageCache());

  it('leaves data: and relative URLs untouched without fetching', async () => {
    const fetcher = vi.fn();
    expect(await inlineImageUrl('data:image/png;base64,AQID', fetcher)).toBe(
      'data:image/png;base64,AQID'
    );
    expect(await inlineImageUrl('/mock-storage/x.png', fetcher)).toBe('/mock-storage/x.png');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('inlines an https facade link as a data URL (regression: media_url_not_fetchable)', async () => {
    const fetcher = vi.fn(async () => png('image/png; charset=binary'));
    expect(await inlineImageUrl(R2, fetcher)).toBe('data:image/png;base64,AQID');
  });

  it('downloads the same link once for repeated calls', async () => {
    const fetcher = vi.fn(async () => png());
    await Promise.all([inlineImageUrl(R2, fetcher), inlineImageUrl(R2, fetcher)]);
    await inlineImageUrl(R2, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('defaults a non-image content type to png', async () => {
    const fetcher = vi.fn(async () => png('application/octet-stream'));
    expect(await inlineImageUrl(R2, fetcher)).toBe('data:image/png;base64,AQID');
  });

  it('falls back to the link when the download fails, and retries next time', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(png());
    expect(await inlineImageUrl(R2, fetcher)).toBe(R2);
    expect(await inlineImageUrl(R2, fetcher)).toBe(R2);
    expect(await inlineImageUrl(R2, fetcher)).toBe('data:image/png;base64,AQID');
  });
});
