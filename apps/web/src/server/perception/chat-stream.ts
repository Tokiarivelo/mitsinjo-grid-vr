/**
 * Streamed chat completions (PQ-T72): a long reasoning call (the house specialist thinks for
 * minutes) asked with `stream: true` gets its response headers at once; it is sent through
 * `longFetch` (the model stays silent while it thinks, past fetch's 300 s body timer). The chunks
 * are put back into the one completion the callers read. Pure, no network.
 */

/** Call kinds asked as a stream (long answers only: a short one gains nothing). */
export const STREAMED_KINDS: ReadonlySet<string> = new Set([
  'readHouse',
  'housePilot',
  'houseTool',
  'carPilot',
  'carTool',
]);

/** The completion as a non-streamed call returns it. */
export interface ChatCompletion {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Server-sent events of a streamed completion (OpenAI chunks: `data: {choices:[{delta:{content}}]}`,
 * `data: [DONE]`) → one completion. Lines that are not data, keep-alives and unparsable chunks
 * are skipped; usage is taken from the chunk that carries it.
 */
export function collectChatStream(events: string): ChatCompletion {
  let content = '';
  let usage: ChatCompletion['usage'];
  for (const raw of events.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const chunk = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string } }>;
        usage?: ChatCompletion['usage'];
      };
      const choice = chunk.choices?.[0];
      content += choice?.delta?.content ?? choice?.message?.content ?? '';
      if (chunk.usage) usage = chunk.usage;
    } catch {
      // A keep-alive or a cut line: nothing to add.
    }
  }
  return { choices: [{ message: { content } }], ...(usage ? { usage } : {}) };
}

/** A response body read as text when it is an event stream, as JSON otherwise. */
export async function readCompletion(res: Response): Promise<unknown> {
  // A bare response (no headers, as test doubles give) is read as JSON.
  const type = (res.headers as Headers | undefined)?.get('content-type') ?? '';
  if (type.includes('text/event-stream')) return collectChatStream(await res.text());
  return (await res.json()) as unknown;
}
