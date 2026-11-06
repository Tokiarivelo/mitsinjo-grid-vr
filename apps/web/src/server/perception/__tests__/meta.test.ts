// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import { MetaPerceptionBackend } from '../meta';

// Hosted images are inlined before Meta sees them (inline-image.test.ts); here a link stays a link
// tagged `inlined:` so request shapes stay readable and the fetch mock only sees API calls.
vi.mock('../inline-image', () => ({
  inlineImageUrl: async (url: string) => (/^https?:/.test(url) ? `inlined:${url}` : url),
}));

const BASE = 'https://api.meta.ai/v1';
const originalFetch = global.fetch;

function respond(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
  return global.fetch as ReturnType<typeof vi.fn>;
}

function lastRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

const backend = new MetaPerceptionBackend({ apiKey: 'k', baseUrl: BASE, preferContributor: false });

afterEach(() => {
  global.fetch = originalFetch;
});

describe('MetaPerceptionBackend (shapes recorded from real calls, 2026-10-30)', () => {
  it('transcribes: multipart request + WAV, maps turns and duration', async () => {
    const fetchMock = respond({
      sessionId: 's',
      transcript: 'A: bonjour',
      audioDurationMs: 1040,
      turns: [{ turnId: 0, startMs: 0, endMs: 900, transcript: 'bonjour', speaker: 'A' }],
    });
    const wav = new Blob([new Uint8Array(100)], { type: 'audio/wav' });
    const out = await backend.transcribe(wav, { diarize: true, languages: ['French'] });

    const { url, init } = lastRequest(fetchMock);
    expect(url).toBe(`${BASE}/asr/transcribe`);
    const form = init.body as FormData;
    const request = JSON.parse(await (form.get('request') as Blob).text());
    expect(request).toEqual({
      model: 'muse-voice-transcribe-1.0',
      audioEncoding: 'WAV',
      mode: 'DIARIZATION',
      languageBias: ['French'],
    });
    expect(form.get('audio')).toBeInstanceOf(Blob);
    expect(out.result).toEqual({
      text: 'A: bonjour',
      durationMs: 1040,
      turns: [{ startMs: 0, endMs: 900, text: 'bonjour', speaker: 'A' }],
    });
    expect(out.usage).toEqual({ audioMs: 1040 });
  });

  it('analyzes an image with a JSON schema answer and drops malformed observations', async () => {
    const fetchMock = respond({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Partly cloudy',
              observations: [
                { label: 'cloud_cover', value: 65, unit: '%', confidence: 85 },
                { label: 'broken' },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 3202, completion_tokens: 1314 },
    });
    const out = await backend.analyzeImage('data:image/webp;base64,AA', 'Cloud cover?');

    const body = JSON.parse(lastRequest(fetchMock).init.body as string);
    expect(lastRequest(fetchMock).url).toBe(`${BASE}/chat/completions`);
    expect(body.model).toBe('muse-spark-1.3');
    expect(body.reasoning_effort).toBe('high');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/webp;base64,AA' },
    });
    expect(out.result.observations).toEqual([
      { label: 'cloud_cover', value: 65, unit: '%', confidence: 0.85 },
    ]);
    expect(out.usage).toEqual({ inputTokens: 3202, outputTokens: 1314 });
  });

  it('criticizes a shape with the KitPatch schema and parses the patch', async () => {
    const fetchMock = respond({
      choices: [
        {
          message: {
            content: JSON.stringify({ subtype: 'sedan', details: { wheels: 4 } }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    const out = await backend.criticizeShape('data:image/png;base64,AA', 'Patch?');
    const body = JSON.parse(lastRequest(fetchMock).init.body as string);
    expect(body.response_format.json_schema.name).toBe('KitPatch');
    expect(out.result).toEqual({ patch: { subtype: 'sedan', details: { wheels: 4 } } });
  });

  it('prefers the contributor vision model and resends on the standard one when refused', async () => {
    const ok = {
      choices: [{ message: { content: JSON.stringify({ summary: 'ok', observations: [] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ok });
    const contributor = new MetaPerceptionBackend({
      apiKey: 'k',
      baseUrl: BASE,
      preferContributor: true,
    });
    const out = await contributor.analyzeImage('https://x/p.png', 'sky?');
    const models = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string).model
    );
    expect(models).toEqual(['muse-spark-1.3-contributor', 'muse-spark-1.3']);
    expect(out.model).toBe('muse-spark-1.3');
  });

  it('detects appliances with the category enum schema and parses the boxes', async () => {
    const fetchMock = respond({
      choices: [
        {
          message: {
            content: JSON.stringify({
              objects: [{ label: 'Fridge', category: 'refrigerator', bbox: [100, 200, 300, 1040] }],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 1500, completion_tokens: 120 },
    });
    const out = await backend.detectAppliances('data:image/jpeg;base64,AA');

    const body = JSON.parse(lastRequest(fetchMock).init.body as string);
    expect(lastRequest(fetchMock).url).toBe(`${BASE}/chat/completions`);
    expect(body.model).toBe('muse-spark-1.3');
    expect(body.reasoning_effort).toBe('high');
    expect(body.response_format.json_schema.name).toBe('ApplianceDetections');
    expect(
      body.response_format.json_schema.schema.properties.objects.items.properties.category.enum
    ).toContain('fridge_vaccine');
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,AA');
    // Regression: an appliance-only question made Muse return [] on outdoor photos.
    const question = body.messages[1].content[0].text as string;
    expect(question).not.toMatch(/^List the electrical appliances/);
    expect(question).toMatch(/buildings, vehicles, trees/);
    expect(out.result.detections).toEqual([
      { id: 'det-1', label: 'Fridge', category: 'fridge', box: { x: 0.1, y: 0.2, w: 0.2, h: 0.8 } },
    ]);
    expect(out.usage).toEqual({ inputTokens: 1500, outputTokens: 120 });
  });

  it('asks Spark for a short 3D kit on the standard model, then builds the recipe (PV-T9b)', async () => {
    const kit = {
      archetype: 'cabinet',
      proportions: { w: 0.5, h: 1, d: 0.5 },
      colors: { main: '#eeeeee', secondary: '#bbbbbb', accent: '#888888' },
    };
    const fetchMock = respond({
      choices: [{ message: { content: JSON.stringify(kit) } }],
      usage: { prompt_tokens: 900, completion_tokens: 80 },
    });
    const prefersContributor = new MetaPerceptionBackend({
      apiKey: 'k',
      baseUrl: BASE,
      preferContributor: true,
    });
    const out = await prefersContributor.describeShape('data:image/jpeg;base64,AA', {
      label: 'Fridge',
      category: 'fridge',
    });
    const body = JSON.parse(lastRequest(fetchMock).init.body as string);
    expect(lastRequest(fetchMock).url).toBe(`${BASE}/chat/completions`);
    expect(body.response_format.json_schema.name).toBe('ObjectKit');
    expect(body.reasoning_effort).toBe('high');
    // Latency-sensitive: never the (slower) contributor id.
    expect(body.model).not.toMatch(/contributor/);
    expect(body.messages[1].content[0].text).toContain('"Fridge"');
    expect(body.messages[1].content[0].text).toContain('probably a "cabinet"');
    expect(out.result.recipe).toEqual(kitToRecipe(kit as ObjectKit));
    expect(out.usage).toEqual({ inputTokens: 900, outputTokens: 80 });

    respond({ choices: [{ message: { content: 'A white fridge.' } }] });
    const prose = await backend.describeShape('data:image/jpeg;base64,AA', {
      label: 'Fridge',
      category: 'fridge',
    });
    expect(prose.result.recipe).toBeNull();
  });

  it('sends the validated 2D facade as a second image and tells Spark how to use it', async () => {
    const kit = {
      archetype: 'house',
      proportions: { w: 1, h: 0.6, d: 0.7 },
      colors: { main: '#e8dcc0', secondary: '#7a3b2e', accent: '#334455' },
    };
    const fetchMock = respond({ choices: [{ message: { content: JSON.stringify(kit) } }] });
    await backend.describeShape('data:image/jpeg;base64,AA', {
      label: 'House',
      category: 'other',
      scenery: 'building',
      facadeUrl: 'https://r2.example/facade.png',
    });
    const content = JSON.parse(lastRequest(fetchMock).init.body as string).messages[1].content;
    expect(content.map((c: { type: string }) => c.type)).toEqual([
      'text',
      'image_url',
      'image_url',
    ]);
    expect(content[1].image_url.url).toBe('data:image/jpeg;base64,AA');
    // Regression (2026-11-06): Meta refused the R2 link (media_url_not_fetchable); it now goes inline.
    expect(content[2].image_url.url).toBe('inlined:https://r2.example/facade.png');
    expect(content[0].text).toContain('second image is the validated front elevation');

    const plainMock = respond({ choices: [{ message: { content: JSON.stringify(kit) } }] });
    await backend.describeShape('data:image/jpeg;base64,AA', { label: 'House', category: 'other' });
    const plain = JSON.parse(lastRequest(plainMock).init.body as string).messages[1].content;
    expect(plain).toHaveLength(2);
    expect(plain[0].text).not.toContain('second image');
  });

  it('logs the full 3D request and result, images as placeholders only', async () => {
    const kit = {
      archetype: 'cabinet',
      proportions: { w: 0.5, h: 1, d: 0.5 },
      colors: { main: '#eeeeee', secondary: '#bbbbbb', accent: '#888888' },
    };
    respond({
      choices: [{ message: { content: JSON.stringify(kit) } }],
      usage: { prompt_tokens: 900, completion_tokens: 80 },
    });
    const seen: string[] = [];
    const info = vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => {
      seen.push(a.map(String).join(' '));
    });
    try {
      await backend.describeShape(`data:image/jpeg;base64,${'A'.repeat(200)}`, {
        label: 'Fridge',
        category: 'fridge',
        aspect: 0.75,
      });
    } finally {
      info.mockRestore();
    }
    const lines = seen.filter((l) => l.includes('3D describeShape'));
    expect(lines).toHaveLength(4);
    const all = lines.join('\n');
    // Params, both prompts and the full result are logged…
    expect(all).toContain('"label":"Fridge"');
    expect(all).toContain('"aspect":0.75');
    expect(all).toContain('schema ObjectKit');
    expect(all).toContain('system: ');
    expect(all).toContain('question: ');
    expect(all).toContain('"archetype":"cabinet"');
    expect(all).toContain('in 900, out 80');
    // …but the pixels never leave as base64.
    expect(all).not.toContain('base64,');
    expect(all).not.toContain('A'.repeat(200));
    expect(all).toContain('[image data-url, 223 chars]');
  });

  it('asks Spark for an imagined part list with the cut edges, stamped free (PV-T9c)', async () => {
    const parts = {
      proportions: { w: 0.4, h: 0.8, d: 0.3 },
      parts: [
        {
          shape: 'cylinder',
          at: [0, -0.05, 0],
          size: [0.5, 0.6, 0.35],
          color: '#334455',
          front: true,
        },
      ],
    };
    const fetchMock = respond({
      choices: [{ message: { content: JSON.stringify(parts) } }],
      usage: { prompt_tokens: 900, completion_tokens: 120 },
    });
    const out = await backend.describeParts('data:image/jpeg;base64,AA', {
      label: 'Guard',
      archetype: 'person',
      coverage: 'cut off at the left',
    });
    const body = JSON.parse(lastRequest(fetchMock).init.body as string);
    expect(body.response_format.json_schema.name).toBe('ObjectParts');
    expect(body.reasoning_effort).toBe('high');
    expect(body.model).not.toMatch(/contributor/);
    const text = body.messages[1].content[0].text as string;
    expect(text).toContain('"Guard"');
    expect(text).toContain('cut off at the left');
    expect(text).toContain('WHOLE');
    expect(out.result.recipe?.source).toBe('free');
    expect(out.result.recipe?.proportions.w).toBe(0.5);
    expect(out.result.recipe?.proportions.h).toBe(1);
    expect(out.result.recipe?.proportions.d).toBeCloseTo(0.375, 10);
    expect(out.usage).toEqual({ inputTokens: 900, outputTokens: 120 });

    respond({ choices: [{ message: { content: 'A person, standing.' } }] });
    const prose = await backend.describeParts('data:image/jpeg;base64,AA', {
      label: 'Guard',
      archetype: 'person',
    });
    expect(prose.result.recipe).toBeNull();
  });

  it('throws on a malformed detection reply so the client can fall back', async () => {
    respond({ choices: [{ message: { content: 'A fridge, I think.' } }] });
    await expect(backend.detectAppliances('data:image/jpeg;base64,AA')).rejects.toThrow(/JSON/);
  });

  it('segments through /responses and reads the boxes', async () => {
    const fetchMock = respond({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: '<0f>0<|box;x1=0;y1=0;x2=9;y2=4;w=10;h=10;c=0.9|><|mask;x=0;y=0;data=1,1,!|>',
            },
          ],
        },
      ],
    });
    const out = await backend.segmentImage('https://x/p.png', 'solar panel');

    const body = JSON.parse(lastRequest(fetchMock).init.body as string);
    expect(lastRequest(fetchMock).url).toBe(`${BASE}/responses`);
    expect(body.model).toBe('sam-3.1');
    expect(body.input[0].content).toEqual([
      { type: 'input_text', text: 'solar panel' },
      { type: 'input_image', image_url: 'inlined:https://x/p.png' },
    ]);
    expect(out.result.count).toBe(1);
    expect(out.result.boxCoverage).toBeCloseTo(0.5);
    expect(out.usage).toEqual({ images: 1 });
  });

  it('segment: decodes full masks into outlines on each instance', async () => {
    respond({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text:
                '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' +
                "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>",
            },
          ],
        },
      ],
    });
    const out = await backend.segmentImage('https://x/p.png', 'button');
    expect(out.result.instances[0]!.outline).toMatch(/^M.*Z$/);
  });

  it('throws on an HTTP error so the client can fall back', async () => {
    respond({ error: { code: 'media_url_origin_error' } }, false, 400);
    await expect(backend.analyzeImage('https://x', 'q')).rejects.toThrow(/400/);
  });

  it('throws without an API key', async () => {
    const noKey = new MetaPerceptionBackend({ apiKey: '', baseUrl: BASE });
    // env may hold a real key in dev: only assert when the constructor really has none.
    if (!(noKey as unknown as { apiKey: string }).apiKey) {
      await expect(noKey.segmentImage('https://x', 'roof')).rejects.toThrow(/META_API_KEY/);
    }
  });
});

describe('proposeShapeOps final check (PG-T24, Muse Wonder)', () => {
  const answer = (model: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      model,
      choices: [{ message: { content: '{"ops":[{"op":"set","id":"roof","ridge":0.9}]}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    text: async () => '',
  });
  const modelOf = (call: unknown[]) =>
    (JSON.parse(String((call[1] as RequestInit).body)) as { model: string }).model;

  it('a stage round asks Spark; the final check asks Wonder', async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer('x'));
    global.fetch = fetchMock as unknown as typeof fetch;
    await backend.proposeShapeOps('data:image/png;base64,AA', 'Stage: roof (round 1)');
    await backend.proposeShapeOps(
      'data:image/png;base64,AA',
      'Stage: final (round 1)',
      undefined,
      'elevation',
      {
        refine: true,
      }
    );
    expect(modelOf(fetchMock.mock.calls[0]!)).toBe('muse-spark-1.3');
    expect(modelOf(fetchMock.mock.calls[1]!)).toBe('muse-wonder-1.0');
  });

  it('Wonder fails → one retry on Spark, the ops still come back', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => 'no model',
      })
      .mockResolvedValueOnce(answer('muse-spark-1.3'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const out = await backend.proposeShapeOps('data:image/png;base64,AA', 'q', undefined, 'views', {
      refine: true,
    });
    expect(fetchMock.mock.calls.map((c) => modelOf(c))).toEqual([
      'muse-wonder-1.0',
      'muse-spark-1.3',
    ]);
    expect(out.result.ops).toEqual([{ op: 'set', id: 'roof', ridge: 0.9 }]);
  });
});
