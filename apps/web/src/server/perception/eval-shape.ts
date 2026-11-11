import 'server-only';

import { readdirSync } from 'node:fs';
import type { ObjectKit } from '@/lib/object-kit';
import { recipeIssue } from '@/lib/object-shape';
import type { PerceptionClient } from './client';
import { readCapture } from './shape-capture';
import { KIT_PROMPT_VERSION } from './shape';

/**
 * Kit eval harness (PR-3.1, S3): replays the captured crops on live Spark and scores the fresh
 * kit against the frozen capture kit (regression truth) — archetype, subtype, counts, materials —
 * plus latency. Costs API calls: run on demand (`make eval-shape`), never in CI. `MODEL` selects
 * the vision model for PR-3.4 comparisons.
 */

export interface EvalRow {
  id: string;
  model: string;
  /** Kit prompt version asked with (PQ-T5). */
  promptVersion: number;
  archetype: [truth: string, got: string];
  subtype: [truth: string | undefined, got: string | undefined];
  /** Per count key: [truth, got]. */
  counts: Record<string, [number | undefined, number | undefined]>;
  /** Per colour role: [truth, got] materials. */
  materials: Record<string, [string | undefined, string | undefined]>;
  /** L1 distance of the rescaled proportions (0 = same). */
  proportionsDelta: number;
  /** Spark latency for this crop, seconds. */
  seconds: number;
}

const COUNT_KEYS = ['windows', 'doors', 'wheels', 'legs', 'floors', 'units'] as const;
const ROLES = ['main', 'secondary', 'accent'] as const;

export function compareKits(
  truth: ObjectKit,
  got: ObjectKit
): Omit<EvalRow, 'id' | 'model' | 'seconds' | 'promptVersion'> {
  const counts: EvalRow['counts'] = {};
  for (const k of COUNT_KEYS) {
    const t = truth.details?.[k];
    const g = got.details?.[k];
    if (t !== undefined || g !== undefined) counts[k] = [t, g];
  }
  if (truth.details?.chimney !== undefined || got.details?.chimney !== undefined) {
    counts.chimney = [
      truth.details?.chimney === true ? 1 : truth.details?.chimney === false ? 0 : undefined,
      got.details?.chimney === true ? 1 : got.details?.chimney === false ? 0 : undefined,
    ];
  }
  const materials: EvalRow['materials'] = {};
  for (const r of ROLES) {
    const t = truth.materials?.[r];
    const g = got.materials?.[r];
    if (t !== undefined || g !== undefined) materials[r] = [t, g];
  }
  const proportionsDelta =
    Math.abs(truth.proportions.w - got.proportions.w) +
    Math.abs(truth.proportions.h - got.proportions.h) +
    Math.abs(truth.proportions.d - got.proportions.d);
  return {
    archetype: [truth.archetype, got.archetype],
    subtype: [truth.subtype, got.subtype],
    counts,
    materials,
    proportionsDelta,
  };
}

/** Agreement summary: exact matches over compared fields (proportions within 0.15). */
export function agreement(row: EvalRow): { match: number; total: number } {
  let match = row.archetype[0] === row.archetype[1] ? 1 : 0;
  let total = 1;
  if (row.subtype[0] !== undefined || row.subtype[1] !== undefined) {
    total++;
    if (row.subtype[0] === row.subtype[1]) match++;
  }
  for (const [t, g] of Object.values(row.counts)) {
    total++;
    if (t === g) match++;
  }
  for (const [t, g] of Object.values(row.materials)) {
    total++;
    if (t === g) match++;
  }
  total++;
  if (row.proportionsDelta <= 0.15) match++;
  return { match, total };
}

/** One live Spark kit per capture in `dir`, asked with kit prompt `promptVersion` (default: current). */
export async function evalCaptures(
  client: Pick<PerceptionClient, 'describeShape'>,
  dir: string,
  signal?: AbortSignal,
  promptVersion: number = KIT_PROMPT_VERSION
): Promise<EvalRow[]> {
  const ids = readdirSync(dir)
    .filter((f) => f.endsWith('.capture.json'))
    .map((f) => f.slice(0, -'.capture.json'.length))
    .sort();
  const rows: EvalRow[] = [];
  for (const id of ids) {
    const { capture, cropPhoto } = await readCapture(dir, id);
    const url = `data:image/jpeg;base64,${cropPhoto.buffer.toString('base64')}`;
    const box = capture.cropTarget.box;
    const aspect = (box.w * cropPhoto.width) / (box.h * cropPhoto.height);
    const started = Date.now();
    const out = await client.describeShape(
      url,
      {
        label: capture.target.label,
        category: capture.target.category,
        ...(capture.target.scenery ? { scenery: capture.target.scenery } : {}),
        ...(aspect > 0 ? { aspect } : {}),
        promptVersion,
      },
      signal
    );
    const seconds = (Date.now() - started) / 1000;
    if (!out.kit) {
      console.warn(`[eval] ${id}: no kit from ${out.model}, skipped`);
      continue;
    }
    rows.push({
      id,
      model: out.model,
      promptVersion,
      ...compareKits(capture.kit, out.kit),
      seconds,
    });
    // One line per capture as it lands: a long run that is cut short still leaves its numbers.
    console.info(`[eval] prompt ${promptVersion} ${id}: ${seconds.toFixed(1)} s (${out.model})`);
  }
  return rows;
}

/** Kit prompt versions to evaluate: `PROMPT=1,2` (env `EVAL_SHAPE_PROMPTS`) → [1, 2]; empty → current. */
export function parsePromptVersions(raw: string | undefined): number[] {
  const versions = (raw ?? '')
    .split(',')
    .map((v) => Number(v.trim().replace(/^v/i, '')))
    .filter((v) => Number.isInteger(v) && v >= 1);
  return versions.length ? [...new Set(versions)] : [KIT_PROMPT_VERSION];
}

/**
 * Markdown agreement table for the console and the report file, one section per prompt version
 * (PQ-T5) with its total agreement and median latency, so two prompts compare in one table.
 */
export function evalMarkdown(rows: EvalRow[]): string {
  const versions = [...new Set(rows.map((r) => r.promptVersion))].sort((a, b) => a - b);
  return versions
    .map((v) =>
      versionTable(
        v,
        rows.filter((r) => r.promptVersion === v)
      )
    )
    .join('\n');
}

function versionTable(version: number, rows: EvalRow[]): string {
  const sum = rows.reduce(
    (a, r) => {
      const { match, total } = agreement(r);
      return { match: a.match + match, total: a.total + total };
    },
    { match: 0, total: 0 }
  );
  const secs = rows.map((r) => r.seconds).sort((a, b) => a - b);
  const median = secs.length ? secs[Math.floor((secs.length - 1) / 2)]! : 0;
  const lines = [
    `### Kit prompt v${version} — agree ${sum.match}/${sum.total}, median ${median.toFixed(1)} s`,
    '',
    '| id | model | agree | arch | sub | counts | materials | Δprop | s |',
    '| -- | ----- | ----- | ---- | --- | ------ | --------- | ----- | - |',
  ];
  for (const r of rows) {
    const { match, total } = agreement(r);
    const counts = Object.entries(r.counts)
      .map(([k, [t, g]]) => `${k}:${t ?? '?'}→${g ?? '?'}${t === g ? '' : '✗'}`)
      .join(' ');
    const mats = Object.entries(r.materials)
      .map(([k, [t, g]]) => `${k}:${t ?? '?'}→${g ?? '?'}${t === g ? '' : '✗'}`)
      .join(' ');
    lines.push(
      `| ${r.id} | ${r.model} | ${match}/${total} | ${r.archetype[1]}${r.archetype[0] === r.archetype[1] ? '' : '✗'} | ` +
        `${r.subtype[1] ?? '—'}${r.subtype[0] === r.subtype[1] ? '' : '✗'} | ${counts || '—'} | ${mats || '—'} | ` +
        `${r.proportionsDelta.toFixed(2)} | ${r.seconds.toFixed(1)} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

export interface PartsEvalRow {
  id: string;
  model: string;
  /** Kit prompt version the free-parts call was asked with (1 = first prompt, 2 = Muse cards). */
  promptVersion: number;
  /** Parts in the answer; 0 when it could not be read. */
  parts: number;
  /** The answer builds: a readable recipe without a `recipeIssue`. */
  valid: boolean;
  seconds: number;
}

/**
 * One live free-parts answer per capture in `dir` (PQ-T12: the call had never been measured on the Muse
 * cards). There is no frozen truth for free parts: the rows say whether the answer builds, how many parts it
 * has and how long it took. `ids` limits the run (each capture costs one call).
 */
export async function evalParts(
  client: Pick<PerceptionClient, 'describeParts'>,
  dir: string,
  promptVersion: number = KIT_PROMPT_VERSION,
  ids?: ReadonlyArray<string>,
  signal?: AbortSignal
): Promise<PartsEvalRow[]> {
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.capture.json'))
    .map((f) => f.slice(0, -'.capture.json'.length))
    .sort();
  const rows: PartsEvalRow[] = [];
  for (const id of ids?.length ? all.filter((x) => ids.includes(x)) : all) {
    const { capture, cropPhoto } = await readCapture(dir, id);
    const url = `data:image/jpeg;base64,${cropPhoto.buffer.toString('base64')}`;
    const started = Date.now();
    const out = await client.describeParts(
      url,
      { label: capture.target.label, archetype: capture.kit.archetype, promptVersion },
      signal
    );
    const seconds = (Date.now() - started) / 1000;
    rows.push({
      id,
      model: out.model,
      promptVersion,
      parts: out.recipe?.parts.length ?? 0,
      valid: !!out.recipe && !recipeIssue(out.recipe),
      seconds,
    });
    console.info(
      `[eval] parts prompt ${promptVersion} ${id}: ${out.recipe?.parts.length ?? 0} parts, ${seconds.toFixed(1)} s`
    );
  }
  return rows;
}

/** Markdown table of the free-parts eval, one section per prompt version with its totals. */
export function partsEvalMarkdown(rows: PartsEvalRow[]): string {
  const versions = [...new Set(rows.map((r) => r.promptVersion))].sort((a, b) => a - b);
  return versions
    .map((v) => {
      const mine = rows.filter((r) => r.promptVersion === v);
      const secs = mine.map((r) => r.seconds).sort((a, b) => a - b);
      const median = secs.length ? secs[Math.floor((secs.length - 1) / 2)]! : 0;
      const mean = mine.length ? mine.reduce((n, r) => n + r.parts, 0) / mine.length : 0;
      return [
        `### Free parts, prompt v${v} — builds ${mine.filter((r) => r.valid).length}/${mine.length}, mean ${mean.toFixed(1)} parts, median ${median.toFixed(1)} s`,
        '',
        '| id | model | builds | parts | s |',
        '| -- | ----- | ------ | ----- | - |',
        ...mine.map(
          (r) =>
            `| ${r.id} | ${r.model} | ${r.valid ? '✓' : '✗'} | ${r.parts} | ${r.seconds.toFixed(1)} |`
        ),
        '',
      ].join('\n');
    })
    .join('\n');
}
