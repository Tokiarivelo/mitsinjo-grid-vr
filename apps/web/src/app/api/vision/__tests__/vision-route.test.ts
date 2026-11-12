// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const { hostVisionImage } = vi.hoisted(() => ({ hostVisionImage: vi.fn() }));
vi.mock('@/server/storage/media', () => ({ hostVisionImage }));

import { MOCK_DETECTIONS } from '@/server/perception';
import { MAX_VISION_BYTES, POST } from '../route';

const request = (form: FormData) =>
  new Request('http://localhost/api/vision', {
    method: 'POST',
    body: form,
  }) as unknown as NextRequest;

const jpeg = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

/** `event: x\ndata: {...}` blocks → [{ event, data }]. */
async function readSse(res: Response) {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event: (.*)$/m)?.[1];
      const data = JSON.parse(block.match(/^data: (.*)$/m)?.[1] ?? '{}');
      return { event, data };
    });
}

describe('POST /api/vision (PV-T6)', () => {
  it('streams the sample-room detections offline, then done', async () => {
    const form = new FormData();
    form.append('image', jpeg(1000), 'room.jpg');
    const res = await POST(request(form));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const events = await readSse(res);
    expect(events.map((e) => e.event)).toEqual(['vision_detections', 'done']);
    const { data } = events[0]!;
    expect(data.phase).toBe('boxes');
    expect(data.source).toBe('mock');
    // PQ-T42: the phase carries its duration.
    expect(data.ms).toEqual(expect.any(Number));
    expect(data.ms).toBeGreaterThanOrEqual(0);
    expect(data.detections).toEqual(MOCK_DETECTIONS);
    // Labels and geometry only: no power value leaves the vision route.
    expect(JSON.stringify(data)).not.toMatch(/watt|kw/i);
    // Mock mode: the photo is never uploaded.
    expect(hostVisionImage).not.toHaveBeenCalled();
  });

  it('refuses a missing image, a too large one and a non-image', async () => {
    expect((await POST(request(new FormData()))).status).toBe(400);
    const big = new FormData();
    big.append('image', jpeg(MAX_VISION_BYTES + 1), 'big.jpg');
    expect((await POST(request(big))).status).toBe(413);
    const pdf = new FormData();
    pdf.append('image', new Blob([new Uint8Array(10)], { type: 'application/pdf' }), 'a.pdf');
    expect((await POST(request(pdf))).status).toBe(415);
  });
});
