// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { ObjectKit } from '@/lib/object-kit';
import { getPerceptionClient } from '../client';
import {
  agreement,
  compareKits,
  evalCaptures,
  evalMarkdown,
  evalParts,
  partsEvalMarkdown,
  parsePromptVersions,
} from '../eval-shape';
import { KIT_PROMPT_VERSION, kitPrompt, SHAPE_SYSTEM_PROMPT } from '../shape';
import { writeGoldenCapture } from './golden-run';

const kit: ObjectKit = {
  archetype: 'vehicle',
  subtype: 'sedan',
  proportions: { w: 1, h: 0.4, d: 0.45 },
  colors: { main: '#a33327', secondary: '#cfd6dd', accent: '#1c1c1e' },
  materials: { main: 'metal', secondary: 'glass', accent: 'rubber' },
  details: { wheels: 4, doors: 2 },
};

describe('compareKits + agreement (PR-3.1)', () => {
  it('identical kits agree everywhere', () => {
    const row = { id: 'x', model: 'm', promptVersion: 1, ...compareKits(kit, kit), seconds: 1 };
    const { match, total } = agreement(row);
    expect(match).toBe(total);
    expect(row.proportionsDelta).toBe(0);
  });

  it('scores mismatches per field', () => {
    const other: ObjectKit = {
      ...kit,
      subtype: 'van',
      proportions: { w: 1, h: 0.6, d: 0.45 },
      materials: { main: 'metal', secondary: 'glass', accent: 'plastic' },
      details: { wheels: 6, doors: 2 },
    };
    const row = { id: 'x', model: 'm', promptVersion: 1, ...compareKits(kit, other), seconds: 1 };
    expect(row.archetype).toEqual(['vehicle', 'vehicle']);
    expect(row.subtype).toEqual(['sedan', 'van']);
    expect(row.counts.wheels).toEqual([4, 6]);
    expect(row.counts.doors).toEqual([2, 2]);
    expect(row.materials.accent).toEqual(['rubber', 'plastic']);
    expect(row.proportionsDelta).toBeCloseTo(0.2, 9);
    const { match, total } = agreement(row);
    expect(match).toBeLessThan(total);
    // archetype ✓, subtype ✗, wheels ✗, doors ✓, 3 materials (2 ✓), proportions ✗ (0.2 > 0.15)
    expect([match, total]).toEqual([4, 8]);
    const md = evalMarkdown([row]);
    expect(md).toContain('| x | m | 4/8 |');
    expect(md).toContain('wheels:4→6✗');
  });
});

describe('evalCaptures (PR-3.1)', () => {
  async function captureDir() {
    const dir = mkdtempSync(join(tmpdir(), 'shape-eval-'));
    await writeGoldenCapture(dir, 'fridge');
    return dir;
  }

  it('replays crops and compares against the frozen kits', async () => {
    const dir = await captureDir();
    const same = { describeShape: vi.fn().mockResolvedValue({ kit: kit, model: 'm' }) };
    const rows = await evalCaptures(same, dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('fridge');
    // The stub answers a vehicle kit for a fridge capture: archetype mismatch recorded.
    expect(rows[0]!.archetype).toEqual(['cabinet', 'vehicle']);
    expect(rows[0]!.seconds).toBeGreaterThanOrEqual(0);
    const quiet = { describeShape: vi.fn().mockResolvedValue({ model: 'm' }) };
    await expect(evalCaptures(quiet, dir)).resolves.toHaveLength(0);
  }, 60_000);

  it('asks with the chosen kit prompt and groups the table by version (PQ-T5)', async () => {
    const dir = await captureDir();
    const client = { describeShape: vi.fn().mockResolvedValue({ kit, model: 'm' }) };
    const rows = [
      ...(await evalCaptures(client, dir, undefined, 1)),
      ...(await evalCaptures(client, dir, undefined, 2)),
    ];
    expect(client.describeShape.mock.calls.map((c) => c[1].promptVersion)).toEqual([1, 2]);
    expect(rows.map((r) => r.promptVersion)).toEqual([1, 2]);
    const md = evalMarkdown([rows[1]!, rows[0]!]);
    expect(md.indexOf('### Kit prompt v1')).toBeGreaterThanOrEqual(0);
    expect(md.indexOf('### Kit prompt v2')).toBeGreaterThan(md.indexOf('### Kit prompt v1'));
    expect(md).toMatch(/### Kit prompt v1 — agree \d+\/\d+, median \d+\.\d s/);
  }, 60_000);

  it('reads PROMPT=1,2 (and v-prefixed, duplicate or empty values)', () => {
    expect(parsePromptVersions('1,2')).toEqual([1, 2]);
    expect(parsePromptVersions('v2, 2 ,x')).toEqual([2]);
    expect(parsePromptVersions(undefined)).toEqual([KIT_PROMPT_VERSION]);
    expect(kitPrompt(KIT_PROMPT_VERSION)).toBe(SHAPE_SYSTEM_PROMPT);
    expect(() => kitPrompt(99)).toThrow(/unknown kit prompt version 99/);
  });
});

describe('evalParts (PQ-T12)', () => {
  it('asks the free-parts call with the chosen prompt and reports builds, parts and time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parts-eval-'));
    await writeGoldenCapture(dir, 'fridge');
    const part = { shape: 'box' as const, at: [0, 0, 0], size: [0.6, 1, 0.5], color: '#cccccc' };
    const client = {
      describeParts: vi
        .fn()
        .mockResolvedValueOnce({
          recipe: { proportions: { w: 0.6, h: 1, d: 0.5 }, parts: [{ ...part, front: true }] },
          model: 'm',
        })
        .mockResolvedValueOnce({ recipe: null, model: 'm' }),
    };
    const rows = [
      ...(await evalParts(client, dir, 1)),
      ...(await evalParts(client, dir, 2, ['fridge'])),
      ...(await evalParts(client, dir, 2, ['not-there'])),
    ];
    expect(client.describeParts.mock.calls.map((c) => c[1].promptVersion)).toEqual([1, 2]);
    expect(client.describeParts.mock.calls[0]![1]).toMatchObject({ archetype: 'cabinet' });
    expect(rows.map((r) => [r.promptVersion, r.parts, r.valid])).toEqual([
      [1, 1, true],
      [2, 0, false],
    ]);
    const md = partsEvalMarkdown(rows);
    expect(md).toMatch(
      /### Free parts, prompt v1 — builds 1\/1, mean 1\.0 parts, median \d+\.\d s/
    );
    expect(md).toMatch(/### Free parts, prompt v2 — builds 0\/1/);
    expect(md).toContain('| fridge | m | ✗ | 0 |');
  }, 60_000);
});

const LIVE = process.env.EVAL_SHAPE === '1';

describe.skipIf(!LIVE)('make eval-shape', () => {
  it(
    'scores the real captures on live Spark',
    async () => {
      const dir =
        process.env.EVAL_SHAPE_DIR ??
        join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
      const client = getPerceptionClient('eval-shape');
      if (!client.callsMeta) throw new Error('Refusing to eval mock: set LLM_PROVIDER=meta');
      const rows = [];
      for (const v of parsePromptVersions(process.env.EVAL_SHAPE_PROMPTS))
        rows.push(...(await evalCaptures(client, dir, undefined, v)));
      const md = `# Kit eval — ${new Date().toISOString().slice(0, 10)}\n\n${evalMarkdown(rows)}`;
      console.info(`\n${md}`);
      expect(rows.length).toBeGreaterThan(0);
      // 20 min per prompt version: 16 real captures, ≈ 20 s each on prompt 1, far more on prompt 2 (PQ-T12 runs timed out at 10 and 20 min).
    },
    1_200_000 * Math.max(1, parsePromptVersions(process.env.EVAL_SHAPE_PROMPTS).length)
  );
});

/** `make eval-parts` (EVAL_PARTS=1, costs one call per capture and prompt): the free-parts call, first prompt vs Muse cards. */
describe.skipIf(process.env.EVAL_PARTS !== '1')('make eval-parts', () => {
  it(
    'asks the free-parts call on the real captures',
    async () => {
      const dir =
        process.env.EVAL_SHAPE_DIR ??
        join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
      const client = getPerceptionClient('eval-parts');
      if (!client.callsMeta) throw new Error('Refusing to eval mock: set LLM_PROVIDER=meta');
      const ids = (process.env.EVAL_PARTS_IDS ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const rows = [];
      for (const v of parsePromptVersions(process.env.EVAL_SHAPE_PROMPTS))
        rows.push(...(await evalParts(client, dir, v, ids)));
      console.info(
        `\n# Free-parts eval — ${new Date().toISOString().slice(0, 10)}\n\n${partsEvalMarkdown(rows)}`
      );
      expect(rows.length).toBeGreaterThan(0);
    },
    1_200_000 * Math.max(1, parsePromptVersions(process.env.EVAL_SHAPE_PROMPTS).length)
  );
});
