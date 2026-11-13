import 'server-only';

import type { ObjectRecipe } from '@/lib/object-shape';
import { estimateCostUsd, type UsageSample } from '@/server/spend';
import { buildCodeQuestion, CODE_PROMPT_VERSION } from './shape-code';
import { runSandboxedCode, type CodeParams } from './code-sandbox';

/**
 * Route-B refinement loop (PQ-T45, §8bis): write → run → render → compare → keep only gains.
 * The draft (route A) shows first; the code model replaces it round by round, never worse.
 * Scores run 0–1 (the wiring normalises its yardstick); the loop itself never sees a photo.
 */

/** Gain that keeps a round (§8bis): +0.005 on the 0–1 yardstick. */
export const CODE_MIN_GAIN = 0.005;
/** Rounds without gain before the loop stops (§8bis). */
export const CODE_STALLS_MAX = 3;
/** Most Wonder rounds per object (spend safety; stalls stop it earlier). */
export const CODE_ROUNDS_MAX = 5;

export interface CodeRound {
  round: number;
  /** Bytes of the tried body, 0 when the writer answered nothing usable. */
  bytes: number;
  /** Yardstick of the tried model, null when it failed to run or score. */
  score: number | null;
  kept: boolean;
  dropped: number;
  reason?: string;
  /** Tour duration (PQ-T55 §8bis): whole round, ms. */
  ms: number;
  /** Writer call (Meta), sandbox execution, yardstick scoring, ms. */
  writeMs: number;
  execMs: number;
  scoreMs: number;
  /** Model that wrote the round, when the writer reports it. */
  model?: string;
  /** Estimated Meta cost of the round, when the writer reports model + usage. */
  costUsd?: number;
}

/** A round whose body executed (valid code ran, whether or not it gained). */
export function codeRoundValid(r: Pick<CodeRound, 'bytes' | 'score' | 'reason'>): boolean {
  return r.bytes > 0 && (r.score !== null || r.reason === 'unscorable');
}

/** Everything one round produced, for the debug dump (PQ-T56): the body, its model, why it lost. */
export interface CodeRoundEvent extends CodeRound {
  question: string;
  /** Score the round had to beat. */
  baseScore: number;
  /** The `build()` body the writer answered, null when it answered nothing usable. */
  rawBody: string | null;
  /** Executed recipe, null when the body failed to run. */
  recipe: ObjectRecipe | null;
  /** Dropped-part reasons (`index: reason`). */
  issues: string[];
}

export interface CodeLoopResult {
  recipe: ObjectRecipe;
  /** Winning body, null when no round beat the draft. */
  code: string | null;
  promptVersion: number;
  seed: number;
  rounds: CodeRound[];
}

export interface CodeLoopInput {
  label: string;
  /** Kit archetype, shown beside the label so the v2 kind section applies (PQ-T55). */
  archetype?: string;
  /** Route-A draft: the floor, shown before any round lands. */
  draft: ObjectRecipe;
  /** Draft's yardstick (0–1). */
  baseScore: number;
  /** Params the guest rebuilds from (its proportions win). */
  params: CodeParams;
  /** `name value` measure lines the code must cite. */
  measuresText?: string;
  /** Draft detail lines (`recall 0.7 · …`), static for the loop. */
  detailText?: string;
  /** Sheet the writer sees beside its question (photo | current render). */
  sheet: (recipe: ObjectRecipe) => Promise<string>;
  /** One Wonder call; null code = failed round (counts as no gain, never throws the loop). */
  writeCode: (
    imageUrl: string,
    question: string,
    signal?: AbortSignal
  ) => Promise<{ code: string | null; model?: string; usage?: UsageSample } | null>;
  /** Yardstick of one candidate (0–1), null when unscorable. */
  score: (recipe: ObjectRecipe) => Promise<number | null>;
  /** Sandbox execution (default: the §8bis QuickJS runner; tests inject fakes). */
  execute?: typeof runSandboxedCode;
  /** Called after every round, kept or not (debug dump); must not throw into the loop. */
  onRound?: (event: CodeRoundEvent) => void;
  /** Writer prompt version of this run, stored with the code (default: current). */
  promptVersion?: number;
  roundsMax?: number;
  minGain?: number;
  signal?: AbortSignal;
}

/** Deterministic seed of one object (FNV-1a of its id): stored code replays bit-identically. */
export function codeSeedFor(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function refineWithCode(input: CodeLoopInput): Promise<CodeLoopResult> {
  const {
    label,
    archetype,
    draft,
    baseScore,
    params,
    measuresText,
    detailText,
    sheet,
    writeCode,
    score,
    execute = runSandboxedCode,
    onRound,
    promptVersion = CODE_PROMPT_VERSION,
    roundsMax = CODE_ROUNDS_MAX,
    minGain = CODE_MIN_GAIN,
    signal,
  } = input;
  let best = draft;
  let bestScore = baseScore;
  let code: string | null = null;
  let stalls = 0;
  let droppedText: string | undefined;
  const rounds: CodeRound[] = [];
  const record = (
    r: CodeRound,
    question: string,
    rawBody: string | null,
    recipe: ObjectRecipe | null,
    issues: string[]
  ) => {
    rounds.push(r);
    try {
      onRound?.({ ...r, question, baseScore: bestScore, rawBody, recipe, issues });
    } catch (err) {
      console.warn('[vision] 3D code round hook failed:', err instanceof Error ? err.message : err);
    }
  };
  for (let round = 1; round <= Math.max(1, roundsMax); round++) {
    if (signal?.aborted) break;
    let image: string;
    try {
      image = await sheet(best);
    } catch (err) {
      console.warn(
        '[vision] 3D code sheet failed, keeping the draft:',
        err instanceof Error ? err.message : err
      );
      break;
    }
    const question = buildCodeQuestion({
      label,
      ...(archetype ? { archetype } : {}),
      draft: best,
      scoreText: bestScore.toFixed(3),
      ...(detailText ? { detailText } : {}),
      ...(measuresText ? { measuresText } : {}),
      ...(code ? { currentCode: code } : {}),
      ...(droppedText ? { droppedText } : {}),
    });
    const roundStart = Date.now();
    const answered = await writeCode(image, question, signal).catch(() => null);
    const writeMs = Date.now() - roundStart;
    const model = answered?.model;
    const costUsd = model && answered?.usage ? estimateCostUsd(model, answered.usage) : undefined;
    const body = answered?.code ?? null;
    if (!body) {
      record(
        {
          round,
          bytes: 0,
          score: null,
          kept: false,
          dropped: 0,
          reason: 'no code',
          ms: Date.now() - roundStart,
          writeMs,
          execMs: 0,
          scoreMs: 0,
          ...(model ? { model } : {}),
          ...(costUsd !== undefined ? { costUsd } : {}),
        },
        question,
        null,
        null,
        []
      );
      console.info(
        `[vision] 3D code round ${round} for "${label}": ${answered ? 'writer answer unusable (empty, not JSON or over 64 Ko)' : 'writer call failed'}`
      );
      stalls += 1;
      if (stalls >= CODE_STALLS_MAX) break;
      continue;
    }
    const execStart = Date.now();
    const exec = await execute(body, params).catch((err: unknown) => ({
      ok: false as const,
      reason: err instanceof Error ? err.message : String(err),
    }));
    const execMs = Date.now() - execStart;
    if (!exec.ok) {
      record(
        {
          round,
          bytes: Buffer.byteLength(body, 'utf8'),
          score: null,
          kept: false,
          dropped: 0,
          reason: trunc(exec.reason, 120),
          ms: Date.now() - roundStart,
          writeMs,
          execMs,
          scoreMs: 0,
          ...(model ? { model } : {}),
          ...(costUsd !== undefined ? { costUsd } : {}),
        },
        question,
        body,
        null,
        []
      );
      console.info(
        `[vision] 3D code round ${round} for "${label}": failed (${trunc(exec.reason, 120)})`
      );
      stalls += 1;
      if (stalls >= CODE_STALLS_MAX) break;
      continue;
    }
    droppedText = exec.issues.length
      ? exec.issues.map((i) => `${i.index}: ${i.reason}`).join('; ')
      : undefined;
    const scoreStart = Date.now();
    const s = await score(exec.recipe).catch(() => null);
    const scoreMs = Date.now() - scoreStart;
    const kept = s !== null && s - bestScore >= minGain;
    record(
      {
        round,
        bytes: Buffer.byteLength(body, 'utf8'),
        score: s,
        kept,
        dropped: exec.issues.length,
        ...(s === null
          ? { reason: 'unscorable' }
          : !kept
            ? { reason: `no gain (${s.toFixed(3)} vs ${bestScore.toFixed(3)}, needs +${minGain})` }
            : {}),
        ms: Date.now() - roundStart,
        writeMs,
        execMs,
        scoreMs,
        ...(model ? { model } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
      },
      question,
      body,
      exec.recipe,
      exec.issues.map((i) => `${i.index}: ${i.reason}`)
    );
    const secs = ((Date.now() - roundStart) / 1000).toFixed(1);
    if (kept && s !== null) {
      console.info(
        `[vision] 3D code round ${round} for "${label}": ${bestScore.toFixed(3)}→${s.toFixed(3)} kept (${exec.recipe.parts.length} parts${exec.issues.length ? `, ${exec.issues.length} dropped` : ''}) in ${secs} s`
      );
      best = exec.recipe;
      bestScore = s;
      code = body;
      stalls = 0;
    } else {
      console.info(
        `[vision] 3D code round ${round} for "${label}": ${s === null ? 'unscorable' : `${bestScore.toFixed(3)}→${s.toFixed(3)}`} dropped in ${secs} s`
      );
      stalls += 1;
      if (stalls >= CODE_STALLS_MAX) break;
    }
  }
  if (!code) console.info(`[vision] 3D code for "${label}": no round beat the draft`);
  return { recipe: best, code, promptVersion, seed: params.seed, rounds };
}
