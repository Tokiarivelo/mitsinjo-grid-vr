import { describe, expect, it } from 'vitest';
import { collectChatStream, isStreamedKind, readCompletion, teamCallKind } from '../chat-stream';

const sse = (chunks: unknown[]) =>
  chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join('');

describe('streamed chat completions (PQ-T72)', () => {
  it('puts the chunks back into one completion, with the usage', () => {
    const out = collectChatStream(
      `: keep-alive\n\n${sse([
        { choices: [{ delta: { content: '{"volumes"' } }] },
        { choices: [{ delta: { content: null } }] },
        'not json',
        { choices: [{ delta: { content: ':[]}' } }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 34 } },
        '[DONE]',
      ])}`
    );
    expect(out).toEqual({
      choices: [{ message: { content: '{"volumes":[]}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    });
  });

  it('reads an event stream as a stream and anything else as JSON', async () => {
    const streamed = new Response(sse([{ choices: [{ delta: { content: 'ok' } }] }, '[DONE]']), {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
    expect(await readCompletion(streamed)).toEqual({ choices: [{ message: { content: 'ok' } }] });
    const plain = new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      headers: { 'content-type': 'application/json' },
    });
    expect(await readCompletion(plain)).toEqual({ choices: [{ message: { content: 'ok' } }] });
  });

  it('streams the single house reading and every specialist team call, only (PQ-T85)', () => {
    for (const k of ['readHouse', 'housePilot', 'houseTool', 'carTool', 'plantPilot', 'seatTool'])
      expect(isStreamedKind(k)).toBe(true);
    for (const k of ['describeShape', 'judgeShape', 'askPart', 'nameClasses'])
      expect(isStreamedKind(k)).toBe(false);
    expect(teamCallKind('car', 'pilot')).toBe('carPilot');
    expect(teamCallKind('seat', 'legs')).toBe('seatTool');
  });
});

describe('readCompletion without headers', () => {
  it('reads a bare response as JSON', async () => {
    const res = { json: async () => ({ ok: 1 }) } as unknown as Response;
    expect(await readCompletion(res)).toEqual({ ok: 1 });
  });
});
