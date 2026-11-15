// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { getPerceptionClient } from '../client';
import { askPartQuestions } from '../part-question';

/**
 * `make part-probe ID=<capture> PARTS="wheels,chimney"` (PART_PROBE=1, one Spark `low` call per
 * part, in parallel): asks each part on the capture's shape crop and prints the answers with the
 * latency. Proves `low` effort is accepted by the Meta endpoint and the short answers are usable
 * (PQ-T52). Fails when any answer is unusable.
 */
describe.runIf(process.env.PART_PROBE)('make part-probe', () => {
  it('answers one short question per part', async () => {
    const dir =
      process.env.SHAPE_REAL_DIR ??
      join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
    const id = process.env.PART_PROBE_ID;
    const parts = (process.env.PART_PROBE_PARTS ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (!id || !parts.length) throw new Error('Usage: make part-probe ID=<capture id> PARTS="a,b"');
    const cropPath = join(dir, `${id}.crop.jpg`);
    if (!existsSync(cropPath)) throw new Error(`no crop at ${cropPath}`);
    const client = getPerceptionClient('part-probe');
    if (!client.callsMeta) throw new Error('Refusing to probe with mock: set LLM_PROVIDER=meta');
    const cropUrl = `data:image/jpeg;base64,${readFileSync(cropPath).toString('base64')}`;
    const t0 = Date.now();
    const out = await askPartQuestions(
      async (imageUrl, question, signal) =>
        (await client.askPart(imageUrl, question, signal)).answer,
      cropUrl,
      parts.map((part) => ({ part }))
    );
    const seconds = (Date.now() - t0) / 1000;
    for (const { part, answer } of out)
      console.info(
        `[vision] part-probe ${id} "${part}": ${answer ? JSON.stringify(answer) : 'unusable'}`
      );
    console.info(`[vision] part-probe ${id}: ${out.length} parts in ${seconds.toFixed(1)} s`);
    for (const { part, answer } of out) expect(answer, `part "${part}"`).not.toBeNull();
  }, 120_000);
});
