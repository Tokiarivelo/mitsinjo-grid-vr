// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { NextRequest } from 'next/server';
import { POST } from '../route';

const recipe = {
  proportions: { w: 0.5, h: 1, d: 0.5 },
  parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#eeeeee', front: true }],
};

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/vision/shape/blender', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );

describe('POST /api/vision/shape/blender', () => {
  it('returns the model as a Blender Python attachment', async () => {
    const res = await post({ recipe, label: 'Maison rouge' });
    if (res.status !== 200) throw new Error(await res.text());
    expect(res.headers.get('content-type')).toContain('text/x-python');
    expect(res.headers.get('content-disposition')).toContain('Maison-rouge.py');
    expect(await res.text()).toContain('import bpy');
  });

  it('refuses an invalid body', async () => {
    expect((await post({ recipe: { parts: [] } })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
  });
});
