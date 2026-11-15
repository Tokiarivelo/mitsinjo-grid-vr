// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { spendGuard } from '@/server/spend';
import { getPerceptionClient } from '../client';
import { scoreRecipe } from '../score-shape';
import { readCapture } from '../shape-capture';
import {
  CodeEvalSchema,
  codeVerdict,
  detailTextOf,
  EVAL_CODE_IDS,
  evalCodeMarkdown,
  evalOneCode,
  gainPerDollar,
  readCodeEval,
  tourStats,
  writeCodeEval,
  type CodeEval,
  type EvalCodeRow,
} from '../eval-code';
import { writeGoldenCapture } from './golden-run';

describe('gainPerDollar + codeVerdict (PQ-T55)', () => {
  it('compares gains at equal cost, not raw gains', () => {
    // B gains more raw (+5) but A buys each point cheaper: A wins the equal-cost verdict.
    expect(codeVerdict(2, 1, 5, 10)).toBe('A');
    expect(codeVerdict(2, 10, 5, 1)).toBe('B');
    expect(gainPerDollar(4, 2)).toBe(2);
  });

  it('ties when neither route gains, whatever the spend', () => {
    expect(codeVerdict(0, 1, 0, 100)).toBe('tie');
    expect(codeVerdict(-1, 0, 0, 5)).toBe('tie');
    // A free gain still beats no gain.
    expect(codeVerdict(0, 1, 3, 0)).toBe('B');
  });
});

describe('detail text and tour stats (PQ-T55)', () => {
  it('lists the measured detail fields only', () => {
    expect(detailTextOf({ detail: undefined } as never)).toBeUndefined();
    expect(detailTextOf({ detail: { partRecall: 0.7, partDeltaE: 5.04 } } as never)).toBe(
      'recall 0.70 · part ΔE 5.0'
    );
    expect(detailTextOf({ detail: {} } as never)).toBeUndefined();
  });

  it('medians the tour and shares the writer part', () => {
    expect(tourStats([])).toEqual({ medianMs: 0, writerShare: 0 });
    const stats = tourStats([
      { ms: 100, writeMs: 90 },
      { ms: 300, writeMs: 270 },
      { ms: 200, writeMs: 100 },
    ]);
    expect(stats.medianMs).toBe(200);
    expect(stats.writerShare).toBeCloseTo(460 / 600, 6);
  });
});

describe('eval markdown + stored eval (PQ-T55)', () => {
  const row = (id: string, verdict: EvalCodeRow['verdict']): EvalCodeRow => ({
    id,
    archetype: 'cabinet',
    codeVersion: 2,
    draft: 90,
    a: { score: 91, gain: 1, rounds: 2, kept: 1, costUsd: 0.01, seconds: 30 },
    b: {
      score: 92,
      gain: 2,
      rounds: 3,
      kept: 1,
      costUsd: 0.05,
      seconds: 120,
      validRate: 2 / 3,
      tourMedianMs: 40000,
      writerShare: 0.95,
    },
    verdict,
  });

  it('prints one line per id plus the means', () => {
    const md = evalCodeMarkdown([row('willow', 'B')]);
    expect(md).toMatch(/willow/);
    expect(md).toMatch(/\+1\.0/);
    expect(md).toMatch(/\+2\.0/);
    expect(md).toMatch(/40\.0 s/);
    expect(md).toMatch(/\*\*mean\*\*/);
  });

  it('round-trips a stored eval through its schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-code-'));
    const eval_: CodeEval = {
      version: 1,
      id: 'willow',
      evaluatedAt: new Date().toISOString(),
      codeVersion: 2,
      archetype: 'tree',
      draft: 90,
      a: {
        score: 91,
        gain: 1,
        rounds: 1,
        kept: 1,
        costUsd: 0.01,
        seconds: 30,
        roundsRun: [{ before: 90, after: 91, kept: true }],
      },
      b: {
        score: 92,
        gain: 2,
        rounds: 1,
        kept: 1,
        costUsd: 0.05,
        seconds: 120,
        validRate: 1,
        tourMedianMs: 40000,
        writerShare: 0.95,
        roundsRun: [
          {
            round: 1,
            bytes: 100,
            score: 0.92,
            kept: true,
            dropped: 0,
            ms: 40000,
            writeMs: 38000,
            execMs: 50,
            scoreMs: 100,
            model: 'muse-wonder-1.0',
          },
        ],
        code: 'return [];',
      },
      verdict: 'B',
    };
    const path = writeCodeEval(dir, eval_);
    expect(path).toBe(join(dir, 'willow.code-eval.json'));
    expect(readCodeEval(dir, 'willow')).toEqual(eval_);
    expect(() => CodeEvalSchema.parse({ ...eval_, verdict: 'C' })).toThrow();
  });
});

describe('evalOneCode offline on a golden capture (PQ-T55)', () => {
  it('runs both sides with mock answers: no gain, tie, stalled B rounds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-code-'));
    await writeGoldenCapture(dir, 'fridge');
    const clients = {
      a: {
        criticizeShape: vi.fn().mockResolvedValue({ patch: null, missingParts: [] }),
      },
      b: {
        writeBuildCode: vi.fn().mockResolvedValue({ code: null, model: 'mock' }),
      },
      costUsd: () => 0,
    };
    const { row, eval_ } = await evalOneCode(dir, 'fridge', clients as never, {
      codeRoundsMax: 3,
    });
    expect(row.draft).toBeGreaterThan(0);
    expect(row.a).toMatchObject({ rounds: 0, kept: 0, gain: 0 });
    expect(row.b).toMatchObject({ rounds: 3, kept: 0, gain: 0, validRate: 0 });
    expect(row.verdict).toBe('tie');
    expect(eval_.b.roundsRun.map((r) => r.reason)).toEqual(['no code', 'no code', 'no code']);
    expect(eval_.b.code).toBeNull();
    expect(clients.b.writeBuildCode).toHaveBeenCalledTimes(3);
    // The writer is asked with the generic prompt version.
    expect(clients.b.writeBuildCode.mock.calls[0]?.[3]).toBe(2);
  }, 60_000);

  it('scores route A on the eval yardstick, not the replay maskless number (PQ-T55)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-code-'));
    await writeGoldenCapture(dir, 'fridge');
    // One part mask on the object: masked and maskless scores now differ.
    const json = join(dir, 'fridge.capture.json');
    const stored = JSON.parse(readFileSync(json, 'utf8'));
    stored.partMasks = [{ concept: 'window', box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }];
    writeFileSync(json, JSON.stringify(stored));
    const { capture, cropPhoto } = await readCapture(dir, 'fridge');
    const maskless = await scoreRecipe(cropPhoto, capture.cropTarget, capture.recipe!);
    const clients = {
      a: {
        criticizeShape: vi.fn().mockResolvedValue({ patch: null, missingParts: [] }),
      },
      b: {
        writeBuildCode: vi.fn().mockResolvedValue({ code: null, model: 'mock' }),
      },
      costUsd: () => 0,
    };
    const { row } = await evalOneCode(dir, 'fridge', clients as never, { codeRoundsMax: 3 });
    // Sensitivity: the mask really moves the yardstick off the maskless number.
    expect(maskless?.score.score).not.toBe(row.draft);
    // Before the fix, a.score was the maskless replay number (a faked gain); now it is the
    // yardstick rescore of route A's final recipe (= the draft: 0 kept rounds).
    expect(row.a.score).toBe(row.draft);
    expect(row.a.gain).toBe(0);
  }, 60_000);
});

const LIVE = process.env.EVAL_CODE === '1';

describe.skipIf(!LIVE)('make eval-code', () => {
  it(
    'scores route B against route A on the §12.13 set, to stall',
    async () => {
      const dir =
        process.env.EVAL_CODE_DIR ??
        join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
      const wanted = (process.env.EVAL_CODE_IDS ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const ids = wanted.length ? wanted : [...EVAL_CODE_IDS];
      const client = getPerceptionClient('eval-code');
      if (!client.callsMeta) throw new Error('Refusing to eval mock: set LLM_PROVIDER=meta');
      const rows: EvalCodeRow[] = [];
      for (const id of ids) {
        const aKey = `eval-code-${id}-a`;
        const bKey = `eval-code-${id}-b`;
        const { row, eval_ } = await evalOneCode(
          dir,
          id,
          {
            a: getPerceptionClient(aKey),
            b: getPerceptionClient(bKey),
            costUsd: (side) => spendGuard.spentUsd(side === 'a' ? aKey : bKey),
          },
          {}
        );
        rows.push(row);
        const path = writeCodeEval(dir, eval_);
        console.info(
          `[vision] eval-code ${id}: draft ${row.draft} → A ${row.a.score} (+${row.a.gain.toFixed(1)}, $${row.a.costUsd.toFixed(3)}) vs B ${row.b.score} (+${row.b.gain.toFixed(1)}, $${row.b.costUsd.toFixed(3)}, valid ${row.b.validRate.toFixed(2)}) → ${row.verdict}\n  ${path}`
        );
      }
      console.info(
        `\n# Route-B vs route-A eval — ${new Date().toISOString().slice(0, 10)}\n\n${evalCodeMarkdown(rows)}`
      );
      expect(rows.length).toBe(ids.length);
    },
    // 30 min per id: up to 5 Wonder rounds + 3 Spark critic rounds, each minutes long.
    1_800_000 *
      Math.max(
        1,
        (process.env.EVAL_CODE_IDS ?? '').split(',').filter(Boolean).length || EVAL_CODE_IDS.length
      )
  );
});
