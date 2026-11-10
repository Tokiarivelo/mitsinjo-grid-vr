// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { env } from '@/lib/env';
import type { ObjectRecipe, RecipePart } from '@/lib/object-shape';
import { getPerceptionClient } from '../client';
import { MOCK_JUDGE_GRADE, MockPerceptionBackend } from '../mock';
import {
  calibration,
  damage,
  judgeMean,
  liveJudgement,
  judgeQuestion,
  judgeSheet,
  JUDGE_CRITERIA,
  JUDGE_PROMPT_VERSION,
  parseJudge,
  type Judgement,
} from '../rubric-judge';
import { readCapture, rescoreCapture } from '../shape-capture';
import { REAL_SHAPES } from '../__fixtures__/shape';

const part = (size: [number, number, number], extra: Partial<RecipePart> = {}): RecipePart => ({
  shape: 'box',
  at: [0, 0, 0],
  size,
  color: '#888888',
  ...extra,
});
const all = (g: number): Judgement => ({
  grades: Object.fromEntries(JUDGE_CRITERIA.map((c) => [c, g])) as Judgement['grades'],
  notes: {},
});

describe('rubric judge (PQ-T4)', () => {
  it('clamps and rounds grades to 1–5, keeps notes only under 4', () => {
    const j = parseJudge(
      JSON.stringify({
        grades: {
          silhouette: 7,
          proportions: 0,
          parts_present: 3.4,
          parts_placed: '4',
          surfaces: 2,
          likeness: 5,
        },
        notes: { proportions: 'too flat', likeness: 'fine', surfaces: '  roof is grey  ' },
      })
    )!;
    expect(j.grades).toEqual({
      silhouette: 5,
      proportions: 1,
      parts_present: 3,
      parts_placed: 4,
      surfaces: 2,
      likeness: 5,
    });
    expect(j.notes).toEqual({ proportions: 'too flat', surfaces: 'roof is grey' });
  });

  it('bad JSON or a missing grade → null', () => {
    expect(parseJudge('not json')).toBeNull();
    expect(parseJudge('{"grades":{"silhouette":3}}')).toBeNull();
    expect(parseJudge('null')).toBeNull();
    // A null or empty grade is missing, not the grade 1 (PR #9 review).
    const grades = {
      silhouette: 3,
      proportions: 3,
      parts_present: 3,
      parts_placed: 3,
      surfaces: 3,
    };
    expect(parseJudge(JSON.stringify({ grades: { ...grades, likeness: null } }))).toBeNull();
    expect(parseJudge(JSON.stringify({ grades: { ...grades, likeness: ' ' } }))).toBeNull();
  });

  it('damage removes the two biggest parts that are not the body', () => {
    const r: ObjectRecipe = {
      proportions: { w: 1, h: 1, d: 1 },
      parts: [
        part([0.2, 0.2, 0.2]),
        part([1, 1, 1], { front: true }),
        part([0.5, 0.5, 0.5]),
        part([0.1, 0.1, 0.1]),
        part([0.4, 0.4, 0.4]),
      ],
    };
    const d = damage(r);
    expect(d.parts.map((p) => p.size[0])).toEqual([0.2, 1, 0.1]);
    expect(damage({ ...r, parts: r.parts.slice(0, 2) }).parts).toHaveLength(2);
  });

  it('the mock answers a fixed grade', async () => {
    const out = await new MockPerceptionBackend().judgeShape('data:', judgeQuestion('fridge'));
    expect(out.result.judgement).toEqual(all(MOCK_JUDGE_GRADE));
    expect(judgeMean(out.result.judgement!)).toBe(MOCK_JUDGE_GRADE);
  });

  it('calibration trusts the judge only when damaged models grade lower in ≥ 90 % of pairs', () => {
    const good = Array.from({ length: 10 }, () => ({ intact: all(4), damaged: all(3) }));
    expect(calibration(good)).toEqual({ share: 1, trusted: true });
    const mixed = [
      ...good.slice(0, 8),
      ...good.slice(0, 2).map(() => ({ intact: all(3), damaged: all(3) })),
    ];
    expect(calibration(mixed)).toEqual({ share: 0.8, trusted: false });
    expect(calibration([]).trusted).toBe(false);
  });

  it('draws the photo | front | ¾ sheet as one PNG', async () => {
    const crop = { cols: 4, rows: 4, rgb: new Uint8Array(48).fill(200) };
    const url = await judgeSheet(
      crop,
      { proportions: { w: 1, h: 1, d: 1 }, parts: [part([0.8, 0.8, 0.8])] },
      1
    );
    const meta = await sharp(Buffer.from(url.split(',')[1]!, 'base64')).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(3 * 256);
    expect(meta.height).toBe(256);
  });
});

/**
 * `make shape-judge` (SHAPE_JUDGE=1, costs API calls): every real capture judged intact and damaged on
 * `META_JUDGE_MODEL`; answers stored beside the captures (`<id>.judge.json`) and replayed offline when
 * the model and prompt version match (`SHAPE_JUDGE_REPLAY=1` refuses any live call).
 */
describe('liveJudgement (PQ-T4)', () => {
  const j: Judgement = {
    grades: {
      silhouette: 4,
      proportions: 4,
      parts_present: 4,
      parts_placed: 4,
      surfaces: 4,
      likeness: 4,
    },
    notes: {},
  };
  it('keeps only a real Meta answer: a mock or a fallback (network timeout) is never a grade', () => {
    expect(liveJudgement({ source: 'meta', model: 'muse-wonder-1.0', judgement: j })).toBe(j);
    expect(liveJudgement({ source: 'mock', model: 'mock', judgement: j })).toBeNull();
    expect(
      liveJudgement({ source: 'mock', model: 'mock', fallback: 'provider_error', judgement: j })
    ).toBeNull();
  });
});

describe.runIf(process.env.SHAPE_JUDGE)('make shape-judge', () => {
  it('judges the real set and prints the calibration', async () => {
    const dir =
      process.env.SHAPE_REAL_DIR ??
      join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
    const replayOnly = process.env.SHAPE_JUDGE_REPLAY === '1';
    const client = getPerceptionClient('shape-judge');
    if (!replayOnly && !client.callsMeta)
      throw new Error('Refusing to judge with mock: set LLM_PROVIDER=meta');
    const pairs: Array<{ id: string; intact: Judgement; damaged: Judgement }> = [];
    const skipped: string[] = [];
    const undamageable: string[] = [];
    for (const c of REAL_SHAPES) {
      if (!existsSync(join(dir, `${c.id}.capture.json`))) continue;
      const { capture } = await readCapture(dir, c.id);
      // Fewer than three parts: `damage` removes nothing, the pair would compare a model with itself.
      if (!capture.recipe || damage(capture.recipe) === capture.recipe) {
        undamageable.push(c.id);
        continue;
      }
      const file = join(dir, `${c.id}.judge.json`);
      const stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
      if (stored?.promptVersion === JUDGE_PROMPT_VERSION && stored.model === env.META_JUDGE_MODEL) {
        pairs.push({ id: c.id, intact: stored.intact, damaged: stored.damaged });
        continue;
      }
      if (replayOnly) continue;
      const s = await rescoreCapture(dir, c.id);
      if (!s) continue;
      const box = capture.cropTarget.box;
      const aspect = s.crop.cols / s.crop.rows || box.w / box.h;
      const ask = async (recipe: ObjectRecipe) =>
        liveJudgement(
          await client.judgeShape(
            await judgeSheet(s.crop, recipe, aspect),
            judgeQuestion(capture.target.label)
          )
        );
      const [intact, damaged] = [await ask(capture.recipe), await ask(damage(capture.recipe))];
      // A fallback answer is never stored nor counted: the capture is retried on the next run.
      if (!intact || !damaged) {
        skipped.push(c.id);
        continue;
      }
      writeFileSync(
        file,
        JSON.stringify(
          { promptVersion: JUDGE_PROMPT_VERSION, model: env.META_JUDGE_MODEL, intact, damaged },
          null,
          2
        )
      );
      pairs.push({ id: c.id, intact, damaged });
    }
    const cal = calibration(pairs);
    const lines = pairs.map(
      (p) =>
        `| ${p.id} | ${judgeMean(p.intact).toFixed(2)} | ${judgeMean(p.damaged).toFixed(2)} | ${judgeMean(p.damaged) < judgeMean(p.intact) ? '✓' : '✗'} |`
    );
    console.info(
      `\n## Judge calibration (${env.META_JUDGE_MODEL}, prompt v${JUDGE_PROMPT_VERSION})\n\n| Capture | Intact | Damaged | Lower |\n| --- | --- | --- | --- |\n${lines.join('\n')}\n\nDamaged lower in ${Math.round(cal.share * 100)} % of ${pairs.length} pairs → ${cal.trusted ? 'trusted by the loop' : 'developer note only'}.${skipped.length ? `\n\nNo live answer (not counted, rerun): ${skipped.join(', ')}.` : ''}${undamageable.length ? `\n\nToo few parts to damage (not counted): ${undamageable.join(', ')}.` : ''}`
    );
    expect(pairs.length).toBeGreaterThan(0);
  }, 900_000);
});
