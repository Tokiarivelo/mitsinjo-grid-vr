import 'server-only';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ObjectRecipe } from '@/lib/object-shape';
import type { PerceptionClient } from './client';
import { presentAnatomy } from './fusion';
import type { ModelScore } from './model-score';
import { scoreRecipe, type RecipeScore } from './score-shape';
import { captureMasks, criticReplay, readCapture, type CriticReplayRound } from './shape-capture';
import { CODE_PROMPT_GENERIC_VERSION } from './shape-code';
import { codeRoundValid, codeSeedFor, refineWithCode, type CodeRound } from './shape-code-loop';
import { criticImage } from './spark-critic';

/**
 * Scored route-B vs route-A eval (PQ-T55, §12.13): on each eval capture the route-A draft is
 * the floor, route A refines it with Spark critic rounds (`criticReplay`) and route B with the
 * Wonder code loop (`refineWithCode`). Each route refines by its native procedure, but both
 * finals are re-scored on ONE photo yardstick (masks + anatomy when the capture has them) —
 * the replay's maskless number is never compared to the masked draft. Costs API calls: run on
 * demand (`make eval-code`), never in CI. `IDS` selects a subset for calibration.
 */

/** The §12.13 eval set: willow, car, house, one appliance. Eval-only (not in `REAL_SHAPES`). */
export const EVAL_CODE_IDS = ['willow', 'car-side', 'house-front', 'refrigerator'] as const;

/** Winner at equal cost: the higher gain per dollar (`tie` when neither route gains). */
export type CodeEvalVerdict = 'B' | 'A' | 'tie';

export interface EvalCodeSide {
  /** Final score (0–100 photo yardstick). */
  score: number;
  /** Gain over the draft (may be ≤ 0). */
  gain: number;
  /** Rounds run / kept. */
  rounds: number;
  kept: number;
  /** Estimated Meta spend, USD. */
  costUsd: number;
  /** Wall clock, seconds. */
  seconds: number;
}

export interface EvalCodeRow {
  id: string;
  archetype: string;
  codeVersion: number;
  draft: number;
  a: EvalCodeSide;
  b: EvalCodeSide & {
    /** Share of rounds whose body executed (§8bis valid-code rate). */
    validRate: number;
    /** Median tour duration, ms, and the writer call's share of all rounds. */
    tourMedianMs: number;
    writerShare: number;
  };
  verdict: CodeEvalVerdict;
}

/** Gain per dollar: the equal-cost comparison. No gain → the raw (≤ 0) gain, cost irrelevant. */
export function gainPerDollar(gain: number, costUsd: number): number {
  if (gain <= 0 || costUsd <= 0) return gain;
  return gain / costUsd;
}

/** Verdict from both sides' gain and cost. */
export function codeVerdict(
  aGain: number,
  aCost: number,
  bGain: number,
  bCost: number
): CodeEvalVerdict {
  if (aGain <= 0 && bGain <= 0) return 'tie';
  const a = gainPerDollar(aGain, aCost);
  const b = gainPerDollar(bGain, bCost);
  if (b > a) return 'B';
  if (a > b) return 'A';
  return 'tie';
}

/** Draft detail line for the writer question (`recall 0.70 · …`), from the fields measured. */
export function detailTextOf(score: ModelScore): string | undefined {
  const d = score.detail;
  if (!d) return undefined;
  const cells: string[] = [];
  if (d.partRecall !== undefined) cells.push(`recall ${d.partRecall.toFixed(2)}`);
  if (d.partPrecision !== undefined) cells.push(`precision ${d.partPrecision.toFixed(2)}`);
  if (d.interiorEdgeF1 !== undefined) cells.push(`interior F1 ${d.interiorEdgeF1.toFixed(2)}`);
  if (d.partDeltaE !== undefined) cells.push(`part ΔE ${d.partDeltaE.toFixed(1)}`);
  if (d.anatomyRecall !== undefined) cells.push(`ana ${d.anatomyRecall.toFixed(2)}`);
  return cells.length ? cells.join(' · ') : undefined;
}

/** Median tour duration and writer share over loop rounds (0 rounds → zeros). */
export function tourStats(rounds: ReadonlyArray<Pick<CodeRound, 'ms' | 'writeMs'>>): {
  medianMs: number;
  writerShare: number;
} {
  if (!rounds.length) return { medianMs: 0, writerShare: 0 };
  const sorted = rounds.map((r) => r.ms).sort((x, y) => x - y);
  const medianMs = sorted[Math.floor(sorted.length / 2)]!;
  const total = rounds.reduce((n, r) => n + r.ms, 0);
  const writer = rounds.reduce((n, r) => n + r.writeMs, 0);
  return { medianMs, writerShare: total > 0 ? writer / total : 0 };
}

const CodeEvalRoundSchema = z.object({
  round: z.number().int(),
  bytes: z.number().int(),
  score: z.number().nullable(),
  kept: z.boolean(),
  dropped: z.number().int(),
  reason: z.string().optional(),
  ms: z.number(),
  writeMs: z.number(),
  execMs: z.number(),
  scoreMs: z.number(),
  model: z.string().optional(),
  costUsd: z.number().optional(),
});

const CodeEvalSideSchema = z.object({
  score: z.number(),
  gain: z.number(),
  rounds: z.number().int(),
  kept: z.number().int(),
  costUsd: z.number(),
  seconds: z.number(),
});

/** One stored B-vs-A eval (`<id>.code-eval.json`, local like the judge answers). */
export const CodeEvalSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  evaluatedAt: z.string(),
  codeVersion: z.number().int(),
  archetype: z.string(),
  draft: z.number(),
  a: CodeEvalSideSchema.extend({
    roundsRun: z.array(
      z.object({
        before: z.number(),
        after: z.number(),
        kept: z.boolean(),
      })
    ),
  }),
  b: CodeEvalSideSchema.extend({
    validRate: z.number(),
    tourMedianMs: z.number(),
    writerShare: z.number(),
    roundsRun: z.array(CodeEvalRoundSchema),
    /** Winning body, when a round beat the draft. */
    code: z.string().nullable(),
  }),
  verdict: z.enum(['B', 'A', 'tie']),
});
export type CodeEval = z.infer<typeof CodeEvalSchema>;

/** Write `<dir>/<id>.code-eval.json` (local, gitignored, beside the captures). */
export function writeCodeEval(dir: string, eval_: CodeEval): string {
  const path = join(dir, `${eval_.id}.code-eval.json`);
  writeFileSync(path, JSON.stringify(CodeEvalSchema.parse(eval_), null, 2));
  return path;
}

/** Read a stored eval back. */
export function readCodeEval(dir: string, id: string): CodeEval {
  return CodeEvalSchema.parse(JSON.parse(readFileSync(join(dir, `${id}.code-eval.json`), 'utf8')));
}

export interface EvalCodeClients {
  /** Route-A critic (Spark live, null patch in mock: 0 rounds). */
  a: Pick<PerceptionClient, 'criticizeShape'>;
  /** Route-B writer (Wonder live, null code in mock: 3 stalled rounds). */
  b: Pick<PerceptionClient, 'writeBuildCode'>;
  /** Estimated spend so far per side (the live test reads `spendGuard` budget keys). */
  costUsd: (side: 'a' | 'b') => number;
}

export interface EvalCodeOptions {
  codeVersion?: number;
  /** Route-A critic rounds (default 3, like the replay harness). */
  criticRounds?: number;
  /** Route-B loop rounds (default: to stall, ≤ 5). */
  codeRoundsMax?: number;
  signal?: AbortSignal;
}

/**
 * One capture, both routes, same yardstick: the draft's photo score is the floor, route A runs
 * Spark critic rounds, route B runs the Wonder code loop to stall. Throws without a recipe or
 * an outline (nothing to score), like the live pipeline.
 */
export async function evalOneCode(
  dir: string,
  id: string,
  clients: EvalCodeClients,
  opts: EvalCodeOptions = {}
): Promise<{ row: EvalCodeRow; eval_: CodeEval }> {
  const codeVersion = opts.codeVersion ?? CODE_PROMPT_GENERIC_VERSION;
  const { capture, cropPhoto } = await readCapture(dir, id);
  const draft: ObjectRecipe | undefined = capture.recipe;
  if (!draft) throw new Error(`capture ${id}: no recipe to evaluate`);
  const masks = captureMasks(capture);
  const anatomy = presentAnatomy(capture.kit);
  const answered = anatomy.length ? anatomy : undefined;
  const { width, height } = cropPhoto;
  const maskCrop =
    masks.length > 0
      ? { left: 0, top: 0, width, height, outWidth: width, outHeight: height }
      : undefined;
  const scoreOf = async (recipe: ObjectRecipe): Promise<RecipeScore | null> =>
    masks.length > 0
      ? scoreRecipe(cropPhoto, capture.cropTarget, recipe, masks, maskCrop, answered)
      : scoreRecipe(cropPhoto, capture.cropTarget, recipe, undefined, undefined, answered);
  const draftScore = await scoreOf(draft);
  if (!draftScore) throw new Error(`capture ${id}: no outline to score against`);
  const box = capture.cropTarget.box;
  const aspect = (box.w * width) / (box.h * height);
  const draft100 = draftScore.score.score;
  const detailText = detailTextOf(draftScore.score);

  // Route A: Spark critic rounds on the frozen draft (mock answers no patch: 0 rounds).
  // Each route refines by its native procedure (`criticReplay` scores maskless), but the FINAL
  // comparison re-scores both finals on this eval's yardstick (masks + anatomy when present):
  // comparing the replay's maskless number to the masked draft fakes a gain (PQ-T55 fix).
  const aStart = Date.now();
  const replayed = await criticReplay(clients.a, dir, id, opts.criticRounds ?? 3, opts.signal);
  const aSeconds = (Date.now() - aStart) / 1000;
  const aFinal = await scoreOf(replayed.recipe).catch(() => null);
  const aScore = aFinal ? aFinal.score.score : draft100;
  const aRounds: CriticReplayRound[] = replayed.roundsRun;
  const a: EvalCodeSide = {
    score: aScore,
    gain: aScore - draft100,
    rounds: aRounds.length,
    kept: aRounds.filter((r) => r.kept).length,
    costUsd: clients.costUsd('a'),
    seconds: aSeconds,
  };

  // Route B: the Wonder code loop to stall (mock answers no code: 3 stalled rounds).
  const bStart = Date.now();
  const sheetCrop = draftScore.crop;
  const looped = await refineWithCode({
    label: capture.target.label,
    archetype: capture.kit.archetype,
    draft,
    baseScore: draft100 / 100,
    params: {
      seed: codeSeedFor(id),
      proportions: draft.proportions,
      colors: capture.kit.colors,
    },
    ...(detailText ? { detailText } : {}),
    sheet: async (recipe) => criticImage(sheetCrop, recipe, aspect),
    writeCode: async (img, q, sig) => {
      const r = await clients.b.writeBuildCode(img, q, sig, codeVersion);
      return { code: r.code, model: r.model };
    },
    score: async (r) => {
      const s = await scoreOf(r).catch(() => null);
      return s ? s.score.score / 100 : null;
    },
    ...(opts.codeRoundsMax !== undefined ? { roundsMax: opts.codeRoundsMax } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  const bSeconds = (Date.now() - bStart) / 1000;
  let bScore = draft100;
  if (looped.code !== null) {
    for (const r of looped.rounds) {
      // The yardstick is an integer 0–100: round the 0–1 loop scale back (no float dust).
      if (r.kept && r.score !== null) bScore = Math.round(r.score * 100);
    }
  }
  const bGain = bScore - draft100;
  const tour = tourStats(looped.rounds);
  const b: EvalCodeRow['b'] = {
    score: bScore,
    gain: bGain,
    rounds: looped.rounds.length,
    kept: looped.rounds.filter((r) => r.kept).length,
    costUsd: clients.costUsd('b'),
    seconds: bSeconds,
    validRate: looped.rounds.length
      ? looped.rounds.filter(codeRoundValid).length / looped.rounds.length
      : 0,
    tourMedianMs: tour.medianMs,
    writerShare: tour.writerShare,
  };
  const verdict = codeVerdict(a.gain, a.costUsd, b.gain, b.costUsd);
  const row: EvalCodeRow = {
    id,
    archetype: capture.kit.archetype,
    codeVersion,
    draft: draft100,
    a,
    b,
    verdict,
  };
  const eval_: CodeEval = {
    version: 1,
    id,
    evaluatedAt: new Date().toISOString(),
    codeVersion,
    archetype: capture.kit.archetype,
    draft: draft100,
    a: {
      ...a,
      roundsRun: aRounds.map((r) => ({ before: r.before, after: r.after, kept: r.kept })),
    },
    b: {
      ...b,
      roundsRun: looped.rounds.map((r) => ({
        round: r.round,
        bytes: r.bytes,
        score: r.score,
        kept: r.kept,
        dropped: r.dropped,
        ...(r.reason ? { reason: r.reason } : {}),
        ms: r.ms,
        writeMs: r.writeMs,
        execMs: r.execMs,
        scoreMs: r.scoreMs,
        ...(r.model ? { model: r.model } : {}),
        ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}),
      })),
      code: looped.code,
    },
    verdict,
  };
  return { row, eval_ };
}

/** One Markdown table over the eval rows, with the means (offline-safe, pure). */
export function evalCodeMarkdown(rows: ReadonlyArray<EvalCodeRow>): string {
  const lines = [
    '| ID | Draft | A: gain (rounds/cost) | B: gain (rounds/valid/cost) | Tour med | Verdict |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${r.draft.toFixed(1)} | ${fmtGain(r.a.gain)} (${r.a.rounds}r/$${r.a.costUsd.toFixed(3)}) | ${fmtGain(r.b.gain)} (${r.b.rounds}r/${r.b.validRate.toFixed(2)}/$${r.b.costUsd.toFixed(3)}) | ${(r.b.tourMedianMs / 1000).toFixed(1)} s | ${r.verdict} |`
    );
  }
  if (rows.length) {
    const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    lines.push(
      `| **mean** | ${mean(rows.map((r) => r.draft)).toFixed(1)} | ${fmtGain(mean(rows.map((r) => r.a.gain)))} ($${mean(rows.map((r) => r.a.costUsd)).toFixed(3)}) | ${fmtGain(mean(rows.map((r) => r.b.gain)))} ($${mean(rows.map((r) => r.b.costUsd)).toFixed(3)}) | ${(mean(rows.map((r) => r.b.tourMedianMs)) / 1000).toFixed(1)} s | |`
    );
  }
  return lines.join('\n');
}

const fmtGain = (g: number) => `${g >= 0 ? '+' : ''}${g.toFixed(1)}`;
