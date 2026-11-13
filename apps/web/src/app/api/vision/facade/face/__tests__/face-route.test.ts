// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

import { buildFacePrompt } from '@/server/perception/facade-faces';
import { POST } from '../route';

const FRONT = 'data:image/png;base64,AAAA';
const target = { id: 'house-1', label: 'rural cottage', category: 'other', scenery: 'building' };

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/vision/facade/face', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }) as unknown as NextRequest
  );

describe('POST /api/vision/facade/face (PQ-T68)', () => {
  it('draws one face from the references (mock: a placeholder, still a stored image)', async () => {
    const res = await post({ target, face: 'back', references: [FRONT] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      face: string;
      imageUrl: string;
      fileKey: string;
      source: string;
    };
    expect(json).toMatchObject({ ok: true, face: 'back', source: 'mock' });
    expect(json.fileKey).toContain('house-1_back_');
    expect(json.imageUrl).toMatch(/^data:image\/png;base64,|^https:\/\//);
  });

  it('refuses an unknown face, no reference, too many references or a non-image link', async () => {
    expect((await post({ target, face: 'top', references: [FRONT] })).status).toBe(400);
    expect((await post({ target, face: 'side', references: [] })).status).toBe(400);
    expect(
      (await post({ target, face: 'side', references: [FRONT, FRONT, FRONT, FRONT] })).status
    ).toBe(400);
    expect((await post({ target, face: 'side', references: ['javascript:alert(1)'] })).status).toBe(
      400
    );
    expect((await post('not json')).status).toBe(400);
  });
});

describe('buildFacePrompt', () => {
  it('names the face and says the views must agree once other faces ride along', () => {
    const one = buildFacePrompt('side', 'cottage', 'house');
    expect(one).toContain('RIGHT SIDE');
    expect(one).toContain('front elevation');
    const many = buildFacePrompt('left', 'cottage', 'house', {
      known: 3,
      userPrompt: 'add a window',
    });
    expect(many).toContain('LEFT SIDE');
    expect(many).toContain('all four views must agree');
    expect(many).toContain('add a window');
    expect(buildFacePrompt('back', 'cottage', 'house')).toContain('BACK');
  });
});
