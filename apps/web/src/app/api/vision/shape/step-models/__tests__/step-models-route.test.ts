// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

import { STEP_MODEL_STEPS } from '@/lib/step-models';
import { GET, PUT } from '../route';

const SCOPE = 'test-step-models';

const get = (scope = SCOPE) =>
  GET({ nextUrl: new URL(`http://localhost/api?scope=${scope}`) } as unknown as NextRequest);

const put = (body: unknown) =>
  PUT({
    text: async () => JSON.stringify(body),
  } as unknown as NextRequest);

describe('GET /api/vision/shape/step-models (PQ-T67)', () => {
  it('serves env defaults, offered models and no stored choice', async () => {
    const res = await get('test-step-models-fresh');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.defaults).sort()).toEqual([...STEP_MODEL_STEPS].sort());
    expect(body.models).toContain('muse-spark-1.3');
    expect(body.models).toContain('muse-wonder-1.0');
    expect(body.models).toContain('muse-spark-1.3-contributor');
    expect(body.models).toContain('muse-spark-1.2-contributor');
    expect(body.selection).toBeNull();
  });
});

describe('PUT /api/vision/shape/step-models (PQ-T67)', () => {
  it('stores the choice and GET reads it back', async () => {
    const selection = { code: 'muse-spark-1.3', kit: 'muse-wonder-1.0' };
    const saved = await put({ scope: SCOPE, selection });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ selection });
    const reread = await get(SCOPE);
    expect((await reread.json()).selection).toEqual(selection);
    // Reset to defaults: an empty choice means env everywhere.
    expect(await (await put({ scope: SCOPE, selection: {} })).json()).toEqual({
      selection: {},
    });
  });

  it('refuses an unknown step or id', async () => {
    expect((await put({ scope: SCOPE, selection: { unknown: 'x' } })).status).toBe(400);
    expect((await put({ scope: SCOPE, selection: { code: '' } })).status).toBe(400);
    expect((await put({ selection: null })).status).toBe(400);
    expect((await put({ scope: SCOPE, selection: { code: 'gpt-5-huge' } })).status).toBe(400);
  });
});
