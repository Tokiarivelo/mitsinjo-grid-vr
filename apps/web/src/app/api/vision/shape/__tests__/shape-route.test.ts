// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

import { ObjectShapeSchema, ShapeTimingEventSchema } from '@/lib/object-shape';
import { parseSseChunk } from '@/lib/sse';
import { mockRecipe } from '@/server/perception';
import { POST } from '../route';

const request = (form: FormData) =>
  new Request('http://localhost/api/vision/shape', {
    method: 'POST',
    body: form,
  }) as unknown as NextRequest;

const form = (target?: unknown) => {
  const f = new FormData();
  f.append('image', new Blob([new Uint8Array(500)], { type: 'image/jpeg' }), 'room.jpg');
  if (target !== undefined)
    f.append('target', typeof target === 'string' ? target : JSON.stringify(target));
  return f;
};

const fridge = {
  id: 'det-1',
  label: 'Fridge',
  category: 'fridge',
  box: { x: 0.1, y: 0.1, w: 0.2, h: 0.6 },
};

const events = async (res: Response) => parseSseChunk(await res.text()).events;

describe('POST /api/vision/shape (PV-T9)', () => {
  it('streams the steps, then the offline fridge recipe in mock mode', async () => {
    const res = await POST(request(form(fridge)));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const list = await events(res);
    expect(list.map((e) => e.event)).toEqual([
      'shape_step',
      'shape_step',
      'shape_timing',
      'shape_step',
      'shape_result',
      'done',
    ]);
    expect(list.filter((e) => e.event === 'shape_step').map((e) => e.data.step)).toEqual([
      'crop',
      'model',
      'fit',
    ]);
    // PQ-T42: mock mode without pixels times the kit call alone.
    const timing = list.find((e) => e.event === 'shape_timing')!;
    expect(ShapeTimingEventSchema.parse(timing.data)).toEqual({
      phase: 'kit',
      ms: expect.any(Number),
    });
    const body = ObjectShapeSchema.parse(list[4]!.data.shape);
    expect(body).toMatchObject({ detectionId: 'det-1', mode: 'recipe', source: 'mock' });
    expect(body.recipe).toEqual(mockRecipe('fridge'));
    expect(body.imaginedViews).toHaveLength(6);
    // Geometry and colours only: no power value (opaque base64 PNG previews excluded).
    const text = JSON.stringify(body).replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, '');
    expect(text).not.toMatch(/watt|kw/i);
  });

  it('refuses a missing, unreadable or invalid target, and a missing image', async () => {
    expect((await POST(request(form()))).status).toBe(400);
    expect((await POST(request(form('{nope')))).status).toBe(400);
    expect((await POST(request(form({ ...fridge, category: 'toaster' })))).status).toBe(400);
    expect((await POST(request(new FormData()))).status).toBe(400);
  });
});
